import Database from "better-sqlite3";
import type {
  Session,
  SessionLog,
  SessionAskUser,
  SessionStepState,
  Agent,
  Skill,
  SessionStatus,
} from "./types.js";

let db: Database.Database | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  repo_full_name TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  session_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  config TEXT NOT NULL,
  conversation_state TEXT,
  current_phase TEXT,
  current_step_order INTEGER,
  analysis_id TEXT,
  plan_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);

CREATE TABLE IF NOT EXISTS session_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  step_order INTEGER NOT NULL DEFAULT 0,
  log_type TEXT NOT NULL,
  turn INTEGER,
  provider TEXT,
  model TEXT,
  tool_name TEXT,
  tool_input TEXT,
  tool_result TEXT,
  tool_error TEXT,
  decision TEXT,
  reason TEXT,
  message TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_logs_session ON session_logs(session_id);

CREATE TABLE IF NOT EXISTS session_ask_user (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  step_order INTEGER NOT NULL DEFAULT 0,
  question TEXT NOT NULL,
  options TEXT NOT NULL,
  allow_multiple INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  answer TEXT,
  timeout_minutes INTEGER,
  created_at TEXT NOT NULL,
  answered_at TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_ask_user_session ON session_ask_user(session_id);
CREATE INDEX IF NOT EXISTS idx_session_ask_user_status ON session_ask_user(status);

CREATE TABLE IF NOT EXISTS session_step_state (
  session_id TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  output TEXT,
  error TEXT,
  conversation_state TEXT,
  PRIMARY KEY (session_id, step_order),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_step_state_session ON session_step_state(session_id);
`;

export function initDb(dbPath: string): Database.Database {
  if (db) return db;

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(SCHEMA);

  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error("Database not initialized. Call initDb() first.");
  return db;
}

// ─── Session Operations ───

export function createSession(session: Session): void {
  const stmt = getDb().prepare(`
    INSERT INTO sessions (id, workspace_id, repo_full_name, issue_number, session_type, status, config, conversation_state, current_phase, current_step_order, analysis_id, plan_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    session.id,
    session.workspace_id,
    session.repo_full_name,
    session.issue_number,
    session.session_type,
    session.status,
    session.config,
    session.conversation_state,
    session.current_phase,
    session.current_step_order,
    session.analysis_id,
    session.plan_id,
    session.created_at,
    session.updated_at,
  );
}

export function getSession(id: string): Session | undefined {
  return getDb().prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Session | undefined;
}

export function updateSession(id: string, updates: Partial<Session>): void {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, val] of Object.entries(updates)) {
    if (key === "id") continue;
    sets.push(`${key} = ?`);
    values.push(val);
  }
  sets.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(id);
  getDb().prepare(`UPDATE sessions SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function listSessions(): Session[] {
  return getDb().prepare("SELECT * FROM sessions ORDER BY created_at DESC").all() as Session[];
}

export function listRunningSessions(): Session[] {
  return getDb().prepare("SELECT * FROM sessions WHERE status = 'running'").all() as Session[];
}

// ─── Session Log Operations ───

export function insertLog(log: Omit<SessionLog, "id">): void {
  const stmt = getDb().prepare(`
    INSERT INTO session_logs (session_id, step_order, log_type, turn, provider, model, tool_name, tool_input, tool_result, tool_error, decision, reason, message, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    log.session_id,
    log.step_order,
    log.log_type,
    log.turn,
    log.provider,
    log.model,
    log.tool_name,
    log.tool_input,
    log.tool_result,
    log.tool_error,
    log.decision,
    log.reason,
    log.message,
    log.created_at,
  );
}

export function getLogsForSession(sessionId: string): SessionLog[] {
  return getDb()
    .prepare("SELECT * FROM session_logs WHERE session_id = ? ORDER BY id")
    .all(sessionId) as SessionLog[];
}

// ─── Ask User Operations ───

