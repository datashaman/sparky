import type { AgentProvider } from "./types";

export const SLUG_REGEX = /^[a-z0-9\-]*$/;

export function validateSlug(name: string): boolean {
  return SLUG_REGEX.test(name);
}

/** Extract the first non-empty paragraph from markdown content. */
export function firstParagraph(content: string | null | undefined): string | null {
  if (!content) return null;
  const para = content
    .split(/\n\s*\n/)
    .map((p) => p.replace(/^#+\s+/gm, "").trim())
    .find((p) => p.length > 0);
  return para || null;
}

/** Brand colors for each provider, used in list item icons. */
export const PROVIDER_COLORS: Record<AgentProvider, string> = {
  openai: "#10a37f",
  anthropic: "#d4a27f",
  gemini: "#4285f4",
  ollama: "#1d1d1d",
  openrouter: "#b364e9",
  litellm: "#2563eb",
};

/**
 * Resolve the model list for a given provider.
 * Returns dynamic models for ollama/openrouter/litellm, or static models from AGENT_MODELS.
 */
export function getModelsForProvider(
  provider: AgentProvider | "",
  ollamaModels: string[],
  openrouterModels: string[],
  litellmModels: string[],
  staticModels: Record<AgentProvider, string[]>,
): string[] {
  switch (provider) {
    case "ollama":
      return ollamaModels;
    case "openrouter":
      return openrouterModels;
    case "litellm":
      return litellmModels;
    case "":
      return [];
    default:
      return staticModels[provider];
  }
}

/**
 * Check whether the model selector should show a free-text input
 * (when a dynamic provider has no models loaded yet).
 */
export function shouldShowModelInput(provider: AgentProvider | "", models: string[]): boolean {
  return (provider === "ollama" || provider === "openrouter" || provider === "litellm") && models.length === 0;
}

/**
 * Get the placeholder text for the model free-text input.
 */
export function getModelInputPlaceholder(provider: AgentProvider | ""): string {
  switch (provider) {
    case "ollama":
      return "e.g. qwen2.5:latest";
    case "litellm":
      return "e.g. gpt-4o";
    default:
      return "e.g. anthropic/claude-sonnet-4";
  }
}
