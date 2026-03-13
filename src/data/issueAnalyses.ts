import { getDb } from "../db";
import type { IssueAnalysis } from "./types";

export async function getAnalysisForIssue(
  workspaceId: string,
  repoFullName: string,
  issueNumber: number,
): Promise<IssueAnalysis | null> {
  const db = await getDb();
  const rows = await db.select<IssueAnalysis[]>(
    "SELECT * FROM issue_analyses WHERE workspace_id = ? AND repo_full_name = ? AND issue_number = ? ORDER BY created_at DESC LIMIT 1",
    [workspaceId, repoFullName, issueNumber],
  );
  return rows[0] ?? null;
}

export async function deleteAnalysesForIssue(
  workspaceId: string,
  repoFullName: string,
  issueNumber: number,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM issue_analyses WHERE workspace_id = ? AND repo_full_name = ? AND issue_number = ?",
    [workspaceId, repoFullName, issueNumber],
  );
}

export async function createAnalysis(
  workspaceId: string,
  repoFullName: string,
  issueNumber: number,
): Promise<IssueAnalysis> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.execute(
    "INSERT INTO issue_analyses (id, workspace_id, repo_full_name, issue_number, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)",
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
