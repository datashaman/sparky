import { callLLM } from "./llm";
import type { AgentProvider, ExecutionPlanStep, ReplanCheck } from "./types";

const REPLAN_CHECK_SYSTEM_PROMPT = `You are evaluating whether an execution plan's remaining steps are still valid after a step just completed.

Consider:
- Did the step output reveal something unexpected that invalidates remaining steps?
- Are the remaining steps still relevant and correctly ordered?
- Did the step accomplish more or less than expected?

Be conservative: only recommend replanning if there is a clear mismatch. Minor deviations are fine. Most of the time, the answer should be "continue".`;

const REPLAN_CHECK_SCHEMA = {
  type: "object" as const,
  properties: {
    decision: {
      type: "string" as const,
      enum: ["continue", "replan"],
      description: "continue if remaining steps are still valid, replan if they need adjustment",
    },
    reason: { type: "string" as const, description: "Brief explanation of the decision" },
  },
  required: ["decision", "reason"],
  additionalProperties: false,
};

const REPLAN_STEPS_SYSTEM_PROMPT = `You are a senior software engineering project manager. Given the completed steps and their outputs, generate replacement steps for the remaining work needed to achieve the goal.

The new steps should:
- Pick up where the completed steps left off
- Account for what was actually accomplished (which may differ from what was planned)
- Be minimal and practical
- Use sequential order numbers starting from the next available number`;

const REPLAN_STEPS_SCHEMA = {
  type: "object" as const,
  properties: {
    steps: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          order: { type: "number" as const },
          title: { type: "string" as const },
          description: { type: "string" as const },
          agent_name: { type: ["string", "null"] as const },
          expected_output: { type: "string" as const },
          depends_on: { type: "array" as const, items: { type: "number" as const } },
        },
        required: ["order", "title", "description", "agent_name", "expected_output", "depends_on"],
        additionalProperties: false,
      },
    },
  },
  required: ["steps"],
  additionalProperties: false,
};

export async function checkNeedReplan(
  stepOutput: string,
  completedStep: ExecutionPlanStep,
  remainingSteps: ExecutionPlanStep[],
  goal: string,
  issueContext: string,
  provider: AgentProvider,
  modelId: string,
  apiKey: string,
): Promise<ReplanCheck> {
  const prompt = [
    `# Goal: ${goal}`,
    "",
    `## Issue Context`,
    issueContext,
    "",
    `## Just Completed: Step ${completedStep.order} — ${completedStep.title}`,
    `Expected: ${completedStep.expected_output}`,
    `Actual output:`,
    stepOutput.slice(0, 2000),
    "",
    `## Remaining Steps`,
    ...remainingSteps.map(
      (s) => `${s.order}. **${s.title}** — ${s.description}\n   Expected: ${s.expected_output}`,
    ),
    "",
    "Are the remaining steps still valid given what just happened?",
  ].join("\n");

  console.log("[replan] checking after step", completedStep.order);

  const text = await callLLM({
    provider,
    modelId,
    apiKey,
    systemPrompt: REPLAN_CHECK_SYSTEM_PROMPT,
    userPrompt: prompt,
    schema: REPLAN_CHECK_SCHEMA,
    schemaName: "replan_check",
    maxTokens: 256,
  });

  const check: ReplanCheck = JSON.parse(text);
  console.log("[replan] decision:", check.decision, "reason:", check.reason);
  return check;
}

export async function regenerateRemainingSteps(
  completedSteps: ExecutionPlanStep[],
  stepOutputs: Map<number, string>,
  goal: string,
  issueContext: string,
  replanReason: string,
  nextOrder: number,
  provider: AgentProvider,
  modelId: string,
  apiKey: string,
): Promise<ExecutionPlanStep[]> {
  const completedContext = completedSteps.map((s) => {
    const output = stepOutputs.get(s.order);
    return `Step ${s.order}: ${s.title}\nOutput: ${output?.slice(0, 1000) ?? "(no output)"}`;
  }).join("\n\n");

  const prompt = [
    `# Goal: ${goal}`,
    "",
    `## Issue Context`,
    issueContext,
    "",
    `## Completed Steps`,
    completedContext,
    "",
    `## Reason for Replanning`,
    replanReason,
    "",
    `Generate the remaining steps needed to achieve the goal. Start order numbers at ${nextOrder}.`,
  ].join("\n");

  console.log("[replan] regenerating steps from order", nextOrder);

  const text = await callLLM({
    provider,
    modelId,
    apiKey,
    systemPrompt: REPLAN_STEPS_SYSTEM_PROMPT,
    userPrompt: prompt,
    schema: REPLAN_STEPS_SCHEMA,
    schemaName: "replan_steps",
    maxTokens: 2048,
  });

  const parsed = JSON.parse(text);
  console.log("[replan] generated", parsed.steps.length, "new steps");
  return parsed.steps;
}
