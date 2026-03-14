import { isTauri } from "@tauri-apps/api/core";
import { getDb } from "../db";
import type { Skill, AgentProvider } from "./types";
import { validateSlug, firstParagraph } from "./shared";

export const validateSkillSlug = validateSlug;

let mockSkills: Skill[] = [];

export async function listSkillsForWorkspace(workspaceId: string): Promise<Skill[]> {
  if (!isTauri()) return mockSkills.filter((s) => s.workspace_id === workspaceId);
  const db = await getDb();
  return db.select<Skill[]>(
    `SELECT id, workspace_id, name, description, content, provider, model, created_at
     FROM skills WHERE workspace_id = $1 ORDER BY created_at DESC`,
    [workspaceId]
  );
}

export interface CreateSkillParams {
  workspaceId: string;
  name: string;
  description?: string | null;
  content?: string | null;
  provider?: AgentProvider | null;
  model?: string | null;
}

export async function createSkill(params: CreateSkillParams): Promise<Skill> {
  const { workspaceId, name, content = null, provider = null, model = null } = params;
  const description = params.description?.trim() || firstParagraph(content);
  const id = crypto.randomUUID();
  const created_at = new Date().toISOString();
  const skill: Skill = {
    id,
    workspace_id: workspaceId,
    name,
    description,
    content,
    provider,
    model,
    created_at,
  };

  if (!isTauri()) {
    mockSkills = [skill, ...mockSkills];
    return skill;
  }

  const db = await getDb();
  await db.execute(
    `INSERT INTO skills (id, workspace_id, name, description, content, provider, model, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, workspaceId, name, description, content, provider, model, created_at]
  );
  return skill;
}

export async function getSkill(id: string): Promise<Skill | null> {
  if (!isTauri()) return mockSkills.find((s) => s.id === id) ?? null;
  const db = await getDb();
  const rows = await db.select<Skill[]>(
    "SELECT id, workspace_id, name, description, content, provider, model, created_at FROM skills WHERE id = $1",
    [id]
  );
  return rows[0] ?? null;
}

export async function updateSkill(id: string, updates: Partial<CreateSkillParams>): Promise<Skill | null> {
  // Auto-derive description from content's first paragraph when description is empty
  const resolvedUpdates = { ...updates };
  if (!resolvedUpdates.description?.trim() && resolvedUpdates.content) {
    resolvedUpdates.description = firstParagraph(resolvedUpdates.content);
  }

  if (!isTauri()) {
    mockSkills = mockSkills.map((s) =>
      s.id === id ? { ...s, ...resolvedUpdates } : s
    );
    return mockSkills.find((s) => s.id === id) ?? null;
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
  if (sets.length === 0) return getSkill(id);
  values.push(id);
  await db.execute(`UPDATE skills SET ${sets.join(", ")} WHERE id = $${i}`, values);
  return getSkill(id);
}

export async function deleteSkill(id: string): Promise<void> {
  if (!isTauri()) {
    mockSkills = mockSkills.filter((s) => s.id !== id);
    return;
  }
  const db = await getDb();
  await db.execute("DELETE FROM skills WHERE id = $1", [id]);
}
