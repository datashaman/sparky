import type { AgentProvider } from "../types.js";

/**
 * Context window sizes by model prefix (tokens).
 * Checked in order — first match wins.
 */
const CONTEXT_WINDOWS: [prefix: string, tokens: number][] = [
  ["claude-", 200_000],
  ["gpt-4.1", 1_000_000],
  ["gpt-4o", 128_000],
  ["gpt-4-turbo", 128_000],
  ["gpt-3.5", 16_385],
  ["gemini-2.5", 1_000_000],
  ["gemini-2.0", 1_000_000],
  ["gemini-1.5-pro", 1_000_000],
  ["gemini-1.5-flash", 1_000_000],
  ["o1", 200_000],
  ["o3", 200_000],
  ["o4", 200_000],
];

const DEFAULT_CONTEXT_WINDOW = 32_000;

export function getContextWindowSize(_provider: AgentProvider, modelId: string): number {
  for (const [prefix, tokens] of CONTEXT_WINDOWS) {
    if (modelId.startsWith(prefix)) return tokens;
  }
  return DEFAULT_CONTEXT_WINDOW;
}

/**
 * Estimate token count from a message array using chars/4 heuristic.
 */
export function estimateMessageTokens(messages: unknown[]): number {
  const chars = JSON.stringify(messages).length;
  return Math.ceil(chars / 4);
}

export interface ContextBudget {
  maxTokens: number;
  usedTokens: number;
  remainingTokens: number;
  utilizationPct: number;
}

export function getContextBudget(
  messages: unknown[],
  provider: AgentProvider,
  modelId: string,
): ContextBudget {
  const maxTokens = getContextWindowSize(provider, modelId);
  const usedTokens = estimateMessageTokens(messages);
  const remainingTokens = Math.max(0, maxTokens - usedTokens);
  const utilizationPct = Math.round((usedTokens / maxTokens) * 100);
  return { maxTokens, usedTokens, remainingTokens, utilizationPct };
}
