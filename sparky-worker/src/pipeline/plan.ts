import type { SessionConfig, StartSessionPayload, ExecutionLogEntry, AnalysisResult, Agent, Skill } from "../types.js";
import { updateSession, updateExistingTable, getSkillsForWorkspace, getAgentsForWorkspace } from "../db.js";
import { callLLM, callLLMWithTools, KEYLESS_PROVIDERS } from "../llm/index.js";
import { TOOL_SCHEMAS, createToolHandler } from "../tools/index.js";
import { buildSkillResolver } from "../tools/skill-tool.js";
import { createAskUserHandler } from "../tools/ask-user-tool.js";
import { isSessionCancelled } from "../session-manager.js";
import { extractJSONWithRetry } from "../util.js";
import { readRepoContext } from "../repo-context.js";

const TOOL_IDS = ["list_files", "read_file", "glob", "grep", "bash", "ask_user", "use_skill"];

export interface PlanPipelineOpts {
  sessionId: string;
  payload: StartSessionPayload;
  config: SessionConfig;
  onLog: (stepOrder: number, entry: Omit<ExecutionLogEntry, "timestamp" | "stepOrder">) => void;
}

export async function runPlanPipeline(opts: PlanPipelineOpts): Promise<void> {
  const { sessionId, payload, config, onLog } = opts;
  const { workspace_id, repo_full_name, issue_number } = payload;

  const provider = config.default_provider;
  const modelId = config.default_model;
  const apiKey = config.default_api_key;

  if (!provider || !modelId) throw new Error("No default provider/model configured.");
  if (!apiKey && !KEYLESS_PROVIDERS.has(provider)) throw new Error(`No API key for ${provider}.`);
  if (isSessionCancelled(sessionId)) return;

  const analysisResult = payload.analysis_result;
  if (!analysisResult) throw new Error("Plan generation requires an analysis result.");

  updateSession(sessionId, { current_phase: "plan" });

  if (payload.plan_id) {
    updateExistingTable("execution_plans", payload.plan_id, { status: "running" });
  }

  const agents = getAgentsForWorkspace(workspace_id);
  const skills = getSkillsForWorkspace(workspace_id);

  const worktreePath = await resolveWorktreePath(repo_full_name, issue_number);

  const skillResolver = buildSkillResolver(workspace_id);
  const askUserHandler = createAskUserHandler(sessionId, 0, config.ask_user_timeout_minutes);
  const toolHandler = createToolHandler(worktreePath, skillResolver, askUserHandler);

  const planTools = TOOL_SCHEMAS.filter((t) => TOOL_IDS.includes(t.name));

  const repoContext = readRepoContext(worktreePath, 2000);
  const systemPrompt = buildPlanSystemPrompt() + (repoContext ? `\n\n${repoContext}` : "");
  const baseUserPrompt = buildPlanUserPrompt(payload, analysisResult, agents, skills);

  const schemaInstruction = `\n\nIMPORTANT: When you are ready to provide your final plan, you MUST respond with ONLY a JSON object (no prose, no explanation) matching this schema:\n${JSON.stringify(PLAN_SCHEMA, null, 2)}`;
  const userPrompt = baseUserPrompt + schemaInstruction;

  const stepLog = (partial: Omit<ExecutionLogEntry, "timestamp" | "stepOrder">) => onLog(0, partial);
  stepLog({ type: "info", message: `Starting plan generation (${provider}/${modelId})` });

  const { text } = await callLLMWithTools({
    provider,
    modelId,
    apiKey,
    systemPrompt,
    userPrompt,
    tools: planTools,
    maxTurns: 15,
    onToolCall: toolHandler,
    onLog: stepLog,
  });

  let parsed = await extractJSONWithRetry({
    text,
    schema: PLAN_SCHEMA,
    schemaName: "execution_plan",
    provider,
    modelId,
    apiKey,
    onRetry: () => stepLog({ type: "info", message: "JSON extraction failed, retrying with focused prompt" }),
  }) as Record<string, unknown>;
  if (!parsed.goal || !parsed.steps || !parsed.success_criteria) {
    throw new Error("Invalid plan response: missing required fields");
  }

  // Critic review
  stepLog({ type: "info", message: "Running critic review" });
  let criticReview = await reviewPlan(parsed, payload, analysisResult, provider, modelId, apiKey);

  if (criticReview.verdict === "fail") {
    stepLog({ type: "info", message: "Critic failed plan, refining" });
    parsed = await refinePlan(parsed, criticReview, payload, analysisResult, agents, skills, provider, modelId, apiKey);
    criticReview = await reviewPlan(parsed, payload, analysisResult, provider, modelId, apiKey);
  }

  (parsed as Record<string, unknown>).critic_review = criticReview;
  const result = JSON.stringify(parsed);

  if (payload.plan_id) {
    updateExistingTable("execution_plans", payload.plan_id, { status: "done", result });
  }
}

