let cachedModels: string[] | null = null;

/** Fetch available OpenRouter models. Only caches successful results. */
export async function fetchOpenRouterModels(): Promise<string[]> {
  if (cachedModels) return cachedModels;

  try {
    const res = await fetch("https://openrouter.ai/api/v1/models");
    if (!res.ok) return [];
    const data = await res.json();
    const models = (data.data ?? []).map((m: { id: string }) => m.id).sort();
    cachedModels = models;
    return models;
  } catch {
    return [];
  }
}

/** Clear the cache so models are re-fetched on next call. */
export function clearOpenRouterModelCache(): void {
  cachedModels = null;
}
