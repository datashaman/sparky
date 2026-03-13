import { useState, useEffect } from "react";
import {
  listAgentsForWorkspace,
  createAgent,
  deleteAgent,
  AGENT_PROVIDERS,
  AGENT_MODELS,
} from "../data/agents";
import type { AgentProvider } from "../data/types";
import type { Agent } from "../data/types";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

interface Props {
  workspaceId: string;
  onSelectAgent?: (id: string) => void;
}

const PROVIDER_COLORS: Record<AgentProvider, string> = {
  openai: "#10a37f",
  anthropic: "#d4a27f",
  gemini: "#4285f4",
  ollama: "#ffffff",
};

export function AgentsList({ workspaceId, onSelectAgent }: Props) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formProvider, setFormProvider] = useState<AgentProvider>("openai");
  const [formModel, setFormModel] = useState(AGENT_MODELS.openai[0]);
  const [formMaxTurns, setFormMaxTurns] = useState("");
  const [formBackground, setFormBackground] = useState(false);

  const models = AGENT_MODELS[formProvider];

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const list = await listAgentsForWorkspace(workspaceId);
      setAgents(list);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [workspaceId]);

  useEffect(() => {
    setFormModel(models[0] ?? "");
  }, [formProvider]);

  function resetForm() {
    setFormName("");
    setFormDescription("");
    setFormProvider("openai");
    setFormModel(AGENT_MODELS.openai[0]);
    setFormMaxTurns("");
    setFormBackground(false);
    setError(null);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    resetForm();
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = formName.trim();
    if (!name) return;
    if (!formDescription.trim()) {
      setError("Description is required.");
      return;
    }
    if (!formModel || creating) return;

    setCreating(true);
    setError(null);
    try {
      await createAgent({
        workspaceId,
        name,
        description: formDescription.trim(),
        provider: formProvider,
        model: formModel,
        max_turns: formMaxTurns.trim() ? parseInt(formMaxTurns, 10) : null,
        background: formBackground,
      });
      await load();
      closeDrawer();
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteAgent(id);
      await load();
      setConfirmingDeleteId(null);
    } catch (e) {
      setError(String(e));
    }
  }

  if (loading) return null;

  return (
    <div className="agents-list">
      <div className="agents-list-header">
        <h3>Agents</h3>
        {agents.length > 0 && (
          <button
            type="button"
            className="header-btn"
            onClick={() => setDrawerOpen(true)}
          >
            + New
          </button>
        )}
      </div>

      {agents.length === 0 ? (
        <div className="agents-empty-state">
          <div className="agents-empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M5.5 21a7.5 7.5 0 0 1 13 0" />
              <path d="M17 11l2 2 4-4" />
            </svg>
          </div>
          <p className="agents-empty-title">No agents yet</p>
          <p className="agents-empty-hint">Automate tasks across your repos with configurable AI agents.</p>
          <button
            type="button"
            className="agents-empty-cta"
            onClick={() => setDrawerOpen(true)}
          >
            + New
          </button>
        </div>
      ) : (
        <ul className="agent-items">
          {agents.map((a) => (
            <li
              key={a.id}
              className={`agent-item ${confirmingDeleteId === a.id ? "agent-item-confirming" : ""}`}
              onClick={() => onSelectAgent?.(a.id)}
              role={onSelectAgent ? "button" : undefined}
              tabIndex={onSelectAgent ? 0 : undefined}
              style={onSelectAgent ? { cursor: "pointer" } : undefined}
            >
              <span
                className="agent-item-icon"
                style={{ background: PROVIDER_COLORS[a.provider as AgentProvider] ?? "#888" }}
              >
                {a.name.charAt(0).toUpperCase()}
              </span>
              <div className="agent-item-info">
                <span className="agent-name">{a.name}</span>
                <span className="agent-meta">
                  {a.provider} / {a.model}
                  {a.background && " \u00b7 background"}
                  {a.max_turns != null && ` \u00b7 ${a.max_turns} turns`}
                </span>
                {a.description && (
                  <span className="agent-desc">{a.description}</span>
                )}
              </div>
              <button
                type="button"
                className="agent-delete"
                onClick={() =>
                  confirmingDeleteId === a.id
                    ? handleDelete(a.id)
                    : setConfirmingDeleteId(a.id)
                }
                aria-label={confirmingDeleteId === a.id ? `Confirm delete ${a.name}` : `Delete ${a.name}`}
              >
                {confirmingDeleteId === a.id ? "!" : "\u00d7"}
              </button>
              {confirmingDeleteId === a.id && (
                <button
                  type="button"
                  className="agent-delete-cancel"
                  onClick={() => setConfirmingDeleteId(null)}
                >
                  Cancel
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Create agent drawer */}
      <div
        className={`agents-drawer ${drawerOpen ? "agents-drawer-open" : ""}`}
        aria-hidden={!drawerOpen}
      >
        <div className="agents-drawer-backdrop" onClick={closeDrawer} />
        <div className="agents-drawer-panel">
          <div className="agents-drawer-header">
            <h3>New agent</h3>
            <button
              type="button"
              className="agents-drawer-close"
              onClick={closeDrawer}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <form onSubmit={handleCreate} className="agents-drawer-form" autoComplete="off">
            <div className="agents-drawer-body">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="agent-name">Name <span className="text-destructive">*</span></Label>
                <Input
                  id="agent-name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value.replace(/\s+/g, "-"))}
                  placeholder="e.g. code-reviewer"
                  disabled={creating}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="agent-description">Description <span className="text-destructive">*</span></Label>
                <Textarea
                  id="agent-description"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="What this agent does..."
                  disabled={creating}
                  rows={2}
                />
              </div>
              <div className="flex gap-3">
                <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                  <Label>Provider</Label>
                  <Select
                    value={formProvider}
                    onValueChange={(v) => setFormProvider(v as AgentProvider)}
                    disabled={creating}
                  >
                    <SelectTrigger>
                      <SelectValue />
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
                  <Select
                    value={formModel}
                    onValueChange={setFormModel}
                    disabled={creating}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {models.map((m) => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                  <Label htmlFor="agent-max-turns">Max turns</Label>
                  <NumberInput
                    id="agent-max-turns"
                    min={1}
                    value={formMaxTurns}
                    onChange={(e) => setFormMaxTurns(e.target.value)}
                    placeholder="No limit"
                    disabled={creating}
                  />
                </div>
                <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                  <Label>&nbsp;</Label>
                  <div className="flex items-center gap-2 h-10">
                    <Checkbox
                      id="agent-background"
                      checked={formBackground}
                      onCheckedChange={(v) => setFormBackground(v === true)}
                      disabled={creating}
                    />
                    <Label htmlFor="agent-background" className="cursor-pointer whitespace-nowrap">Run in background</Label>
                  </div>
                </div>
              </div>
            </div>
            {error && <p className="agents-drawer-error">{error}</p>}
            <div className="agents-drawer-actions">
              <Button
                type="submit"
                disabled={creating || !formName.trim() || !formDescription.trim()}
                className="w-full"
              >
                {creating ? "Creating..." : "Create"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
