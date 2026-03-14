import { randomUUID } from "node:crypto";
import type {
  Session,
  SessionConfig,
  StartSessionPayload,
  ExecutionLogEntry,
} from "./types.js";
import {
  createSession,
  updateSession,
  insertLog,
  upsertStepState,
  getStepState,
  getStepStatesForSession,
  upsertStepResult,
  getExistingTableRow,
} from "./db.js";
import { broadcast } from "./ipc.js";
import { runAnalysisPipeline } from "./pipeline/analyse.js";
import { runPlanPipeline } from "./pipeline/plan.js";
import { runExecutionPipeline } from "./pipeline/execute.js";
import { classifyError } from "./error-classifier.js";

/** Start a new session and run its pipeline. */
export async function startSession(payload: StartSessionPayload): Promise<string> {
  const sessionId = randomUUID();
  const now = new Date().toISOString();

  const session: Session = {
    id: sessionId,
    workspace_id: payload.workspace_id,
    repo_full_name: payload.repo_full_name,
    issue_number: payload.issue_number,
    session_type: payload.session_type,
    status: "pending",
    config: JSON.stringify(payload.config),
    conversation_state: null,
    current_phase: null,
    current_step_order: null,
    analysis_id: payload.analysis_id ?? null,
    plan_id: payload.plan_id ?? null,
    created_at: now,
    updated_at: now,
  };

  createSession(session);

  broadcast({ type: "session_started", session_id: sessionId });

  // Run async — don't await so we can return session_id immediately
  runSession(sessionId, payload).catch((err) => {
    console.error(`[session ${sessionId}] fatal error:`, err);
    updateSession(sessionId, { status: "error" });
    broadcast({ type: "session_error", session_id: sessionId, error: String(err) });
  });

  return sessionId;
}

/** Execute a session's pipeline based on its type. */
async function runSession(sessionId: string, payload: StartSessionPayload): Promise<void> {
  const config = payload.config;

  updateSession(sessionId, { status: "running" });

  const logFn = createLogFn(sessionId);
  const onStepUpdate = createStepUpdateFn(sessionId, payload.plan_id ?? null);

  try {
    switch (payload.session_type) {
      case "analysis":
        await runAnalysisPipeline({
          sessionId,
          payload,
          config,
          onLog: logFn,
        });
        break;
      case "plan":
        await runPlanPipeline({
          sessionId,
          payload,
          config,
          onLog: logFn,
        });
        break;
      case "execution":
        await runExecutionPipeline({
          sessionId,
          payload,
          config,
          onLog: logFn,
          onStepUpdate,
        });
        break;
    }

    updateSession(sessionId, { status: "done" });
    broadcast({ type: "session_complete", session_id: sessionId });
  } catch (err) {
    const classified = classifyError(err);
    const errorMsg = `[${classified.category}] ${classified.message}`;
    console.error(`[session ${sessionId}] ${errorMsg}`);
    updateSession(sessionId, { status: "error" });
    logFn(0, {
      type: "info",
      message: `Error (${classified.category}): ${classified.suggestion}${classified.retryable ? " [retryable]" : ""}`,
    });
    broadcast({ type: "session_error", session_id: sessionId, error: `${classified.message}\n\n${classified.suggestion}` });
    throw err;
  }
}

/** Resume a session from the last checkpoint. */
export async function resumeSession(session: Session): Promise<void> {
  console.log(`[session ${session.id}] resuming (type=${session.session_type})`);

  const config: SessionConfig = JSON.parse(session.config);
  const logFn = createLogFn(session.id);

  // Load analysis/plan results from existing tables for resume
  let analysisResult: unknown | undefined;
  let planResult: unknown | undefined;
  let issueTitle = "";
  let issueBody: string | null = null;

  if (session.analysis_id) {
    const row = getExistingTableRow("issue_analyses", session.analysis_id);
    if (row?.result) {
      try { analysisResult = JSON.parse(row.result as string); } catch { /* skip */ }
    }
  }
  if (session.plan_id) {
    const row = getExistingTableRow("execution_plans", session.plan_id);
    if (row?.result) {
      try { planResult = JSON.parse(row.result as string); } catch { /* skip */ }
    }
  }

  const payload: StartSessionPayload = {
    session_type: session.session_type,
    workspace_id: session.workspace_id,
    repo_full_name: session.repo_full_name,
    issue_number: session.issue_number,
    issue_title: issueTitle,
    issue_body: issueBody,
    issue_state: "open",
    issue_labels: [],
    config,
    analysis_id: session.analysis_id ?? undefined,
    plan_id: session.plan_id ?? undefined,
    analysis_result: analysisResult as any,
    plan_result: planResult as any,
  };

  const onStepUpdate = createStepUpdateFn(session.id, session.plan_id);

  try {
    switch (session.session_type) {
      case "execution":
        // Load completed step states for resume
        const stepStates = getStepStatesForSession(session.id);
        await runExecutionPipeline({
          sessionId: session.id,
          payload,
          config,
          onLog: logFn,
          onStepUpdate,
          resumeFromStepStates: stepStates,
        });
        break;
      // Analysis and plan don't support resume yet — restart them
      default:
        await runSession(session.id, payload);
        return;
    }

    updateSession(session.id, { status: "done" });
    broadcast({ type: "session_complete", session_id: session.id });
  } catch (err) {
    const classified = classifyError(err);
    const errorMsg = `[${classified.category}] ${classified.message}`;
    console.error(`[session ${session.id}] resume error: ${errorMsg}`);
    updateSession(session.id, { status: "error" });
    broadcast({ type: "session_error", session_id: session.id, error: `${classified.message}\n\n${classified.suggestion}` });
  }
}

function createLogFn(sessionId: string): (stepOrder: number, entry: Omit<ExecutionLogEntry, "timestamp" | "stepOrder">) => void {
  return (stepOrder, partial) => {
    const entry: ExecutionLogEntry = {
      ...partial,
      timestamp: Date.now(),
      stepOrder,
    };

    insertLog({
      session_id: sessionId,
      step_order: stepOrder,
      log_type: entry.type,
      turn: entry.turn ?? null,
      provider: entry.provider ?? null,
      model: entry.model ?? null,
      tool_name: entry.toolName ?? null,
      tool_input: entry.toolInput ?? null,
      tool_result: entry.toolResult ?? null,
      tool_error: entry.toolError ?? null,
      decision: entry.decision ?? null,
      reason: entry.reason ?? null,
      message: entry.message ?? null,
      created_at: new Date().toISOString(),
    });

    broadcast({ type: "log", session_id: sessionId, entry });
  };
}

function createStepUpdateFn(
  sessionId: string,
  planId: string | null,
): (stepOrder: number, status: string, output?: string | null, error?: string | null) => void {
  return (stepOrder, status, output, error) => {
    // Update only status/output/error — preserve existing conversation_state
    const existing = getStepState(sessionId, stepOrder);
    upsertStepState({
      session_id: sessionId,
      step_order: stepOrder,
      status: status as "pending" | "running" | "done" | "error",
      output: output ?? null,
      error: error ?? null,
      conversation_state: existing?.conversation_state ?? null,
    });

    // Also update the existing execution_step_results table for frontend compatibility
    if (planId) {
      upsertStepResult(planId, stepOrder, status, output ?? null, error ?? null);
    }

    broadcast({ type: "session_update", session_id: sessionId, step_order: stepOrder, status });
  };
}
