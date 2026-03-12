import { isTauri } from "@tauri-apps/api/core";
import { getDb } from "../db";
import type { Repo } from "./types";

export async function getOrCreateRepo(
  fullName: string,
  owner: string,
  name: string,
  url?: string | null
): Promise<Repo> {
  if (!isTauri()) {
    return { id: crypto.randomUUID(), full_name: `${owner}/${name}`, owner, name, url: url ?? null, created_at: new Date().toISOString() };
  }
  const db = await getDb();
  const existing = await db.select<Repo[]>("SELECT id, full_name, owner, name, url, created_at FROM repos WHERE full_name = $1", [
    fullName,
  ]);
  if (existing.length > 0) {
    return existing[0];
  }
  const id = crypto.randomUUID();
  const created_at = new Date().toISOString();
  await db.execute(
    "INSERT INTO repos (id, full_name, owner, name, url, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [id, fullName, owner, name, url ?? null, created_at]
  );
  return { id, full_name: fullName, owner, name, url: url ?? null, created_at };
}

export async function listReposForWorkspace(workspaceId: string): Promise<Repo[]> {
  if (!isTauri()) return [];
  const db = await getDb();
  const rows = await db.select<Repo[]>(
    `SELECT r.id, r.full_name, r.owner, r.name, r.url, r.created_at
     FROM repos r
     INNER JOIN workspace_repos wr ON r.id = wr.repo_id
     WHERE wr.workspace_id = $1
     ORDER BY r.full_name`,
    [workspaceId]
  );
  return rows;
}
