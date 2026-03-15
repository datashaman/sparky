import type { AnalysisResult } from "../data/types";
import { marked } from "marked";
import DOMPurify from "dompurify";

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

export function AnalysisView({ result, onAllCreated }: AnalysisViewProps) {
  // Auto-notify parent that we're ready (no CRUD needed)
  if (onAllCreated) {
    // Use microtask to avoid calling during render
    queueMicrotask(onAllCreated);
  }

  const approachHtml = DOMPurify.sanitize(marked.parse(result.approach, { async: false }) as string);

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

      {(result.skills && result.skills.length > 0 || result.agents && result.agents.length > 0) && (
        <div className="av-section">
          <div className="av-skills-agents-row">
            {result.skills && result.skills.length > 0 && (
              <div className="av-pills-group">
                <div className="av-pills-label">Relevant Skills</div>
                <div className="av-pills">
                  {result.skills.map((s) => (
                    <span
                      key={s.name}
                      className="av-pill av-pill-exists"
                      title={s.description}
                    >
                      {s.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {result.agents && result.agents.length > 0 && (
              <div className="av-pills-group">
                <div className="av-pills-label">Relevant Agents</div>
                <div className="av-pills">
                  {result.agents.map((a) => (
                    <span
                      key={a.name}
                      className="av-pill av-pill-exists"
                      title={a.description}
                    >
                      {a.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
