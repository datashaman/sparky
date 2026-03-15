import { GoogleGenAI, type Content, type Part } from "@google/genai";
import type { LLMToolDef } from "../types.js";
import type { LogCallback, CheckpointCallback } from "./index.js";
import { getContextBudget } from "./context-budget.js";
import { compressMessages } from "./compress.js";

function truncate(s: string, max = 200): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function makeClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({ apiKey });
}

export async function geminiStructured(opts: {
  modelId: string;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  schema: Record<string, unknown>;
  maxTokens: number;
}): Promise<string> {
  const { modelId, apiKey, systemPrompt, userPrompt, schema, maxTokens } = opts;
  const client = makeClient(apiKey);

  const response = await client.models.generateContent({
    model: modelId,
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: "application/json",
      responseSchema: schema as any,
      maxOutputTokens: maxTokens,
    },
  });

  return response.candidates?.[0]?.content?.parts
    ?.filter((p: Part) => p.text)
    .map((p: Part) => p.text)
    .join("") ?? "";
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
  const client = makeClient(apiKey);

  const declarations = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parametersJsonSchema: t.parameters,
  }));

  const contents: Content[] = opts.existingMessages
    ? [...opts.existingMessages]
    : [{ role: "user", parts: [{ text: opts.userPrompt }] }];

  let toolResultCount = 0;
  let hintLevel = 0; // 0=none, 1=info, 2=urgent

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

    const data = await client.models.generateContent({
      model: modelId,
      contents,
      config: {
        systemInstruction: systemPrompt,
        ...(isLastTurn ? {} : { tools: [{ functionDeclarations: declarations }] }),
      },
    });

    const parts: Part[] = data.candidates?.[0]?.content?.parts ?? [];
    contents.push({ role: "model", parts });

    const fnCalls = parts.filter((p: Part) => p.functionCall);
    if (fnCalls.length === 0 || isLastTurn) {
      onLog?.({ type: "llm_response", turn: turn + 1, message: "final response" });
      const text = parts
        .filter((p: Part) => p.text)
        .map((p: Part) => p.text)
        .join("");
      return { text, messages: contents };
    }

    onLog?.({
      type: "llm_response",
      turn: turn + 1,
      message: `${fnCalls.length} tool call${fnCalls.length > 1 ? "s" : ""}`,
    });

    const responseParts: Part[] = [];
    for (const fc of fnCalls) {
      const name = fc.functionCall!.name!;
      const args = fc.functionCall!.args ?? {};
      onLog?.({ type: "tool_call", turn: turn + 1, toolName: name, toolInput: truncate(JSON.stringify(args)) });
      const result = await onToolCall(name, args);
      onLog?.({ type: "tool_result", turn: turn + 1, toolName: name, toolResult: truncate(result) });
      responseParts.push({
        functionResponse: {
          name,
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

    // Remaining turns awareness — two-stage hints
    const remaining = maxTurns - turn - 1;
    const turnsUsedPct = ((turn + 1) / maxTurns) * 100;
    if ((turnsUsedPct >= 80 || budget.utilizationPct >= 85) && hintLevel < 2) {
      contents.push({ role: "user", parts: [{ text: `⚠ ${remaining} actions remaining (context: ${budget.utilizationPct}% used). Prioritize completing the most critical work. Leave the codebase in a working state. Skip nice-to-haves.` }] });
      hintLevel = 2;
    } else if (turnsUsedPct >= 75 && hintLevel < 1) {
      contents.push({ role: "user", parts: [{ text: `Note: ${remaining} of ${maxTurns} actions remaining. Plan your remaining work accordingly.` }] });
      hintLevel = 1;
    }

    if (onCheckpoint && toolResultCount % 3 === 0) {
      onCheckpoint(contents, turn + 1);
    }
  }

  return { text: "(max turns reached)", messages: contents };
}
