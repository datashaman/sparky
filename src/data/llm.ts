import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AgentProvider, LLMToolDef } from "./types";

const OLLAMA_BASE_URL = "http://localhost:11434/v1";
export const LITELLM_BASE_URL = "http://localhost:4000/v1";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Call LiteLLM via Tauri backend proxy to bypass CORS, or direct fetch in non-Tauri mode. */
async function litellmFetch(body: string, apiKey: string): Promise<{ status: number; data: any }> {
  if (isTauri()) {
    const res = await invoke<{ status: number; body: string }>("litellm_chat", { body, apiKey });
    let data: any;
    try {
      data = JSON.parse(res.body);
    } catch {
      data = { raw: res.body };
    }
    return { status: res.status, data };
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const res = await fetch(`${LITELLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers,
    body,
  });
  return { status: res.status, data: await res.json() };
}

/** Call Ollama via Tauri backend proxy to bypass CORS, or direct fetch in non-Tauri mode. */
async function ollamaFetch(body: string): Promise<{ status: number; data: any }> {
  if (isTauri()) {
    const res = await invoke<{ status: number; body: string }>("ollama_chat", { body });
    let data: any;
    try {
      data = JSON.parse(res.body);
    } catch {
      data = { raw: res.body };
    }
    return { status: res.status, data };
  }
  // Fallback: direct fetch (works if CORS is configured)
  const res = await fetch(`${OLLAMA_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  return { status: res.status, data: await res.json() };
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

/* eslint-disable @typescript-eslint/no-explicit-any */

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
}): Promise<string> {
  const { provider, modelId, apiKey, systemPrompt, userPrompt, tools, maxTurns = DEFAULT_MAX_TURNS, onToolCall } = opts;

  switch (provider) {
    case "anthropic":
      return anthropicToolLoop({ modelId, apiKey, systemPrompt, userPrompt, tools, maxTurns, onToolCall });
    case "openai":
      return openaiToolLoop({ modelId, apiKey, systemPrompt, userPrompt, tools, maxTurns, onToolCall, baseUrl: "https://api.openai.com/v1", label: "OpenAI" });
    case "ollama":
      return openaiToolLoop({ modelId, apiKey, systemPrompt, userPrompt, tools, maxTurns, onToolCall, baseUrl: OLLAMA_BASE_URL, useProxy: true, label: "Ollama" });
    case "openrouter":
      return openaiToolLoop({ modelId, apiKey, systemPrompt, userPrompt, tools, maxTurns, onToolCall, baseUrl: "https://openrouter.ai/api/v1", label: "OpenRouter" });
    case "litellm":
      return openaiToolLoop({ modelId, apiKey, systemPrompt, userPrompt, tools, maxTurns, onToolCall, baseUrl: LITELLM_BASE_URL, useProxy: true, proxyFn: litellmFetch, label: "LiteLLM" });
    case "gemini":
      return geminiToolLoop({ modelId, apiKey, systemPrompt, userPrompt, tools, maxTurns, onToolCall });
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
}): Promise<string> {
  const { modelId, apiKey, systemPrompt, tools, maxTurns, onToolCall } = opts;

  const anthropicTools = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));

  const messages: any[] = [{ role: "user", content: opts.userPrompt }];

  for (let turn = 0; turn < maxTurns; turn++) {
    const isLastTurn = turn === maxTurns - 1;
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
      // Extract final text
      return content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");
    }

    // Execute tool calls and build results
    const toolResults: any[] = [];
    for (const tu of toolUses) {
      const result = await onToolCall(tu.name, tu.input ?? {});
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
  baseUrl?: string;
  useProxy?: boolean;
  proxyFn?: (body: string, apiKey: string) => Promise<{ status: number; data: any }>;
  label?: string;
}): Promise<string> {
  const { modelId, apiKey, systemPrompt, tools, maxTurns, onToolCall, baseUrl = "https://api.openai.com/v1", useProxy = false, proxyFn, label = "API" } = opts;

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
      return msg.content ?? "";
    }

    // Execute tool calls
    for (const tc of msg.tool_calls) {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: `Error: invalid JSON in tool arguments: ${tc.function.arguments}`,
        });
        continue;
      }
      const result = await onToolCall(tc.function.name, args);
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
}): Promise<string> {
  const { modelId, apiKey, systemPrompt, tools, maxTurns, onToolCall } = opts;

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
      // Extract text
      return parts
        .filter((p: any) => p.text)
        .map((p: any) => p.text)
        .join("");
    }

    // Execute function calls and build responses
    const responseParts: any[] = [];
    for (const fc of fnCalls) {
      const result = await onToolCall(fc.functionCall.name, fc.functionCall.args ?? {});
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
