import { useEffect, useRef, useState } from "react";
import type { ExecutionLogEntry, ExecutionPlanResult, StepExecutionStatus, CriticReview } from "../data/types";

interface PlanViewProps {
  result: ExecutionPlanResult;
  criticReview?: CriticReview;
  stepStatuses?: Map<number, StepExecutionStatus>;
  executing?: boolean;
  executionError?: string | null;
  onExecute?: () => void;
  executionLogs?: ExecutionLogEntry[];
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

function CriticReviewSection({ review }: { review: CriticReview }) {
  const [expanded, setExpanded] = useState(false);
  const isPassing = review.verdict === "pass";

  return (
    <div className={`pv-critic ${isPassing ? "pv-critic-pass" : "pv-critic-fail"}`}>
      <button
        type="button"
        className="pv-critic-header"
        onClick={() => setExpanded(!expanded)}
      >
        <span className={`pv-critic-badge ${isPassing ? "pv-badge-pass" : "pv-badge-fail"}`}>
          {isPassing ? "✓ Pass" : "⚠ Issues"}
        </span>
        <span className="pv-critic-summary">{review.summary}</span>
        <span className="pv-critic-toggle">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && review.issues.length > 0 && (
        <ul className="pv-critic-issues">
          {review.issues.map((issue, i) => (
            <li key={i} className={`pv-critic-issue pv-critic-${issue.severity}`}>
              <span className="pv-critic-severity">{issue.severity}</span>
              {issue.step_order !== null && (
                <span className="pv-critic-step-ref">Step {issue.step_order}</span>
              )}
              <span className="pv-critic-desc">{issue.description}</span>
              <span className="pv-critic-suggestion">{issue.suggestion}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function LogEntryLine({ entry }: { entry: ExecutionLogEntry }) {
  const time = formatTime(entry.timestamp);

  switch (entry.type) {
    case "llm_request":
      return (
        <div className="pv-log-entry pv-log-llm">
          <span className="pv-log-time">[{time}]</span>
          <span className="pv-log-icon">&#129302;</span>
          <span>LLM turn {entry.turn} ({entry.provider}/{entry.model}): {entry.message}</span>
        </div>
      );
    case "llm_response":
      return (
        <div className="pv-log-entry pv-log-llm">
          <span className="pv-log-time">[{time}]</span>
          <span className="pv-log-icon">&#129302;</span>
          <span>LLM response: {entry.message}</span>
        </div>
      );
    case "tool_call":
      return (
        <div className="pv-log-entry pv-log-tool">
          <span className="pv-log-time">[{time}]</span>
          <span className="pv-log-icon">&#128295;</span>
          <span>{entry.toolName} {entry.toolInput}</span>
        </div>
      );
    case "tool_result":
      return (
        <div className={`pv-log-entry ${entry.toolError ? "pv-log-error" : "pv-log-result"}`}>
          <span className="pv-log-time">[{time}]</span>
          <span className="pv-log-icon">{entry.toolError ? "\u2717" : "\u2713"}</span>
          <span>{entry.toolName} {entry.toolError ? `error: ${entry.toolError}` : `\u2192 ${entry.toolResult}`}</span>
        </div>
      );
    case "replan_check":
      return (
        <div className="pv-log-entry pv-log-replan">
          <span className="pv-log-time">[{time}]</span>
          <span className="pv-log-icon">&#128260;</span>
          <span>{entry.message}</span>
        </div>
      );
    case "replan_decision":
      return (
        <div className={`pv-log-entry ${entry.decision === "replan" ? "pv-log-replan" : "pv-log-result"}`}>
          <span className="pv-log-time">[{time}]</span>
          <span className="pv-log-icon">{entry.decision === "replan" ? "\u21BB" : "\u2713"}</span>
          <span>{entry.decision === "replan" ? "Replanning" : "Continuing"}: {entry.reason}</span>
        </div>
      );
    case "info":
      return (
        <div className="pv-log-entry pv-log-info">
          <span className="pv-log-time">[{time}]</span>
          <span className="pv-log-icon">&#8505;</span>
          <span>{entry.message}</span>
        </div>
      );
  }
}

function StepLogPanel({ logs }: { logs: ExecutionLogEntry[] }) {
  const [expanded, setExpanded] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (expanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, expanded]);

  if (logs.length === 0) return null;

  return (
    <div className="pv-log-panel">
      <button
        type="button"
        className="pv-log-toggle"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? "Hide" : "Show"} execution log ({logs.length})
      </button>
      {expanded && (
        <div className="pv-log-container" ref={scrollRef}>
          {logs.map((entry, i) => (
            <LogEntryLine key={i} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

export function PlanView({ result, criticReview, stepStatuses, executing, executionError, onExecute, executionLogs }: PlanViewProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());

  const toggleExpanded = (order: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(order)) next.delete(order);
      else next.add(order);
      return next;
    });
  };

  // Group logs by stepOrder
  const logsByStep = new Map<number, ExecutionLogEntry[]>();
  if (executionLogs) {
    for (const entry of executionLogs) {
      const arr = logsByStep.get(entry.stepOrder) ?? [];
      arr.push(entry);
      logsByStep.set(entry.stepOrder, arr);
    }
  }

  return (
    <div className="pv-root">
      <div className="pv-goal">
        <h3 className="pv-goal-label">Goal</h3>
        <p className="pv-goal-text">{result.goal}</p>
      </div>

      {criticReview && <CriticReviewSection review={criticReview} />}

      <div className="pv-steps">
        {result.steps.map((step) => {
          const status = stepStatuses?.get(step.order);
          const isExpanded = expandedSteps.has(step.order);
          const stepLogs = logsByStep.get(step.order) ?? [];

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
              {(status?.status === "running" || status?.status === "done") && stepLogs.length > 0 && (
                <StepLogPanel logs={stepLogs} />
              )}
              {status?.status === "error" && status.error && (
                <div className="pv-step-error-text">{status.error}</div>
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
          {executionError && (
            <div className="pv-execute-error">{executionError}</div>
          )}
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
