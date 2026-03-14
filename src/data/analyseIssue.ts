import { getDefaultProvider, getDefaultModel, getApiKey } from "../components/UserSettings";
import type { IssueAnalysis, Skill, Agent } from "./types";
import type { GitHubIssue } from "../github";
import { listSkillsForWorkspace } from "./skills";
import { listAgentsForWorkspace } from "./agents";
import { callLLMWithTools, KEYLESS_PROVIDERS } from "./llm";
import { TOOLS, TOOL_SCHEMAS, createToolCallHandler, createAskUserInterceptor, type AskUserHandler, type SkillResolver, type GitHubToolContext } from "./tools";
import { ensureWorktree } from "./issueWorktrees";
import { extractJSON } from "./jsonExtract";
import { dynamicUpdate } from "./dbUtils";

const SYSTEM_PROMPT = `You are a senior software engineer analysing a GitHub issue. Provide a concise, structured analysis. Be direct and practical. No filler.

## Tools available to you during analysis

You have access to tools during analysis:
- **ask_user** — Ask the user clarifying questions. If the issue is ambiguous, underspecified, or could be interpreted multiple ways, use this to get the user's input. Provide clear options for them to choose from.
- **use_skill** — Load domain-specific knowledge from available skills.
- **read_file**, **glob**, **grep** — Explore the codebase to understand the project structure, existing code patterns, and relevant files before making your analysis.
- **bash** — Run shell commands (e.g. to check dependencies, build configuration, or project setup).
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

An **issue LLM** (the controlling LLM) works on resolving the issue. It has access to all sandboxed tools (${TOOLS.map((t) => t.name).join(", ")}) and operates directly in the issue's worktree. Most of the work is done by the issue LLM itself.

The issue LLM can optionally activate **agents** and **skills** based on their descriptions and the current context:
- **Skills**: Reusable bodies of knowledge or instructions (markdown content). The issue LLM can invoke a skill directly, or a skill's content can be injected into an agent's context to give it domain expertise. Every skill MUST have a content body — this is the actual knowledge or instructions. Without content, the skill is useless.
- **Agents**: Autonomous AI workers for specialized subtasks. The issue LLM delegates to an agent only when the task benefits from a focused, specialized worker (e.g. a dedicated test-writer, a security reviewer). Each agent has its own configured tools and skills. Every agent MUST have a content body — this is the system prompt that defines the agent's behavior, constraints, and workflow. Without content, the agent has no guidance.
- **Tools**: Sandboxed capabilities for interacting with worktrees: ${TOOLS.map((t) => `${t.name} (${t.description}${t.dangerous ? " — dangerous" : ""})`).join(", ")}. The issue LLM has all tools. Agents get a subset configured per-agent.

## When recommending skills and agents
- Check existing skills and agents listed in the prompt. Prefer referencing existing ones by name over creating duplicates.
- Only recommend new skills/agents when the existing ones don't cover the need.
- Skills should be specific, reusable knowledge areas (e.g. "react-state-management", "cache-invalidation", "github-api"). Each has a name, a description of when to use it, and a content body with the actual knowledge/instructions in markdown.
- Agents should only be recommended when a specialized, focused worker adds value beyond what the issue LLM does on its own. Each has a name, a description of when to delegate to it, a content body with detailed system prompt, a list of skill names, and a list of tool IDs.
- An agent's skill_names should reference skills from the skills list you recommend (or existing skills).
- An agent's tool_names should be the minimal set needed. Read-only agents need Read, Glob, Grep. Code-modifying agents need Write/Edit. Command-running agents need Bash.

## Complexity-driven decomposition

If you determine the issue is **high** complexity, decompose it into smaller, independently resolvable subissues:
1. Identify 2-5 logical subissues that together resolve the parent issue.
2. Use \`create_issue\` for each subissue. Include enough context in each body for it to be worked on independently.
3. In your final JSON response, set \`decomposed\` to \`true\` and list the created subissue numbers in \`subissues\`.

Do NOT decompose low or medium complexity issues.`;

