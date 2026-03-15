import { useState, useEffect } from "react";
import { AGENT_PROVIDERS, AGENT_MODELS } from "../data/providers";
import { fetchOllamaModels } from "../data/ollamaModels";
import { fetchOpenRouterModels } from "../data/openrouterModels";
import { fetchLitellmModels } from "../data/litellmModels";
import { KEYLESS_PROVIDERS, PROVIDER_LABELS } from "../data/providers";
import { getModelsForProvider, shouldShowModelInput, getModelInputPlaceholder } from "../data/shared";
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

// ─── Stage definitions ───

const STAGES = ["default", "analysis", "planning", "critic", "execution", "replanning"] as const;
type Stage = typeof STAGES[number];

const STAGE_LABELS: Record<Stage, string> = {
  default: "Default",
  analysis: "Analysis",
  planning: "Planning",
  critic: "Critic Review",
  execution: "Execution",
  replanning: "Replanning",
};

const STAGE_HINTS: Record<Stage, string> = {
  default: "Fallback for all stages without an override.",
  analysis: "AI reads the issue, classifies type and complexity.",
  planning: "Generates a step-by-step plan with task dependencies.",
  critic: "Separate LLM pass to validate and refine the plan.",
  execution: "Executes each step using sandboxed tools.",
  replanning: "Adjusts remaining steps when execution diverges.",
};

const UNSET = "__unset__";

// ─── Exported getters (used by useWorkerSession and other components) ───

export type DisplayMode = "light" | "dark" | "system";

