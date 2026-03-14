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
