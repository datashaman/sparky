import type { AgentProvider } from "./types";

/** Providers that don't require an API key. */
export const KEYLESS_PROVIDERS = new Set<AgentProvider>(["ollama", "litellm"]);

export const LITELLM_BASE_URL = "http://localhost:4000/v1";
