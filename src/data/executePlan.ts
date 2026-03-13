import { getDefaultProvider, getDefaultModel, getExecProvider, getExecModel, getApiKey } from "../components/UserSettings";
import { listAgentsForWorkspace, getToolIdsForAgent, getSkillIdsForAgent } from "./agents";
import { listSkillsForWorkspace } from "./skills";
import { ensureWorktree } from "./issueWorktrees";
import { callLLMWithTools } from "./llm";
import { TOOL_SCHEMAS, filterToolSchemas, createToolCallHandler } from "./tools";
import type {
  ExecutionPlanResult,
  StepExecutionStatus,
  Agent,
  Skill,
  IssueWorktree,
} from "./types";
import { checkNeedReplan, regenerateRemainingSteps } from "./replanCheck";
import type { GitHubIssue } from "../github";

export interface ExecutePlanOpts {
  planResult: ExecutionPlanResult;
  workspaceId: string;
  issue: GitHubIssue & { full_name: string };
  onStepUpdate: (stepOrder: number, status: StepExecutionStatus) => void;
  onWorktreeUpdate: (wt: IssueWorktree) => void;
  onPlanUpdate?: (updatedPlan: ExecutionPlanResult) => void;
}

export async function executePlan(opts: ExecutePlanOpts): Promise<void> {
  const { planResult, workspaceId, issue, onStepUpdate, onWorktreeUpdate, onPlanUpdate } = opts;

  // Validate provider/model/key
  const defaultProvider = getDefaultProvider();
  const defaultModel = getDefaultModel();
  if (!defaultProvider || !defaultModel) {
    throw new Error("No default provider/model configured. Set one in Settings.");
  }
  const defaultApiKey = getApiKey(defaultProvider);
  if (!defaultApiKey) {
    throw new Error(`No API key configured for ${defaultProvider}. Add one in Settings.`);
  }

  // Resolve execution-specific provider/model (cheaper/faster for step execution)
  const execProviderVal = getExecProvider() || defaultProvider;
  const execModelVal = getExecModel() || defaultModel;
  const execApiKey = execProviderVal !== defaultProvider ? getApiKey(execProviderVal) : defaultApiKey;
  if (!execApiKey) {
    throw new Error(`No API key configured for exec provider ${execProviderVal}. Add one in Settings.`);
  }

  // Ensure worktree exists
  const accessToken = localStorage.getItem("github_token") ?? "";
  if (!accessToken) {
    throw new Error("No GitHub token. Please log in.");
  }

  const worktree = await ensureWorktree(
    workspaceId,
    issue.full_name,
    issue.number,
    accessToken,
    onWorktreeUpdate,
  );

  const worktreePath = worktree.path;
  const toolHandler = createToolCallHandler(worktreePath);

  // Load workspace agents and skills
  const [wsAgents, wsSkills] = await Promise.all([
    listAgentsForWorkspace(workspaceId),
    listSkillsForWorkspace(workspaceId),
  ]);

  const agentsByName = new Map(wsAgents.map((a) => [a.name, a]));
  const skillsByName = new Map(wsSkills.map((s) => [s.name, s]));

  // Track step outputs for context passing
  const stepOutputs = new Map<number, string>();

  // Mutable steps array for replan support
  let steps = [...planResult.steps];

  // Build issue context string for replan checks
  const issueContext = `${issue.title} (#${issue.number}) in ${issue.full_name}${issue.body ? `\n${issue.body}` : ""}`;

  // Mark all steps as pending
  for (const step of steps) {
    onStepUpdate(step.order, { status: "pending" });
  }

  // Execute steps using index (steps array may change via replan)
  let stepIdx = 0;
  while (stepIdx < steps.length) {
    const step = steps[stepIdx];

    // Verify dependencies completed
    for (const dep of step.depends_on) {
      if (!stepOutputs.has(dep)) {
        const msg = `Dependency step ${dep} did not complete`;
        onStepUpdate(step.order, { status: "error", error: msg });
        throw new Error(msg);
      }
    }

    onStepUpdate(step.order, { status: "running" });

    try {
      // Resolve agent if specified
      let agent: Agent | undefined;
      let provider = execProviderVal;
      let modelId = execModelVal;
      let apiKey = execApiKey;
      let toolSchemas = TOOL_SCHEMAS;
      let agentContent = "";

      // Build effective skill names list (without mutating the plan model)
      const effectiveSkillNames = [...step.skill_names];

      if (step.agent_name) {
        agent = agentsByName.get(step.agent_name);
        if (agent) {
          provider = agent.provider;
          modelId = agent.model;
          const agentKey = getApiKey(agent.provider);
          if (!agentKey) {
            throw new Error(`No API key configured for agent provider ${agent.provider} (agent: ${agent.name}). Add one in Settings.`);
          }
          apiKey = agentKey;
          if (agent.content) agentContent = agent.content;

          // Filter tools to agent's configured set (empty = safe default of read-only tools)
          const agentToolIds = await getToolIdsForAgent(agent.id);
          if (agentToolIds.length > 0) {
            toolSchemas = filterToolSchemas(agentToolIds);
          } else {
            toolSchemas = filterToolSchemas(["read", "glob", "grep"]);
          }

          // Load agent's skills too
          const agentSkillIds = await getSkillIdsForAgent(agent.id);
          const agentSkills = agentSkillIds
            .map((id) => wsSkills.find((s) => s.id === id))
            .filter((s): s is Skill => !!s);
          for (const s of agentSkills) {
            if (!effectiveSkillNames.includes(s.name) && s.content) {
              effectiveSkillNames.push(s.name);
            }
          }
        }
      }

      // Gather skill content
      const skillContext = effectiveSkillNames
        .map((name) => {
          const skill = skillsByName.get(name);
          return skill?.content ? `## Skill: ${skill.name}\n${skill.content}` : null;
        })
        .filter(Boolean)
        .join("\n\n");

      // Build context from dependent step outputs
      const depsContext = step.depends_on
        .map((dep) => {
          const output = stepOutputs.get(dep);
          const depStep = steps.find((s) => s.order === dep);
          return output ? `## Output from step ${dep} (${depStep?.title ?? ""})\n${output}` : null;
        })
        .filter(Boolean)
        .join("\n\n");

      // Build system prompt
      const systemParts = [
        `You are working on resolving a GitHub issue in a code worktree.`,
        `Issue: ${issue.title} (#${issue.number}) in ${issue.full_name}`,
        ``,
        `Your current task (step ${step.order}): ${step.title}`,
        `${step.description}`,
        ``,
        `Expected output: ${step.expected_output}`,
      ];

      if (agentContent) {
        systemParts.push("", "## Agent Instructions", agentContent);
      }

      if (skillContext) {
        systemParts.push("", skillContext);
      }

      const systemPrompt = systemParts.join("\n");

      // Build user prompt with context
      const userParts = ["Complete the task described above."];

      if (depsContext) {
        userParts.push("", "Here is context from previous steps:", "", depsContext);
      }

      if (issue.body) {
        userParts.push("", "## Issue description", issue.body);
      }

      const userPrompt = userParts.join("\n");

      const maxTurns = agent?.max_turns ?? 25;

      console.log(`[execute] step ${step.order}: "${step.title}" provider=${provider} model=${modelId} tools=${toolSchemas.length} maxTurns=${maxTurns}`);

      const output = await callLLMWithTools({
        provider,
        modelId,
        apiKey,
        systemPrompt,
        userPrompt,
        tools: toolSchemas,
        maxTurns,
        onToolCall: toolHandler,
      });

      stepOutputs.set(step.order, output);
      onStepUpdate(step.order, { status: "done", output });
      console.log(`[execute] step ${step.order} done, output length: ${output.length}`);

      // Adaptive re-planning: check if remaining steps are still valid
      const remainingSteps = steps.slice(stepIdx + 1);
      if (remainingSteps.length > 0) {
        try {
          const replanResult = await checkNeedReplan(
            output,
            step,
            remainingSteps,
            planResult.goal,
            issueContext,
            execProviderVal,
            execModelVal,
            execApiKey,
          );

          if (replanResult.decision === "replan") {
            console.log("[execute] replanning:", replanResult.reason);
            const completedSteps = steps.slice(0, stepIdx + 1);
            const nextOrder = step.order + 1;

            // Use planning model (reasoning task) for step regeneration
            const newSteps = await regenerateRemainingSteps(
              completedSteps,
              stepOutputs,
              planResult.goal,
              issueContext,
              replanResult.reason,
              nextOrder,
              defaultProvider,
              defaultModel,
              defaultApiKey,
            );

            // Replace remaining steps
            steps = [...completedSteps, ...newSteps];

            // Mark new steps as pending
            for (const ns of newSteps) {
              onStepUpdate(ns.order, { status: "pending" });
            }

            // Notify UI of plan update
            if (onPlanUpdate) {
              onPlanUpdate({ ...planResult, steps });
            }
          }
        } catch (replanErr) {
          // Replan check failure is non-fatal — continue with existing plan
          console.warn("[execute] replan check failed, continuing:", replanErr);
        }
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[execute] step ${step.order} error:`, error);
      onStepUpdate(step.order, { status: "error", error });
      throw e;
    }

    stepIdx++;
  }
}
