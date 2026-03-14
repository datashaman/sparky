// ─── Provider & Agent Types ───

export type AgentProvider = "openai" | "anthropic" | "gemini" | "ollama" | "openrouter" | "litellm";

export interface Agent {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  content: string | null;
  provider: AgentProvider;
  model: string;
  max_turns: number | null;
  background: number;
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

// ─── Analysis Types ───

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

// ─── Plan Types ───

export interface ExecutionPlanStep {
  order: number;
  title: string;
  description: string;
  agent_name: string | null;
  expected_output: string;
  depends_on: number[];
  verification_command?: string | null;
  done_when?: string;
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

// ─── Execution Types ───

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

export interface ExecutionLogEntry {
  timestamp: number;
  stepOrder: number;
  type: "llm_request" | "llm_response" | "tool_call" | "tool_result" | "replan_check" | "replan_decision" | "info";
  turn?: number;
  provider?: string;
  model?: string;
  toolName?: string;
  toolInput?: string;
  toolResult?: string;
  toolError?: string;
  decision?: "continue" | "replan";
  reason?: string;
  message?: string;
}

// ─── Session Types ───

export type SessionType = "analysis" | "plan" | "execution";
export type SessionStatus = "pending" | "running" | "paused" | "done" | "error" | "cancelled";
export type AskUserStatus = "pending" | "answered" | "timeout";

export interface Session {
  id: string;
  workspace_id: string;
  repo_full_name: string;
  issue_number: number;
  session_type: SessionType;
  status: SessionStatus;
  config: string;
  conversation_state: string | null;
  current_phase: string | null;
  current_step_order: number | null;
  analysis_id: string | null;
  plan_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionLog {
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

export interface SessionAskUser {
  id: string;
  session_id: string;
  step_order: number;
  question: string;
  options: string;
  allow_multiple: number;
  status: AskUserStatus;
  answer: string | null;
  timeout_minutes: number | null;
  created_at: string;
  answered_at: string | null;
}

export interface SessionStepState {
  session_id: string;
  step_order: number;
  status: "pending" | "running" | "done" | "error";
  output: string | null;
  error: string | null;
  conversation_state: string | null;
}

// ─── Config Types ───

export interface SessionConfig {
  default_provider: AgentProvider;
  default_model: string;
  default_api_key: string;
  exec_provider: AgentProvider;
  exec_model: string;
  exec_api_key: string;
  github_token: string;
  ask_user_timeout_minutes: number | null;
  /** API keys by provider for agent resolution. */
  api_keys?: Partial<Record<AgentProvider, string>>;
}

// ─── IPC Types ───

export type IPCCommand =
  | { type: "start_session"; payload: StartSessionPayload }
  | { type: "cancel_session"; payload: { session_id: string } }
  | { type: "answer_ask_user"; payload: { session_id: string; prompt_id: string; selected: string[] } }
  | { type: "list_sessions" }
  | { type: "ping" };

export interface StartSessionPayload {
  session_type: SessionType;
  workspace_id: string;
  repo_full_name: string;
  issue_number: number;
  issue_title: string;
  issue_body: string | null;
  issue_state: string;
  issue_labels: Array<{ name: string }>;
  config: SessionConfig;
  analysis_id?: string;
  plan_id?: string;
  analysis_result?: AnalysisResult;
  plan_result?: ExecutionPlanResult;
}

export type IPCEvent =
  | { type: "session_started"; session_id: string }
  | { type: "session_update"; session_id: string; step_order: number; status: string }
  | { type: "log"; session_id: string; entry: ExecutionLogEntry }
  | { type: "ask_user"; session_id: string; prompt_id: string; question: string; options: string[]; allow_multiple: boolean }
  | { type: "session_complete"; session_id: string }
  | { type: "session_error"; session_id: string; error: string }
  | { type: "pong" }
  | { type: "sessions_list"; sessions: Session[] }
  | { type: "error"; error: string };
