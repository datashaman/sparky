import { useEffect, useRef, useCallback, useState } from "react";
import {
  ensureWorkerRunning,
  subscribeToWorkerEvents,
  startSession,
  cancelSession,
  answerAskUser,
  type WorkerEvent,
  type SessionConfig,
} from "../data/workerClient";
import { getAnalysisForIssue } from "../data/issueAnalyses";
import { getPlanForIssue } from "../data/executionPlans";
import type {
  ExecutionLogEntry,
  IssueAnalysis,
  ExecutionPlan,
  StepExecutionStatus,
  AnalysisResult,
  ExecutionPlanResult,
} from "../data/types";
import type { GitHubIssue } from "../github";
import {
  getDefaultProvider,
  getDefaultModel,
  getExecProvider,
  getExecModel,
  getApiKey,
} from "../components/UserSettings";
import { KEYLESS_PROVIDERS } from "../data/providers";
import { AGENT_PROVIDERS } from "../data/agents";
import type { AgentProvider } from "../data/types";

export interface AskUserPromptIPC {
  sessionId: string;
  promptId: string;
  stepOrder: number;
  question: string;
  options: string[];
  allowMultiple: boolean;
}

export interface WorkerSessionState {
  sessionId: string | null;
  loading: boolean;
  error: string | null;
  askUserPrompt: AskUserPromptIPC | null;
}

/** Build a SessionConfig from localStorage settings. */
function buildSessionConfig(): SessionConfig {
  const defaultProvider = getDefaultProvider() as AgentProvider;
  const defaultModel = getDefaultModel();
  const execProvider = (getExecProvider() || defaultProvider) as AgentProvider;
  const execModel = getExecModel() || defaultModel;

  const apiKeys: Partial<Record<AgentProvider, string>> = {};
  for (const p of AGENT_PROVIDERS) {
    const key = getApiKey(p);
    if (key) apiKeys[p] = key;
  }

  return {
    default_provider: defaultProvider,
    default_model: defaultModel,
    default_api_key: getApiKey(defaultProvider),
    exec_provider: execProvider,
    exec_model: execModel,
    exec_api_key: getApiKey(execProvider),
    github_token: localStorage.getItem("github_token") ?? "",
    ask_user_timeout_minutes: null,
    api_keys: apiKeys,
  };
}

