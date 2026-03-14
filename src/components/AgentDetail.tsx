import { useState, useEffect, useRef } from "react";
import {
  getAgent,
  updateAgent,
  deleteAgent,
  getSkillIdsForAgent,
  setSkillIdsForAgent,
  getToolIdsForAgent,
  setToolIdsForAgent,
  AGENT_PROVIDERS,
  AGENT_MODELS,
} from "../data/agents";
import { listSkillsForWorkspace } from "../data/skills";
import { TOOLS } from "../data/tools";
import { fetchOllamaModels } from "../data/ollamaModels";
import { fetchOpenRouterModels } from "../data/openrouterModels";
import { fetchLitellmModels } from "../data/litellmModels";
import type { Agent, AgentProvider, Skill } from "../data/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

interface AgentDetailProps {
  agentId: string;
  workspaceId: string;
  onBack: () => void;
  onDeleted: () => void;
}

export function AgentDetail({ agentId, workspaceId, onBack, onDeleted }: AgentDetailProps) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formContent, setFormContent] = useState("");
  const [formProvider, setFormProvider] = useState<AgentProvider>("openai");
  const [formModel, setFormModel] = useState("");
  const [formMaxTurns, setFormMaxTurns] = useState("");
  const [formBackground, setFormBackground] = useState(false);

  const [allSkills, setAllSkills] = useState<Skill[]>([]);
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set());
  const [savedSkillIds, setSavedSkillIds] = useState<Set<string>>(new Set());

  const [selectedToolIds, setSelectedToolIds] = useState<Set<string>>(new Set());
  const [savedToolIds, setSavedToolIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      getAgent(agentId),
      getSkillIdsForAgent(agentId),
      getToolIdsForAgent(agentId),
      listSkillsForWorkspace(workspaceId),
    ])
      .then(([a, skillIds, toolIds, skills]) => {
        if (cancelled) return;
        setAgent(a);
        setAllSkills(skills);
        const ids = new Set(skillIds);
        setSelectedSkillIds(ids);
        setSavedSkillIds(new Set(ids));
        const tIds = new Set(toolIds);
        setSelectedToolIds(tIds);
        setSavedToolIds(new Set(tIds));
        if (a) {
          setFormName(a.name);
          setFormDescription(a.description);
          setFormContent(a.content ?? "");
          setFormProvider(a.provider);
          setFormModel(a.model);
          setFormMaxTurns(a.max_turns != null ? String(a.max_turns) : "");
          setFormBackground(a.background);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, workspaceId]);

  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [openrouterModels, setOpenrouterModels] = useState<string[]>([]);
  const [litellmModels, setLitellmModels] = useState<string[]>([]);
  const providerRef = useRef(formProvider);
  providerRef.current = formProvider;

  // When provider changes, reset model to first available for that provider
  useEffect(() => {
    if (!agent) return;
    const current = formProvider;
    if (current === "ollama") {
      if (current !== agent.provider) setFormModel("");
      fetchOllamaModels().then((m) => {
        if (providerRef.current !== current) return;
        setOllamaModels(m);
        if (current !== agent.provider && m.length > 0) setFormModel(m[0]);
      });
    } else if (current === "openrouter") {
      if (current !== agent.provider) setFormModel("");
      fetchOpenRouterModels().then((m) => {
        if (providerRef.current !== current) return;
        setOpenrouterModels(m);
        if (current !== agent.provider && m.length > 0) setFormModel(m[0]);
      });
    } else if (current === "litellm") {
      if (current !== agent.provider) setFormModel("");
      fetchLitellmModels().then((m) => {
        if (providerRef.current !== current) return;
        setLitellmModels(m);
        if (current !== agent.provider && m.length > 0) setFormModel(m[0]);
      });
    } else if (current !== agent.provider && AGENT_MODELS[current].length > 0) {
      setFormModel(AGENT_MODELS[current][0] ?? "");
    }
  }, [formProvider]);

  const models = formProvider === "ollama" ? ollamaModels : formProvider === "openrouter" ? openrouterModels : formProvider === "litellm" ? litellmModels : (AGENT_MODELS[formProvider] ?? []);

  const skillsChanged = selectedSkillIds.size !== savedSkillIds.size ||
    [...selectedSkillIds].some((id) => !savedSkillIds.has(id));

  const toolsChanged = selectedToolIds.size !== savedToolIds.size ||
    [...selectedToolIds].some((id) => !savedToolIds.has(id));

  const hasChanges =
    agent !== null &&
    (formName.trim() !== agent.name ||
      formDescription.trim() !== agent.description ||
      formContent !== (agent.content ?? "") ||
      formProvider !== agent.provider ||
      formModel !== agent.model ||
      formMaxTurns !== (agent.max_turns != null ? String(agent.max_turns) : "") ||
      formBackground !== agent.background ||
      skillsChanged ||
      toolsChanged);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!agent || !hasChanges || saving) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateAgent(agent.id, {
        name: formName.trim(),
        description: formDescription.trim(),
        content: formContent.trim() || null,
        provider: formProvider,
        model: formModel,
        max_turns: formMaxTurns.trim() ? parseInt(formMaxTurns, 10) : null,
        background: formBackground,
      });
      if (updated) setAgent(updated);
      if (skillsChanged) {
        await setSkillIdsForAgent(agent.id, [...selectedSkillIds]);
        setSavedSkillIds(new Set(selectedSkillIds));
      }
      if (toolsChanged) {
        await setToolIdsForAgent(agent.id, [...selectedToolIds]);
        setSavedToolIds(new Set(selectedToolIds));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!agent) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    try {
      await deleteAgent(agent.id);
      onDeleted();
    } catch (e) {
      setError(String(e));
      setConfirmingDelete(false);
    }
  }

  if (loading) {
    return <p className="loading">Loading…</p>;
  }

  if (!agent) {
    return (
      <div className="detail-page">
        <div className="detail-header">
          <button type="button" className="detail-back" onClick={onBack}>
            ← Back
          </button>
        </div>
        <p className="empty-state">Agent not found.</p>
      </div>
    );
  }

  return (
    <div className="detail-page">
      <div className="detail-header">
        <button type="button" className="detail-back" onClick={onBack}>
          ← Back
        </button>
        <h2 className="detail-title">{agent.name}</h2>
      </div>

      <form onSubmit={handleSave} className="detail-form" autoComplete="off">
        <div className="detail-field">
          <Label htmlFor="agent-detail-name">Name</Label>
          <Input
            id="agent-detail-name"
            value={formName}
            onChange={(e) => setFormName(e.target.value.replace(/\s+/g, "-"))}
            placeholder="e.g. code-reviewer"
            disabled={saving}
          />
        </div>

        <div className="detail-field">
          <Label htmlFor="agent-detail-description">Description</Label>
          <span className="detail-hint">When to delegate to this agent. If blank, uses the first paragraph of content.</span>
          <Textarea
            id="agent-detail-description"
            value={formDescription}
            onChange={(e) => setFormDescription(e.target.value)}
            placeholder="When to delegate to this agent..."
            disabled={saving}
            rows={2}
          />
        </div>

        <div className="detail-field">
          <Label htmlFor="agent-detail-content">Content</Label>
          <Textarea
            id="agent-detail-content"
            value={formContent}
            onChange={(e) => setFormContent(e.target.value)}
            placeholder="Agent body (markdown supported)..."
            disabled={saving}
            rows={10}
            className="detail-content-textarea"
          />
        </div>

        {allSkills.length > 0 && (
          <div className="detail-field">
            <Label>Skills</Label>
            <span className="detail-hint">Skill content is injected into this agent's context.</span>
            <div className="detail-skills-picker">
              {allSkills.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`av-pill ${selectedSkillIds.has(s.id) ? "av-pill-selected" : ""}`}
                  title={s.description || s.name}
                  disabled={saving}
                  onClick={() => {
                    setSelectedSkillIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(s.id)) next.delete(s.id);
                      else next.add(s.id);
                      return next;
                    });
                  }}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="detail-field">
          <Label>Tools</Label>
          <span className="detail-hint">Capabilities available to this agent during execution.</span>
          <div className="detail-skills-picker">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`av-pill ${selectedToolIds.has(t.id) ? (t.dangerous ? "av-pill-dangerous" : "av-pill-selected") : ""}`}
                title={t.description}
                disabled={saving}
                onClick={() => {
                  setSelectedToolIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(t.id)) next.delete(t.id);
                    else next.add(t.id);
                    return next;
                  });
                }}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>

        <div className="detail-field">
          <div className="flex gap-3">
            <div className="flex flex-col gap-1.5 flex-1 min-w-0">
              <Label>Provider</Label>
              <Select
                value={formProvider}
                onValueChange={(v) => setFormProvider(v as AgentProvider)}
                disabled={saving}
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
              {(formProvider === "openrouter" && openrouterModels.length === 0) || (formProvider === "ollama" && models.length === 0) || (formProvider === "litellm" && models.length === 0) ? (
                <Input
                  placeholder={formProvider === "ollama" ? "e.g. qwen2.5:latest" : formProvider === "litellm" ? "e.g. gpt-4o" : "e.g. anthropic/claude-sonnet-4"}
                  value={formModel}
                  onChange={(e) => setFormModel(e.target.value)}
                  disabled={saving}
                />
              ) : (
                <Select
                  value={formModel}
                  onValueChange={setFormModel}
                  disabled={saving}
                >
                  <SelectTrigger>
                    <SelectValue />
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
        </div>

        <div className="detail-field">
          <div className="flex gap-3">
            <div className="flex flex-col gap-1.5 flex-1 min-w-0">
              <Label htmlFor="agent-detail-max-turns">Max turns</Label>
              <NumberInput
                id="agent-detail-max-turns"
                min={1}
                value={formMaxTurns}
                onChange={(e) => setFormMaxTurns(e.target.value)}
                placeholder="No limit"
                disabled={saving}
              />
            </div>
            <div className="flex flex-col gap-1.5 flex-1 min-w-0">
              <Label>&nbsp;</Label>
              <div className="flex items-center gap-2 h-10">
                <Checkbox
                  id="agent-detail-background"
                  checked={formBackground}
                  onCheckedChange={(v) => setFormBackground(v === true)}
                  disabled={saving}
                />
                <Label htmlFor="agent-detail-background" className="cursor-pointer whitespace-nowrap">
                  Run in background
                </Label>
              </div>
            </div>
          </div>
        </div>

        {error && <p className="detail-error">{error}</p>}

        <div className="detail-actions">
          <Button type="submit" disabled={!hasChanges || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>

      <section className={`detail-danger ${confirmingDelete ? "detail-danger-confirming" : ""}`}>
        <h3>Danger zone</h3>
        <p>
          {confirmingDelete
            ? `Really delete "${agent.name}"? This cannot be undone.`
            : "Permanently delete this agent and all associated data."}
        </p>
        <div className="detail-danger-actions">
          <button
            type="button"
            className="settings-danger-btn"
            onClick={handleDelete}
          >
            {confirmingDelete ? "Confirm delete" : "Delete agent"}
          </button>
          {confirmingDelete && (
            <button
              type="button"
              className="settings-danger-cancel"
              onClick={() => setConfirmingDelete(false)}
            >
              Cancel
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
