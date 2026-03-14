import { invoke, isTauri } from "@tauri-apps/api/core";
import { getApiKey } from "../components/UserSettings";

let cachedModels: string[] | null = null;

/** Fetch available LiteLLM models. Only caches successful results. */
export async function fetchLitellmModels(): Promise<string[]> {
  if (cachedModels) return cachedModels;

  const apiKey = getApiKey("litellm");

  try {
    let models: string[];
    if (isTauri()) {
      models = await invoke<string[]>("litellm_list_models", { apiKey });
    } else {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      const res = await fetch("http://localhost:4000/v1/models", { headers });
      if (!res.ok) return [];
      const data = await res.json();
      models = (data.data ?? []).map((m: { id: string }) => m.id);
    }
    models.sort();
    cachedModels = models;
    return models;
  } catch {
    return [];
  }
}

/** Clear the cache so models are re-fetched on next call. */
export function clearLitellmModelCache(): void {
  cachedModels = null;
}