const ANALYSIS_SCHEMA = {
  type: "object" as const,
  properties: {
    summary: { type: "string" as const, description: "1-2 sentence summary of the issue" },
    type: { type: "string" as const, enum: ["bug", "feature", "improvement", "question", "other"] },
    complexity: { type: "string" as const, enum: ["low", "medium", "high"] },
    complexity_reason: { type: "string" as const, description: "Brief explanation of why this complexity level" },
    considerations: { type: "array" as const, items: { type: "string" as const }, description: "Important technical aspects to consider" },
    approach: { type: "string" as const, description: "Brief recommendation for how to tackle this" },
    skills: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          name: { type: "string" as const, description: "Short slug-style skill name" },
          description: { type: "string" as const, description: "One-line description of when to use this skill" },
          content: { type: "string" as const, description: "Markdown body with the actual knowledge, instructions, patterns, or guidelines this skill provides. Be thorough — this is what gets injected into agent context." },
        },
        required: ["name", "description", "content"],
        additionalProperties: false,
      },
      description: "1-3 specialist skills useful for resolving this issue",
    },
    agents: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          name: { type: "string" as const, description: "Short slug-style agent name" },
          description: { type: "string" as const, description: "One-line description of agent role and goal" },
          content: { type: "string" as const, description: "Markdown body with the agent's system prompt: its role, behavior, constraints, workflow steps, and output format. Be thorough — this defines how the agent operates." },
          skill_names: {
            type: "array" as const,
            items: { type: "string" as const },
            description: "Names of recommended skills to inject into this agent's context",
          },
          tool_names: {
            type: "array" as const,
            items: { type: "string" as const, enum: TOOLS.map((t) => t.id) },
            description: "Tool IDs this agent should have access to (e.g. read, write, edit, glob, grep, bash)",
          },
        },
        required: ["name", "description", "content", "skill_names", "tool_names"],
        additionalProperties: false,
      },
      description: "1-3 autonomous agents that would help",
    },
    decomposed: { type: "boolean" as const, description: "Set to true if the issue was decomposed into subissues" },
    subissues: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          number: { type: "number" as const, description: "Subissue number" },
          title: { type: "string" as const, description: "Subissue title" },
        },
        required: ["number", "title"],
        additionalProperties: false,
      },
      description: "Subissues created during decomposition",
    },
  },
  required: ["summary", "type", "complexity", "complexity_reason", "considerations", "approach", "skills", "agents"],
  additionalProperties: false,
};

function buildPrompt(
  issue: GitHubIssue & { full_name: string },
  existingSkills: Skill[],
  existingAgents: Agent[],
): string {
  const parts = [
    `# ${issue.title}`,
    `Repo: ${issue.full_name} | #${issue.number} | State: ${issue.state}`,
  ];
  if (issue.labels?.length) {
    parts.push(`Labels: ${issue.labels.map((l) => l.name).join(", ")}`);
  }
  if (issue.body) {
    parts.push("", issue.body);
  }

  if (existingSkills.length > 0) {
    parts.push(
      "",
      "## Existing skills in this workspace",
      "You may reference these by name instead of recommending new ones.",
      ...existingSkills.map((s) => `- **${s.name}**: ${s.description || "(no description)"}`),
    );
  }

  if (existingAgents.length > 0) {
    parts.push(
      "",
      "## Existing agents in this workspace",
      "You may reference these by name instead of recommending new ones.",
      ...existingAgents.map((a) => `- **${a.name}**: ${a.description || "(no description)"}`),
    );
  }

  return parts.join("\n");
}


async function updateAnalysis(id: string, updates: Partial<IssueAnalysis>): Promise<void> {
  await dynamicUpdate("issue_analyses", id, updates);
}

