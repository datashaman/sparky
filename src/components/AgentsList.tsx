import { useState, useEffect } from "react";
import {
  listAgentsForWorkspace,
  createAgent,
  deleteAgent,
  validateAgentSlug,
  AGENT_PROVIDERS,
  AGENT_MODELS,
} from "../data/agents";
import type { AgentProvider } from "../data/types";
import { ErrorMessage } from "./ErrorMessage";
import type { Agent } from "../data/types";

interface Props {
  workspaceId: string;
}

export function AgentsList({ workspaceId }: Props) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = formName.trim().toLowerCase().replace(/\s+/g, "-");
    if (!validateAgentSlug(name)) {
      setError("Name must be a slug: only a-z, 0-9, and hyphens (e.g. my-agent)");
      return;
    }
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
      setFormName("");
      setFormDescription("");
      setFormProvider("openai");
      setFormModel(AGENT_MODELS.openai[0]);
      setFormMaxTurns("");
      setFormBackground(false);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await deleteAgent(id);
      await load();
      setConfirmingDeleteId(null);
    } catch (e) {
      setError(String(e));
    }
  }

  if (loading) return <p className="loading">Loading agents…</p>;
  if (error && !creating) return <ErrorMessage message={error} />;

  return (
    <div className="agents-list">
      <h3>Agents</h3>
      <form onSubmit={handleCreate} className="agents-form">
        <div className="form-row">
          <label htmlFor="agent-name">Name (slug)</label>
          <input
            id="agent-name"
            type="text"
            value={formName}
            onChange={(e) => setFormName(e.target.value.toLowerCase().replace(/[^a-z0-9\-]/g, (c) => (c === " " ? "-" : "")))}
            placeholder="e.g. my-agent"
            disabled={creating}
          />
        </div>
        <div className="form-row">
          <label htmlFor="agent-description">Description</label>
          <textarea
            id="agent-description"
            value={formDescription}
            onChange={(e) => setFormDescription(e.target.value)}
            placeholder="What this agent does…"
            disabled={creating}
            rows={2}
          />
        </div>
        <div className="form-row form-row-inline">
          <div className="form-field">
            <label htmlFor="agent-provider">Provider</label>
            <select
              id="agent-provider"
              value={formProvider}
              onChange={(e) => setFormProvider(e.target.value as AgentProvider)}
              disabled={creating}
            >
              {AGENT_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="agent-model">Model</label>
            <select
              id="agent-model"
              value={formModel}
              onChange={(e) => setFormModel(e.target.value)}
              disabled={creating}
            >
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-row form-row-inline">
          <div className="form-field">
            <label htmlFor="agent-max-turns">Max turns (optional)</label>
            <input
              id="agent-max-turns"
              type="number"
              min={1}
              value={formMaxTurns}
              onChange={(e) => setFormMaxTurns(e.target.value)}
              placeholder="—"
              disabled={creating}
            />
          </div>
          <div className="form-field form-field-checkbox">
            <label>
              <input
                type="checkbox"
                checked={formBackground}
                onChange={(e) => setFormBackground(e.target.checked)}
                disabled={creating}
              />
              Background
            </label>
          </div>
        </div>
        <div className="form-actions">
          <button type="submit" disabled={creating || !formName.trim() || !formDescription.trim()}>
            {creating ? "Creating…" : "Create agent"}
          </button>
        </div>
      </form>

      {agents.length === 0 ? (
        <p className="empty-state">No agents yet. Create one above.</p>
      ) : (
        <ul className="agent-items">
          {agents.map((a) => (
            <li key={a.id} className="agent-item">
              <div className="agent-item-main">
                <span className="agent-name">{a.name}</span>
                <span className="agent-meta">
                  {a.provider} / {a.model}
                  {a.background && " · background"}
                </span>
              </div>
              {confirmingDeleteId === a.id ? (
                <span className="agent-actions">
                  <button
                    type="button"
                    className="agent-confirm-delete"
                    onClick={() => handleDelete(a.id)}
                  >
                    Confirm
                  </button>
                  <button type="button" onClick={() => setConfirmingDeleteId(null)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="agent-delete"
                  onClick={() => setConfirmingDeleteId(a.id)}
                  aria-label={`Delete ${a.name}`}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