async function resolveWorktreePath(repoFullName: string, issueNumber: number): Promise<string> {
  const { getDb } = await import("../db.js");
  const row = getDb()
    .prepare("SELECT path FROM issue_worktrees WHERE repo_full_name = ? AND issue_number = ? AND status = 'ready'")
    .get(repoFullName, issueNumber) as { path: string } | undefined;
  if (!row) throw new Error(`No ready worktree for ${repoFullName}#${issueNumber}.`);
  return row.path;
}

async function reviewPlan(
  planResult: Record<string, unknown>,
  payload: StartSessionPayload,
  analysisResult: AnalysisResult,
  provider: string,
  modelId: string,
  apiKey: string,
): Promise<{ verdict: "pass" | "fail"; issues: unknown[]; summary: string }> {
  const prompt = [
    `# Issue: ${payload.issue_title} (#${payload.issue_number}) in ${payload.repo_full_name}`,
    payload.issue_body ? `\n${payload.issue_body}` : "",
    "",
    `## Analysis`,
    `Type: ${analysisResult.type} | Complexity: ${analysisResult.complexity}`,
    `Summary: ${analysisResult.summary}`,
    "",
    `## Plan to Review`,
    JSON.stringify(planResult, null, 2),
    "",
    "Review this plan. Only fail it if there are serious issues.",
  ].join("\n");

  const text = await callLLM({
    provider: provider as any,
    modelId,
    apiKey,
    systemPrompt: CRITIC_SYSTEM_PROMPT,
    userPrompt: prompt,
    schema: CRITIC_SCHEMA,
    schemaName: "critic_review",
    maxTokens: 1024,
  });

  return JSON.parse(text);
}

async function refinePlan(
  planResult: Record<string, unknown>,
  review: { verdict: string; issues: unknown[]; summary: string },
  payload: StartSessionPayload,
  analysisResult: AnalysisResult,
  agents: Agent[],
  skills: Skill[],
  provider: string,
  modelId: string,
  apiKey: string,
): Promise<Record<string, unknown>> {
  const prompt = [
    buildPlanUserPrompt(payload, analysisResult, agents, skills),
    "",
    "## Original Plan",
    JSON.stringify(planResult, null, 2),
    "",
    `## Critic Feedback (verdict: ${review.verdict})`,
    review.summary,
    "",
    "Produce a corrected plan.",
  ].join("\n");

  const text = await callLLM({
    provider: provider as any,
    modelId,
    apiKey,
    systemPrompt: "You are a senior project manager. Fix the plan based on critic feedback.",
    userPrompt: prompt,
    schema: PLAN_SCHEMA,
    schemaName: "execution_plan",
    maxTokens: 2048,
  });

  return JSON.parse(text);
}

