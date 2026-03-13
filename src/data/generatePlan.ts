import { getDefaultProvider, getDefaultModel, getApiKey } from "../components/UserSettings";
import { getDb } from "../db";
import type { ExecutionPlan, ExecutionPlanResult, AnalysisResult, Agent, Skill } from "./types";
import type { GitHubIssue } from "../github";
import { callLLM } from "./llm";
import { TOOLS } from "./tools";
import { reviewPlan, refinePlan } from "./criticPlan";

const PLAN_SYSTEM_PROMPT = `You are a senior software engineering project manager. Given a GitHub issue analysis, available agents, and their skills, create a concrete step-by-step execution plan to resolve the issue.

The plan is executed by an **issue LLM** (the controlling LLM) that has access to all sandboxed tools (${TOOLS.map((t) => t.name).join(", ")}) and works directly in the issue's worktree. The issue LLM does most of the work itself. It can optionally delegate specific steps to specialized agents when their focused expertise adds value.

Steps can depend on other steps. Be practical and direct — no filler.

The plan should be minimal: only include steps that are necessary to resolve the issue. Prefer fewer, well-scoped steps over many granular ones.

For each step:
- Most steps should be done by the issue LLM directly (leave agent_name null).
- Only assign an agent_name when a specialized agent would do the step better than the issue LLM working alone.
- skill_names can reference skills the issue LLM should load for context on that step, regardless of whether an agent is assigned.`;

export const PLAN_SCHEMA = {
  type: "object" as const,
  properties: {
    goal: { type: "string" as const, description: "One-sentence goal statement for the plan" },
    steps: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          order: { type: "number" as const, description: "Step number (1-based)" },
          title: { type: "string" as const, description: "Short step title" },
          description: { type: "string" as const, description: "What should be done in this step" },
          agent_name: { type: ["string", "null"] as const, description: "Name of a specialized agent to delegate to, or null if the issue LLM handles this step directly" },
          skill_names: {
            type: "array" as const,
            items: { type: "string" as const },
            description: "Skills to load for context on this step (used by the issue LLM or the assigned agent)",
          },
          expected_output: { type: "string" as const, description: "What this step should produce" },
          depends_on: {
            type: "array" as const,
            items: { type: "number" as const },
            description: "Order numbers of prerequisite steps",
          },
        },
        required: ["order", "title", "description", "agent_name", "skill_names", "expected_output", "depends_on"],
        additionalProperties: false,
      },
      description: "Ordered execution steps",
    },
    success_criteria: { type: "string" as const, description: "How to know the issue is resolved" },
  },
  required: ["goal", "steps", "success_criteria"],
  additionalProperties: false,
};

export function buildPlanPrompt(
  issue: GitHubIssue & { full_name: string },
  analysisResult: AnalysisResult,
  agents: Agent[],
  skills: Skill[],
): string {
  const parts = [
    `# Issue: ${issue.title}`,
    `Repo: ${issue.full_name} | #${issue.number} | State: ${issue.state}`,
  ];
  if (issue.body) {
    parts.push("", issue.body);
  }

  parts.push(
    "",
    "## Analysis",
    `Type: ${analysisResult.type} | Complexity: ${analysisResult.complexity}`,
    `Summary: ${analysisResult.summary}`,
    `Approach: ${analysisResult.approach}`,
  );

  if (analysisResult.considerations.length > 0) {
    parts.push("", "### Considerations");
    for (const c of analysisResult.considerations) {
      parts.push(`- ${c}`);
    }
  }

  if (agents.length > 0) {
    parts.push("", "## Available Agents");
    for (const a of agents) {
      parts.push(`- **${a.name}**: ${a.description}`);
    }
  }

  if (skills.length > 0) {
    parts.push("", "## Available Skills");
    for (const s of skills) {
      parts.push(`- **${s.name}**: ${s.description || "(no description)"}`);
    }
  }

  parts.push(
    "",
    "Create an execution plan. Most steps should be handled directly by the issue LLM (agent_name: null). Only delegate to a named agent when its specialization adds clear value. Only reference skills and agents that exist above.",
  );

  return parts.join("\n");
}

async function updatePlan(id: string, updates: Partial<ExecutionPlan>): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const [key, val] of Object.entries(updates)) {
    sets.push(`${key} = $${i++}`);
    values.push(val);
  }
  sets.push(`updated_at = $${i++}`);
  values.push(new Date().toISOString());
  values.push(id);
  await db.execute(`UPDATE execution_plans SET ${sets.join(", ")} WHERE id = $${i}`, values);
}

export async function runPlanGeneration(
  plan: ExecutionPlan,
  issue: GitHubIssue & { full_name: string },
  analysisResult: AnalysisResult,
  agents: Agent[],
  skills: Skill[],
  onUpdate: (p: ExecutionPlan) => void,
): Promise<void> {
  const provider = getDefaultProvider();
  const modelId = getDefaultModel();
  console.log("[plan] start", { provider, modelId, issue: `${issue.full_name}#${issue.number}` });

  if (!provider || !modelId) {
    const msg = "No default provider/model configured. Set one in Settings.";
    console.warn("[plan] abort:", msg);
    await updatePlan(plan.id, { status: "error", error: msg });
    onUpdate({ ...plan, status: "error", error: msg });
    return;
  }

  const apiKey = getApiKey(provider);
  if (!apiKey) {
    const msg = `No API key configured for ${provider}. Add one in Settings.`;
    console.warn("[plan] abort:", msg);
    await updatePlan(plan.id, { status: "error", error: msg });
    onUpdate({ ...plan, status: "error", error: msg });
    return;
  }

  try {
    await updatePlan(plan.id, { status: "running" });
    onUpdate({ ...plan, status: "running" });

    const prompt = buildPlanPrompt(issue, analysisResult, agents, skills);
    console.log("[plan] calling", provider, modelId, "prompt length:", prompt.length);

    const text = await callLLM({
      provider,
      modelId,
      apiKey,
      systemPrompt: PLAN_SYSTEM_PROMPT,
      userPrompt: prompt,
      schema: PLAN_SCHEMA,
      schemaName: "execution_plan",
      maxTokens: 2048,
    });
    console.log("[plan] success, response length:", text.length);

    let parsed: ExecutionPlanResult = JSON.parse(text);
    if (!parsed.goal || !parsed.steps || !parsed.success_criteria) {
      throw new Error("Invalid plan response: missing required fields");
    }

    // Critic review: validate the generated plan
    console.log("[plan] running critic review");
    let criticReview = await reviewPlan(parsed, issue, analysisResult, provider, modelId, apiKey);

    if (criticReview.verdict === "fail") {
      console.log("[plan] critic failed plan, refining (1 cycle)");
      parsed = await refinePlan(
        parsed,
        criticReview,
        issue,
        analysisResult,
        agents,
        skills,
        PLAN_SCHEMA,
        buildPlanPrompt,
        provider,
        modelId,
        apiKey,
      );
      // Re-review the refined plan so the stored verdict reflects the final state
      criticReview = await reviewPlan(parsed, issue, analysisResult, provider, modelId, apiKey);
      console.log("[plan] post-refinement critic verdict:", criticReview.verdict);
    }

    parsed.critic_review = criticReview;
    const result = JSON.stringify(parsed);

    await updatePlan(plan.id, { status: "done", result });
    onUpdate({ ...plan, status: "done", result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[plan] error:", message);
    await updatePlan(plan.id, { status: "error", error: message });
    onUpdate({ ...plan, status: "error", error: message });
  }
}
