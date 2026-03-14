import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AgentProvider, ExecutionLogEntry, LLMToolDef } from "./types";

export type LogCallback = (entry: Omit<ExecutionLogEntry, "timestamp" | "stepOrder">) => void;

function truncate(s: string, max = 200): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

const OLLAMA_BASE_URL = "http://localhost:11434/v1";
export const LITELLM_BASE_URL = "http://localhost:4000/v1";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Parse a Tauri proxy response body as JSON, falling back to a raw wrapper. */
function parseProxyBody(body: string): any {
  try {
    return JSON.parse(body);
  } catch {
    return { raw: body };
  }
}

/** Call a local LLM proxy via Tauri backend (to bypass CORS), or direct fetch in non-Tauri mode. */
async function localProxyFetch(
  body: string,
  opts: { tauriCommand: string; tauriArgs: Record<string, unknown>; fallbackUrl: string; apiKey?: string },
): Promise<{ status: number; data: any }> {
  if (isTauri()) {
    const res = await invoke<{ status: number; body: string }>(opts.tauriCommand, opts.tauriArgs);
    return { status: res.status, data: parseProxyBody(res.body) };
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;
  const res = await fetch(opts.fallbackUrl, { method: "POST", headers, body });
  return { status: res.status, data: await res.json() };
}

/** Call LiteLLM via Tauri backend proxy to bypass CORS, or direct fetch in non-Tauri mode. */
async function litellmFetch(body: string, apiKey: string): Promise<{ status: number; data: any }> {
  return localProxyFetch(body, {
    tauriCommand: "litellm_chat",
    tauriArgs: { body, apiKey },
    fallbackUrl: `${LITELLM_BASE_URL}/chat/completions`,
    apiKey,
  });
}

/** Call Ollama via Tauri backend proxy to bypass CORS, or direct fetch in non-Tauri mode. */
async function ollamaFetch(body: string): Promise<{ status: number; data: any }> {
  return localProxyFetch(body, {
    tauriCommand: "ollama_chat",
    tauriArgs: { body },
    fallbackUrl: `${OLLAMA_BASE_URL}/chat/completions`,
  });
}

/** Providers that don't require an API key. */
export const KEYLESS_PROVIDERS = new Set<AgentProvider>(["ollama", "litellm"]);

export async function callLLM(opts: {
  provider: AgentProvider;
  modelId: string;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  schema: Record<string, unknown>;
  schemaName: string;
  maxTokens?: number;
}): Promise<string> {
  const { provider, modelId, apiKey, systemPrompt, userPrompt, schema, schemaName, maxTokens = 1024 } = opts;

  switch (provider) {
    case "anthropic": {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
          output_config: {
            format: {
              type: "json_schema",
              schema,
            },
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

    case "openai": {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: maxTokens,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: schemaName,
              strict: true,
              schema,
            },
          },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`OpenAI API ${res.status}: ${body}`);
      }
      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? "";
    }

    case "gemini": {
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

    case "ollama": {
      const reqBody = JSON.stringify({
        model: modelId,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt + "\n\nYou MUST respond with valid JSON matching this schema:\n" + JSON.stringify(schema, null, 2) },
          { role: "user", content: userPrompt },
        ],
      });
      const { status, data } = await ollamaFetch(reqBody);
      if (status !== 200) {
        throw new Error(`Ollama API ${status}: ${JSON.stringify(data)}`);
      }
      return data.choices?.[0]?.message?.content ?? "";
    }

    case "openrouter": {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: maxTokens,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: schemaName,
              strict: true,
              schema,
            },
          },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`OpenRouter API ${res.status}: ${body}`);
      }
      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? "";
    }

    case "litellm": {
      const reqBody = JSON.stringify({
        model: modelId,
        max_tokens: maxTokens,
        response_format: {
          type: "json_schema",
          json_schema: { name: schemaName, strict: true, schema },
        },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });
      const { status, data } = await litellmFetch(reqBody, apiKey);
      if (status !== 200) {
        throw new Error(`LiteLLM API ${status}: ${JSON.stringify(data)}`);
      }
      return data.choices?.[0]?.message?.content ?? "";
    }
  }
}

