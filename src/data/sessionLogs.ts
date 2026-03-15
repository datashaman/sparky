import { getDb } from "../db";
import type { ExecutionLogEntry } from "./types";

interface SessionLogRow {
  id: number;
  session_id: string;
  step_order: number;
  log_type: string;
  turn: number | null;
  provider: string | null;
  model: string | null;
  tool_name: string | null;
  tool_input: string | null;
  tool_result: string | null;
  tool_error: string | null;
  decision: string | null;
  reason: string | null;
  message: string | null;
  created_at: string;
}

function rowToEntry(row: SessionLogRow): ExecutionLogEntry {
  const entry: ExecutionLogEntry = {
    timestamp: new Date(row.created_at).getTime(),
    stepOrder: row.step_order,
    type: row.log_type as ExecutionLogEntry["type"],
  };
  if (row.turn != null) entry.turn = row.turn;
  if (row.provider) entry.provider = row.provider;
  if (row.model) entry.model = row.model;
  if (row.tool_name) entry.toolName = row.tool_name;
  if (row.tool_input) entry.toolInput = row.tool_input;
  if (row.tool_result) entry.toolResult = row.tool_result;
  if (row.tool_error) entry.toolError = row.tool_error;
  if (row.decision) entry.decision = row.decision as "continue" | "replan";
  if (row.reason) entry.reason = row.reason;
  if (row.message) entry.message = row.message;
  return entry;
}

/** Get all log entries for a session, ordered by ID. */
export async function getLogsForSession(sessionId: string): Promise<ExecutionLogEntry[]> {
  const db = await getDb();
  const rows = await db.select<SessionLogRow[]>(
    "SELECT * FROM session_logs WHERE session_id = ? ORDER BY id",
    [sessionId],
  );
  return rows.map(rowToEntry);
}

interface SessionRow {
  id: string;
  status: string;
}

/** Find the most recent session for a workspace/repo/issue combo. */
export async function getLatestSessionForIssue(
  workspaceId: string,
  repoFullName: string,
  issueNumber: number,
): Promise<{ id: string; status: string } | null> {
  const db = await getDb();
  const rows = await db.select<SessionRow[]>(
    "SELECT id, status FROM sessions WHERE workspace_id = ? AND repo_full_name = ? AND issue_number = ? ORDER BY created_at DESC LIMIT 1",
    [workspaceId, repoFullName, issueNumber],
  );
  return rows.length > 0 ? rows[0] : null;
}
