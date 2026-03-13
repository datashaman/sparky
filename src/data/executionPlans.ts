import { getDb } from "../db";
import type { ExecutionPlan } from "./types";

export async function getPlanForIssue(
  workspaceId: string,
  repoFullName: string,
  issueNumber: number,
): Promise<ExecutionPlan | null> {
  const db = await getDb();
  const rows = await db.select<ExecutionPlan[]>(
    "SELECT * FROM execution_plans WHERE workspace_id = ? AND repo_full_name = ? AND issue_number = ? ORDER BY created_at DESC LIMIT 1",
    [workspaceId, repoFullName, issueNumber],
  );
  return rows[0] ?? null;
}

export async function createPlan(
  workspaceId: string,
  repoFullName: string,
  issueNumber: number,
): Promise<ExecutionPlan> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.execute(
    "INSERT INTO execution_plans (id, workspace_id, repo_full_name, issue_number, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)",
    [id, workspaceId, repoFullName, issueNumber, now, now],
  );
  return {
    id,
    workspace_id: workspaceId,
    repo_full_name: repoFullName,
    issue_number: issueNumber,
    status: "pending",
    result: null,
    error: null,
    created_at: now,
    updated_at: now,
  };
}
