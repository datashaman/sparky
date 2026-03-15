import type { AgentProvider } from "./types";

/** All supported providers (order matters for UI selectors). */
export const AGENT_PROVIDERS: AgentProvider[] = [
  "openai",
  "anthropic",
  "gemini",
  "ollama",
  "openrouter",
  "litellm",
];

/** Static model lists per provider. Empty array = dynamic (fetched at runtime). */
export const AGENT_MODELS: Record<AgentProvider, string[]> = {
  openai: ["gpt-5.4", "gpt-5.2", "gpt-5-mini", "o4-mini", "o3", "o3-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"],
  anthropic: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"],
  ollama: [],
  openrouter: [],
  litellm: [],
};

/** Providers that don't require an API key. */
export const KEYLESS_PROVIDERS = new Set<AgentProvider>(["ollama", "litellm"]);

export const LITELLM_BASE_URL = "http://localhost:4000/v1";

/** Display names for providers. */
export const PROVIDER_LABELS: Record<AgentProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  ollama: "Ollama",
  openrouter: "OpenRouter",
  litellm: "LiteLLM",
};
