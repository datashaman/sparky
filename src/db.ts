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

  dbInstance = db;
  return dbInstance;
}
