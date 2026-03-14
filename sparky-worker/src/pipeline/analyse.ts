import type { SessionConfig, StartSessionPayload, ExecutionLogEntry } from "../types.js";
import { updateSession, updateExistingTable, getSkillsForWorkspace, getAgentsForWorkspace } from "../db.js";
import { callLLMWithTools, KEYLESS_PROVIDERS } from "../llm/index.js";
import { TOOL_SCHEMAS, createToolHandler } from "../tools/index.js";
import { buildSkillResolver } from "../tools/skill-tool.js";
import { createAskUserHandler } from "../tools/ask-user-tool.js";
import { isSessionCancelled } from "../session-manager.js";
import { extractJSONWithRetry } from "../util.js";
import { readRepoContext } from "../repo-context.js";

const TOOL_IDS = ["list_files", "read_file", "glob", "grep", "bash", "ask_user", "use_skill", "create_issue", "update_issue", "close_issue"];

export interface AnalysisPipelineOpts {
  sessionId: string;
  payload: StartSessionPayload;
  config: SessionConfig;
  onLog: (stepOrder: number, entry: Omit<ExecutionLogEntry, "timestamp" | "stepOrder">) => void;
}

export async function runAnalysisPipeline(opts: AnalysisPipelineOpts): Promise<void> {
  const { sessionId, payload, config, onLog } = opts;
  const { workspace_id, repo_full_name, issue_number, issue_title, issue_body } = payload;

  const provider = config.default_provider;
  const modelId = config.default_model;
  const apiKey = config.default_api_key;

  if (!provider || !modelId) throw new Error("No default provider/model configured.");
  if (!apiKey && !KEYLESS_PROVIDERS.has(provider)) throw new Error(`No API key for ${provider}.`);
  if (isSessionCancelled(sessionId)) return;

  updateSession(sessionId, { current_phase: "analysis" });

  // Update the analysis record to running
  if (payload.analysis_id) {
    updateExistingTable("issue_analyses", payload.analysis_id, { status: "running" });
  }

  const [skills, agents] = [
    getSkillsForWorkspace(workspace_id),
    getAgentsForWorkspace(workspace_id),
  ];

  const worktreePath = await resolveWorktreePath(repo_full_name, issue_number, config.github_token);

  const skillResolver = buildSkillResolver(workspace_id);
  const askUserHandler = createAskUserHandler(sessionId, 0, config.ask_user_timeout_minutes);
  const githubContext = { token: config.github_token, repoFullName: repo_full_name, parentIssueNumber: issue_number };
  const toolHandler = createToolHandler(worktreePath, skillResolver, askUserHandler, githubContext);

  const analysisTools = TOOL_SCHEMAS.filter((t) => TOOL_IDS.includes(t.name));

  const repoContext = readRepoContext(worktreePath, 2000);
  const systemPrompt = buildAnalysisSystemPrompt(skills, agents) + (repoContext ? `\n\n${repoContext}` : "");
  const baseUserPrompt = buildAnalysisUserPrompt(payload, skills, agents);

  const schemaInstruction = `\n\nIMPORTANT: When you are ready to provide your final analysis, you MUST respond with ONLY a JSON object (no prose, no explanation) matching this schema:\n${JSON.stringify(ANALYSIS_SCHEMA, null, 2)}`;
  const userPrompt = baseUserPrompt + schemaInstruction;

  const stepLog = (partial: Omit<ExecutionLogEntry, "timestamp" | "stepOrder">) => onLog(0, partial);
  const startTime = Date.now();
  stepLog({ type: "info", message: `Starting analysis (${provider}/${modelId})` });

  const { text } = await callLLMWithTools({
    provider,
    modelId,
    apiKey,
    systemPrompt,
    userPrompt,
    tools: analysisTools,
    maxTurns: 10,
    onToolCall: toolHandler,
    onLog: stepLog,
  });

  const parsed = await extractJSONWithRetry({
    text,
    schema: ANALYSIS_SCHEMA,
    schemaName: "analysis",
    provider,
    modelId,
    apiKey,
    onRetry: () => stepLog({ type: "info", message: "JSON extraction failed, retrying with focused prompt" }),
  }) as Record<string, unknown>;
  repairAnalysisResponse(parsed);
  if (!parsed.summary || !parsed.type || !parsed.complexity) {
    throw new Error("Invalid analysis response: missing required fields (summary, type, or complexity)");
  }

  const duration = Math.round((Date.now() - startTime) / 1000);
  stepLog({ type: "info", message: `Analysis completed in ${duration}s` });

  const result = JSON.stringify(parsed);
  const status = parsed.decomposed === true ? "decomposed" : "done";

  if (payload.analysis_id) {
    updateExistingTable("issue_analyses", payload.analysis_id, { status, result });
  }
}

/**
 * Fill missing fields in an analysis response with sensible defaults.
 * Small models often omit array fields or optional fields.
 */
function repairAnalysisResponse(parsed: Record<string, unknown>): void {
  if (!parsed.complexity_reason && parsed.complexity) {
    parsed.complexity_reason = `Assessed as ${parsed.complexity}`;
  }
  if (!Array.isArray(parsed.considerations)) {
    parsed.considerations = [];
  }
  if (!parsed.approach && parsed.summary) {
    parsed.approach = String(parsed.summary);
  }
  if (!Array.isArray(parsed.skills)) {
    parsed.skills = [];
  }
  if (!Array.isArray(parsed.agents)) {
    parsed.agents = [];
  }
}

