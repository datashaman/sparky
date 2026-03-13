let cachedModels: string[] | null = null;

/** Fetch available OpenRouter models. Caches until refresh is called. */
export async function fetchOpenRouterModels(): Promise<string[]> {
  if (cachedModels) return cachedModels;

  try {
    const res = await fetch("https://openrouter.ai/api/v1/models");
    if (!res.ok) {
      cachedModels = [];
      return cachedModels;
    }
    const data = await res.json();
    cachedModels = (data.data ?? []).map((m: { id: string }) => m.id).sort();
  } catch {
    cachedModels = [];
  }

  return cachedModels!;
}

/** Clear the cache so models are re-fetched on next call. */
export function clearOpenRouterModelCache(): void {
  cachedModels = null;
}
