import { invoke, isTauri } from "@tauri-apps/api/core";

let cachedModels: string[] | null = null;

/** Fetch available Ollama models. Caches until refresh is called. */
export async function fetchOllamaModels(): Promise<string[]> {
  if (cachedModels) return cachedModels;

  try {
    if (isTauri()) {
      cachedModels = await invoke<string[]>("ollama_list_models");
    } else {
      const res = await fetch("http://localhost:11434/api/tags");
      if (!res.ok) {
        cachedModels = [];
        return cachedModels;
      }
      const data = await res.json();
      cachedModels = (data.models ?? []).map((m: { name: string }) => m.name);
    }
  } catch {
    cachedModels = [];
  }

  cachedModels!.sort();
  return cachedModels!;
}

/** Clear the cache so models are re-fetched on next call. */
export function clearOllamaModelCache(): void {
  cachedModels = null;
}
