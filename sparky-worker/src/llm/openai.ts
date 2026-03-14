import type { LLMToolDef } from "../types.js";
import type { LogCallback, CheckpointCallback } from "./index.js";
import { getContextBudget } from "./context-budget.js";
import { compressMessages } from "./compress.js";
import { fetchWithRetry } from "./retry.js";

function truncate(s: string, max = 200): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function openaiStructured(opts: {
  modelId: string;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  schema: Record<string, unknown>;
  schemaName: string;
  maxTokens: number;
  baseUrl: string;
  jsonMode?: boolean;
}): Promise<string> {
  const { modelId, apiKey, systemPrompt, userPrompt, schema, schemaName, maxTokens, baseUrl, jsonMode } = opts;

  const messages: any[] = [
    { role: "system", content: jsonMode
      ? systemPrompt + "\n\nYou MUST respond with valid JSON matching this schema:\n" + JSON.stringify(schema, null, 2)
      : systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const body: any = {
    model: modelId,
    max_tokens: maxTokens,
    messages,
  };

  if (jsonMode) {
    body.response_format = { type: "json_object" };
  } else {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: schemaName, strict: true, schema },
    };
  }

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  const res = await fetchWithRetry(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }, { label: "OpenAI" });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

export async function openaiToolLoop(opts: {
  modelId: string;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  tools: LLMToolDef[];
  maxTurns: number;
  onToolCall: (name: string, input: Record<string, unknown>) => Promise<string>;
  onLog?: LogCallback;
  baseUrl: string;
  label: string;
  existingMessages?: any[];
  onCheckpoint?: CheckpointCallback;
}): Promise<{ text: string; messages: any[] }> {
  const { modelId, apiKey, systemPrompt, tools, maxTurns, onToolCall, onLog, baseUrl, label, onCheckpoint } = opts;

  const openaiTools = tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  const messages: any[] = opts.existingMessages
    ? [...opts.existingMessages]
    : [
        { role: "system", content: systemPrompt },
        { role: "user", content: opts.userPrompt },
      ];

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  let toolResultCount = 0;
  let hintInjected = false;

  for (let turn = 0; turn < maxTurns; turn++) {
    const isLastTurn = turn === maxTurns - 1;

    if (isLastTurn) {
      messages.push({ role: "user", content: "You have reached the tool-use limit. Respond with:\n1. What is DONE (with file paths)\n2. What REMAINS to be completed\n3. Current state of the codebase (compiles? tests pass?)" });
    }

    onLog?.({
      type: "llm_request",
      turn: turn + 1,
      provider: label.toLowerCase(),
      model: modelId,
      message: turn === 0 && !opts.existingMessages ? truncate(opts.userPrompt, 150) : `turn ${turn + 1} (with tool results)`,
    });

    const reqBody = JSON.stringify({
      model: modelId,
      max_tokens: 4096,
      messages,
      ...(isLastTurn ? {} : { tools: openaiTools }),
    });

    const res = await fetchWithRetry(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: reqBody,
    }, { label, onLog });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${label} API ${res.status}: ${body}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    if (!choice) throw new Error(`No choices in ${label} response`);

    const msg = choice.message;
    messages.push(msg);

    if (choice.finish_reason !== "tool_calls" || !msg.tool_calls?.length || isLastTurn) {
      onLog?.({ type: "llm_response", turn: turn + 1, message: "final response" });
      return { text: msg.content ?? "", messages };
    }

    onLog?.({
      type: "llm_response",
      turn: turn + 1,
      message: `${msg.tool_calls.length} tool call${msg.tool_calls.length > 1 ? "s" : ""}`,
    });

    for (const tc of msg.tool_calls) {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        onLog?.({ type: "tool_result", turn: turn + 1, toolName: tc.function.name, toolError: "invalid JSON in tool arguments" });
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: `Error: invalid JSON in tool arguments: ${tc.function.arguments}`,
        });
        continue;
      }
      onLog?.({ type: "tool_call", turn: turn + 1, toolName: tc.function.name, toolInput: truncate(JSON.stringify(args)) });
      const result = await onToolCall(tc.function.name, args);
      onLog?.({ type: "tool_result", turn: turn + 1, toolName: tc.function.name, toolResult: truncate(result) });
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result,
      });
      toolResultCount++;
    }

    // Context budget tracking and compression
    const budget = getContextBudget(messages, label.toLowerCase() as any, modelId);
    onLog?.({ type: "context_budget", turn: turn + 1, message: `Context: ${budget.utilizationPct}% (${budget.usedTokens}/${budget.maxTokens} tokens)` });

    if (budget.utilizationPct > 90) {
      compressMessages(messages, label.toLowerCase() as any, modelId, onLog, { targetPct: 50 });
    } else if (budget.utilizationPct > 75) {
      compressMessages(messages, label.toLowerCase() as any, modelId, onLog);
    }

    // Proactive degradation hints
    const turnsUsedPct = ((turn + 1) / maxTurns) * 100;
    if ((turnsUsedPct >= 80 || budget.utilizationPct >= 85) && !hintInjected) {
      messages.push({ role: "user", content: "You are running low on remaining actions. Prioritize completing the most critical work. Leave the codebase in a working state." });
      hintInjected = true;
    }

    if (onCheckpoint && toolResultCount % 3 === 0) {
      onCheckpoint(messages, turn + 1);
    }
  }

  return { text: "(max turns reached)", messages };
}
