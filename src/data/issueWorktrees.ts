import { invoke } from "@tauri-apps/api/core";
import { getDb } from "../db";
import type { IssueWorktree } from "./types";

export async function getWorktreeForIssue(
  workspaceId: string,
  repoFullName: string,
  issueNumber: number,
): Promise<IssueWorktree | null> {
  const db = await getDb();
  const rows = await db.select<IssueWorktree[]>(
    "SELECT * FROM issue_worktrees WHERE workspace_id = ? AND repo_full_name = ? AND issue_number = ? ORDER BY created_at DESC LIMIT 1",
    [workspaceId, repoFullName, issueNumber],
  );
  return rows[0] ?? null;
}

async function createWorktreeRecord(
  workspaceId: string,
  repoFullName: string,
  issueNumber: number,
  branchName: string,
  path: string,
): Promise<IssueWorktree> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.execute(
    "INSERT INTO issue_worktrees (id, workspace_id, repo_full_name, issue_number, branch_name, path, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'creating', ?, ?)",
    [id, workspaceId, repoFullName, issueNumber, branchName, path, now, now],
  );
  return {
    id,
    workspace_id: workspaceId,
    repo_full_name: repoFullName,
    issue_number: issueNumber,
    branch_name: branchName,
    path,
    status: "creating",
    error: null,
    created_at: now,
    updated_at: now,
  };
}

async function updateWorktreeRecord(
  id: string,
  updates: Partial<Pick<IssueWorktree, "status" | "error" | "path" | "branch_name">>,
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const [key, val] of Object.entries(updates)) {
    sets.push(`${key} = $${i++}`);
    values.push(val ?? null);
  }
  sets.push(`updated_at = $${i++}`);
  values.push(new Date().toISOString());
  values.push(id);
  await db.execute(`UPDATE issue_worktrees SET ${sets.join(", ")} WHERE id = $${i}`, values);
}

async function deleteWorktreeRecord(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM issue_worktrees WHERE id = ?", [id]);
}

export async function ensureWorktree(
  workspaceId: string,
  repoFullName: string,
  issueNumber: number,
  accessToken: string,
  onUpdate: (wt: IssueWorktree) => void,
): Promise<IssueWorktree> {
  let wt = await getWorktreeForIssue(workspaceId, repoFullName, issueNumber);
  if (wt && wt.status === "ready") return wt;

  const branchName = `sparky/issue-${issueNumber}`;

  if (!wt) {
    wt = await createWorktreeRecord(workspaceId, repoFullName, issueNumber, branchName, "");
    onUpdate(wt);
  } else if (wt.status === "error") {
    await updateWorktreeRecord(wt.id, { status: "creating", error: null });
    wt = { ...wt, status: "creating", error: null };
    onUpdate(wt);
  }

  try {
    // Clone or fetch
    await invoke<string>("git_clone_repo", {
      repoFullName,
      accessToken,
    });

    // Create worktree
    const result = await invoke<{ path: string; branch_name: string }>(
      "git_create_worktree",
      { repoFullName, issueNumber },
    );

    await updateWorktreeRecord(wt.id, {
      path: result.path,
      branch_name: result.branch_name,
      status: "ready",
      error: null,
    });
    wt = { ...wt, path: result.path, branch_name: result.branch_name, status: "ready", error: null };
    onUpdate(wt);
    return wt;
  } catch (e) {
    const error = String(e);
    await updateWorktreeRecord(wt.id, { status: "error", error });
    wt = { ...wt, status: "error", error };
    onUpdate(wt);
    throw e;
  }
}

export async function removeWorktree(
  wt: IssueWorktree,
  onUpdate: (wt: IssueWorktree) => void,
): Promise<void> {
  await updateWorktreeRecord(wt.id, { status: "removing" });
  onUpdate({ ...wt, status: "removing" });

  try {
    await invoke("git_remove_worktree", {
      repoFullName: wt.repo_full_name,
      issueNumber: wt.issue_number,
    });
    await deleteWorktreeRecord(wt.id);
    onUpdate({ ...wt, status: "removing", path: "" });
  } catch (e) {
    const error = String(e);
    await updateWorktreeRecord(wt.id, { status: "error", error });
    onUpdate({ ...wt, status: "error", error });
    throw e;
  }
}
