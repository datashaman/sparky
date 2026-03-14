import type { AgentProvider } from "./types.js";
import { callLLM } from "./llm/index.js";

/**
 * Extract a JSON object from an LLM response that may contain prose,
 * code fences, or other wrapping around the JSON.
 */
export function extractJSON(text: string): unknown {
  const trimmed = text.trim();

  // 1. Try parsing the entire text as JSON
  try {
    return JSON.parse(trimmed);
  } catch { /* continue */ }

  // 2. Try extracting from code fences (last match wins)
  const fencePattern = /```(?:json)?\s*\n([\s\S]*?)\n\s*```/g;
  let lastMatch: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = fencePattern.exec(trimmed)) !== null) {
    lastMatch = m[1];
  }
  if (lastMatch) {
    try {
      return JSON.parse(lastMatch.trim());
    } catch { /* continue */ }
  }

  // 3. Find first { to last } as a fallback
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch { /* fall through */ }
  }

  throw new Error("Could not extract valid JSON from LLM response");
}

/**
 * Try extractJSON, and on failure retry via callLLM with structured output
 * to convert the prose response into the required JSON schema.
 */
export async function extractJSONWithRetry(opts: {
  text: string;
  schema: Record<string, unknown>;
  schemaName: string;
  provider: AgentProvider;
  modelId: string;
  apiKey: string;
  onRetry?: () => void;
}): Promise<unknown> {
  try {
    return extractJSON(opts.text);
  } catch {
    if (opts.onRetry) opts.onRetry();
    const retryText = await callLLM({
      provider: opts.provider,
      modelId: opts.modelId,
      apiKey: opts.apiKey,
      systemPrompt: "You are a JSON formatter. Convert the text below into a valid JSON object. Output ONLY the JSON, nothing else.",
      userPrompt: `Convert this into JSON matching this schema:\n${JSON.stringify(opts.schema, null, 2)}\n\nText to convert:\n${opts.text.slice(0, 4000)}`,
      schema: opts.schema,
      schemaName: opts.schemaName,
      maxTokens: 2048,
    });
    return extractJSON(retryText);
  }
}
