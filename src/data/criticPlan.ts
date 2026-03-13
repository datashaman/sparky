import { callLLM } from "./llm";
import type { AgentProvider, ExecutionPlanResult, AnalysisResult, CriticReview, Agent, Skill } from "./types";
import type { GitHubIssue } from "../github";

const CRITIC_SYSTEM_PROMPT = `You are a senior engineering critic reviewing an execution plan for resolving a GitHub issue.

Evaluate the plan for:
- **Missing steps**: Are there obvious tasks the plan forgot?
- **Bad dependencies**: Are step dependencies correct and complete?
- **Over-decomposition**: Are steps too granular when they could be combined?
- **Feasibility**: Can each step actually be accomplished with the available tools and context?
- **Ordering**: Are steps in a logical order?

Be practical. Only flag real problems, not stylistic preferences. A good plan with minor wording issues should pass.`;

const CRITIC_SCHEMA = {
  type: "object" as const,
  properties: {
    verdict: {
      type: "string" as const,
      enum: ["pass", "fail"],
      description: "pass if the plan is acceptable (possibly with minor warnings), fail if it has serious issues that must be fixed",
    },
    issues: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          severity: { type: "string" as const, enum: ["error", "warning", "info"] },
          step_order: { type: ["number", "null"] as const, description: "Step order number this issue refers to, or null for plan-level issues" },
          description: { type: "string" as const, description: "What the issue is" },
          suggestion: { type: "string" as const, description: "How to fix it" },
        },
        required: ["severity", "description", "suggestion", "step_order"],
        additionalProperties: false,
      },
    },
    summary: { type: "string" as const, description: "One-sentence summary of the review" },
  },
  required: ["verdict", "issues", "summary"],
  additionalProperties: false,
};

const REFINE_SYSTEM_PROMPT = `You are a senior software engineering project manager. You are given a plan that was reviewed by a critic and found lacking. Improve the plan based on the critic's feedback.

Fix the issues raised by the critic while preserving any good parts of the original plan. Return a complete, corrected plan.`;

export async function reviewPlan(
  planResult: ExecutionPlanResult,
  issue: GitHubIssue & { full_name: string },
  analysisResult: AnalysisResult,
  provider: AgentProvider,
  modelId: string,
  apiKey: string,
): Promise<CriticReview> {
  const prompt = [
    `# Issue: ${issue.title} (#${issue.number}) in ${issue.full_name}`,
    issue.body ? `\n${issue.body}` : "",
    "",
    `## Analysis`,
    `Type: ${analysisResult.type} | Complexity: ${analysisResult.complexity}`,
    `Summary: ${analysisResult.summary}`,
    `Approach: ${analysisResult.approach}`,
    "",
    `## Plan to Review`,
    `Goal: ${planResult.goal}`,
    `Success Criteria: ${planResult.success_criteria}`,
    "",
    "### Steps",
    ...planResult.steps.map(
      (s) =>
        `${s.order}. **${s.title}** — ${s.description}\n   Agent: ${s.agent_name ?? "issue LLM"} | Skills: ${s.skill_names.join(", ") || "none"} | Depends on: ${s.depends_on.join(", ") || "none"}\n   Expected: ${s.expected_output}`,
    ),
    "",
    "Review this plan. Only fail it if there are serious issues.",
  ].join("\n");

  console.log("[critic] reviewing plan, prompt length:", prompt.length);

  const text = await callLLM({
    provider,
    modelId,
    apiKey,
    systemPrompt: CRITIC_SYSTEM_PROMPT,
    userPrompt: prompt,
    schema: CRITIC_SCHEMA,
    schemaName: "critic_review",
    maxTokens: 1024,
  });

  const review: CriticReview = JSON.parse(text);
  console.log("[critic] verdict:", review.verdict, "issues:", review.issues.length);
  return review;
}

export async function refinePlan(
  planResult: ExecutionPlanResult,
  review: CriticReview,
  issue: GitHubIssue & { full_name: string },
  analysisResult: AnalysisResult,
  agents: Agent[],
  skills: Skill[],
  planSchema: Record<string, unknown>,
  buildPromptFn: (
    issue: GitHubIssue & { full_name: string },
    analysisResult: AnalysisResult,
    agents: Agent[],
    skills: Skill[],
  ) => string,
  provider: AgentProvider,
  modelId: string,
  apiKey: string,
): Promise<ExecutionPlanResult> {
  const criticFeedback = [
    `## Critic Feedback (verdict: ${review.verdict})`,
    review.summary,
    "",
    ...review.issues.map(
      (i) =>
        `- [${i.severity}]${i.step_order !== null ? ` Step ${i.step_order}:` : ""} ${i.description}\n  Suggestion: ${i.suggestion}`,
    ),
  ].join("\n");

  const originalContext = buildPromptFn(issue, analysisResult, agents, skills);

  const prompt = [
    originalContext,
    "",
    "## Original Plan",
    JSON.stringify(planResult, null, 2),
    "",
    criticFeedback,
    "",
    "Produce a corrected plan that addresses the critic's feedback.",
  ].join("\n");

  console.log("[critic] refining plan, prompt length:", prompt.length);

  const text = await callLLM({
    provider,
    modelId,
    apiKey,
    systemPrompt: REFINE_SYSTEM_PROMPT,
    userPrompt: prompt,
    schema: planSchema,
    schemaName: "execution_plan",
    maxTokens: 2048,
  });

  const refined: ExecutionPlanResult = JSON.parse(text);
  console.log("[critic] refined plan: steps:", refined.steps.length);
  return refined;
}
