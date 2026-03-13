import { isTauri } from "@tauri-apps/api/core";
import { getDb } from "../db";
import type { Skill, AgentProvider } from "./types";

const SLUG_REGEX = /^[a-z0-9\-]*$/;

export function validateSkillSlug(name: string): boolean {
  return SLUG_REGEX.test(name);
}

let mockSkills: Skill[] = [];

export async function listSkillsForWorkspace(workspaceId: string): Promise<Skill[]> {
  if (!isTauri()) return mockSkills.filter((s) => s.workspace_id === workspaceId);
  const db = await getDb();
  return db.select<Skill[]>(
    `SELECT id, workspace_id, name, description, provider, model, created_at
     FROM skills WHERE workspace_id = $1 ORDER BY created_at DESC`,
    [workspaceId]
  );
}

export interface CreateSkillParams {
  workspaceId: string;
  name: string;
  description?: string | null;
  provider?: AgentProvider | null;
  model?: string | null;
}

export async function createSkill(params: CreateSkillParams): Promise<Skill> {
  const { workspaceId, name, description = null, provider = null, model = null } = params;
  const id = crypto.randomUUID();
  const created_at = new Date().toISOString();
  const skill: Skill = {
    id,
    workspace_id: workspaceId,
    name,
    description,
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
    `INSERT INTO skills (id, workspace_id, name, description, provider, model, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, workspaceId, name, description, provider, model, created_at]
  );
  return skill;
}

export async function deleteSkill(id: string): Promise<void> {
  if (!isTauri()) {
    mockSkills = mockSkills.filter((s) => s.id !== id);
    return;
  }
  const db = await getDb();
  await db.execute("DELETE FROM skills WHERE id = $1", [id]);
}
