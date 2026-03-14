import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AgentProvider } from "./types";

// ─── Types matching worker IPC protocol ───

export type SessionType = "analysis" | "plan" | "execution";

export interface SessionConfig {
  default_provider: AgentProvider;
  default_model: string;
  default_api_key: string;
  exec_provider: AgentProvider;
  exec_model: string;
  exec_api_key: string;
  github_token: string;
  ask_user_timeout_minutes: number | null;
}

export interface StartSessionOpts {
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
  analysis_result?: unknown;
  plan_result?: unknown;
}

export interface WorkerEvent {
  type: string;
  session_id?: string;
  step_order?: number;
  status?: string;
  entry?: unknown;
  prompt_id?: string;
  question?: string;
  options?: string[];
  allow_multiple?: boolean;
  error?: string;
  sessions?: unknown[];
}

// ─── Worker Lifecycle ───

/** Ensure the tmux worker process is running and connected. */
export async function ensureWorkerRunning(): Promise<void> {
  await invoke("worker_ensure_running");
}

/** Start forwarding worker events as Tauri events. Call once after ensuring worker. */
export async function subscribeToWorkerEvents(handler: (event: WorkerEvent) => void): Promise<() => void> {
  // First, start the background event reader
  await invoke("worker_subscribe");

  // Listen for forwarded events
  const unlisten = await listen<string>("worker-event", (e) => {
    try {
      const parsed = JSON.parse(e.payload) as WorkerEvent;
      handler(parsed);
    } catch {
      console.warn("[workerClient] failed to parse worker event:", e.payload);
    }
  });

  return unlisten;
}

// ─── Session Commands ───

/** Send a command to the worker via the Unix socket. */
async function sendCommand(command: unknown): Promise<void> {
  await invoke("worker_send", { message: JSON.stringify(command) });
}

/** Start a new session. Returns immediately; session_id comes via events. */
export async function startSession(opts: StartSessionOpts): Promise<void> {
  await sendCommand({
    type: "start_session",
    payload: opts,
  });
}

/** Cancel a running session. */
export async function cancelSession(sessionId: string): Promise<void> {
  await sendCommand({
    type: "cancel_session",
    payload: { session_id: sessionId },
  });
}

/** Answer an ask_user prompt. */
export async function answerAskUser(sessionId: string, promptId: string, selected: string[]): Promise<void> {
  await sendCommand({
    type: "answer_ask_user",
    payload: { session_id: sessionId, prompt_id: promptId, selected },
  });
}

/** Request list of all sessions. Results come via sessions_list event. */
export async function listSessions(): Promise<void> {
  await sendCommand({ type: "list_sessions" });
}

/** Ping the worker to check connectivity. Response comes as pong event. */
export async function pingWorker(): Promise<void> {
  await sendCommand({ type: "ping" });
}
