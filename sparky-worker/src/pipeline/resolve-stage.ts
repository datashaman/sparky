import type { SessionConfig, AgentProvider } from "../types.js";
import { KEYLESS_PROVIDERS } from "../llm/index.js";

export type StageName = "analysis" | "planning" | "critic" | "execution" | "replanning";

interface ResolvedStage {
  provider: AgentProvider;
  model: string;
  apiKey: string;
}

/** Resolve provider/model/apiKey for a pipeline stage, with fallback to defaults. */
export function resolveStage(config: SessionConfig, stage: StageName): ResolvedStage {
  const override = config.stage_overrides?.[stage];

  // Stage override takes priority
  if (override?.provider && override?.model) {
    const apiKey = config.api_keys?.[override.provider] ?? config.default_api_key;
    return { provider: override.provider, model: override.model, apiKey };
  }

  // Legacy exec_provider/model for backward compat
  if ((stage === "execution" || stage === "replanning") && config.exec_provider && config.exec_model) {
    return {
      provider: config.exec_provider,
      model: config.exec_model,
      apiKey: config.exec_api_key ?? config.api_keys?.[config.exec_provider] ?? config.default_api_key,
    };
  }

  // Default
  return {
    provider: config.default_provider,
    model: config.default_model,
    apiKey: config.default_api_key,
  };
}

/** Validate that a resolved stage has the required config. */
export function validateStage(resolved: ResolvedStage, stageName: string): void {
  if (!resolved.provider || !resolved.model) {
    throw new Error(`No provider/model configured for ${stageName}. Set a default or stage override in Settings.`);
  }
  if (!resolved.apiKey && !KEYLESS_PROVIDERS.has(resolved.provider)) {
    throw new Error(`No API key for ${resolved.provider} (${stageName}). Add one in Settings.`);
  }
}
