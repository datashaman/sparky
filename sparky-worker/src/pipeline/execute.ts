import type {
  SessionConfig,
  StartSessionPayload,
  ExecutionLogEntry,
  ExecutionPlanResult,
  ExecutionPlanStep,
  Agent,
  SessionStepState,
  AgentProvider,
} from "../types.js";
import {
  updateSession,
  upsertStepState,
  getAgentsForWorkspace,
  getSkillsForWorkspace,
  getToolIdsForAgent,
  updateExistingTable,
} from "../db.js";
import { callLLM, callLLMWithTools, KEYLESS_PROVIDERS } from "../llm/index.js";
import { getContextWindowSize, estimateMessageTokens } from "../llm/context-budget.js";
import { TOOL_SCHEMAS, filterToolSchemas, createToolHandler } from "../tools/index.js";
import { buildSkillResolver } from "../tools/skill-tool.js";
import { createAskUserHandler } from "../tools/ask-user-tool.js";
import { isSessionCancelled } from "../session-manager.js";
import { readRepoContext } from "../repo-context.js";

export interface ExecutionPipelineOpts {
  sessionId: string;
  payload: StartSessionPayload;
  config: SessionConfig;
  onLog: (stepOrder: number, entry: Omit<ExecutionLogEntry, "timestamp" | "stepOrder">) => void;
  onStepUpdate: (stepOrder: number, status: string, output?: string | null, error?: string | null) => void;
  resumeFromStepStates?: SessionStepState[];
}

