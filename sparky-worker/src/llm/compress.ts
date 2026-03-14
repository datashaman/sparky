import type { AgentProvider } from "../types.js";
import { getContextBudget } from "./context-budget.js";
import type { LogCallback } from "./index.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const TRUNCATE_THRESHOLD = 2048;
const SUMMARIZE_THRESHOLD = 256;
const ASSISTANT_TEXT_PREVIEW_LENGTH = 200;
const ASSISTANT_TEXT_OMIT_OVERSHOOT = 20;
const ASSISTANT_TEXT_OMITTED = "[assistant reasoning omitted]";
const ASSISTANT_TEXT_SUFFIX = "\n... (assistant text compressed)";

/**
 * Compress older messages when context utilization exceeds a threshold.
 * Mutates the array in place.
 *
 * Protected: the last `protectedTail` messages are never touched.
 * Assistant text is compressed first (truncate or omit), then tool results
 * are compressed in three tiers:
 *   1. Truncate content to 2KB
 *   2. Summarize to a short tag
 *   3. Drop entirely (replace with placeholder)
 */
export function compressMessages(
  messages: any[],
  provider: AgentProvider,
  modelId: string,
  onLog?: LogCallback,
  opts?: { targetPct?: number; protectedTail?: number },
): void {
  const targetPct = opts?.targetPct ?? 75;
  const protectedTail = opts?.protectedTail ?? 6; // ~3 turns (assistant + user)

  const budget = getContextBudget(messages, provider, modelId);
  if (budget.utilizationPct <= targetPct) return;

  const cutoff = messages.length - protectedTail;
  if (cutoff <= 0) return;

  let compressed = 0;
  let currentPct = budget.utilizationPct;

  for (let i = 0; i < cutoff; i++) {
    if (currentPct <= targetPct) break;

    const count = compressMessage(messages[i], provider, currentPct, targetPct);
    compressed += count;

    // Only recalculate budget when we actually compressed something
    if (count > 0) {
      currentPct = getContextBudget(messages, provider, modelId).utilizationPct;
    }
  }

  if (compressed > 0) {
    onLog?.({
      type: "info",
      message: `Compressed ${compressed} messages: ${budget.utilizationPct}% → ${currentPct}% utilization`,
    });
  }
}

function compressMessage(msg: any, provider: AgentProvider, currentPct: number, targetPct: number): number {
  // Asymmetric compression: compress assistant text blocks first (cheaper to lose
  // than user messages). Inspired by ChatGPT's approach of keeping user messages
  // but dropping assistant responses for ~50% token savings.
  const assistantCount = compressAssistantText(msg, provider, currentPct, targetPct);
  if (assistantCount > 0) return assistantCount;

  switch (provider) {
    case "anthropic":
      return compressAnthropicMessage(msg, currentPct, targetPct);
    case "gemini":
      return compressGeminiMessage(msg, currentPct, targetPct);
    default:
      return compressOpenAIMessage(msg, currentPct, targetPct);
  }
}

/**
 * Anthropic: tool results are in user messages with content array of
 * { type: "tool_result", tool_use_id, content } blocks.
 */
function compressAnthropicMessage(msg: any, currentPct: number, targetPct: number): number {
  if (msg.role !== "user" || !Array.isArray(msg.content)) return 0;
  let count = 0;
  for (const block of msg.content) {
    if (block.type !== "tool_result" || typeof block.content !== "string") continue;
    const result = compressContent(block.content, currentPct, targetPct);
    if (result !== block.content) {
      block.content = result;
      count++;
    }
  }
  return count;
}

/**
 * OpenAI-compatible: tool results are { role: "tool", content } messages.
 */
function compressOpenAIMessage(msg: any, currentPct: number, targetPct: number): number {
  if (msg.role !== "tool" || typeof msg.content !== "string") return 0;
  const result = compressContent(msg.content, currentPct, targetPct);
  if (result !== msg.content) {
    msg.content = result;
    return 1;
  }
  return 0;
}

/**
 * Gemini: tool results are in user messages with parts containing
 * { functionResponse: { name, response: { result } } }.
 */
function compressGeminiMessage(msg: any, currentPct: number, targetPct: number): number {
  if (msg.role !== "user" || !Array.isArray(msg.parts)) return 0;
  let count = 0;
  for (const part of msg.parts) {
    const fr = part.functionResponse;
    if (!fr?.response?.result || typeof fr.response.result !== "string") continue;
    const result = compressContent(fr.response.result, currentPct, targetPct);
    if (result !== fr.response.result) {
      fr.response.result = result;
      count++;
    }
  }
  return count;
}

/**
 * Compress assistant text blocks. Assistant reasoning/narration is the least
 * valuable content to preserve — the tool calls and user messages carry the
 * actual state. At moderate overshoot, text is truncated to a preview. At
 * severe overshoot, text is replaced with a placeholder.
 */
function compressAssistantText(msg: any, provider: AgentProvider, currentPct: number, targetPct: number): number {
  const overshoot = currentPct - targetPct;

  if (provider === "gemini") {
    // Gemini: model messages with text parts
    if (msg.role !== "model" || !Array.isArray(msg.parts)) return 0;
    let count = 0;
    for (const part of msg.parts) {
      if (!part.text || typeof part.text !== "string" || part.text.length < SUMMARIZE_THRESHOLD) continue;
      part.text = compressAssistantContent(part.text, overshoot);
      count++;
    }
    return count;
  }

  // Anthropic: assistant messages with content array of text blocks
  if (provider === "anthropic") {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) return 0;
    let count = 0;
    for (const block of msg.content) {
      if (block.type !== "text" || typeof block.text !== "string" || block.text.length < SUMMARIZE_THRESHOLD) continue;
      block.text = compressAssistantContent(block.text, overshoot);
      count++;
    }
    return count;
  }

  // OpenAI-compatible: assistant messages with content string
  if (msg.role !== "assistant" || typeof msg.content !== "string" || msg.content.length < SUMMARIZE_THRESHOLD) return 0;
  msg.content = compressAssistantContent(msg.content, overshoot);
  return 1;
}

function compressAssistantContent(text: string, overshoot: number): string {
  if (overshoot > ASSISTANT_TEXT_OMIT_OVERSHOOT) {
    return ASSISTANT_TEXT_OMITTED;
  }
  return text.slice(0, ASSISTANT_TEXT_PREVIEW_LENGTH) + ASSISTANT_TEXT_SUFFIX;
}

/**
 * Apply tiered compression to a content string based on how far over budget we are.
 */
function compressContent(content: string, currentPct: number, targetPct: number): string {
  if (content.length < SUMMARIZE_THRESHOLD) return content;

  // Tier depends on how aggressively we need to compress
  const overshoot = currentPct - targetPct;

  if (overshoot > 30 || content.length < SUMMARIZE_THRESHOLD) {
    // Tier 3: drop entirely
    return "[tool result omitted to save context]";
  }

  if (overshoot > 15) {
    // Tier 2: summarize
    const preview = content.slice(0, 100).replace(/\n/g, " ");
    return `[tool result: ${preview}... (original ${content.length} chars)]`;
  }

  // Tier 1: truncate to 2KB
  if (content.length > TRUNCATE_THRESHOLD) {
    return content.slice(0, TRUNCATE_THRESHOLD) + "\n... (compressed)";
  }

  return content;
}