export function useWorkerSession(opts: {
  workspaceId: string;
  onAnalysisUpdate: (a: IssueAnalysis) => void;
  onPlanUpdate: (p: ExecutionPlan) => void;
  onStepUpdate: (stepOrder: number, status: StepExecutionStatus) => void;
  onLog: (entry: ExecutionLogEntry) => void;
}) {
  const { workspaceId, onAnalysisUpdate, onPlanUpdate, onStepUpdate, onLog } = opts;

  const [state, setState] = useState<WorkerSessionState>({
    sessionId: null,
    loading: false,
    error: null,
    askUserPrompt: null,
  });

  // Track active session to filter events
  const activeSessionRef = useRef<string | null>(null);
  // Track what type of session is running for completion handling
  const sessionTypeRef = useRef<"analysis" | "plan" | "execution" | null>(null);
  // Track IDs for DB lookups on completion
  const sessionMetaRef = useRef<{
    repoFullName: string;
    issueNumber: number;
    analysisId?: string;
    planId?: string;
  } | null>(null);

  // Subscribe to worker events on mount
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function setup() {
      try {
        await ensureWorkerRunning();
      } catch (err) {
        console.warn("[useWorkerSession] failed to ensure worker:", err);
        return;
      }

      if (cancelled) return;

      const unlisten = await subscribeToWorkerEvents(handleWorkerEvent);
      if (cancelled) {
        unlisten();
        return;
      }
      unlistenRef.current = unlisten;
    }

    setup();

    return () => {
      cancelled = true;
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleWorkerEvent = useCallback((event: WorkerEvent) => {
    // Filter events to our active session
    if (event.session_id && activeSessionRef.current && event.session_id !== activeSessionRef.current) {
      return;
    }

    switch (event.type) {
      case "session_started":
        activeSessionRef.current = event.session_id ?? null;
        setState((prev) => ({
          ...prev,
          sessionId: event.session_id ?? null,
          loading: true,
          error: null,
        }));
        break;

      case "log":
        if (event.entry) {
          onLog(event.entry as ExecutionLogEntry);
        }
        break;

      case "session_update":
        if (event.step_order != null && event.status) {
          const status: StepExecutionStatus = {
            status: event.status as StepExecutionStatus["status"],
          };
          onStepUpdate(event.step_order, status);
        }
        break;

      case "ask_user":
        setState((prev) => ({
          ...prev,
          askUserPrompt: {
            sessionId: event.session_id!,
            promptId: event.prompt_id!,
            stepOrder: event.step_order ?? 0,
            question: event.question ?? "",
            options: event.options ?? [],
            allowMultiple: event.allow_multiple ?? false,
          },
        }));
        break;

      case "session_complete":
        handleSessionComplete();
        break;

      case "session_error":
        setState((prev) => ({
          ...prev,
          loading: false,
          error: event.error ?? "Unknown error",
        }));
        activeSessionRef.current = null;
        break;
    }
  }, [onLog, onStepUpdate]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSessionComplete = useCallback(async () => {
    const meta = sessionMetaRef.current;
    const type = sessionTypeRef.current;

    setState((prev) => ({
      ...prev,
      loading: false,
      error: null,
      askUserPrompt: null,
    }));
    activeSessionRef.current = null;

    if (!meta) return;

    // Re-read results from DB
    try {
      if (type === "analysis" || type === "plan") {
        const analysis = await getAnalysisForIssue(workspaceId, meta.repoFullName, meta.issueNumber);
        if (analysis) onAnalysisUpdate(analysis);
      }
      if (type === "plan") {
        const plan = await getPlanForIssue(workspaceId, meta.repoFullName, meta.issueNumber);
        if (plan) onPlanUpdate(plan);
      }
      if (type === "execution") {
        // Plan status is updated by worker; re-read to get final status
        const plan = await getPlanForIssue(workspaceId, meta.repoFullName, meta.issueNumber);
        if (plan) onPlanUpdate(plan);
      }
    } catch (err) {
      console.error("[useWorkerSession] error re-reading results:", err);
    }
  }, [workspaceId, onAnalysisUpdate, onPlanUpdate]);

  const doStartAnalysis = useCallback(
    async (
      analysisId: string,
      issue: GitHubIssue & { full_name: string },
    ) => {
      const config = buildSessionConfig();
      if (!config.default_provider || !config.default_model) {
        setState((prev) => ({ ...prev, error: "No default provider/model configured. Set one in Settings." }));
        return;
      }
      if (!config.default_api_key && !KEYLESS_PROVIDERS.has(config.default_provider)) {
        setState((prev) => ({ ...prev, error: `No API key configured for ${config.default_provider}. Add one in Settings.` }));
        return;
      }

      sessionTypeRef.current = "analysis";
      sessionMetaRef.current = {
        repoFullName: issue.full_name,
        issueNumber: issue.number,
        analysisId,
      };
      setState((prev) => ({ ...prev, loading: true, error: null, askUserPrompt: null }));

      await startSession({
        session_type: "analysis",
        workspace_id: workspaceId,
        repo_full_name: issue.full_name,
        issue_number: issue.number,
        issue_title: issue.title,
        issue_body: issue.body ?? null,
        issue_state: issue.state,
        issue_labels: issue.labels ?? [],
        config,
        analysis_id: analysisId,
      });
    },
    [workspaceId],
  );

  const doStartPlan = useCallback(
    async (
      planId: string,
      issue: GitHubIssue & { full_name: string },
      analysisResult: AnalysisResult,
      analysisId?: string,
    ) => {
      const config = buildSessionConfig();
      if (!config.default_provider || !config.default_model) {
        setState((prev) => ({ ...prev, error: "No default provider/model configured. Set one in Settings." }));
        return;
      }
      if (!config.default_api_key && !KEYLESS_PROVIDERS.has(config.default_provider)) {
        setState((prev) => ({ ...prev, error: `No API key configured for ${config.default_provider}. Add one in Settings.` }));
        return;
      }

      sessionTypeRef.current = "plan";
      sessionMetaRef.current = {
        repoFullName: issue.full_name,
        issueNumber: issue.number,
        analysisId,
        planId,
      };
      setState((prev) => ({ ...prev, loading: true, error: null, askUserPrompt: null }));

      await startSession({
        session_type: "plan",
        workspace_id: workspaceId,
        repo_full_name: issue.full_name,
        issue_number: issue.number,
        issue_title: issue.title,
        issue_body: issue.body ?? null,
        issue_state: issue.state,
        issue_labels: issue.labels ?? [],
        config,
        analysis_id: analysisId,
        plan_id: planId,
        analysis_result: analysisResult,
      });
    },
    [workspaceId],
  );

  const doStartExecution = useCallback(
    async (
      planId: string,
      issue: GitHubIssue & { full_name: string },
      planResult: ExecutionPlanResult,
      analysisId?: string,
    ) => {
      const config = buildSessionConfig();
      if (!config.exec_api_key && !KEYLESS_PROVIDERS.has(config.exec_provider)) {
        setState((prev) => ({ ...prev, error: `No API key configured for exec provider ${config.exec_provider}. Add one in Settings.` }));
        return;
      }

      sessionTypeRef.current = "execution";
      sessionMetaRef.current = {
        repoFullName: issue.full_name,
        issueNumber: issue.number,
        analysisId,
        planId,
      };
      setState((prev) => ({ ...prev, loading: true, error: null, askUserPrompt: null }));

      await startSession({
        session_type: "execution",
        workspace_id: workspaceId,
        repo_full_name: issue.full_name,
        issue_number: issue.number,
        issue_title: issue.title,
        issue_body: issue.body ?? null,
        issue_state: issue.state,
        issue_labels: issue.labels ?? [],
        config,
        analysis_id: analysisId,
        plan_id: planId,
        plan_result: planResult,
      });
    },
    [workspaceId],
  );

  const doCancel = useCallback(async () => {
    if (activeSessionRef.current) {
      await cancelSession(activeSessionRef.current);
      setState((prev) => ({ ...prev, loading: false, askUserPrompt: null }));
      activeSessionRef.current = null;
    }
  }, []);

  const doAnswerAskUser = useCallback(async (selected: string[]) => {
    const prompt = state.askUserPrompt;
    if (!prompt) return;
    await answerAskUser(prompt.sessionId, prompt.promptId, selected);
    setState((prev) => ({ ...prev, askUserPrompt: null }));
  }, [state.askUserPrompt]);

  return {
    ...state,
    startAnalysis: doStartAnalysis,
    startPlan: doStartPlan,
    startExecution: doStartExecution,
    cancel: doCancel,
    answerAskUser: doAnswerAskUser,
  };
}
