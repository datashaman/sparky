import OpenAI from "openai";
import type { LLMToolDef } from "../types.js";
import type { LogCallback, CheckpointCallback } from "./index.js";
import { getContextBudget } from "./context-budget.js";
import { compressMessages } from "./compress.js";

function truncate(s: string, max = 200): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function makeClient(apiKey: string, baseUrl: string): OpenAI {
  return new OpenAI({ apiKey: apiKey || "unused", baseURL: baseUrl });
}

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
  const client = makeClient(apiKey, baseUrl);

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: jsonMode
      ? systemPrompt + "\n\nYou MUST respond with valid JSON matching this schema:\n" + JSON.stringify(schema, null, 2)
      : systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const response = await client.chat.completions.create({
    model: modelId,
    max_tokens: maxTokens,
    messages,
    response_format: jsonMode
      ? { type: "json_object" }
      : { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } },
  });

  return response.choices?.[0]?.message?.content ?? "";
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
  const client = makeClient(apiKey, baseUrl);

  const openaiTools: OpenAI.ChatCompletionTool[] = tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  const messages: any[] = opts.existingMessages
    ? [...opts.existingMessages]
    : [
        { role: "system", content: systemPrompt },
        { role: "user", content: opts.userPrompt },
      ];

  let toolResultCount = 0;
  let hintLevel = 0; // 0=none, 1=info, 2=urgent

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

    const data = await client.chat.completions.create({
      model: modelId,
      max_tokens: 4096,
      messages,
      ...(isLastTurn ? {} : { tools: openaiTools }),
    });

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
      if (tc.type !== "function") continue;
      const fn = tc.function;
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(fn.arguments);
      } catch {
        onLog?.({ type: "tool_result", turn: turn + 1, toolName: fn.name, toolError: "invalid JSON in tool arguments" });
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: `Error: invalid JSON in tool arguments: ${fn.arguments}`,
        });
        continue;
      }
      onLog?.({ type: "tool_call", turn: turn + 1, toolName: fn.name, toolInput: truncate(JSON.stringify(args)) });
      const result = await onToolCall(fn.name, args);
      onLog?.({ type: "tool_result", turn: turn + 1, toolName: fn.name, toolResult: truncate(result) });
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

    // Remaining turns awareness — two-stage hints
    const remaining = maxTurns - turn - 1;
    const turnsUsedPct = ((turn + 1) / maxTurns) * 100;
    if ((turnsUsedPct >= 80 || budget.utilizationPct >= 85) && hintLevel < 2) {
      messages.push({ role: "user", content: `⚠ ${remaining} actions remaining (context: ${budget.utilizationPct}% used). Prioritize completing the most critical work. Leave the codebase in a working state. Skip nice-to-haves.` });
      hintLevel = 2;
    } else if (turnsUsedPct >= 75 && hintLevel < 1) {
      messages.push({ role: "user", content: `Note: ${remaining} of ${maxTurns} actions remaining. Plan your remaining work accordingly.` });
      hintLevel = 1;
    }

    if (onCheckpoint && toolResultCount % 3 === 0) {
      onCheckpoint(messages, turn + 1);
    }
  }

  return { text: "(max turns reached)", messages };
}