export async function runExecutionPipeline(opts: ExecutionPipelineOpts): Promise<void> {
  const { sessionId, payload, config, onLog, onStepUpdate, resumeFromStepStates } = opts;
  const { workspace_id, repo_full_name, issue_number } = payload;

  const planResult = payload.plan_result;
  if (!planResult) throw new Error("Execution requires a plan result.");

  const defaultProvider = config.default_provider;
  const defaultModel = config.default_model;
  const defaultApiKey = config.default_api_key;
  const execProvider = config.exec_provider;
  const execModel = config.exec_model;
  const execApiKey = config.exec_api_key;

  if (!execProvider || !execModel) throw new Error("No exec provider/model configured.");
  if (!execApiKey && !KEYLESS_PROVIDERS.has(execProvider)) throw new Error(`No API key for ${execProvider}.`);

  updateSession(sessionId, { current_phase: "execution" });

  // If we're updating the execution_plans table status
  if (payload.plan_id) {
    updateExistingTable("execution_plans", payload.plan_id, { status: "running" });
  }

  const worktreePath = await resolveWorktreePath(repo_full_name, issue_number);

  // Dynamic repo context budget: 5% of context window, clamped to 2000-10000 chars
  const execContextWindow = getContextWindowSize(execProvider, execModel);
  const repoContextBudget = Math.min(10000, Math.max(2000, Math.floor(execContextWindow * 0.05 * 4)));
  const repoContext = readRepoContext(worktreePath, repoContextBudget);

  const agents = getAgentsForWorkspace(workspace_id);
  const skills = getSkillsForWorkspace(workspace_id);

  const agentsByName = new Map(agents.map((a) => [a.name, a]));
  const skillResolver = buildSkillResolver(workspace_id);

  const stepOutputs = new Map<number, string>();
  let steps = [...planResult.steps];

  const issueContext = `${payload.issue_title} (#${payload.issue_number}) in ${payload.repo_full_name}${payload.issue_body ? `\n${payload.issue_body}` : ""}`;

  // Restore completed step outputs from resume state
  const completedStepOrders = new Set<number>();
  if (resumeFromStepStates) {
    for (const state of resumeFromStepStates) {
      if (state.status === "done" && state.output) {
        stepOutputs.set(state.step_order, state.output);
        completedStepOrders.add(state.step_order);
      }
    }
  }

  // Mark all steps as pending (skip already completed on resume)
  for (const step of steps) {
    if (!completedStepOrders.has(step.order)) {
      onStepUpdate(step.order, "pending");
    }
  }

  let stepIdx = 0;
  while (stepIdx < steps.length) {
    const step = steps[stepIdx];

    // Check cancellation
    if (isSessionCancelled(sessionId)) {
      updateSession(sessionId, { status: "cancelled" });
      return;
    }

    // Skip already completed steps (resume)
    if (completedStepOrders.has(step.order)) {
      stepIdx++;
      continue;
    }

    // Verify dependencies
    for (const dep of step.depends_on) {
      if (!stepOutputs.has(dep)) {
        const msg = `Dependency step ${dep} did not complete`;
        onStepUpdate(step.order, "error", null, msg);
        throw new Error(msg);
      }
    }

    onStepUpdate(step.order, "running");
    updateSession(sessionId, { current_step_order: step.order });

    try {
      // Resolve agent
      let agent: Agent | undefined;
      let provider: AgentProvider = execProvider;
      let modelId = execModel;
      let apiKey = execApiKey;
      let toolSchemas = TOOL_SCHEMAS;
      let agentContent = "";

      if (step.agent_name) {
        agent = agentsByName.get(step.agent_name);
        if (agent) {
          provider = agent.provider;
          modelId = agent.model;
          // Resolve API key for the agent's provider
          const agentKey = config.api_keys?.[agent.provider] ?? (agent.provider === execProvider ? execApiKey : config.default_api_key);
          if (!agentKey && !KEYLESS_PROVIDERS.has(agent.provider)) {
            throw new Error(`No API key for agent provider ${agent.provider} (agent: ${agent.name}).`);
          }
          apiKey = agentKey;
          if (agent.content) agentContent = agent.content;

          const agentToolIds = getToolIdsForAgent(agent.id);
          toolSchemas = agentToolIds.length > 0
            ? filterToolSchemas(agentToolIds)
            : filterToolSchemas(["read", "glob", "grep"]);
        }
      }

      // Build context from dependent step outputs (budget-aware)
      const stepContextWindow = getContextWindowSize(provider, modelId);
      const totalDepsBudgetChars = Math.floor(stepContextWindow * 0.20) * 4; // 20% of window, in chars
      const perDepBudget = step.depends_on.length > 0
        ? Math.floor(totalDepsBudgetChars / step.depends_on.length)
        : 0;

      const depsContext = step.depends_on
        .map((dep) => {
          let output = stepOutputs.get(dep);
          const depStep = steps.find((s) => s.order === dep);
          if (!output) return null;
          if (output.length > perDepBudget) {
            output = output.slice(0, perDepBudget) + "\n... (truncated to fit context budget)";
          }
          return `## Output from step ${dep} (${depStep?.title ?? ""})\n${output}`;
        })
        .filter(Boolean)
        .join("\n\n");

      // Build prompts
      const totalSteps = steps.length;
      const completedStepsList = steps
        .filter((s) => stepOutputs.has(s.order))
        .map((s) => `${s.order}. ${s.title}`)
        .join(", ");

      const systemParts = [
        `You are an autonomous agent working on resolving a GitHub issue in a code worktree. You MUST keep going until the task is fully complete — do not stop to ask for confirmation, do not present partial results, do not ask "should I continue?". Only stop when the work is DONE or you are genuinely BLOCKED.`,
        `Issue: ${payload.issue_title} (#${payload.issue_number}) in ${payload.repo_full_name}`,
        ``,
        `## Progress`,
        `You are on step ${step.order} of ${totalSteps}.${completedStepsList ? ` Completed: ${completedStepsList}.` : ""} Focus only on YOUR step.`,
        ``,
        `## Your current task: ${step.title}`,
        `${step.description}`,
        ``,
        `Expected output: ${step.expected_output}`,
        step.done_when ? `Done when: ${step.done_when}` : "",
        step.verification_command ? `Verification command: ${step.verification_command}` : "",
        ``,
        `## Workflow`,
        `1. **Understand**: Read relevant files and understand the current state before making changes.`,
        `2. **Plan**: Briefly state your approach (1-2 sentences) before writing code.`,
        `3. **Implement**: Make the changes using edit_file or write_file.`,
        `4. **Verify**: After each change, verify it worked — read the file back or run a relevant command. Never assume an action succeeded.`,
        ``,
        `## Working guidelines`,
        `- Before each tool call, state what you expect to find or accomplish.`,
        `- After each tool result, assess whether it matched your expectation.`,
        `- If a tool call fails with the same error 3 times, STOP and try a different approach or report the issue.`,
        `- If a bash command returns a non-zero exit code (look for "Exit code: N" in the output), do NOT run it more than 3 times. After 2 failures, read the error carefully and fix the root cause before retrying.`,
        `- If an edit_file call fails (no match), re-read the file to get current content before retrying.`,
        step.verification_command ? `- After completing the task, run the verification command: \`${step.verification_command}\`. If it fails, fix the issue. If it still fails after 2 fix attempts, end with STATUS: BLOCKED and include the failing output.` : "",
        `- End your final response with STATUS: DONE if the task is complete, or STATUS: BLOCKED with a reason if you cannot proceed.`,
      ].filter(Boolean);

      if (repoContext) {
        systemParts.push("", repoContext);
      }

      if (agentContent) {
        systemParts.push("", "## Agent Instructions", agentContent);
      }

      if (skills.length > 0) {
        systemParts.push("", "## Available Skills");
        systemParts.push("Use the `use_skill` tool to load a skill's content.");
        for (const s of skills) {
          systemParts.push(`- **${s.name}**: ${s.description || "(no description)"}`);
        }
      }

      const userParts = ["Complete the task described above."];
      if (depsContext) {
        userParts.push("", "Here is context from previous steps:", "", depsContext);
      }
      if (payload.issue_body) {
        userParts.push("", "## Issue description", payload.issue_body);
      }

      const maxTurns = agent?.max_turns ?? 25;

      const stepLog = (partial: Omit<ExecutionLogEntry, "timestamp" | "stepOrder">) => onLog(step.order, partial);
      const stepStartTime = Date.now();
      stepLog({ type: "info", message: `Starting: ${step.title} (${provider}/${modelId})` });

      const askUserHandler = createAskUserHandler(sessionId, step.order, config.ask_user_timeout_minutes);
      const toolHandler = createToolHandler(worktreePath, skillResolver, askUserHandler);

      // Resume from checkpoint if available
      let existingMessages: unknown[] | undefined;
      if (resumeFromStepStates) {
        const stepState = resumeFromStepStates.find((s) => s.step_order === step.order);
        if (stepState?.conversation_state) {
          try {
            const checkpoint = JSON.parse(stepState.conversation_state);
            existingMessages = checkpoint.messages;
            stepLog({ type: "info", message: `Resuming from turn ${checkpoint.turn}` });
          } catch { /* start fresh */ }
        }
      }

      const { text: output, messages } = await callLLMWithTools({
        provider,
        modelId,
        apiKey,
        systemPrompt: systemParts.join("\n"),
        userPrompt: userParts.join("\n"),
        tools: toolSchemas,
        maxTurns,
        onToolCall: toolHandler,
        onLog: stepLog,
        existingMessages,
        onCheckpoint: (msgs, turn) => {
          upsertStepState({
            session_id: sessionId,
            step_order: step.order,
            status: "running",
            output: null,
            error: null,
            conversation_state: JSON.stringify({ messages: msgs, turn }),
          });
        },
      });

      // Checkpoint after completion — derive actual turn from message count
      const actualTurn = Math.ceil(messages.length / 2);
      upsertStepState({
        session_id: sessionId,
        step_order: step.order,
        status: "done",
        output,
        error: null,
        conversation_state: JSON.stringify({ messages, turn: actualTurn }),
      });

      // Log step metrics
      const stepDuration = Math.round((Date.now() - stepStartTime) / 1000);
      const estimatedTokens = estimateMessageTokens(messages);
      stepLog({
        type: "info",
        message: `Step completed in ${stepDuration}s, ${actualTurn} turns, ~${estimatedTokens.toLocaleString()} tokens used`,
      });

      stepOutputs.set(step.order, output);
      onStepUpdate(step.order, "done", output);

      // Adaptive replanning
      const remainingSteps = steps.slice(stepIdx + 1);
      if (remainingSteps.length > 0) {
        try {
          stepLog({ type: "replan_check", message: "Checking if remaining steps need adjustment" });
          const replanResult = await checkNeedReplan(output, step, remainingSteps, planResult.goal, issueContext, execProvider, execModel, execApiKey);

          stepLog({ type: "replan_decision", decision: replanResult.decision, reason: replanResult.reason });

          if (replanResult.decision === "replan") {
            const completedSteps = steps.slice(0, stepIdx + 1);
            const nextOrder = step.order + 1;

            const newSteps = await regenerateRemainingSteps(
              completedSteps, stepOutputs, planResult.goal, issueContext,
              replanResult.reason, nextOrder, defaultProvider, defaultModel, defaultApiKey,
            );

            steps = [...completedSteps, ...newSteps];
            for (const ns of newSteps) {
              onStepUpdate(ns.order, "pending");
            }
          }
        } catch (replanErr) {
          console.warn("[execute] replan check failed, continuing:", replanErr);
        }
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      onStepUpdate(step.order, "error", null, error);
      throw e;
    }

    stepIdx++;
  }

  // Mark plan as done
  if (payload.plan_id) {
    updateExistingTable("execution_plans", payload.plan_id, { status: "done" });
  }
}

async function resolveWorktreePath(repoFullName: string, issueNumber: number): Promise<string> {
  const { getDb } = await import("../db.js");
  const row = getDb()
    .prepare("SELECT path FROM issue_worktrees WHERE repo_full_name = ? AND issue_number = ? AND status = 'ready'")
    .get(repoFullName, issueNumber) as { path: string } | undefined;
  if (!row) throw new Error(`No ready worktree for ${repoFullName}#${issueNumber}.`);
  return row.path;
}

// ─── Replan ───

const REPLAN_CHECK_SCHEMA = {
  type: "object" as const,
  properties: {
    decision: { type: "string" as const, enum: ["continue", "replan"] },
    reason: { type: "string" as const },
  },
  required: ["decision", "reason"],
  additionalProperties: false,
};

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
          verification_command: { type: ["string", "null"] as const },
          done_when: { type: "string" as const },
        },
        required: ["order", "title", "description", "agent_name", "expected_output", "depends_on", "verification_command", "done_when"],
        additionalProperties: false,
      },
    },
  },
  required: ["steps"],
  additionalProperties: false,
};

