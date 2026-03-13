import { getDefaultProvider, getDefaultModel, getApiKey } from "../components/UserSettings";
import { getDb } from "../db";
import type { IssueAnalysis, AgentProvider, Skill, Agent } from "./types";
import type { GitHubIssue } from "../github";
import { listSkillsForWorkspace } from "./skills";
import { listAgentsForWorkspace } from "./agents";

const SYSTEM_PROMPT = `You are a senior software engineer analysing a GitHub issue. Provide a concise, structured analysis. Be direct and practical. No filler.

The system uses two concepts:
- **Skills**: Reusable bodies of knowledge or instructions (markdown content). Skills can be used in two ways: (1) the controlling LLM can invoke a skill directly based on its description, or (2) a skill's content can be injected into an agent's context to give it domain expertise.
- **Agents**: Autonomous AI workers that tackle specific tasks. Each agent can have skills injected into its context. The agent's skill_names list determines which skills are pre-loaded.

When recommending skills and agents:
- Check the existing skills and agents listed in the prompt. Prefer referencing existing ones by name over creating duplicates.
- Only recommend new skills/agents when the existing ones don't cover the need.
- Skills should be specific, reusable knowledge areas (e.g. "react-state-management", "cache-invalidation", "github-api"). Each skill has a name and a description of when to use it.
- Agents should be task-oriented workers (e.g. "bug-triager", "fix-proposer", "test-writer"). Each agent has a name, a description of when to delegate to it, and a list of skill names to inject into its context.
- An agent's skill_names should reference skills from the skills list you recommend (or existing skills). Not every skill needs to be attached to an agent — some are useful on their own.`;

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
          description: { type: "string" as const, description: "One-line description" },
        },
        required: ["name", "description"],
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
          skill_names: {
            type: "array" as const,
            items: { type: "string" as const },
            description: "Names of recommended skills to inject into this agent's context",
          },
        },
        required: ["name", "description", "skill_names"],
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

async function callLLM(provider: AgentProvider, modelId: string, apiKey: string, prompt: string): Promise<string> {
  switch (provider) {
    case "anthropic": {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: prompt }],
          output_config: {
            format: {
              type: "json_schema",
              schema: ANALYSIS_SCHEMA,
            },
          },
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Anthropic API ${res.status}: ${body}`);
      }
      const data = await res.json();
      return data.content?.map((b: { text: string }) => b.text).join("") ?? "";
    }

    case "openai": {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: 1024,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "issue_analysis",
              strict: true,
              schema: ANALYSIS_SCHEMA,
            },
          },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`OpenAI API ${res.status}: ${body}`);
      }
      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? "";
    }

    case "gemini": {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: ANALYSIS_SCHEMA,
            },
          }),
        },
      );
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Gemini API ${res.status}: ${body}`);
      }
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.map((p: { text: string }) => p.text).join("") ?? "";
    }
  }
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

    const text = await callLLM(provider, modelId, apiKey, prompt);
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
