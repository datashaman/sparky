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
  content: string | null;
  provider: AgentProvider;
  model: string;
  max_turns: number | null;
  background: boolean;
  created_at: string;
}

export interface Skill {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  content: string | null;
  provider: AgentProvider | null;
  model: string | null;
  created_at: string;
}

export type AnalysisStatus = "pending" | "running" | "done" | "error";

export interface IssueAnalysis {
  id: string;
  workspace_id: string;
  repo_full_name: string;
  issue_number: number;
  status: AnalysisStatus;
  result: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface AnalysisResultSkill {
  name: string;
  description: string;
}

export interface AnalysisResultAgent {
  name: string;
  description: string;
  skill_names: string[];
}

export interface AnalysisResult {
  summary: string;
  type: "bug" | "feature" | "improvement" | "question" | "other";
  complexity: "low" | "medium" | "high";
  complexity_reason: string;
  considerations: string[];
  approach: string;
  skills: AnalysisResultSkill[];
  agents: AnalysisResultAgent[];
}