async function checkNeedReplan(
  stepOutput: string,
  completedStep: ExecutionPlanStep,
  remainingSteps: ExecutionPlanStep[],
  goal: string,
  issueContext: string,
  provider: AgentProvider,
  modelId: string,
  apiKey: string,
): Promise<{ decision: "continue" | "replan"; reason: string }> {
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
    ...remainingSteps.map((s) => `${s.order}. **${s.title}** — ${s.description}`),
    "",
    "Are the remaining steps still valid?",
  ].join("\n");

  const text = await callLLM({
    provider,
    modelId,
    apiKey,
    systemPrompt: `You are evaluating whether remaining execution plan steps are still valid.

Only recommend replan if:
(a) a step discovered the codebase structure is fundamentally different than assumed,
(b) a step completed the work of a future step as a side effect, or
(c) a step failed in a way that invalidates the approach.

Replanning costs time and tokens. Default to "continue" unless there is a clear, specific reason to change course.`,
    userPrompt: prompt,
    schema: REPLAN_CHECK_SCHEMA,
    schemaName: "replan_check",
    maxTokens: 256,
  });

  return JSON.parse(text);
}

async function regenerateRemainingSteps(
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
    `Generate remaining steps starting at order ${nextOrder}.`,
  ].join("\n");

  const text = await callLLM({
    provider,
    modelId,
    apiKey,
    systemPrompt: "You are a senior project manager. Generate replacement steps for the remaining work.",
    userPrompt: prompt,
    schema: REPLAN_STEPS_SCHEMA,
    schemaName: "replan_steps",
    maxTokens: 2048,
  });

  return JSON.parse(text).steps;
}
