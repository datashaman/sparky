import { getDefaultProvider, getDefaultModel, getApiKey } from "../components/UserSettings";
import { getDb } from "../db";
import type { ExecutionPlan, AnalysisResult, Agent, Skill } from "./types";
import type { GitHubIssue } from "../github";
import { callLLM } from "./llm";
import { TOOLS } from "./tools";

const PLAN_SYSTEM_PROMPT = `You are a senior software engineering project manager. Given a GitHub issue analysis, available agents, and their skills, create a concrete step-by-step execution plan to resolve the issue.

Each step must be delegated to a specific agent. Steps can depend on other steps. Be practical and direct — no filler.

The plan should be minimal: only include steps that are necessary to resolve the issue. Prefer fewer, well-scoped steps over many granular ones.

Agents have access to sandboxed tools for interacting with issue worktrees. Available tools: ${TOOLS.map((t) => `${t.name} (${t.description}${t.dangerous ? " — dangerous" : ""})`).join(", ")}. When specifying tool_names for a step, choose the minimal set of tools needed. Read-only steps need only Read/Glob/Grep. Steps that modify code need Write/Edit. Steps that run commands need Bash.`;

const PLAN_SCHEMA = {
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
          description: { type: "string" as const, description: "What the agent should do in this step" },
          agent_name: { type: "string" as const, description: "Name of the agent to delegate to" },
          skill_names: {
            type: "array" as const,
            items: { type: "string" as const },
            description: "Skills the agent should use for this step",
          },
          tool_names: {
            type: "array" as const,
            items: { type: "string" as const, enum: TOOLS.map((t) => t.id) },
            description: "Tool IDs the agent needs for this step (e.g. read, write, edit, glob, grep, bash)",
          },
          expected_output: { type: "string" as const, description: "What this step should produce" },
          depends_on: {
            type: "array" as const,
            items: { type: "number" as const },
            description: "Order numbers of prerequisite steps",
          },
        },
        required: ["order", "title", "description", "agent_name", "skill_names", "tool_names", "expected_output", "depends_on"],
        additionalProperties: false,
      },
      description: "Ordered execution steps",
    },
    success_criteria: { type: "string" as const, description: "How to know the issue is resolved" },
  },
  required: ["goal", "steps", "success_criteria"],
  additionalProperties: false,
};

function buildPlanPrompt(
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
    "Create an execution plan using the available agents and skills. Each step must reference an agent by name. Only reference skills and agents that exist above.",
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

    const parsed = JSON.parse(text);
    if (!parsed.goal || !parsed.steps || !parsed.success_criteria) {
      throw new Error("Invalid plan response: missing required fields");
    }
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
