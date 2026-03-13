export interface Workspace {
  id: string;
  name: string;
  created_at: string;
  repo_count?: number;
}

export interface Repo {
  id: string;
  full_name: string;
  owner: string;
  name: string;
  url: string | null;
  created_at: string;
}

export interface WorkspaceWithRepos extends Workspace {
  repos: Repo[];
}

export type AgentProvider = "openai" | "anthropic" | "gemini";

export interface Agent {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  provider: AgentProvider;
  model: string;
  max_turns: number | null;
  background: boolean;
  created_at: string;
}
