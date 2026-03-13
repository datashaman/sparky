import { getDefaultProvider, getDefaultModel, getApiKey } from "../components/UserSettings";
import { getDb } from "../db";
import type { IssueAnalysis, Skill, Agent } from "./types";
import type { GitHubIssue } from "../github";
import { listSkillsForWorkspace } from "./skills";
import { listAgentsForWorkspace } from "./agents";
import { callLLM } from "./llm";
import { TOOLS } from "./tools";

const SYSTEM_PROMPT = `You are a senior software engineer analysing a GitHub issue. Provide a concise, structured analysis. Be direct and practical. No filler.

The system uses two concepts:
- **Skills**: Reusable bodies of knowledge or instructions (markdown content). Skills can be used in two ways: (1) the controlling LLM can invoke a skill directly based on its description, or (2) a skill's content can be injected into an agent's context to give it domain expertise. Every skill MUST have a content body — this is the actual knowledge or instructions that get injected. Without content, the skill is useless.
- **Agents**: Autonomous AI workers that tackle specific tasks. Each agent can have skills injected into its context and tools assigned to it. The agent's skill_names list determines which skills are pre-loaded, and tool_names determines which tools the agent can use during execution. Every agent MUST have a content body — this is the system prompt / instructions that define the agent's behavior, personality, constraints, and workflow. Without content, the agent has no guidance on how to operate.
- **Tools**: Sandboxed capabilities agents can use to interact with issue worktrees. Available tools: ${TOOLS.map((t) => `${t.name} (${t.description})`).join(", ")}. Tools marked as dangerous (Write, Edit, Bash) should only be assigned to agents that need to modify files or run commands.

When recommending skills and agents:
- Check the existing skills and agents listed in the prompt. Prefer referencing existing ones by name over creating duplicates.
- Only recommend new skills/agents when the existing ones don't cover the need.
- Skills should be specific, reusable knowledge areas (e.g. "react-state-management", "cache-invalidation", "github-api"). Each skill has a name, a description of when to use it, and a content body with the actual knowledge/instructions in markdown.
- Agents should be task-oriented workers (e.g. "bug-triager", "fix-proposer", "test-writer"). Each agent has a name, a description of when to delegate to it, a content body with detailed instructions/system prompt, a list of skill names to inject into its context, and a list of tool names it can use.
- An agent's skill_names should reference skills from the skills list you recommend (or existing skills). Not every skill needs to be attached to an agent — some are useful on their own.
- An agent's tool_names should be chosen from the available tools based on what the agent needs to do. Read-only agents (e.g. analyzers, reviewers) typically need only Read, Glob, and Grep. Agents that modify code need Write and/or Edit. Agents that run tests or build commands need Bash.`;

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
  await db.execute(`UPDATE issue_analyses SET ${sets.join(", ")} WHERE id = $${i}`, values);
}

export async function runAnalysis(
  analysis: IssueAnalysis,
  issue: GitHubIssue & { full_name: string },
  onUpdate: (a: IssueAnalysis) => void,
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
  if (!apiKey) {
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

    const text = await callLLM({
      provider,
      modelId,
      apiKey,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: prompt,
      schema: ANALYSIS_SCHEMA,
      schemaName: "issue_analysis",
      maxTokens: 4096,
    });
    console.log("[analyse] success, response length:", text.length);

    // Structured outputs guarantee valid JSON, but validate anyway
    const parsed = JSON.parse(text);
    if (!parsed.summary || !parsed.type || !parsed.complexity) {
      throw new Error("Invalid analysis response: missing required fields");
    }
    const result = JSON.stringify(parsed);

    await updateAnalysis(analysis.id, { status: "done", result });
    onUpdate({ ...analysis, status: "done", result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[analyse] error:", message);
    await updateAnalysis(analysis.id, { status: "error", error: message });
    onUpdate({ ...analysis, status: "error", error: message });
  }
}