export async function runAnalysis(
  analysis: IssueAnalysis,
  issue: GitHubIssue & { full_name: string },
  onUpdate: (a: IssueAnalysis) => void,
  onAskUser?: AskUserHandler,
): Promise<void> {
  const provider = getDefaultProvider();
  const modelId = getDefaultModel();
  console.log("[analyse] start", { provider, modelId, issue: `${issue.full_name}#${issue.number}` });

  if (!provider || !modelId) {
    const msg = "No default provider/model configured. Set one in Settings.";
    console.warn("[analyse] abort:", msg);
    await updateAnalysis(analysis.id, { status: "error", error: msg });
    onUpdate({ ...analysis, status: "error", error: msg });
    return;
  }

  const apiKey = getApiKey(provider);
  if (!apiKey && !KEYLESS_PROVIDERS.has(provider)) {
    const msg = `No API key configured for ${provider}. Add one in Settings.`;
    console.warn("[analyse] abort:", msg);
    await updateAnalysis(analysis.id, { status: "error", error: msg });
    onUpdate({ ...analysis, status: "error", error: msg });
    return;
  }

  console.log("[analyse] key present, length:", apiKey.length);

  try {
    await updateAnalysis(analysis.id, { status: "running" });
    onUpdate({ ...analysis, status: "running" });

    const [existingSkills, existingAgents] = await Promise.all([
      listSkillsForWorkspace(analysis.workspace_id),
      listAgentsForWorkspace(analysis.workspace_id),
    ]);

    const prompt = buildPrompt(issue, existingSkills, existingAgents);
    console.log("[analyse] calling", provider, modelId, "prompt length:", prompt.length);

    // Ensure worktree exists so file/shell tools can read the codebase
    const accessToken = localStorage.getItem("github_token") ?? "";
    if (!accessToken) {
      throw new Error("No GitHub token. Please log in.");
    }
    const worktree = await ensureWorktree(
      analysis.workspace_id,
      issue.full_name,
      issue.number,
      accessToken,
      () => {}, // no UI worktree status updates during analysis
    );

    // Build skill resolver for use_skill tool
    const skillsByName = new Map(existingSkills.map((s) => [s.name, s]));
    const skillResolver: SkillResolver = (skillName, args) => {
      const skill = skillsByName.get(skillName);
      if (!skill?.content) return null;
      return args ? `${skill.content}\n\n## Arguments\n${args}` : skill.content;
    };

    // Analysis tools: read-only file tools + bash + always-on tools + GitHub issue tools
    const ANALYSIS_TOOL_NAMES = new Set(["read_file", "glob", "grep", "bash", "ask_user", "use_skill", "create_issue", "update_issue", "close_issue"]);
    const analysisTools = TOOL_SCHEMAS.filter((t) => ANALYSIS_TOOL_NAMES.has(t.name));

    const githubContext: GitHubToolContext = {
      token: accessToken,
      repoFullName: issue.full_name,
      parentIssueNumber: issue.number,
    };
    const baseHandler = createToolCallHandler(worktree.path, skillResolver, githubContext);
    const toolHandler = createAskUserInterceptor(onAskUser, baseHandler);

    const schemaInstruction = `\n\nWhen you are ready to provide your final analysis, respond with a JSON object matching this schema:\n${JSON.stringify(ANALYSIS_SCHEMA, null, 2)}`;

    const text = await callLLMWithTools({
      provider,
      modelId,
      apiKey,
      systemPrompt: SYSTEM_PROMPT + schemaInstruction,
      userPrompt: prompt,
      tools: analysisTools,
      maxTurns: 10,
      onToolCall: toolHandler,
    });
    console.log("[analyse] success, response length:", text.length);

    const parsed = extractJSON(text) as Record<string, unknown>;
    if (!parsed.summary || !parsed.type || !parsed.complexity) {
      throw new Error("Invalid analysis response: missing required fields");
    }
    const result = JSON.stringify(parsed);
    const status = parsed.decomposed === true ? "decomposed" as const : "done" as const;

    await updateAnalysis(analysis.id, { status, result });
    onUpdate({ ...analysis, status, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[analyse] error:", message);
    await updateAnalysis(analysis.id, { status: "error", error: message });
    onUpdate({ ...analysis, status: "error", error: message });
  }
}