async function resolveWorktreePath(repoFullName: string, issueNumber: number, _token: string): Promise<string> {
  // The worktree should already exist — resolve its path from the DB
  const { getDb } = await import("../db.js");
  const row = getDb()
    .prepare("SELECT path FROM issue_worktrees WHERE repo_full_name = ? AND issue_number = ? AND status = 'ready'")
    .get(repoFullName, issueNumber) as { path: string } | undefined;

  if (!row) {
    throw new Error(`No ready worktree found for ${repoFullName}#${issueNumber}. Ensure worktree is created before starting session.`);
  }
  return row.path;
}

function buildAnalysisSystemPrompt(skills: { name: string; description: string | null }[], agents: { name: string; description: string }[]): string {
  const toolNames = "List Files, Read, Glob, Grep, Bash, Skill, Ask User";
  return `You are a senior software engineer analysing a GitHub issue. Provide a concise, structured analysis. Be direct and practical. No filler.

## Tools available to you during analysis

You have access to tools during analysis:
- **ask_user** — Ask the user clarifying questions.
- **use_skill** — Load domain-specific knowledge from available skills.
- **read_file**, **glob**, **grep** — Explore the codebase.
- **bash** — Run shell commands.
- **create_issue** — Create a GitHub subissue linked to the parent issue.
- **update_issue** — Update a subissue's title or body.
- **close_issue** — Close a subissue you created (cannot close other issues).

## Investigation steps

Follow these steps before producing your final analysis:
1. Read the issue and identify the affected area of the codebase.
2. Use glob/grep to find relevant files and understand the project structure.
3. Read the relevant files to understand the current implementation.
4. Check for existing tests in the affected area.
5. Identify any ambiguities or gray areas in the issue that could lead to misinterpretation. Use ask_user for clarification on these.
6. THEN produce your structured analysis as a JSON response matching the required schema.

## Constraints
- Do not read the same file more than twice.
- Do not run more than 3 grep searches for the same concept.
- Use glob to check if files exist before reading them.

## How the system works

An **issue LLM** works on resolving the issue with sandboxed tools (${toolNames}).

The issue LLM can activate **agents** and **skills**:
- **Skills**: Reusable bodies of knowledge. Every skill MUST have content.
- **Agents**: Autonomous AI workers. Every agent MUST have content (system prompt).

## When recommending skills and agents
- Check existing ones first. Prefer referencing existing ones by name.
- Only recommend new ones when existing ones don't cover the need.

## Complexity-driven decomposition

If you determine the issue is **high** complexity, decompose it into smaller, independently resolvable subissues:
1. Identify 2-5 logical subissues that together resolve the parent issue.
2. Use \`create_issue\` for each subissue. Include enough context in each body for it to be worked on independently.
3. In your final JSON response, set \`decomposed\` to \`true\` and list the created subissue numbers in \`subissues\`.

Do NOT decompose low or medium complexity issues.`;
}

function buildAnalysisUserPrompt(
  payload: StartSessionPayload,
  skills: { name: string; description: string | null }[],
  agents: { name: string; description: string }[],
): string {
  const parts = [
    `# ${payload.issue_title}`,
    `Repo: ${payload.repo_full_name} | #${payload.issue_number} | State: ${payload.issue_state}`,
  ];
  if (payload.issue_labels?.length) {
    parts.push(`Labels: ${payload.issue_labels.map((l) => l.name).join(", ")}`);
  }
  if (payload.issue_body) {
    parts.push("", payload.issue_body);
  }
  if (skills.length > 0) {
    parts.push("", "## Existing skills", ...skills.map((s) => `- **${s.name}**: ${s.description || "(no description)"}`));
  }
  if (agents.length > 0) {
    parts.push("", "## Existing agents", ...agents.map((a) => `- **${a.name}**: ${a.description}`));
  }
  return parts.join("\n");
}

const ANALYSIS_SCHEMA = {
  type: "object" as const,
  properties: {
    summary: { type: "string" as const, description: "1-2 sentence summary" },
    type: { type: "string" as const, enum: ["bug", "feature", "improvement", "question", "other"] },
    complexity: { type: "string" as const, enum: ["low", "medium", "high"] },
    complexity_reason: { type: "string" as const },
    considerations: { type: "array" as const, items: { type: "string" as const } },
    approach: { type: "string" as const },
    skills: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          name: { type: "string" as const },
          description: { type: "string" as const },
          content: { type: "string" as const },
        },
        required: ["name", "description", "content"],
        additionalProperties: false,
      },
    },
    agents: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          name: { type: "string" as const },
          description: { type: "string" as const },
          content: { type: "string" as const },
          skill_names: { type: "array" as const, items: { type: "string" as const } },
          tool_names: { type: "array" as const, items: { type: "string" as const } },
        },
        required: ["name", "description", "content", "skill_names", "tool_names"],
        additionalProperties: false,
      },
    },
    decomposed: { type: "boolean" as const },
    subissues: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          number: { type: "number" as const },
          title: { type: "string" as const },
        },
        required: ["number", "title"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "type", "complexity", "complexity_reason", "considerations", "approach", "skills", "agents"],
  additionalProperties: false,
};
