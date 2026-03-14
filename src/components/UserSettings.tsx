import { useState, useEffect, useRef } from "react";
import { AGENT_PROVIDERS, AGENT_MODELS } from "../data/agents";
import { fetchOllamaModels } from "../data/ollamaModels";
import { fetchOpenRouterModels } from "../data/openrouterModels";
import { fetchLitellmModels } from "../data/litellmModels";
import type { AgentProvider } from "../data/types";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

const DISPLAY_MODE_KEY = "sparky_display_mode";
const DEFAULT_PROVIDER_KEY = "sparky_default_provider";
const DEFAULT_MODEL_KEY = "sparky_default_model";
const EXEC_PROVIDER_KEY = "sparky_exec_provider";
const EXEC_MODEL_KEY = "sparky_exec_model";
const API_KEY_PREFIX = "sparky_api_key_";

export type DisplayMode = "light" | "dark" | "system";

export function getDisplayMode(): DisplayMode {
  try {
    const stored = localStorage.getItem(DISPLAY_MODE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch { /* ignore */ }
  return "system";
}

export function getDefaultProvider(): AgentProvider | "" {
  try {
    const stored = localStorage.getItem(DEFAULT_PROVIDER_KEY);
    if (stored === "openai" || stored === "anthropic" || stored === "gemini" || stored === "ollama" || stored === "openrouter" || stored === "litellm") return stored;
  } catch { /* ignore */ }
  return "";
}

export function getDefaultModel(): string {
  try {
    return localStorage.getItem(DEFAULT_MODEL_KEY) ?? "";
  } catch { return ""; }
}

export function getExecProvider(): AgentProvider | "" {
  try {
    const stored = localStorage.getItem(EXEC_PROVIDER_KEY);
    if (stored === "openai" || stored === "anthropic" || stored === "gemini" || stored === "ollama" || stored === "openrouter" || stored === "litellm") return stored;
  } catch { /* ignore */ }
  return "";
}

export function getExecModel(): string {
  try {
    return localStorage.getItem(EXEC_MODEL_KEY) ?? "";
  } catch { return ""; }
}

export function getApiKey(provider: AgentProvider): string {
  try {
    return localStorage.getItem(API_KEY_PREFIX + provider) ?? "";
  } catch { return ""; }
}

export function applyDisplayMode(mode: DisplayMode) {
  const root = document.documentElement;
  if (mode === "dark") {
    root.classList.add("dark");
  } else if (mode === "light") {
    root.classList.remove("dark");
  } else {
    // system
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function UserSettings({ open, onClose }: Props) {
  const [displayMode, setDisplayMode] = useState<DisplayMode>(getDisplayMode);
  const [provider, setProvider] = useState<AgentProvider | "">(getDefaultProvider);
  const [model, setModel] = useState(getDefaultModel);
  const [execProvider, setExecProvider] = useState<AgentProvider | "">(getExecProvider);
  const [execModel, setExecModel] = useState(getExecModel);

  const [apiKeys, setApiKeys] = useState<Record<string, string>>(() => {
    const keys: Record<string, string> = {};
    for (const p of AGENT_PROVIDERS) keys[p] = getApiKey(p);
    return keys;
  });

  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [openrouterModels, setOpenrouterModels] = useState<string[]>([]);
  const [litellmModels, setLitellmModels] = useState<string[]>([]);
  const providerRef = useRef(provider);
  providerRef.current = provider;
  const execProviderRef = useRef(execProvider);
  execProviderRef.current = execProvider;

  useEffect(() => {
    if (provider === "ollama" || execProvider === "ollama") {
      fetchOllamaModels().then((m) => {
        if (providerRef.current !== "ollama" && execProviderRef.current !== "ollama") return;
        setOllamaModels(m);
      });
    }
    if (provider === "openrouter" || execProvider === "openrouter") {
      fetchOpenRouterModels().then((m) => {
        if (providerRef.current !== "openrouter" && execProviderRef.current !== "openrouter") return;
        setOpenrouterModels(m);
      });
    }
    if (provider === "litellm" || execProvider === "litellm") {
      fetchLitellmModels().then((m) => {
        if (providerRef.current !== "litellm" && execProviderRef.current !== "litellm") return;
        setLitellmModels(m);
      });
    }
  }, [provider, execProvider]);

  const models = provider === "ollama" ? ollamaModels : provider === "openrouter" ? openrouterModels : provider === "litellm" ? litellmModels : provider ? AGENT_MODELS[provider] : [];
  const execModels = execProvider === "ollama" ? ollamaModels : execProvider === "openrouter" ? openrouterModels : execProvider === "litellm" ? litellmModels : execProvider ? AGENT_MODELS[execProvider] : [];

  useEffect(() => {
    applyDisplayMode(displayMode);
    try { localStorage.setItem(DISPLAY_MODE_KEY, displayMode); } catch { /* ignore */ }
  }, [displayMode]);

  useEffect(() => {
    try { localStorage.setItem(DEFAULT_PROVIDER_KEY, provider); } catch { /* ignore */ }
    // For ollama/openrouter: sync model with dynamic list when loaded.
    // For others: reset to first in fixed list.
    if (!provider) return;
    if (provider === "ollama") {
      if (!ollamaModels.includes(model)) setModel(ollamaModels[0] ?? "");
      return;
    }
    if (provider === "openrouter") {
      if (openrouterModels.length > 0 && !openrouterModels.includes(model)) setModel(openrouterModels[0] ?? "");
      return;
    }
    if (provider === "litellm") {
      if (litellmModels.length > 0 && !litellmModels.includes(model)) setModel(litellmModels[0] ?? "");
      return;
    }
    const available = AGENT_MODELS[provider];
    if (available.length > 0 && !available.includes(model)) {
      setModel(available[0] ?? "");
    }
  }, [provider, ollamaModels, openrouterModels, litellmModels]);

  useEffect(() => {
    try { localStorage.setItem(DEFAULT_MODEL_KEY, model); } catch { /* ignore */ }
  }, [model]);

  useEffect(() => {
    try { localStorage.setItem(EXEC_PROVIDER_KEY, execProvider); } catch { /* ignore */ }
    if (!execProvider) return;
    if (execProvider === "ollama") {
      if (!ollamaModels.includes(execModel)) setExecModel(ollamaModels[0] ?? "");
      return;
    }
    if (execProvider === "openrouter") {
      if (openrouterModels.length > 0 && !openrouterModels.includes(execModel)) setExecModel(openrouterModels[0] ?? "");
      return;
    }
    if (execProvider === "litellm") {
      if (litellmModels.length > 0 && !litellmModels.includes(execModel)) setExecModel(litellmModels[0] ?? "");
      return;
    }
    const available = AGENT_MODELS[execProvider];
    if (available.length > 0 && !available.includes(execModel)) {
      setExecModel(available[0] ?? "");
    }
  }, [execProvider, ollamaModels, openrouterModels, litellmModels]);

  useEffect(() => {
    try { localStorage.setItem(EXEC_MODEL_KEY, execModel); } catch { /* ignore */ }
  }, [execModel]);

  return (
    <div
      className={`user-settings-drawer ${open ? "user-settings-drawer-open" : ""}`}
      aria-hidden={!open}
    >
      <div className="user-settings-backdrop" onClick={onClose} />
      <div className="user-settings-panel">
        <div className="user-settings-header">
          <h3>Settings</h3>
          <button
            type="button"
            className="user-settings-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="user-settings-body">
          <section className="settings-card">
            <h3 className="settings-card-title">Appearance</h3>
            <div className="settings-card-body">
              <div className="flex flex-col gap-1.5">
                <Label>Display mode</Label>
                <Select value={displayMode} onValueChange={(v) => setDisplayMode(v as DisplayMode)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system">System</SelectItem>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="dark">Dark</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          <section className="settings-card">
            <h3 className="settings-card-title">Analysis / Planning</h3>
            <div className="settings-card-body">
              <div className="flex gap-3">
                <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                  <Label>Provider</Label>
                  <Select value={provider} onValueChange={(v) => setProvider(v as AgentProvider)}>
                    <SelectTrigger>
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      {AGENT_PROVIDERS.map((p) => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                  <Label>Model</Label>
                  {(provider === "openrouter" && openrouterModels.length === 0) || (provider === "ollama" && models.length === 0) || (provider === "litellm" && models.length === 0) ? (
                    <Input
                      placeholder={provider === "ollama" ? "e.g. qwen2.5:latest" : provider === "litellm" ? "e.g. gpt-4o" : "e.g. anthropic/claude-sonnet-4"}
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                    />
                  ) : (
                    <Select value={model} onValueChange={setModel} disabled={!provider}>
                      <SelectTrigger>
                        <SelectValue placeholder={provider ? "Select model" : "Pick provider first"} />
                      </SelectTrigger>
                      <SelectContent>
                        {[...models].sort().map((m) => (
                          <SelectItem key={m} value={m}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
              <p className="user-settings-hint">
                Used for issue analysis, plan generation, and new agent/skill defaults.
              </p>
            </div>
          </section>

          <section className="settings-card">
            <h3 className="settings-card-title">Execution</h3>
            <div className="settings-card-body">
              <div className="flex gap-3">
                <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                  <Label>Provider</Label>
                  <Select value={execProvider} onValueChange={(v) => setExecProvider(v as AgentProvider)}>
                    <SelectTrigger>
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      {AGENT_PROVIDERS.map((p) => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                  <Label>Model</Label>
                  {(execProvider === "openrouter" && openrouterModels.length === 0) || (execProvider === "ollama" && execModels.length === 0) || (execProvider === "litellm" && execModels.length === 0) ? (
                    <Input
                      placeholder={execProvider === "ollama" ? "e.g. qwen2.5:latest" : execProvider === "litellm" ? "e.g. gpt-4o" : "e.g. anthropic/claude-sonnet-4"}
                      value={execModel}
                      onChange={(e) => setExecModel(e.target.value)}
                    />
                  ) : (
                    <Select value={execModel} onValueChange={setExecModel} disabled={!execProvider}>
                      <SelectTrigger>
                        <SelectValue placeholder={execProvider ? "Select model" : "Pick provider first"} />
                      </SelectTrigger>
                      <SelectContent>
                        {[...execModels].sort().map((m) => (
                          <SelectItem key={m} value={m}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
              <p className="user-settings-hint">
                Used by the issue LLM when executing plan steps. Falls back to analysis model if not set.
              </p>
            </div>
          </section>

          <section className="settings-card">
            <h3 className="settings-card-title">API Keys</h3>
            <div className="settings-card-body">
              {AGENT_PROVIDERS.map((p) => (
                <div key={p} className="flex flex-col gap-1.5">
                  <Label>{p}</Label>
                  <Input
                    type="password"
                    placeholder={`${p} API key`}
                    value={apiKeys[p] ?? ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      setApiKeys((prev) => ({ ...prev, [p]: val }));
                      try { localStorage.setItem(API_KEY_PREFIX + p, val); } catch { /* ignore */ }
                    }}
                  />
                </div>
              ))}
              <p className="user-settings-hint">
                Stored locally on this device. Required for issue analysis.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
