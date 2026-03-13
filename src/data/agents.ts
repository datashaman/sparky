import { isTauri } from "@tauri-apps/api/core";
import { getDb } from "../db";
import type { Agent, AgentProvider } from "./types";

const SLUG_REGEX = /^[a-z0-9\-]*$/;

export function validateAgentSlug(name: string): boolean {
  return SLUG_REGEX.test(name);
}

export const AGENT_PROVIDERS: AgentProvider[] = ["openai", "anthropic", "gemini", "ollama"];

/** Extract the first non-empty paragraph from markdown content. */
function firstParagraph(content: string | null | undefined): string | null {
  if (!content) return null;
  const para = content
    .split(/\n\s*\n/)
    .map((p) => p.replace(/^#+\s+/gm, "").trim())
    .find((p) => p.length > 0);
  return para || null;
}

export const AGENT_MODELS: Record<AgentProvider, string[]> = {
  openai: ["gpt-5.4", "gpt-5.2", "gpt-5-mini", "o4-mini", "o3", "o3-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"],
  anthropic: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"],
  ollama: [],
};

let mockAgents: Agent[] = [];

export async function listAgentsForWorkspace(workspaceId: string): Promise<Agent[]> {
  if (!isTauri()) return mockAgents.filter((a) => a.workspace_id === workspaceId);
  const db = await getDb();
  const rows = await db.select<(Omit<Agent, "background"> & { background: number })[]>(
    `SELECT id, workspace_id, name, description, content, provider, model, max_turns, background, created_at 
     FROM agents WHERE workspace_id = $1 ORDER BY created_at DESC`,
    [workspaceId]
  );
  return rows.map((r) => ({ ...r, background: Boolean(r.background) }));
}

export interface CreateAgentParams {
  workspaceId: string;
  name: string;
  description: string;
  content?: string | null;
  provider: AgentProvider;
  model: string;
  max_turns?: number | null;
  background?: boolean;
}

export async function createAgent(params: CreateAgentParams): Promise<Agent> {
  const { workspaceId, name, content = null, provider, model, max_turns = null, background = false } = params;
  const description = params.description?.trim() || firstParagraph(content) || name;
  const id = crypto.randomUUID();
  const created_at = new Date().toISOString();
  const agent: Agent = {
    id,
    workspace_id: workspaceId,
    name,
    description,
    content,
    provider,
    model,
    max_turns,
    background,
    created_at,
  };

  if (!isTauri()) {
    mockAgents = [agent, ...mockAgents];
    return agent;
  }

  const db = await getDb();
  await db.execute(
    `INSERT INTO agents (id, workspace_id, name, description, content, provider, model, max_turns, background, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, workspaceId, name, description, content, provider, model, max_turns ?? null, background ? 1 : 0, created_at]
  );
  return agent;
}

export async function getAgent(id: string): Promise<Agent | null> {
  if (!isTauri()) return mockAgents.find((a) => a.id === id) ?? null;
  const db = await getDb();
  const rows = await db.select<(Omit<Agent, "background"> & { background: number })[]>(
    "SELECT id, workspace_id, name, description, content, provider, model, max_turns, background, created_at FROM agents WHERE id = $1",
    [id]
  );
  const r = rows[0];
  if (!r) return null;
  return { ...r, background: Boolean(r.background) };
}

export async function updateAgent(id: string, updates: Partial<CreateAgentParams>): Promise<Agent | null> {
  const resolvedUpdates = { ...updates };
  if (!resolvedUpdates.description?.trim() && resolvedUpdates.content) {
    resolvedUpdates.description = firstParagraph(resolvedUpdates.content) || undefined;
  }

  if (!isTauri()) {
    mockAgents = mockAgents.map((a) =>
      a.id === id ? { ...a, ...resolvedUpdates } : a
    );
    return mockAgents.find((a) => a.id === id) ?? null;
  }
  const db = await getDb();
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (resolvedUpdates.name !== undefined) {
    sets.push(`name = $${i++}`);
    values.push(resolvedUpdates.name);
  }
  if (resolvedUpdates.description !== undefined) {
    sets.push(`description = $${i++}`);
    values.push(resolvedUpdates.description);
  }
  if (resolvedUpdates.content !== undefined) {
    sets.push(`content = $${i++}`);
    values.push(resolvedUpdates.content);
  }
  if (resolvedUpdates.provider !== undefined) {
    sets.push(`provider = $${i++}`);
    values.push(resolvedUpdates.provider);
  }
  if (resolvedUpdates.model !== undefined) {
    sets.push(`model = $${i++}`);
    values.push(resolvedUpdates.model);
  }
  if (resolvedUpdates.max_turns !== undefined) {
    sets.push(`max_turns = $${i++}`);
    values.push(resolvedUpdates.max_turns);
  }
  if (resolvedUpdates.background !== undefined) {
    sets.push(`background = $${i++}`);
    values.push(resolvedUpdates.background ? 1 : 0);
  }
  if (sets.length === 0) return getAgent(id);
  values.push(id);
  await db.execute(`UPDATE agents SET ${sets.join(", ")} WHERE id = $${i}`, values);
  return getAgent(id);
}

export async function deleteAgent(id: string): Promise<void> {
  if (!isTauri()) {
    mockAgents = mockAgents.filter((a) => a.id !== id);
    mockAgentSkills = mockAgentSkills.filter((r) => r.agent_id !== id);
    return;
  }
  const db = await getDb();
  await db.execute("DELETE FROM agents WHERE id = $1", [id]);
}

// ─── Agent–Skill associations ───

let mockAgentSkills: { agent_id: string; skill_id: string }[] = [];

export async function getSkillIdsForAgent(agentId: string): Promise<string[]> {
  if (!isTauri()) return mockAgentSkills.filter((r) => r.agent_id === agentId).map((r) => r.skill_id);
  const db = await getDb();
  const rows = await db.select<{ skill_id: string }[]>(
    "SELECT skill_id FROM agent_skills WHERE agent_id = $1",
    [agentId]
  );
  return rows.map((r) => r.skill_id);
}

// ─── Agent–Tool associations ───

let mockAgentTools: { agent_id: string; tool_id: string }[] = [];

export async function getToolIdsForAgent(agentId: string): Promise<string[]> {
  if (!isTauri()) return mockAgentTools.filter((r) => r.agent_id === agentId).map((r) => r.tool_id);
  const db = await getDb();
  const rows = await db.select<{ tool_id: string }[]>(
    "SELECT tool_id FROM agent_tools WHERE agent_id = $1",
    [agentId]
  );
  return rows.map((r) => r.tool_id);
}

export async function setToolIdsForAgent(agentId: string, toolIds: string[]): Promise<void> {
  if (!isTauri()) {
    mockAgentTools = mockAgentTools.filter((r) => r.agent_id !== agentId);
    for (const toolId of toolIds) {
      mockAgentTools.push({ agent_id: agentId, tool_id: toolId });
    }
    return;
  }
  const db = await getDb();
  await db.execute("DELETE FROM agent_tools WHERE agent_id = $1", [agentId]);
  for (const toolId of toolIds) {
    await db.execute(
      "INSERT INTO agent_tools (agent_id, tool_id) VALUES ($1, $2)",
      [agentId, toolId]
    );
  }
}

export async function setSkillIdsForAgent(agentId: string, skillIds: string[]): Promise<void> {
  if (!isTauri()) {
    mockAgentSkills = mockAgentSkills.filter((r) => r.agent_id !== agentId);
    for (const skillId of skillIds) {
      mockAgentSkills.push({ agent_id: agentId, skill_id: skillId });
    }
    return;
  }
  const db = await getDb();
  await db.execute("DELETE FROM agent_skills WHERE agent_id = $1", [agentId]);
  for (const skillId of skillIds) {
    await db.execute(
      "INSERT INTO agent_skills (agent_id, skill_id) VALUES ($1, $2)",
      [agentId, skillId]
    );
  }
}
