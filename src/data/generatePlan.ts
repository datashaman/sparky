import { getDefaultProvider, getDefaultModel, getApiKey } from "../components/UserSettings";
import type { ExecutionPlan, ExecutionPlanResult, AnalysisResult, Agent, Skill } from "./types";
import type { GitHubIssue } from "../github";
import { callLLMWithTools, KEYLESS_PROVIDERS } from "./llm";
import { TOOLS, TOOL_SCHEMAS, createToolCallHandler, createAskUserInterceptor, type AskUserHandler, type SkillResolver } from "./tools";
import { ensureWorktree } from "./issueWorktrees";
import { extractJSON } from "./jsonExtract";
import { reviewPlan, refinePlan } from "./criticPlan";
import { dynamicUpdate } from "./dbUtils";

const PLAN_SYSTEM_PROMPT = `You are a senior software engineering project manager. Given a GitHub issue analysis, available agents, and available skills, create a concrete step-by-step execution plan to resolve the issue.

## Tools available to you during planning

You have access to tools to help you create a better plan:
- **ask_user** — Ask the user clarifying questions about priorities, scope, or approach. If you are unsure about something, ask.
- **use_skill** — Load domain-specific knowledge from available skills.
- **read_file**, **glob**, **grep** — Explore the codebase to understand project structure and existing patterns before planning.
- **bash** — Run shell commands to check dependencies, build config, etc.

Use these tools as needed before producing your final plan.

## How execution works

The plan is executed by an **issue LLM** (the controlling LLM) that has access to sandboxed tools (${TOOLS.map((t) => t.name).join(", ")}) and works directly in the issue's worktree. The issue LLM does most of the work itself. It can optionally delegate specific steps to specialized agents when their focused expertise adds value.

The issue LLM also has a **use_skill** tool that lets it load any available skill on demand during execution, and an **ask_user** tool to request clarification from the user. You do NOT need to plan for skill loading or user questions — the LLM will invoke them as needed at runtime.

Steps can depend on other steps. Be practical and direct — no filler.

The plan should be minimal: only include steps that are necessary to resolve the issue. Prefer fewer, well-scoped steps over many granular ones. Every step must represent real work (exploring code, making changes, running tests).

For each step:
- Most steps should be done by the issue LLM directly (leave agent_name null).
- Only assign an agent_name when a specialized agent would do the step better than the issue LLM working alone.

## Step design guidelines
- Prefer steps that deliver a complete vertical slice (e.g., model + API + test) over horizontal layers (all models, then all APIs).
- Each step MUST have a concrete, verifiable output — not "understand the codebase".
- Steps with no shared file dependencies can potentially run in parallel. Note this in the step description but keep order numbers unique and sequential.
- Include a \`verification_command\` (e.g. "npm test", "npx tsc --noEmit") and \`done_when\` criteria for each step where applicable.

## Anti-patterns to avoid
- Do NOT create steps that only read/explore code — combine exploration with the step that uses the findings.
- Do NOT create a final "testing" step — each step should verify its own work.
- Do NOT over-decompose. A 3-step plan that works is better than a 10-step plan that's fragile.`;

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
          expected_output: { type: "string" as const, description: "What this step should produce" },
          depends_on: {
            type: "array" as const,
            items: { type: "number" as const },
            description: "Order numbers of prerequisite steps",
          },
          verification_command: { type: ["string", "null"] as const, description: "Command to verify step completion (e.g. 'npm test', 'npx tsc --noEmit'), or null if not applicable" },
          done_when: { type: "string" as const, description: "Explicit completion criteria for this step" },
        },
        required: ["order", "title", "description", "agent_name", "expected_output", "depends_on", "verification_command", "done_when"],
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
    parts.push("", "## Available Skills (accessible at runtime via use_skill tool)");
    parts.push("The issue LLM can call the `use_skill` tool at any time during execution to load a skill's content. The tool takes a required `skill_name` field and an optional `arguments` field to customize the skill's output. You do NOT need to plan skill usage — the LLM will invoke skills as needed.");
    for (const s of skills) {
      parts.push(`- **${s.name}**: ${s.description || "(no description)"}`);
    }
  }

  parts.push(
    "",
    "Create an execution plan. Every step must be real work (exploring code, making edits, running tests). Only delegate to a named agent when its specialization adds clear value. Only reference agents that exist above.",
  );

  return parts.join("\n");
}

async function updatePlan(id: string, updates: Partial<ExecutionPlan>): Promise<void> {
  await dynamicUpdate("execution_plans", id, updates);
}

export async function runPlanGeneration(
  plan: ExecutionPlan,
  issue: GitHubIssue & { full_name: string },
  analysisResult: AnalysisResult,
  agents: Agent[],
  skills: Skill[],
  onUpdate: (p: ExecutionPlan) => void,
  onAskUser?: AskUserHandler,
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
  if (!apiKey && !KEYLESS_PROVIDERS.has(provider)) {
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

    // Ensure worktree exists so file/shell tools can explore the codebase
    const accessToken = localStorage.getItem("github_token") ?? "";
    if (!accessToken) {
      throw new Error("No GitHub token. Please log in.");
    }
    const worktree = await ensureWorktree(
      plan.workspace_id,
      issue.full_name,
      issue.number,
      accessToken,
      () => {},
    );

    // Build skill resolver and tool handler
    const skillsByName = new Map(skills.map((s) => [s.name, s]));
    const skillResolver: SkillResolver = (skillName, args) => {
      const skill = skillsByName.get(skillName);
      if (!skill?.content) return null;
      return args ? `${skill.content}\n\n## Arguments\n${args}` : skill.content;
    };

    const PLAN_TOOL_NAMES = new Set(["list_files", "read_file", "glob", "grep", "bash", "ask_user", "use_skill"]);
    const planTools = TOOL_SCHEMAS.filter((t) => PLAN_TOOL_NAMES.has(t.name));

    const baseHandler = createToolCallHandler(worktree.path, skillResolver);
    const toolHandler = createAskUserInterceptor(onAskUser, baseHandler);

    const schemaInstruction = `\n\nWhen you are ready to provide your final plan, respond with a JSON object matching this schema:\n${JSON.stringify(PLAN_SCHEMA, null, 2)}`;

    const text = await callLLMWithTools({
      provider,
      modelId,
      apiKey,
      systemPrompt: PLAN_SYSTEM_PROMPT + schemaInstruction,
      userPrompt: prompt,
      tools: planTools,
      maxTurns: 15,
      onToolCall: toolHandler,
    });
    console.log("[plan] success, response length:", text.length);

    let parsed = extractJSON(text) as ExecutionPlanResult;
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