function buildPlanSystemPrompt(): string {
  return `You are a senior software engineering project manager. Given a GitHub issue analysis, create a step-by-step execution plan.

## Tools available during planning
- **ask_user** — Ask clarifying questions.
- **use_skill** — Load domain-specific knowledge.
- **read_file**, **glob**, **grep** — Explore the codebase.
- **bash** — Run shell commands.

The plan is executed by an issue LLM with sandboxed tools. Steps can delegate to agents.
Be minimal: only include necessary steps. Prefer fewer, well-scoped steps.

## Step design guidelines
- Prefer steps that deliver a complete vertical slice (e.g., model + API + test) over horizontal layers (all models, then all APIs).
- Each step MUST have a concrete, verifiable output — not "understand the codebase".
- Steps with no shared file dependencies can potentially run in parallel. Note this in the step description but keep order numbers unique and sequential.
- Include a \`verification_command\` (e.g. "npm test", "npx tsc --noEmit") and \`done_when\` criteria for each step where applicable.

## Anti-patterns to avoid
- Do NOT create steps that only read/explore code — combine exploration with the step that uses the findings.
- Do NOT create a final "testing" step — each step should verify its own work.
- Do NOT over-decompose. A 3-step plan that works is better than a 10-step plan that's fragile.`;
}

function buildPlanUserPrompt(
  payload: StartSessionPayload,
  analysisResult: AnalysisResult,
  agents: Agent[],
  skills: Skill[],
): string {
  const parts = [
    `# Issue: ${payload.issue_title}`,
    `Repo: ${payload.repo_full_name} | #${payload.issue_number}`,
    payload.issue_body ? `\n${payload.issue_body}` : "",
    "",
    `## Analysis`,
    `Type: ${analysisResult.type} | Complexity: ${analysisResult.complexity}`,
    `Summary: ${analysisResult.summary}`,
    `Approach: ${analysisResult.approach}`,
  ];

  if (analysisResult.considerations.length > 0) {
    parts.push("", "### Considerations", ...analysisResult.considerations.map((c) => `- ${c}`));
  }
  if (agents.length > 0) {
    parts.push("", "## Available Agents", ...agents.map((a) => `- **${a.name}**: ${a.description}`));
  }
  if (skills.length > 0) {
    parts.push("", "## Available Skills", ...skills.map((s) => `- **${s.name}**: ${s.description || "(no description)"}`));
  }

  return parts.join("\n");
}

const PLAN_SCHEMA = {
  type: "object" as const,
  properties: {
    goal: { type: "string" as const },
    steps: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          order: { type: "number" as const },
          title: { type: "string" as const },
          description: { type: "string" as const },
          agent_name: { type: ["string", "null"] as const },
          expected_output: { type: "string" as const },
          depends_on: { type: "array" as const, items: { type: "number" as const } },
          verification_command: { type: ["string", "null"] as const, description: "Command to verify step completion (e.g. 'npm test', 'npx tsc --noEmit'), or null if not applicable" },
          done_when: { type: "string" as const, description: "Explicit completion criteria for this step" },
        },
        required: ["order", "title", "description", "agent_name", "expected_output", "depends_on", "verification_command", "done_when"],
        additionalProperties: false,
      },
    },
    success_criteria: { type: "string" as const },
  },
  required: ["goal", "steps", "success_criteria"],
  additionalProperties: false,
};

const CRITIC_SYSTEM_PROMPT = `You are a senior engineering critic reviewing an execution plan.

Evaluate for: missing steps, bad dependencies, over-decomposition, feasibility, ordering.
Be practical. Only flag real problems. A good plan with minor issues should pass.

For each step, verify:
- It contributes directly to the stated goal. Remove steps that don't.
- It has a concrete, verifiable output (not "understand X" or "explore Y").
- It doesn't duplicate work done by another step.
- The verification_command and done_when fields are specific enough to objectively assess completion.`;

const CRITIC_SCHEMA = {
  type: "object" as const,
  properties: {
    verdict: { type: "string" as const, enum: ["pass", "fail"] },
    issues: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          severity: { type: "string" as const, enum: ["error", "warning", "info"] },
          step_order: { type: ["number", "null"] as const },
          description: { type: "string" as const },
          suggestion: { type: "string" as const },
        },
        required: ["severity", "description", "suggestion", "step_order"],
        additionalProperties: false,
      },
    },
    summary: { type: "string" as const },
  },
  required: ["verdict", "issues", "summary"],
  additionalProperties: false,
};
