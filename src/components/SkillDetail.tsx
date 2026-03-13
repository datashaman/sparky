import { useState, useEffect } from "react";
import { getSkill, updateSkill, deleteSkill } from "../data/skills";
import { AGENT_PROVIDERS, AGENT_MODELS } from "../data/agents";
import type { AgentProvider, Skill } from "../data/types";
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

interface SkillDetailProps {
  skillId: string;
  onBack: () => void;
  onDeleted: () => void;
}

const PROVIDER_COLORS: Record<AgentProvider, string> = {
  openai: "#10a37f",
  anthropic: "#d4a27f",
  gemini: "#4285f4",
  ollama: "#1d1d1d",
};

export function SkillDetail({ skillId, onBack, onDeleted }: SkillDetailProps) {
  const [skill, setSkill] = useState<Skill | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formContent, setFormContent] = useState("");
  const [formProvider, setFormProvider] = useState<AgentProvider | "">("");
  const [formModel, setFormModel] = useState("");

  const models = formProvider ? AGENT_MODELS[formProvider] : [];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getSkill(skillId)
      .then((s) => {
        if (cancelled) return;
        if (!s) {
          setError("Skill not found.");
          setLoading(false);
          return;
        }
        setSkill(s);
        setFormName(s.name);
        setFormDescription(s.description ?? "");
        setFormContent(s.content ?? "");
        setFormProvider(s.provider ?? "");
        setFormModel(s.model ?? "");
        setLoading(false);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(String(e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [skillId]);

  const hasChanges =
    skill !== null &&
    (formName.trim() !== skill.name ||
      formDescription !== (skill.description ?? "") ||
      formContent !== (skill.content ?? "") ||
      formProvider !== (skill.provider ?? "") ||
      formModel !== (skill.model ?? ""));

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!skill || !hasChanges || saving) return;
    const name = formName.trim();
    if (!name) return;

    setSaving(true);
    setError(null);
    try {
      const updated = await updateSkill(skillId, {
        name,
        description: formDescription.trim() || null,
        content: formContent.trim() || null,
        provider: formProvider || null,
        model: formModel || null,
      });
      if (updated) {
        setSkill(updated);
        setFormName(updated.name);
        setFormDescription(updated.description ?? "");
        setFormContent(updated.content ?? "");
        setFormProvider(updated.provider ?? "");
        setFormModel(updated.model ?? "");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await deleteSkill(skillId);
      onDeleted();
    } catch (e) {
      setError(String(e));
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  if (loading) return null;

  if (error && !skill) {
    return (
      <div className="detail-page">
        <div className="detail-header">
          <button type="button" className="detail-back" onClick={onBack}>
            ← Back
          </button>
        </div>
        <p className="empty-state">{error}</p>
      </div>
    );
  }

  const iconBg = formProvider
    ? (PROVIDER_COLORS[formProvider as AgentProvider] ?? "#888")
    : "#888";

  return (
    <div className="detail-page">
      <div className="detail-header">
        <button type="button" className="detail-back" onClick={onBack}>
          ← Back
        </button>
        <span
          className="skill-item-icon"
          style={{ background: iconBg }}
          aria-hidden
        >
          {formName.charAt(0).toUpperCase() || "S"}
        </span>
        <h2 className="detail-title">{skill?.name ?? "Skill"}</h2>
      </div>

      <form className="detail-form" onSubmit={handleSave} autoComplete="off">
        <div className="detail-field">
          <Label htmlFor="skill-detail-name">
            Name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="skill-detail-name"
            value={formName}
            onChange={(e) => setFormName(e.target.value.replace(/\s+/g, "-"))}
            placeholder="e.g. summarize-pr"
            disabled={saving}
          />
        </div>

        <div className="detail-field">
          <Label htmlFor="skill-detail-description">Description</Label>
          <span className="detail-hint">When to use this skill. If blank, uses the first paragraph of content.</span>
          <Textarea
            id="skill-detail-description"
            value={formDescription}
            onChange={(e) => setFormDescription(e.target.value)}
            placeholder="When to use this skill..."
            disabled={saving}
            rows={2}
          />
        </div>

        <div className="detail-field">
          <Label htmlFor="skill-detail-content">Content</Label>
          <Textarea
            id="skill-detail-content"
            value={formContent}
            onChange={(e) => setFormContent(e.target.value)}
            placeholder="Skill body (markdown supported)..."
            disabled={saving}
            rows={10}
            className="detail-content-textarea"
          />
        </div>

        <div className="detail-field">
          <Label>Provider</Label>
          <Select
            value={formProvider}
            onValueChange={(v) => {
              setFormProvider(v as AgentProvider);
              setFormModel("");
            }}
            disabled={saving}
          >
            <SelectTrigger>
              <SelectValue placeholder="Optional" />
            </SelectTrigger>
            <SelectContent>
              {AGENT_PROVIDERS.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="detail-field">
          <Label>Model</Label>
          {formProvider && models.length === 0 ? (
            <Input
              placeholder="e.g. qwen2.5:3b"
              value={formModel}
              onChange={(e) => setFormModel(e.target.value)}
              disabled={saving}
            />
          ) : (
            <Select
              value={formModel}
              onValueChange={setFormModel}
              disabled={saving || !formProvider}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={formProvider ? "Select model" : "Pick provider first"}
                />
              </SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {error && <p className="skills-drawer-error">{error}</p>}

        <div className="detail-actions">
          <Button
            type="submit"
            disabled={!hasChanges || saving || !formName.trim()}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </form>

      <section className={`detail-danger ${confirmingDelete ? "detail-danger-confirming" : ""}`}>
        <h3>Danger zone</h3>
        <p>
          {confirmingDelete
            ? `Really delete "${skill?.name}"? This cannot be undone.`
            : "Permanently delete this skill."}
        </p>
        <div className="settings-danger-actions">
          <button
            type="button"
            className="settings-danger-btn"
            onClick={handleDelete}
            disabled={deleting}
          >
            {confirmingDelete ? "Confirm delete" : "Delete skill"}
          </button>
          {confirmingDelete && (
            <button
              type="button"
              className="settings-danger-cancel"
              onClick={() => setConfirmingDelete(false)}
              disabled={deleting}
            >
              Cancel
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
