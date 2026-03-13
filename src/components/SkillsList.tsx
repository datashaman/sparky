import { useState, useEffect } from "react";
import { listSkillsForWorkspace, createSkill, deleteSkill } from "../data/skills";
import { AGENT_PROVIDERS, AGENT_MODELS } from "../data/agents";
import type { AgentProvider } from "../data/types";
import type { Skill } from "../data/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
}

const PROVIDER_COLORS: Record<AgentProvider, string> = {
  openai: "#10a37f",
  anthropic: "#d4a27f",
  gemini: "#4285f4",
};

export function SkillsList({ workspaceId }: Props) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formProvider, setFormProvider] = useState<AgentProvider | "">("");
  const [formModel, setFormModel] = useState("");

  const models = formProvider ? AGENT_MODELS[formProvider] : [];

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const list = await listSkillsForWorkspace(workspaceId);
      setSkills(list);
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
    setFormProvider("");
    setFormModel("");
    setError(null);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    resetForm();
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = formName.trim();
    if (!name || creating) return;

    setCreating(true);
    setError(null);
    try {
      await createSkill({
        workspaceId,
        name,
        description: formDescription.trim() || null,
        provider: formProvider || null,
        model: formModel || null,
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
      await deleteSkill(id);
      await load();
      setConfirmingDeleteId(null);
    } catch (e) {
      setError(String(e));
    }
  }

  if (loading) return null;

  return (
    <div className="skills-list">
      <div className="skills-list-header">
        <h3>Skills</h3>
        {skills.length > 0 && (
          <button
            type="button"
            className="header-btn"
            onClick={() => setDrawerOpen(true)}
          >
            + New
          </button>
        )}
      </div>

      {skills.length === 0 ? (
        <div className="skills-empty-state">
          <div className="skills-empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" />
              <path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" />
            </svg>
          </div>
          <p className="skills-empty-title">No skills yet</p>
          <p className="skills-empty-hint">Define reusable skills that agents can invoke.</p>
          <button
            type="button"
            className="skills-empty-cta"
            onClick={() => setDrawerOpen(true)}
          >
            + New
          </button>
        </div>
      ) : (
        <ul className="skill-items">
          {skills.map((s) => (
            <li
              key={s.id}
              className={`skill-item ${confirmingDeleteId === s.id ? "skill-item-confirming" : ""}`}
            >
              <span
                className="skill-item-icon"
                style={{ background: s.provider ? (PROVIDER_COLORS[s.provider as AgentProvider] ?? "#888") : "#888" }}
              >
                {s.name.charAt(0).toUpperCase()}
              </span>
              <div className="skill-item-info">
                <span className="skill-name">{s.name}</span>
                <span className="skill-meta">
                  {s.provider && s.model ? `${s.provider} / ${s.model}` : s.provider || "no provider"}
                </span>
                {s.description && (
                  <span className="skill-desc">{s.description}</span>
                )}
              </div>
              <button
                type="button"
                className="skill-delete"
                onClick={() =>
                  confirmingDeleteId === s.id
                    ? handleDelete(s.id)
                    : setConfirmingDeleteId(s.id)
                }
                aria-label={confirmingDeleteId === s.id ? `Confirm delete ${s.name}` : `Delete ${s.name}`}
              >
                {confirmingDeleteId === s.id ? "!" : "\u00d7"}
              </button>
              {confirmingDeleteId === s.id && (
                <button
                  type="button"
                  className="skill-delete-cancel"
                  onClick={() => setConfirmingDeleteId(null)}
                >
                  Cancel
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Create skill drawer */}
      <div
        className={`skills-drawer ${drawerOpen ? "skills-drawer-open" : ""}`}
        aria-hidden={!drawerOpen}
      >
        <div className="skills-drawer-backdrop" onClick={closeDrawer} />
        <div className="skills-drawer-panel">
          <div className="skills-drawer-header">
            <h3>New skill</h3>
            <button
              type="button"
              className="skills-drawer-close"
              onClick={closeDrawer}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <form onSubmit={handleCreate} className="skills-drawer-form" autoComplete="off">
            <div className="skills-drawer-body">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="skill-name">Name <span className="text-destructive">*</span></Label>
                <Input
                  id="skill-name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value.replace(/\s+/g, "-"))}
                  placeholder="e.g. summarize-pr"
                  disabled={creating}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="skill-description">Description</Label>
                <Textarea
                  id="skill-description"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="What this skill does..."
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
                      <SelectValue placeholder="Optional" />
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
                    disabled={creating || !formProvider}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={formProvider ? "Select model" : "Pick provider first"} />
                    </SelectTrigger>
                    <SelectContent>
                      {models.map((m) => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            {error && <p className="skills-drawer-error">{error}</p>}
            <div className="skills-drawer-actions">
              <Button
                type="submit"
                disabled={creating || !formName.trim()}
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
