import type { ExecutionPlanResult } from "../data/types";

interface PlanViewProps {
  result: ExecutionPlanResult;
}

export function PlanView({ result }: PlanViewProps) {
  return (
    <div className="pv-root">
      <div className="pv-goal">
        <h3 className="pv-goal-label">Goal</h3>
        <p className="pv-goal-text">{result.goal}</p>
      </div>

      <div className="pv-steps">
        {result.steps.map((step) => (
          <div key={step.order} className="pv-step">
            <div className="pv-step-header">
              <span className="pv-step-number">{step.order}</span>
              <span className="pv-step-title">{step.title}</span>
              <span className="pv-step-agent">{step.agent_name}</span>
            </div>
            <p className="pv-step-description">{step.description}</p>
            {step.skill_names.length > 0 && (
              <div className="pv-step-skills">
                {step.skill_names.map((s) => (
                  <span key={s} className="pv-skill-pill">{s}</span>
                ))}
              </div>
            )}
            {step.tool_names?.length > 0 && (
              <div className="pv-step-skills">
                {step.tool_names.map((t) => (
                  <span key={t} className="pv-skill-pill pv-tool-pill">{t}</span>
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
          </div>
        ))}
      </div>

      <div className="pv-criteria">
        <h3 className="pv-criteria-label">Success Criteria</h3>
        <p className="pv-criteria-text">{result.success_criteria}</p>
      </div>
    </div>
  );
}
