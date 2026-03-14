import type { LLMToolDef } from "../types.js";
import type { LogCallback, CheckpointCallback } from "./index.js";
import { getContextBudget } from "./context-budget.js";
import { compressMessages } from "./compress.js";

function truncate(s: string, max = 200): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function geminiStructured(opts: {
  modelId: string;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  schema: Record<string, unknown>;
  maxTokens: number;
}): Promise<string> {
  const { modelId, apiKey, systemPrompt, userPrompt, schema } = opts;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: schema,
        },
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini API ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.map((p: { text: string }) => p.text).join("") ?? "";
}

export async function geminiToolLoop(opts: {
  modelId: string;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  tools: LLMToolDef[];
  maxTurns: number;
  onToolCall: (name: string, input: Record<string, unknown>) => Promise<string>;
  onLog?: LogCallback;
  existingMessages?: any[];
  onCheckpoint?: CheckpointCallback;
}): Promise<{ text: string; messages: any[] }> {
  const { modelId, apiKey, systemPrompt, tools, maxTurns, onToolCall, onLog, onCheckpoint } = opts;

  const declarations = tools.map((t) => {
    const params = { ...t.parameters };
    delete params.additionalProperties;
    return { name: t.name, description: t.description, parameters: params };
  });

  const contents: any[] = opts.existingMessages
    ? [...opts.existingMessages]
    : [{ role: "user", parts: [{ text: opts.userPrompt }] }];

  let toolResultCount = 0;
  let hintInjected = false;

  for (let turn = 0; turn < maxTurns; turn++) {
    const isLastTurn = turn === maxTurns - 1;

    if (isLastTurn) {
      contents.push({ role: "user", parts: [{ text: "You have reached the tool-use limit. Respond with:\n1. What is DONE (with file paths)\n2. What REMAINS to be completed\n3. Current state of the codebase (compiles? tests pass?)" }] });
    }

    onLog?.({
      type: "llm_request",
      turn: turn + 1,
      provider: "gemini",
      model: modelId,
      message: turn === 0 && !opts.existingMessages ? truncate(opts.userPrompt, 150) : `turn ${turn + 1} (with tool results)`,
    });

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents,
          ...(isLastTurn ? {} : { tools: [{ functionDeclarations: declarations }] }),
        }),
      },
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gemini API ${res.status}: ${body}`);
    }

    const data = await res.json();
    const parts: any[] = data.candidates?.[0]?.content?.parts ?? [];
    contents.push({ role: "model", parts });

    const fnCalls = parts.filter((p: any) => p.functionCall);
    if (fnCalls.length === 0 || isLastTurn) {
      onLog?.({ type: "llm_response", turn: turn + 1, message: "final response" });
      const text = parts
        .filter((p: any) => p.text)
        .map((p: any) => p.text)
        .join("");
      return { text, messages: contents };
    }

    onLog?.({
      type: "llm_response",
      turn: turn + 1,
      message: `${fnCalls.length} tool call${fnCalls.length > 1 ? "s" : ""}`,
    });

    const responseParts: any[] = [];
    for (const fc of fnCalls) {
      onLog?.({ type: "tool_call", turn: turn + 1, toolName: fc.functionCall.name, toolInput: truncate(JSON.stringify(fc.functionCall.args ?? {})) });
      const result = await onToolCall(fc.functionCall.name, fc.functionCall.args ?? {});
      onLog?.({ type: "tool_result", turn: turn + 1, toolName: fc.functionCall.name, toolResult: truncate(result) });
      responseParts.push({
        functionResponse: {
          name: fc.functionCall.name,
          response: { result },
        },
      });
      toolResultCount++;
    }
    contents.push({ role: "user", parts: responseParts });

    // Context budget tracking and compression
    const budget = getContextBudget(contents, "gemini", modelId);
    onLog?.({ type: "context_budget", turn: turn + 1, message: `Context: ${budget.utilizationPct}% (${budget.usedTokens}/${budget.maxTokens} tokens)` });

    if (budget.utilizationPct > 90) {
      compressMessages(contents, "gemini", modelId, onLog, { targetPct: 50 });
    } else if (budget.utilizationPct > 75) {
      compressMessages(contents, "gemini", modelId, onLog);
    }

    // Proactive degradation hints
    const turnsUsedPct = ((turn + 1) / maxTurns) * 100;
    if ((turnsUsedPct >= 80 || budget.utilizationPct >= 85) && !hintInjected) {
      contents.push({ role: "user", parts: [{ text: "You are running low on remaining actions. Prioritize completing the most critical work. Leave the codebase in a working state." }] });
      hintInjected = true;
    }

    if (onCheckpoint && toolResultCount % 3 === 0) {
      onCheckpoint(contents, turn + 1);
    }
  }

  return { text: "(max turns reached)", messages: contents };
}