export function insertAskUser(prompt: SessionAskUser): void {
  const stmt = getDb().prepare(`
    INSERT INTO session_ask_user (id, session_id, step_order, question, options, allow_multiple, status, answer, timeout_minutes, created_at, answered_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    prompt.id,
    prompt.session_id,
    prompt.step_order,
    prompt.question,
    prompt.options,
    prompt.allow_multiple,
    prompt.status,
    prompt.answer,
    prompt.timeout_minutes,
    prompt.created_at,
    prompt.answered_at,
  );
}

export function getPendingAskUser(sessionId: string): SessionAskUser | undefined {
  return getDb()
    .prepare("SELECT * FROM session_ask_user WHERE session_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1")
    .get(sessionId) as SessionAskUser | undefined;
}

export function getAskUserById(promptId: string): SessionAskUser | undefined {
  return getDb()
    .prepare("SELECT * FROM session_ask_user WHERE id = ?")
    .get(promptId) as SessionAskUser | undefined;
}

export function answerAskUser(promptId: string, answer: string[]): void {
  getDb()
    .prepare("UPDATE session_ask_user SET status = 'answered', answer = ?, answered_at = ? WHERE id = ?")
    .run(JSON.stringify(answer), new Date().toISOString(), promptId);
}

export function timeoutAskUser(promptId: string): void {
  getDb()
    .prepare("UPDATE session_ask_user SET status = 'timeout', answered_at = ? WHERE id = ?")
    .run(new Date().toISOString(), promptId);
}

// ─── Step State Operations ───

export function upsertStepState(state: SessionStepState): void {
  const stmt = getDb().prepare(`
    INSERT INTO session_step_state (session_id, step_order, status, output, error, conversation_state)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, step_order)
    DO UPDATE SET status = excluded.status, output = excluded.output, error = excluded.error, conversation_state = excluded.conversation_state
  `);
  stmt.run(
    state.session_id,
    state.step_order,
    state.status,
    state.output,
    state.error,
    state.conversation_state,
  );
}

export function getStepState(sessionId: string, stepOrder: number): SessionStepState | undefined {
  return getDb()
    .prepare("SELECT * FROM session_step_state WHERE session_id = ? AND step_order = ?")
    .get(sessionId, stepOrder) as SessionStepState | undefined;
}

export function getStepStatesForSession(sessionId: string): SessionStepState[] {
  return getDb()
    .prepare("SELECT * FROM session_step_state WHERE session_id = ? ORDER BY step_order")
    .all(sessionId) as SessionStepState[];
}

// ─── Workspace Data Queries (read from existing tables) ───

export function getAgentsForWorkspace(workspaceId: string): Agent[] {
  return getDb()
    .prepare("SELECT * FROM agents WHERE workspace_id = ?")
    .all(workspaceId) as Agent[];
}

export function getSkillsForWorkspace(workspaceId: string): Skill[] {
  return getDb()
    .prepare("SELECT * FROM skills WHERE workspace_id = ?")
    .all(workspaceId) as Skill[];
}

export function getToolIdsForAgent(agentId: string): string[] {
  const rows = getDb()
    .prepare("SELECT tool_id FROM agent_tools WHERE agent_id = ?")
    .all(agentId) as Array<{ tool_id: string }>;
  return rows.map((r) => r.tool_id);
}

export function getSkillIdsForAgent(agentId: string): string[] {
  const rows = getDb()
    .prepare("SELECT skill_id FROM agent_skills WHERE agent_id = ?")
    .all(agentId) as Array<{ skill_id: string }>;
  return rows.map((r) => r.skill_id);
}

// ─── Existing table reads (for analysis/plan status updates) ───

export function getExistingTableRow(table: string, id: string): Record<string, unknown> | undefined {
  return getDb()
    .prepare(`SELECT * FROM ${table} WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
}

export function updateExistingTable(table: string, id: string, updates: Record<string, unknown>): void {
  const allowed = new Set(["status", "result", "error"]);
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, val] of Object.entries(updates)) {
    if (!allowed.has(key)) continue;
    sets.push(`${key} = ?`);
    values.push(val);
  }
  if (sets.length === 0) return;
  sets.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(id);
  getDb().prepare(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function upsertStepResult(planId: string, stepOrder: number, status: string, output: string | null, error: string | null): void {
  const stmt = getDb().prepare(`
    INSERT INTO execution_step_results (plan_id, step_order, status, output, error, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(plan_id, step_order)
    DO UPDATE SET status = excluded.status, output = excluded.output, error = excluded.error, updated_at = excluded.updated_at
  `);
  stmt.run(planId, stepOrder, status, output, error, new Date().toISOString());
}