// ─── Tool-use loop ───

const DEFAULT_MAX_TURNS = 25;

export async function callLLMWithTools(opts: {
  provider: AgentProvider;
  modelId: string;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  tools: LLMToolDef[];
  maxTurns?: number;
  onToolCall: (name: string, input: Record<string, unknown>) => Promise<string>;
  onLog?: LogCallback;
}): Promise<string> {
  const { provider, modelId, apiKey, systemPrompt, userPrompt, tools, maxTurns = DEFAULT_MAX_TURNS, onToolCall, onLog } = opts;

  switch (provider) {
    case "anthropic":
      return anthropicToolLoop({ modelId, apiKey, systemPrompt, userPrompt, tools, maxTurns, onToolCall, onLog });
    case "openai":
      return openaiToolLoop({ modelId, apiKey, systemPrompt, userPrompt, tools, maxTurns, onToolCall, onLog, baseUrl: "https://api.openai.com/v1", label: "OpenAI" });
    case "ollama":
      return openaiToolLoop({ modelId, apiKey, systemPrompt, userPrompt, tools, maxTurns, onToolCall, onLog, baseUrl: OLLAMA_BASE_URL, useProxy: true, label: "Ollama" });
    case "openrouter":
      return openaiToolLoop({ modelId, apiKey, systemPrompt, userPrompt, tools, maxTurns, onToolCall, onLog, baseUrl: "https://openrouter.ai/api/v1", label: "OpenRouter" });
    case "litellm":
      return openaiToolLoop({ modelId, apiKey, systemPrompt, userPrompt, tools, maxTurns, onToolCall, onLog, baseUrl: LITELLM_BASE_URL, useProxy: true, proxyFn: litellmFetch, label: "LiteLLM" });
    case "gemini":
      return geminiToolLoop({ modelId, apiKey, systemPrompt, userPrompt, tools, maxTurns, onToolCall, onLog });
  }
}

// ── Anthropic ──

async function anthropicToolLoop(opts: {
  modelId: string;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  tools: LLMToolDef[];
  maxTurns: number;
  onToolCall: (name: string, input: Record<string, unknown>) => Promise<string>;
  onLog?: LogCallback;
}): Promise<string> {
  const { modelId, apiKey, systemPrompt, tools, maxTurns, onToolCall, onLog } = opts;

  const anthropicTools = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));

  const messages: any[] = [{ role: "user", content: opts.userPrompt }];

  for (let turn = 0; turn < maxTurns; turn++) {
    const isLastTurn = turn === maxTurns - 1;

    onLog?.({ type: "llm_request", turn: turn + 1, provider: "anthropic", model: modelId, message: turn === 0 ? truncate(opts.userPrompt, 150) : `turn ${turn + 1} (with tool results)` });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
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

    // Add assistant response to messages
    messages.push({ role: "assistant", content });

    // Check if there are tool uses
    const toolUses = content.filter((b: any) => b.type === "tool_use");
    if (toolUses.length === 0 || data.stop_reason === "end_turn" || isLastTurn) {
      onLog?.({ type: "llm_response", turn: turn + 1, message: "final response" });
      return content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");
    }

    onLog?.({ type: "llm_response", turn: turn + 1, message: `${toolUses.length} tool call${toolUses.length > 1 ? "s" : ""}` });

    // Execute tool calls and build results
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
    }
    messages.push({ role: "user", content: toolResults });
  }

  return "(max turns reached)";
}

// ── OpenAI ──

