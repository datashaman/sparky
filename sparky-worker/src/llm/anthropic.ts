import type { LLMToolDef } from "../types.js";
import type { LogCallback, CheckpointCallback } from "./index.js";

function truncate(s: string, max = 200): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function anthropicStructured(opts: {
  modelId: string;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  schema: Record<string, unknown>;
  maxTokens: number;
}): Promise<string> {
  const { modelId, apiKey, systemPrompt, userPrompt, schema, maxTokens } = opts;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      output_config: {
        format: { type: "json_schema", schema },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data.content?.map((b: { text: string }) => b.text).join("") ?? "";
}

export async function anthropicToolLoop(opts: {
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

  const anthropicTools = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));

  const messages: any[] = opts.existingMessages
    ? [...opts.existingMessages]
    : [{ role: "user", content: opts.userPrompt }];

  let toolResultCount = 0;

  for (let turn = 0; turn < maxTurns; turn++) {
    const isLastTurn = turn === maxTurns - 1;

    onLog?.({
      type: "llm_request",
      turn: turn + 1,
      provider: "anthropic",
      model: modelId,
      message: turn === 0 && !opts.existingMessages ? truncate(opts.userPrompt, 150) : `turn ${turn + 1} (with tool results)`,
    });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 4096,
        system: isLastTurn
          ? systemPrompt + "\n\nYou have reached the tool-use limit. Summarize what you accomplished and what remains."
          : systemPrompt,
        messages,
        ...(isLastTurn ? {} : { tools: anthropicTools }),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic API ${res.status}: ${body}`);
    }

    const data = await res.json();
    const content: any[] = data.content ?? [];
    messages.push({ role: "assistant", content });

    const toolUses = content.filter((b: any) => b.type === "tool_use");
    if (toolUses.length === 0 || data.stop_reason === "end_turn" || isLastTurn) {
      onLog?.({ type: "llm_response", turn: turn + 1, message: "final response" });
      const text = content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");
      return { text, messages };
    }

    onLog?.({
      type: "llm_response",
      turn: turn + 1,
      message: `${toolUses.length} tool call${toolUses.length > 1 ? "s" : ""}`,
    });

    const toolResults: any[] = [];
    for (const tu of toolUses) {
      onLog?.({ type: "tool_call", turn: turn + 1, toolName: tu.name, toolInput: truncate(JSON.stringify(tu.input ?? {})) });
      const result = await onToolCall(tu.name, tu.input ?? {});
      onLog?.({ type: "tool_result", turn: turn + 1, toolName: tu.name, toolResult: truncate(result) });
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: result,
      });
      toolResultCount++;
    }
    messages.push({ role: "user", content: toolResults });
    if (onCheckpoint && toolResultCount % 3 === 0) {
      onCheckpoint(messages, turn + 1);
    }
  }

  return { text: "(max turns reached)", messages };
}
