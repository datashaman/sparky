import type { IPCCommand, IPCEvent } from "./types.js";
import { listSessions, listRunningSessions, answerAskUser, updateSession } from "./db.js";
import { startSession, resumeSession } from "./session-runner.js";

/** Active session tracking. */
const activeSessions = new Set<string>();
const cancelledSessions = new Set<string>();

export function isSessionCancelled(sessionId: string): boolean {
  return cancelledSessions.has(sessionId);
}

/** Handle an IPC command from the frontend. */
export function handleCommand(command: IPCCommand, send: (event: IPCEvent) => void): void {
  switch (command.type) {
    case "start_session": {
      // session_started is broadcast from startSession() to all clients
      startSession(command.payload)
        .then((sessionId) => {
          activeSessions.add(sessionId);
        })
        .catch((err) => {
          send({ type: "error", error: `Failed to start session: ${err}` });
        });
      break;
    }

    case "cancel_session": {
      const { session_id } = command.payload;
      cancelledSessions.add(session_id);
      activeSessions.delete(session_id);
      updateSession(session_id, { status: "cancelled" });
      // Pipelines check isSessionCancelled() at each step boundary
      send({ type: "session_complete", session_id });
      break;
    }

    case "answer_ask_user": {
      const { prompt_id, selected } = command.payload;
      answerAskUser(prompt_id, selected);
      break;
    }

    case "list_sessions": {
      const sessions = listSessions();
      send({ type: "sessions_list", sessions });
      break;
    }

    case "ping": {
      send({ type: "pong" });
      break;
    }

    default: {
      send({ type: "error", error: `Unknown command type: ${(command as { type: string }).type}` });
    }
  }
}

/** Resume any sessions that were running when the worker last stopped. */
export async function resumeRunningSessions(): Promise<void> {
  const running = listRunningSessions();
  if (running.length === 0) {
    console.log("[manager] no sessions to resume");
    return;
  }

  console.log(`[manager] resuming ${running.length} session(s)`);
  for (const session of running) {
    activeSessions.add(session.id);
    resumeSession(session).catch((err) => {
      console.error(`[manager] failed to resume session ${session.id}:`, err);
      activeSessions.delete(session.id);
    });
  }
}
