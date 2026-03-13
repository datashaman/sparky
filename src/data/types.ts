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
  content: string;
}

export interface AnalysisResultAgent {
  name: string;
  description: string;
  content: string;
  skill_names: string[];
  tool_names: string[];
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

export interface ExecutionPlanStep {
  order: number;
  title: string;
  description: string;
  agent_name: string | null;
  skill_names: string[];
  expected_output: string;
  depends_on: number[];
}

export interface ExecutionPlanResult {
  goal: string;
  steps: ExecutionPlanStep[];
  success_criteria: string;
  critic_review?: CriticReview;
}

export interface CriticIssue {
  severity: "error" | "warning" | "info";
  step_order: number | null;
  description: string;
  suggestion: string;
}

export interface CriticReview {
  verdict: "pass" | "fail";
  issues: CriticIssue[];
  summary: string;
}

export interface ReplanCheck {
  decision: "continue" | "replan";
  reason: string;
}

export type PlanStatus = "pending" | "running" | "done" | "error";

export interface ExecutionPlan {
  id: string;
  workspace_id: string;
  repo_full_name: string;
  issue_number: number;
  status: PlanStatus;
  result: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface StepExecutionStatus {
  status: "pending" | "running" | "done" | "error";
  error?: string;
  output?: string;
}

export interface LLMToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type WorktreeStatus = "creating" | "ready" | "error" | "removing";

export interface IssueWorktree {
  id: string;
  workspace_id: string;
  repo_full_name: string;
  issue_number: number;
  branch_name: string;
  path: string;
  status: WorktreeStatus;
  error: string | null;
  created_at: string;
  updated_at: string;
}
