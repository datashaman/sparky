import { randomUUID } from "node:crypto";
import { insertAskUser, getPendingAskUser, timeoutAskUser } from "../db.js";
import { broadcast } from "../ipc.js";
import type { AskUserHandler, AskUserRequest } from "./index.js";

/**
 * Create an ask_user handler that persists prompts to the DB,
 * broadcasts to connected frontends, and polls for answers.
 */
export function createAskUserHandler(
  sessionId: string,
  stepOrder: number,
  timeoutMinutes: number | null,
): AskUserHandler {
  return async (request: AskUserRequest): Promise<string[]> => {
    const promptId = randomUUID();
    const now = new Date().toISOString();

    // Persist to DB
    insertAskUser({
      id: promptId,
      session_id: sessionId,
      step_order: stepOrder,
      question: request.question,
      options: JSON.stringify(request.options),
      allow_multiple: request.allowMultiple ? 1 : 0,
      status: "pending",
      answer: null,
      timeout_minutes: timeoutMinutes,
      created_at: now,
      answered_at: null,
    });

    // Broadcast to connected frontends
    broadcast({
      type: "ask_user",
      session_id: sessionId,
      prompt_id: promptId,
      question: request.question,
      options: request.options,
      allow_multiple: request.allowMultiple,
    });

    // Poll DB for answer
    const deadline = timeoutMinutes
      ? Date.now() + timeoutMinutes * 60 * 1000
      : null;

    while (true) {
      await sleep(2000);

      const prompt = getPendingAskUser(sessionId);

      // If the prompt no longer exists or is answered
      if (!prompt || prompt.id !== promptId) {
        // Check if it was answered
        const { getDb } = await import("../db.js");
        const resolved = getDb()
          .prepare("SELECT * FROM session_ask_user WHERE id = ?")
          .get(promptId) as { status: string; answer: string | null } | undefined;

        if (resolved?.status === "answered" && resolved.answer) {
          return JSON.parse(resolved.answer) as string[];
        }
        if (resolved?.status === "timeout") {
          return [];
        }
        // Answered or gone — return empty
        return [];
      }

      // Check timeout
      if (deadline && Date.now() > deadline) {
        timeoutAskUser(promptId);
        return [];
      }
    }
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