async function openaiToolLoop(opts: {
  modelId: string;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  tools: LLMToolDef[];
  maxTurns: number;
  onToolCall: (name: string, input: Record<string, unknown>) => Promise<string>;
  onLog?: LogCallback;
  baseUrl?: string;
  useProxy?: boolean;
  proxyFn?: (body: string, apiKey: string) => Promise<{ status: number; data: any }>;
  label?: string;
}): Promise<string> {
  const { modelId, apiKey, systemPrompt, tools, maxTurns, onToolCall, onLog, baseUrl = "https://api.openai.com/v1", useProxy = false, proxyFn, label = "API" } = opts;

  const openaiTools = tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  const messages: any[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: opts.userPrompt },
  ];

  for (let turn = 0; turn < maxTurns; turn++) {
    const isLastTurn = turn === maxTurns - 1;

    if (isLastTurn) {
      messages.push({ role: "user", content: "You have reached the tool-use limit. Summarize what you accomplished and what remains." });
    }

    onLog?.({ type: "llm_request", turn: turn + 1, provider: label?.toLowerCase(), model: modelId, message: turn === 0 ? truncate(opts.userPrompt, 150) : `turn ${turn + 1} (with tool results)` });

    const reqBody = JSON.stringify({
      model: modelId,
      max_tokens: 4096,
      messages,
      ...(isLastTurn ? {} : { tools: openaiTools }),
    });

    let data: any;
    if (useProxy) {
      const fetchFn = proxyFn ?? ((b: string) => ollamaFetch(b));
      const proxyRes = await fetchFn(reqBody, apiKey);
      if (proxyRes.status !== 200) {
        throw new Error(`${label} API ${proxyRes.status}: ${JSON.stringify(proxyRes.data)}`);
      }
      data = proxyRes.data;
    } else {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: reqBody,
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${label} API ${res.status}: ${body}`);
      }
      data = await res.json();
    }

    const choice = data.choices?.[0];
    if (!choice) throw new Error(`No choices in ${label} response`);

    const msg = choice.message;
    messages.push(msg);

    if (choice.finish_reason !== "tool_calls" || !msg.tool_calls?.length || isLastTurn) {
      onLog?.({ type: "llm_response", turn: turn + 1, message: "final response" });
      return msg.content ?? "";
    }

    onLog?.({ type: "llm_response", turn: turn + 1, message: `${msg.tool_calls.length} tool call${msg.tool_calls.length > 1 ? "s" : ""}` });

    // Execute tool calls
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
    }
  }

  return "(max turns reached)";
}

// ── Gemini ──

async function geminiToolLoop(opts: {
  modelId: string;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  tools: LLMToolDef[];
  maxTurns: number;
  onToolCall: (name: string, input: Record<string, unknown>) => Promise<string>;
  onLog?: LogCallback;
}): Promise<string> {
  const { modelId, apiKey, systemPrompt, tools, maxTurns, onToolCall, onLog } = opts;

  // Gemini wants schemas without additionalProperties
  const declarations = tools.map((t) => {
    const params = { ...t.parameters };
    delete params.additionalProperties;
    return { name: t.name, description: t.description, parameters: params };
  });

  const contents: any[] = [{ role: "user", parts: [{ text: opts.userPrompt }] }];

  for (let turn = 0; turn < maxTurns; turn++) {
    const isLastTurn = turn === maxTurns - 1;

    if (isLastTurn) {
      contents.push({ role: "user", parts: [{ text: "You have reached the tool-use limit. Summarize what you accomplished and what remains." }] });
    }

    onLog?.({ type: "llm_request", turn: turn + 1, provider: "gemini", model: modelId, message: turn === 0 ? truncate(opts.userPrompt, 150) : `turn ${turn + 1} (with tool results)` });

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

    // Add model response to contents
    contents.push({ role: "model", parts });

    // Check for function calls
    const fnCalls = parts.filter((p: any) => p.functionCall);
    if (fnCalls.length === 0 || isLastTurn) {
      onLog?.({ type: "llm_response", turn: turn + 1, message: "final response" });
      return parts
        .filter((p: any) => p.text)
        .map((p: any) => p.text)
        .join("");
    }

    onLog?.({ type: "llm_response", turn: turn + 1, message: `${fnCalls.length} tool call${fnCalls.length > 1 ? "s" : ""}` });

    // Execute function calls and build responses
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
    }
    contents.push({ role: "user", parts: responseParts });
  }

  return "(max turns reached)";
}