export function getDisplayMode(): DisplayMode {
  try {
    const stored = localStorage.getItem(DISPLAY_MODE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch { /* ignore */ }
  return "system";
}

const VALID_PROVIDERS = new Set<string>(AGENT_PROVIDERS);

function readProvider(key: string): AgentProvider | "" {
  try {
    const stored = localStorage.getItem(key);
    if (stored && VALID_PROVIDERS.has(stored)) return stored as AgentProvider;
  } catch { /* ignore */ }
  return "";
}

export function getDefaultProvider(): AgentProvider | "" {
  return readProvider(DEFAULT_PROVIDER_KEY);
}

export function getDefaultModel(): string {
  try { return localStorage.getItem(DEFAULT_MODEL_KEY) ?? ""; } catch { return ""; }
}

export function getExecProvider(): AgentProvider | "" {
  return readProvider(EXEC_PROVIDER_KEY);
}

export function getExecModel(): string {
  try { return localStorage.getItem(EXEC_MODEL_KEY) ?? ""; } catch { return ""; }
}

export function getApiKey(provider: AgentProvider): string {
  try { return localStorage.getItem(API_KEY_PREFIX + provider) ?? ""; } catch { return ""; }
}

export function applyDisplayMode(mode: DisplayMode) {
  const root = document.documentElement;
  if (mode === "dark") {
    root.classList.add("dark");
  } else if (mode === "light") {
    root.classList.remove("dark");
  } else {
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }
}

// ─── Component ───

interface Props {
  open: boolean;
  onClose: () => void;
}

export function UserSettings({ open, onClose }: Props) {
  // Appearance
  const [displayMode, setDisplayMode] = useState<DisplayMode>(getDisplayMode);

  // Default provider/model
  const [defaultProvider, setDefaultProvider] = useState<AgentProvider | "">(getDefaultProvider);
  const [defaultModel, setDefaultModel] = useState(getDefaultModel);

  // Per-stage overrides
  const [selectedStage, setSelectedStage] = useState<Stage>("default");
  const [stageProviders, setStageProviders] = useState<Record<string, AgentProvider | "">>(() => {
    const m: Record<string, AgentProvider | ""> = {};
    for (const s of STAGES) {
      if (s === "default") continue;
      m[s] = readProvider(`sparky_stage_${s}_provider`);
    }
    return m;
  });
  const [stageModels, setStageModels] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const s of STAGES) {
      if (s === "default") continue;
      try { m[s] = localStorage.getItem(`sparky_stage_${s}_model`) ?? ""; } catch { m[s] = ""; }
    }
    return m;
  });

  // API keys
  const keyProviders = AGENT_PROVIDERS.filter((p) => !KEYLESS_PROVIDERS.has(p));
  const [selectedKeyProvider, setSelectedKeyProvider] = useState<AgentProvider>(keyProviders[0]);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>(() => {
    const keys: Record<string, string> = {};
    for (const p of AGENT_PROVIDERS) keys[p] = getApiKey(p);
    return keys;
  });

  // Sandbox
  const [sandboxBinaries, setSandboxBinaries] = useState(() => {
    try {
      const raw = localStorage.getItem("sandbox_allowed_binaries");
      if (!raw) return "";
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.join(", ") : "";
    } catch { return ""; }
  });
  const [sandboxAllowAll, setSandboxAllowAll] = useState(() => {
    try { return localStorage.getItem("sandbox_allow_all") === "true"; } catch { return false; }
  });

  // Dynamic model lists
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [openrouterModels, setOpenrouterModels] = useState<string[]>([]);
  const [litellmModels, setLitellmModels] = useState<string[]>([]);

  // Fetch dynamic models when any selected provider needs them
  useEffect(() => {
    const allProviders = [defaultProvider, ...Object.values(stageProviders)];
    if (allProviders.includes("ollama")) fetchOllamaModels().then(setOllamaModels);
    if (allProviders.includes("openrouter")) fetchOpenRouterModels().then(setOpenrouterModels);
    if (allProviders.includes("litellm")) fetchLitellmModels().then(setLitellmModels);
  }, [defaultProvider, stageProviders]);

  // Persist display mode
  useEffect(() => {
    applyDisplayMode(displayMode);
    try { localStorage.setItem(DISPLAY_MODE_KEY, displayMode); } catch { /* ignore */ }
  }, [displayMode]);

  // Persist default provider/model + legacy exec keys
  useEffect(() => {
    try { localStorage.setItem(DEFAULT_PROVIDER_KEY, defaultProvider); } catch { /* ignore */ }
  }, [defaultProvider]);
  useEffect(() => {
    try { localStorage.setItem(DEFAULT_MODEL_KEY, defaultModel); } catch { /* ignore */ }
  }, [defaultModel]);

  // Sync legacy exec keys from execution stage override
  useEffect(() => {
    const ep = stageProviders.execution || defaultProvider;
    const em = stageModels.execution || defaultModel;
    try {
      localStorage.setItem(EXEC_PROVIDER_KEY, ep);
      localStorage.setItem(EXEC_MODEL_KEY, em);
    } catch { /* ignore */ }
  }, [stageProviders, stageModels, defaultProvider, defaultModel]);

  // Active provider/model for the selected stage
  const activeProvider = selectedStage === "default"
    ? defaultProvider
    : (stageProviders[selectedStage] || "");
  const activeModel = selectedStage === "default"
    ? defaultModel
    : (stageModels[selectedStage] || "");
  const activeModels = getModelsForProvider(
    activeProvider || defaultProvider,
    ollamaModels, openrouterModels, litellmModels, AGENT_MODELS,
  );

  function setActiveProvider(p: AgentProvider | "") {
    if (selectedStage === "default") {
      setDefaultProvider(p);
    } else {
      setStageProviders((prev) => ({ ...prev, [selectedStage]: p }));
      try { localStorage.setItem(`sparky_stage_${selectedStage}_provider`, p); } catch { /* ignore */ }
      // Clear the stage model when provider changes so we don't keep an incompatible model
      setStageModels((prev) => ({ ...prev, [selectedStage]: "" }));
      try { localStorage.removeItem(`sparky_stage_${selectedStage}_model`); } catch { /* ignore */ }
    }
  }

  function setActiveModel(m: string) {
    if (selectedStage === "default") {
      setDefaultModel(m);
    } else {
      setStageModels((prev) => ({ ...prev, [selectedStage]: m }));
      try { localStorage.setItem(`sparky_stage_${selectedStage}_model`, m); } catch { /* ignore */ }
    }
  }

  function clearStageOverride() {
    if (selectedStage === "default") return;
    setStageProviders((prev) => ({ ...prev, [selectedStage]: "" }));
    setStageModels((prev) => ({ ...prev, [selectedStage]: "" }));
    try {
      localStorage.removeItem(`sparky_stage_${selectedStage}_provider`);
      localStorage.removeItem(`sparky_stage_${selectedStage}_model`);
    } catch { /* ignore */ }
  }

  const showModelInput = shouldShowModelInput(activeProvider || defaultProvider, activeModels);
  const isOverrideSet = selectedStage !== "default" && !!(stageProviders[selectedStage] || stageModels[selectedStage]);

  return (
    <div
      className={`user-settings-drawer ${open ? "user-settings-drawer-open" : ""}`}
      aria-hidden={!open}
    >
      <div className="user-settings-backdrop" onClick={onClose} />
      <div className="user-settings-panel">
        <div className="user-settings-header">
          <h3>Settings</h3>
          <button type="button" className="user-settings-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="user-settings-body">
          <section className="settings-card">
            <h3 className="settings-card-title">Appearance</h3>
            <div className="settings-card-body">
              <div className="flex flex-col gap-1">
                <Label>Display mode</Label>
                <Select value={displayMode} onValueChange={(v) => setDisplayMode(v as DisplayMode)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
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
            <h3 className="settings-card-title">Models</h3>
            <div className="settings-card-body">
              <div className="flex flex-col gap-1">
                <Label>Stage</Label>
                <Select value={selectedStage} onValueChange={(v) => setSelectedStage(v as Stage)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STAGES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {STAGE_LABELS[s]}
                        {s !== "default" && stageProviders[s] ? " (override)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-3">
                <div className="flex flex-col gap-1 flex-1 min-w-0">
                  <Label>Provider</Label>
                  <Select
                    value={activeProvider || UNSET}
                    onValueChange={(v) => setActiveProvider(v === UNSET ? "" : v as AgentProvider)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={selectedStage === "default" ? "Select" : "Use default"} />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedStage !== "default" && (
                        <SelectItem value={UNSET}>Use default</SelectItem>
                      )}
                      {AGENT_PROVIDERS.map((p) => (
                        <SelectItem key={p} value={p}>{PROVIDER_LABELS[p]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1 flex-1 min-w-0">
                  <Label>Model</Label>
                  {showModelInput ? (
                    <Input
                      placeholder={selectedStage !== "default" && !activeProvider ? "Using default" : getModelInputPlaceholder(activeProvider || defaultProvider)}
                      value={activeModel}
                      onChange={(e) => setActiveModel(e.target.value)}
                      disabled={selectedStage !== "default" && !activeProvider}
                    />
                  ) : (
                    <Select
                      value={activeModel || UNSET}
                      onValueChange={(v) => setActiveModel(v === UNSET ? "" : v)}
                      disabled={selectedStage === "default" ? !defaultProvider : !activeProvider}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={selectedStage !== "default" && !activeProvider ? "Using default" : "Select model"} />
                      </SelectTrigger>
                      <SelectContent>
                        {selectedStage !== "default" && (
                          <SelectItem value={UNSET}>Use default</SelectItem>
                        )}
                        {[...activeModels].sort().map((m) => (
                          <SelectItem key={m} value={m}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
              <p className="user-settings-hint">{STAGE_HINTS[selectedStage]}</p>
              {isOverrideSet && (
                <button
                  type="button"
                  className="user-settings-hint"
                  style={{ color: "var(--color-primary, #3b82f6)", cursor: "pointer", background: "none", border: "none", padding: 0, textAlign: "left" }}
                  onClick={clearStageOverride}
                >
                  Clear override (use default)
                </button>
              )}
            </div>
          </section>

          <section className="settings-card">
            <h3 className="settings-card-title">API Keys</h3>
            <div className="settings-card-body">
              <div className="flex gap-3">
                <div className="flex flex-col gap-1 flex-1 min-w-0">
                  <Label>Provider</Label>
                  <Select value={selectedKeyProvider} onValueChange={(v) => setSelectedKeyProvider(v as AgentProvider)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {keyProviders.map((p) => (
                        <SelectItem key={p} value={p}>{PROVIDER_LABELS[p]}{apiKeys[p] ? " \u2713" : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1 flex-1 min-w-0">
                  <Label>API Key</Label>
                  <Input
                    type="password"
                    placeholder={`${PROVIDER_LABELS[selectedKeyProvider]} API key`}
                    value={apiKeys[selectedKeyProvider] ?? ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      setApiKeys((prev) => ({ ...prev, [selectedKeyProvider]: val }));
                      try { localStorage.setItem(API_KEY_PREFIX + selectedKeyProvider, val); } catch { /* ignore */ }
                    }}
                  />
                </div>
              </div>
              <p className="user-settings-hint">
                Stored locally. Ollama and LiteLLM don't require keys.
              </p>
            </div>
          </section>

          <section className="settings-card">
            <h3 className="settings-card-title">Sandbox</h3>
            <div className="settings-card-body">
              <div className="flex flex-col gap-1">
                <Label>Allowed binaries</Label>
                <Input
                  placeholder="php, composer, ruby, bundle..."
                  value={sandboxBinaries}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSandboxBinaries(val);
                    try {
                      const binaries = val.split(",").map((s) => s.trim()).filter(Boolean);
                      localStorage.setItem("sandbox_allowed_binaries", JSON.stringify(binaries));
                    } catch { /* ignore */ }
                  }}
                />
                <p className="user-settings-hint">
                  Extra commands the executor can run. Common tools (git, npm, node, python, php, ruby, go, java) are always allowed.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="sandbox-allow-all"
                  checked={sandboxAllowAll}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setSandboxAllowAll(checked);
                    try { localStorage.setItem("sandbox_allow_all", String(checked)); } catch { /* ignore */ }
                  }}
                />
                <Label htmlFor="sandbox-allow-all" className="cursor-pointer">Allow all commands</Label>
              </div>
              {sandboxAllowAll && (
                <p className="user-settings-hint" style={{ color: "var(--color-warning, #d97706)" }}>
                  Warning: Disables the command allowlist. The executor can run any command in the worktree, including destructive ones.
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
