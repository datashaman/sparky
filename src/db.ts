import Database from "@tauri-apps/plugin-sql";

let dbInstance: Database | null = null;

const MIGRATIONS = `
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repos (
  id TEXT PRIMARY KEY,
  full_name TEXT UNIQUE NOT NULL,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_repos (
  workspace_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  PRIMARY KEY (workspace_id, repo_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspace_repos_workspace ON workspace_repos(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_repos_repo ON workspace_repos(repo_id);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  max_turns INTEGER,
  background INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agents_workspace ON agents(workspace_id);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  provider TEXT,
  model TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_skills_workspace ON skills(workspace_id);

CREATE TABLE IF NOT EXISTS issue_analyses (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  repo_full_name TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  result TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_issue_analyses_lookup ON issue_analyses(workspace_id, repo_full_name, issue_number);
`;

/** Migrations that add columns — safe to fail if column already exists. */
const ALTER_MIGRATIONS = [
  "ALTER TABLE skills ADD COLUMN content TEXT",
  "ALTER TABLE agents ADD COLUMN content TEXT",
];

/** DDL that uses IF NOT EXISTS — safe to re-run. */
const ADDITIONAL_TABLES = `
CREATE TABLE IF NOT EXISTS agent_skills (
  agent_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  PRIMARY KEY (agent_id, skill_id),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_skills_agent ON agent_skills(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_skills_skill ON agent_skills(skill_id);

CREATE TABLE IF NOT EXISTS execution_plans (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  repo_full_name TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  result TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_execution_plans_lookup ON execution_plans(workspace_id, repo_full_name, issue_number);

CREATE TABLE IF NOT EXISTS issue_worktrees (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  repo_full_name TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  branch_name TEXT NOT NULL,
  path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'creating',
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_issue_worktrees_lookup ON issue_worktrees(workspace_id, repo_full_name, issue_number);

CREATE TABLE IF NOT EXISTS agent_tools (
  agent_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  PRIMARY KEY (agent_id, tool_id),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_tools_agent ON agent_tools(agent_id);
`;

/** Standard location: AppConfig (e.g. ~/Library/Application Support/{bundle-id}/ on macOS) */
const DB_PATH = "sqlite:sparky.db";

export async function getDb(): Promise<Database> {
  if (dbInstance) return dbInstance;

  const db = await Database.load(DB_PATH);

  // Run migrations before exposing the instance
  const statements = MIGRATIONS.split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    try {
      await db.execute(stmt);
    } catch (e) {
      throw new Error(`Migration failed: ${e}. Statement: ${stmt.slice(0, 80)}...`);
    }
  }

  // Run additional CREATE TABLE statements (idempotent via IF NOT EXISTS)
  const additionalStmts = ADDITIONAL_TABLES.split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of additionalStmts) {
    try {
      await db.execute(stmt);
    } catch (e) {
      throw new Error(`Migration failed: ${e}. Statement: ${stmt.slice(0, 80)}...`);
    }
  }

  // Run ALTER TABLE migrations — tolerate "duplicate column" errors for idempotency
  for (const stmt of ALTER_MIGRATIONS) {
    try {
      await db.execute(stmt);
    } catch (e) {
      const msg = String(e);
      if (!msg.includes("duplicate column")) {
        throw new Error(`Migration failed: ${e}. Statement: ${stmt}`);
      }
    }
  }

  dbInstance = db;
  return dbInstance;
}
