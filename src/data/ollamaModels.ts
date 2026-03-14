import { invoke, isTauri } from "@tauri-apps/api/core";

let cachedModels: string[] | null = null;

/** Fetch available Ollama models. Only caches successful results. */
export async function fetchOllamaModels(): Promise<string[]> {
  if (cachedModels) return cachedModels;

  try {
    let models: string[];
    if (isTauri()) {
      models = await invoke<string[]>("ollama_list_models");
    } else {
      const res = await fetch("http://localhost:11434/api/tags");
      if (!res.ok) return [];
      const data = await res.json();
      models = (data.models ?? []).map((m: { name: string }) => m.name);
    }
    models.sort();
    cachedModels = models;
    return models;
  } catch {
    return [];
  }
}

/** Clear the cache so models are re-fetched on next call. */
export function clearOllamaModelCache(): void {
  cachedModels = null;
}
