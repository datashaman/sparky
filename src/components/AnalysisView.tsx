import { useState, useEffect } from "react";
import type { AnalysisResult } from "../data/types";
import { createSkill, listSkillsForWorkspace } from "../data/skills";
import { createAgent, listAgentsForWorkspace, setSkillIdsForAgent, setToolIdsForAgent, type CreateAgentParams } from "../data/agents";
import { getDefaultProvider, getDefaultModel } from "./UserSettings";
import { marked } from "marked";

interface AnalysisViewProps {
  result: AnalysisResult;
  workspaceId: string;
  onAllCreated?: () => void;
}

const typeBadgeClass: Record<AnalysisResult["type"], string> = {
  bug: "av-type-bug",
  feature: "av-type-feature",
  improvement: "av-type-improvement",
  question: "av-type-question",
  other: "av-type-other",
};

const complexityBadgeClass: Record<AnalysisResult["complexity"], string> = {
  low: "av-complexity-low",
  medium: "av-complexity-medium",
  high: "av-complexity-high",
};

export function AnalysisView({ result, workspaceId, onAllCreated }: AnalysisViewProps) {
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [existingSkills, setExistingSkills] = useState<Set<string>>(new Set());
  const [existingAgents, setExistingAgents] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [skills, agents] = await Promise.all([
        listSkillsForWorkspace(workspaceId),
        listAgentsForWorkspace(workspaceId),
      ]);
      if (cancelled) return;
      const skillNames = new Set(skills.map((s) => s.name));
      const agentNames = new Set(agents.map((a) => a.name));
      setExistingSkills(skillNames);
      setExistingAgents(agentNames);
      // Pre-select only those not already created
      setSelectedSkills(new Set(result.skills.map((s) => s.name).filter((n) => !skillNames.has(n))));
      setSelectedAgents(new Set(result.agents.map((a) => a.name).filter((n) => !agentNames.has(n))));
      setLoaded(true);

      // If all already exist on load, notify parent immediately
      const allExistOnLoad = result.skills.every((s) => skillNames.has(s.name))
        && result.agents.every((a) => agentNames.has(a.name));
      if (allExistOnLoad && onAllCreated) {
        onAllCreated();
      }
    }
    load();
    return () => { cancelled = true; };
  }, [workspaceId, result]);

  const toggleSkill = (name: string) => {
    if (existingSkills.has(name)) return;
    setSelectedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleAgent = (name: string) => {
    if (existingAgents.has(name)) return;
    setSelectedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const totalSelected = selectedSkills.size + selectedAgents.size;

  const handleCreate = async () => {
    if (totalSelected === 0) return;
    setCreating(true);
    try {
      const provider = getDefaultProvider();
      const model = getDefaultModel();

      for (const skill of result.skills) {
        if (!selectedSkills.has(skill.name)) continue;
        await createSkill({
          workspaceId,
          name: skill.name,
          description: skill.description,
          content: skill.content ?? null,
          provider: provider || null,
          model: model || null,
        });
      }

      // Fetch all skills so we can resolve names to IDs for agent–skill wiring
      const allSkills = await listSkillsForWorkspace(workspaceId);
      const skillNameToId = new Map(allSkills.map((s) => [s.name, s.id]));

      for (const agent of result.agents) {
        if (!selectedAgents.has(agent.name)) continue;
        const params: CreateAgentParams = {
          workspaceId,
          name: agent.name,
          description: agent.description,
          content: agent.content ?? null,
          provider: provider || "anthropic",
          model: model || "claude-sonnet-4-6",
        };
        const created = await createAgent(params);

        // Wire up skill associations
        if (agent.skill_names?.length) {
          const skillIds = agent.skill_names
            .map((n) => skillNameToId.get(n))
            .filter((id): id is string => !!id);
          if (skillIds.length > 0) {
            await setSkillIdsForAgent(created.id, skillIds);
          }
        }

        // Wire up tool associations
        if (agent.tool_names?.length) {
          await setToolIdsForAgent(created.id, agent.tool_names);
        }
      }

      // Refresh existing sets so pills show as already created
      const newExistingSkills = new Set([...existingSkills, ...selectedSkills]);
      const newExistingAgents = new Set([...existingAgents, ...selectedAgents]);
      setExistingSkills(newExistingSkills);
      setExistingAgents(newExistingAgents);
      setSelectedSkills(new Set());
      setSelectedAgents(new Set());

      // Notify parent if all recommended skills/agents now exist
      const allNowExist = result.skills.every((s) => newExistingSkills.has(s.name))
        && result.agents.every((a) => newExistingAgents.has(a.name));
      if (allNowExist && onAllCreated) {
        onAllCreated();
      }
    } finally {
      setCreating(false);
    }
  };

  const approachHtml =
    typeof marked.parse(result.approach) === "string"
      ? (marked.parse(result.approach) as string)
      : "";

  const allExist = loaded && result.skills.every((s) => existingSkills.has(s.name))
    && result.agents.every((a) => existingAgents.has(a.name));

  return (
    <div className="av-root">
      <p className="av-summary">{result.summary}</p>

      <div className="av-badges">
        <span className={`av-badge av-type-badge ${typeBadgeClass[result.type]}`}>
          {result.type}
        </span>
        <span className={`av-badge av-complexity-badge ${complexityBadgeClass[result.complexity]}`}>
          {result.complexity}
        </span>
        <span className="av-complexity-reason">{result.complexity_reason}</span>
      </div>

      {result.considerations.length > 0 && (
        <div className="av-section">
          <h3 className="av-section-header">Key Considerations</h3>
          <div className="av-considerations">
            {result.considerations.map((c, i) => (
              <div key={i} className="av-consideration-card">
                {c}
              </div>
            ))}
          </div>
        </div>
      )}

      {result.approach && (
        <div className="av-section">
          <h3 className="av-section-header">Suggested Approach</h3>
          <div
            className="av-approach"
            dangerouslySetInnerHTML={{ __html: approachHtml }}
          />
        </div>
      )}

      {(result.skills.length > 0 || result.agents.length > 0) && (
        <div className="av-section">
          <div className="av-skills-agents-row">
            {result.skills.length > 0 && (
              <div className="av-pills-group">
                <div className="av-pills-label">Recommended Skills</div>
                <div className="av-pills">
                  {result.skills.map((s) => {
                    const exists = existingSkills.has(s.name);
                    const selected = selectedSkills.has(s.name);
                    return (
                      <button
                        key={s.name}
                        type="button"
                        className={`av-pill ${selected ? "av-pill-selected" : ""} ${exists ? "av-pill-exists" : ""}`}
                        title={exists ? `${s.description} (already created)` : s.description}
                        onClick={() => toggleSkill(s.name)}
                        disabled={exists}
                      >
                        {s.name}
                        {exists && <span className="av-pill-check">&#10003;</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {result.agents.length > 0 && (
              <div className="av-pills-group">
                <div className="av-pills-label">Recommended Agents</div>
                <div className="av-pills">
                  {result.agents.map((a) => {
                    const exists = existingAgents.has(a.name);
                    const selected = selectedAgents.has(a.name);
                    const skillsLabel = a.skill_names?.length
                      ? `\nSkills: ${a.skill_names.join(", ")}`
                      : "";
                    const toolsLabel = a.tool_names?.length
                      ? `\nTools: ${a.tool_names.join(", ")}`
                      : "";
                    return (
                      <span key={a.name} className="av-agent-pill-wrap">
                        <button
                          type="button"
                          className={`av-pill ${selected ? "av-pill-selected" : ""} ${exists ? "av-pill-exists" : ""}`}
                          title={`${exists ? "(already created) " : ""}${a.description}${skillsLabel}${toolsLabel}`}
                          onClick={() => toggleAgent(a.name)}
                          disabled={exists}
                        >
                          {a.name}
                          {exists && <span className="av-pill-check">&#10003;</span>}
                        </button>
                        {a.skill_names?.length > 0 && (
                          <span className="av-agent-skills-hint">
                            {a.skill_names.join(", ")}
                          </span>
                        )}
                        {a.tool_names?.length > 0 && (
                          <span className="av-agent-skills-hint">
                            {a.tool_names.join(", ")}
                          </span>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {allExist ? (
            <p className="av-created-msg">All skills and agents created</p>
          ) : totalSelected > 0 ? (
            <button
              type="button"
              className="av-create-btn"
              disabled={creating}
              onClick={handleCreate}
            >
              {creating ? "Creating..." : `Create ${totalSelected} selected`}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
