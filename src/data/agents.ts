import { isTauri } from "@tauri-apps/api/core";
import { getDb } from "../db";
import type { Agent, AgentProvider } from "./types";

const SLUG_REGEX = /^[a-z0-9\-]*$/;

export function validateAgentSlug(name: string): boolean {
  return SLUG_REGEX.test(name);
}

export const AGENT_PROVIDERS: AgentProvider[] = ["openai", "anthropic", "gemini"];

export const AGENT_MODELS: Record<AgentProvider, string[]> = {
  openai: ["gpt-5.4", "gpt-5.2", "gpt-5-mini", "o4-mini", "o3", "o3-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"],
  anthropic: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"],
};

let mockAgents: Agent[] = [];

export async function listAgentsForWorkspace(workspaceId: string): Promise<Agent[]> {
  if (!isTauri()) return mockAgents.filter((a) => a.workspace_id === workspaceId);
  const db = await getDb();
  const rows = await db.select<(Omit<Agent, "background"> & { background: number })[]>(
    `SELECT id, workspace_id, name, description, provider, model, max_turns, background, created_at 
     FROM agents WHERE workspace_id = $1 ORDER BY created_at DESC`,
    [workspaceId]
  );
  return rows.map((r) => ({ ...r, background: Boolean(r.background) }));
}

export interface CreateAgentParams {
  workspaceId: string;
  name: string;
  description: string;
  provider: AgentProvider;
  model: string;
  max_turns?: number | null;
  background?: boolean;
}

export async function createAgent(params: CreateAgentParams): Promise<Agent> {
  const { workspaceId, name, description, provider, model, max_turns = null, background = false } = params;
  const id = crypto.randomUUID();
  const created_at = new Date().toISOString();
  const agent: Agent = {
    id,
    workspace_id: workspaceId,
    name,
    description,
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
    `INSERT INTO agents (id, workspace_id, name, description, provider, model, max_turns, background, created_at) 
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, workspaceId, name, description, provider, model, max_turns ?? null, background ? 1 : 0, created_at]
  );
  return agent;
}

export async function getAgent(id: string): Promise<Agent | null> {
  if (!isTauri()) return mockAgents.find((a) => a.id === id) ?? null;
  const db = await getDb();
  const rows = await db.select<(Omit<Agent, "background"> & { background: number })[]>(
    "SELECT id, workspace_id, name, description, provider, model, max_turns, background, created_at FROM agents WHERE id = $1",
    [id]
  );
  const r = rows[0];
  if (!r) return null;
  return { ...r, background: Boolean(r.background) };
}

export async function updateAgent(id: string, updates: Partial<CreateAgentParams>): Promise<Agent | null> {
  if (!isTauri()) {
    mockAgents = mockAgents.map((a) =>
      a.id === id ? { ...a, ...updates } : a
    );
    return mockAgents.find((a) => a.id === id) ?? null;
  }
  const db = await getDb();
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (updates.name !== undefined) {
    sets.push(`name = $${i++}`);
    values.push(updates.name);
  }
  if (updates.description !== undefined) {
    sets.push(`description = $${i++}`);
    values.push(updates.description);
  }
  if (updates.provider !== undefined) {
    sets.push(`provider = $${i++}`);
    values.push(updates.provider);
  }
  if (updates.model !== undefined) {
    sets.push(`model = $${i++}`);
    values.push(updates.model);
  }
  if (updates.max_turns !== undefined) {
    sets.push(`max_turns = $${i++}`);
    values.push(updates.max_turns);
  }
  if (updates.background !== undefined) {
    sets.push(`background = $${i++}`);
    values.push(updates.background ? 1 : 0);
  }
  if (sets.length === 0) return getAgent(id);
  values.push(id);
  await db.execute(`UPDATE agents SET ${sets.join(", ")} WHERE id = $${i}`, values);
  return getAgent(id);
}

export async function deleteAgent(id: string): Promise<void> {
  if (!isTauri()) {
    mockAgents = mockAgents.filter((a) => a.id !== id);
    return;
  }
  const db = await getDb();
  await db.execute("DELETE FROM agents WHERE id = $1", [id]);
}
