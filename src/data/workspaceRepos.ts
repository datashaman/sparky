import { isTauri } from "@tauri-apps/api/core";
import { getDb } from "../db";
import type { Workspace } from "./types";

export async function addRepoToWorkspace(workspaceId: string, repoId: string): Promise<void> {
  if (!isTauri()) return;
  const db = await getDb();
  await db.execute(
    "INSERT OR IGNORE INTO workspace_repos (workspace_id, repo_id) VALUES ($1, $2)",
    [workspaceId, repoId]
  );
}

export async function removeRepoFromWorkspace(workspaceId: string, repoId: string): Promise<void> {
  if (!isTauri()) return;
  const db = await getDb();
  await db.execute("DELETE FROM workspace_repos WHERE workspace_id = $1 AND repo_id = $2", [
    workspaceId,
    repoId,
  ]);
}

export async function getWorkspacesForRepo(repoId: string): Promise<Workspace[]> {
  if (!isTauri()) return [];
  const db = await getDb();
  const rows = await db.select<Workspace[]>(
    `SELECT w.id, w.name, w.created_at
     FROM workspaces w
     INNER JOIN workspace_repos wr ON w.id = wr.workspace_id
     WHERE wr.repo_id = $1
     ORDER BY w.name`,
    [repoId]
  );
  return rows;
}
