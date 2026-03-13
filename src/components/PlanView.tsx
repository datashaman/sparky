import { useState } from "react";
import type { ExecutionPlanResult, StepExecutionStatus } from "../data/types";

interface PlanViewProps {
  result: ExecutionPlanResult;
  stepStatuses?: Map<number, StepExecutionStatus>;
  executing?: boolean;
  onExecute?: () => void;
}

function StepStatusBadge({ status }: { status: StepExecutionStatus }) {
  switch (status.status) {
    case "pending":
      return <span className="pv-status pv-status-pending" title="Pending">&#9679;</span>;
    case "running":
      return <span className="pv-status pv-status-running" title="Running">&#9679;</span>;
    case "done":
      return <span className="pv-status pv-status-done" title="Done">&#10003;</span>;
    case "error":
      return <span className="pv-status pv-status-error" title={status.error ?? "Error"}>&#10007;</span>;
  }
}

export function PlanView({ result, stepStatuses, executing, onExecute }: PlanViewProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());

  const toggleExpanded = (order: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(order)) next.delete(order);
      else next.add(order);
      return next;
    });
  };

  return (
    <div className="pv-root">
      <div className="pv-goal">
        <h3 className="pv-goal-label">Goal</h3>
        <p className="pv-goal-text">{result.goal}</p>
      </div>

      <div className="pv-steps">
        {result.steps.map((step) => {
          const status = stepStatuses?.get(step.order);
          const isExpanded = expandedSteps.has(step.order);

          return (
            <div key={step.order} className={`pv-step ${status ? `pv-step-${status.status}` : ""}`}>
              <div className="pv-step-header">
                {status && <StepStatusBadge status={status} />}
                <span className="pv-step-number">{step.order}</span>
                <span className="pv-step-title">{step.title}</span>
                {step.agent_name && <span className="pv-step-agent">{step.agent_name}</span>}
              </div>
              <p className="pv-step-description">{step.description}</p>
              {step.skill_names.length > 0 && (
                <div className="pv-step-skills">
                  {step.skill_names.map((s) => (
                    <span key={s} className="pv-skill-pill">{s}</span>
                  ))}
                </div>
              )}
              <div className="pv-step-output">
                <span className="pv-step-output-label">Expected output:</span> {step.expected_output}
              </div>
              {step.depends_on.length > 0 && (
                <div className="pv-step-deps">
                  Depends on: {step.depends_on.map((d) => `Step ${d}`).join(", ")}
                </div>
              )}
              {status?.status === "error" && status.error && (
                <div className="pv-step-error">{status.error}</div>
              )}
              {status?.status === "done" && status.output && (
                <div className="pv-step-result">
                  <button
                    type="button"
                    className="pv-step-result-toggle"
                    onClick={() => toggleExpanded(step.order)}
                  >
                    {isExpanded ? "Hide output" : "Show output"}
                  </button>
                  {isExpanded && (
                    <pre className="pv-step-result-content">{status.output}</pre>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="pv-criteria">
        <h3 className="pv-criteria-label">Success Criteria</h3>
        <p className="pv-criteria-text">{result.success_criteria}</p>
      </div>

      {onExecute && (
        <div className="pv-execute">
          <button
            type="button"
            className="pv-execute-btn"
            onClick={onExecute}
            disabled={executing}
          >
            {executing ? "Executing..." : "Execute Plan"}
          </button>
        </div>
      )}
    </div>
  );
}
