import type { AgentProvider, LLMToolDef } from "./types";

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
      return openaiToolLoop({ modelId, apiKey, systemPrompt, userPrompt, tools, maxTurns, onToolCall });
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
        system: systemPrompt,
        messages,
        tools: anthropicTools,
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
    if (toolUses.length === 0 || data.stop_reason === "end_turn") {
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

  throw new Error(`Exceeded max turns (${maxTurns})`);
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
}): Promise<string> {
  const { modelId, apiKey, systemPrompt, tools, maxTurns, onToolCall } = opts;

  const openaiTools = tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  const messages: any[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: opts.userPrompt },
  ];

  for (let turn = 0; turn < maxTurns; turn++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 4096,
        messages,
        tools: openaiTools,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI API ${res.status}: ${body}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    if (!choice) throw new Error("No choices in OpenAI response");

    const msg = choice.message;
    messages.push(msg);

    if (choice.finish_reason !== "tool_calls" || !msg.tool_calls?.length) {
      return msg.content ?? "";
    }

    // Execute tool calls
    for (const tc of msg.tool_calls) {
      const args = JSON.parse(tc.function.arguments);
      const result = await onToolCall(tc.function.name, args);
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result,
      });
    }
  }

  throw new Error(`Exceeded max turns (${maxTurns})`);
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
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents,
          tools: [{ functionDeclarations: declarations }],
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
    if (fnCalls.length === 0) {
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

  throw new Error(`Exceeded max turns (${maxTurns})`);
}
