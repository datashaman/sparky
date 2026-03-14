import type { AgentProvider, LLMToolDef, ExecutionLogEntry } from "../types.js";
import { anthropicToolLoop, anthropicStructured } from "./anthropic.js";
import { openaiToolLoop, openaiStructured } from "./openai.js";
import { geminiToolLoop, geminiStructured } from "./gemini.js";

export type LogCallback = (entry: Omit<ExecutionLogEntry, "timestamp" | "stepOrder">) => void;

const OLLAMA_BASE_URL = "http://localhost:11434/v1";
const LITELLM_BASE_URL = "http://localhost:4000/v1";

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
    case "anthropic":
      return anthropicStructured({ modelId, apiKey, systemPrompt, userPrompt, schema, maxTokens });
    case "openai":
      return openaiStructured({ modelId, apiKey, systemPrompt, userPrompt, schema, schemaName, maxTokens, baseUrl: "https://api.openai.com/v1" });
    case "gemini":
      return geminiStructured({ modelId, apiKey, systemPrompt, userPrompt, schema, maxTokens });
    case "ollama":
      return openaiStructured({ modelId, apiKey: "", systemPrompt, userPrompt, schema, schemaName, maxTokens, baseUrl: OLLAMA_BASE_URL, jsonMode: true });
    case "openrouter":
      return openaiStructured({ modelId, apiKey, systemPrompt, userPrompt, schema, schemaName, maxTokens, baseUrl: "https://openrouter.ai/api/v1" });
    case "litellm":
      return openaiStructured({ modelId, apiKey, systemPrompt, userPrompt, schema, schemaName, maxTokens, baseUrl: LITELLM_BASE_URL });
  }
}

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
  existingMessages?: unknown[];
}): Promise<{ text: string; messages: unknown[] }> {
  const { provider, modelId, apiKey, systemPrompt, userPrompt, tools, maxTurns = 25, onToolCall, onLog, existingMessages } = opts;

  switch (provider) {
    case "anthropic":
      return anthropicToolLoop({ modelId, apiKey, systemPrompt, userPrompt, tools, maxTurns, onToolCall, onLog, existingMessages: existingMessages as any[] });
    case "openai":
      return openaiToolLoop({ modelId, apiKey, systemPrompt, userPrompt, tools, maxTurns, onToolCall, onLog, baseUrl: "https://api.openai.com/v1", label: "OpenAI", existingMessages: existingMessages as any[] });
    case "ollama":
      return openaiToolLoop({ modelId, apiKey: "", systemPrompt, userPrompt, tools, maxTurns, onToolCall, onLog, baseUrl: OLLAMA_BASE_URL, label: "Ollama", existingMessages: existingMessages as any[] });
    case "openrouter":
      return openaiToolLoop({ modelId, apiKey, systemPrompt, userPrompt, tools, maxTurns, onToolCall, onLog, baseUrl: "https://openrouter.ai/api/v1", label: "OpenRouter", existingMessages: existingMessages as any[] });
    case "litellm":
      return openaiToolLoop({ modelId, apiKey, systemPrompt, userPrompt, tools, maxTurns, onToolCall, onLog, baseUrl: LITELLM_BASE_URL, label: "LiteLLM", existingMessages: existingMessages as any[] });
    case "gemini":
      return geminiToolLoop({ modelId, apiKey, systemPrompt, userPrompt, tools, maxTurns, onToolCall, onLog, existingMessages: existingMessages as any[] });
  }
}
