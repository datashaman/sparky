import { useState, useEffect, useRef } from "react";
import { getWorkspace, deleteWorkspace, updateWorkspaceName } from "../data/workspaces";
import {
  getOrCreateRepo,
  listReposForWorkspace,
} from "../data/repos";
import { addRepoToWorkspace, removeRepoFromWorkspace } from "../data/workspaceRepos";
import { fetchRepo, listUserRepos, listRepoOpenIssues, type GitHubRepo, type GitHubIssue } from "../github";
import { listAgentsForWorkspace, deleteAgent } from "../data/agents";
import { listSkillsForWorkspace, deleteSkill } from "../data/skills";
import { getAnalysisForIssue, createAnalysis, deleteAnalysesForIssue } from "../data/issueAnalyses";
import { getPlanForIssue, createPlan, deletePlansForIssue } from "../data/executionPlans";
import { getWorktreeForIssue, removeWorktree } from "../data/issueWorktrees";
import { runAnalysis } from "../data/analyseIssue";
import { runPlanGeneration } from "../data/generatePlan";
import type { IssueAnalysis, AnalysisResult, ExecutionPlan, ExecutionPlanResult, IssueWorktree, StepExecutionStatus } from "../data/types";
import { executePlan } from "../data/executePlan";
import { marked } from "marked";
import { AnalysisView } from "./AnalysisView";
import { PlanView } from "./PlanView";
import { SkillDetail } from "./SkillDetail";
import { AgentDetail } from "./AgentDetail";

marked.setOptions({ gfm: true, breaks: true });
import { WorkspaceList } from "./WorkspaceList";
import { AgentsList } from "./AgentsList";
import { SkillsList } from "./SkillsList";
import { ErrorMessage } from "./ErrorMessage";
import type { Workspace, Repo } from "../data/types";

/** Returns black or white text depending on background luminance. */
function labelTextColor(hex: string): string {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#24292f" : "#fff";
}

interface WorkspaceDetailProps {
  workspaceId: string;
  onSwitchWorkspace: (id: string) => void;
  onDeleted: () => void;
  onWorkspaceNameChange?: (name: string) => void;
  /** When in multi-window mode: go back to the workspaces list window. */
  onBackToWorkspaces?: () => void;
}

type WorkspacePage = "workspaces" | "dashboard" | "agents" | "skills" | "issues" | "settings";

const TOOLBAR_COMPACT_KEY = "sparky_toolbar_compact";

export function WorkspaceDetail({ workspaceId, onSwitchWorkspace, onDeleted, onWorkspaceNameChange, onBackToWorkspaces }: WorkspaceDetailProps) {
  const [page, setPage] = useState<WorkspacePage>("dashboard");
  const [toolbarCompact, setToolbarCompact] = useState(() => {
    try {
      const stored = localStorage.getItem(TOOLBAR_COMPACT_KEY);
      return stored === null ? true : stored === "true";
    } catch {
      return true;
    }
  });
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [addRepoInput, setAddRepoInput] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [userRepos, setUserRepos] = useState<GitHubRepo[] | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [autocompleteOpen, setAutocompleteOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const issuesPanelCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const issuesPanelOpenDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ISSUES_PANEL_OPEN_DELAY_MS = 600;

  const [issuesPanelOpen, setIssuesPanelOpen] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<(GitHubIssue & { full_name: string }) | null>(null);
  const [issuesByRepo, setIssuesByRepo] = useState<Array<{ full_name: string; issues: GitHubIssue[] }>>([]);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [issuesError, setIssuesError] = useState<string | null>(null);
  const [agentCount, setAgentCount] = useState(0);
  const [skillCount, setSkillCount] = useState(0);
  const [workspaceNameInput, setWorkspaceNameInput] = useState("");
  const [savingWorkspace, setSavingWorkspace] = useState(false);
  const [workspaceSaveError, setWorkspaceSaveError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [analysis, setAnalysis] = useState<IssueAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [issueTab, setIssueTab] = useState<"issue" | "analysis" | "plan">("issue");
  const [plan, setPlan] = useState<ExecutionPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [allCreated, setAllCreated] = useState(false);
  const [_worktree, setWorktree] = useState<IssueWorktree | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [stepStatuses, setStepStatuses] = useState<Map<number, StepExecutionStatus>>(new Map());
  const [executionError, setExecutionError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, [workspaceId]);

  // Load existing analysis when an issue is selected
  useEffect(() => {
    if (!selectedIssue) {
      setAnalysis(null);
      setPlan(null);
      setWorktree(null);
      setAllCreated(false);
      setIssueTab("issue");
      return;
    }
    let cancelled = false;
    setAnalysisLoading(true);
    setPlanLoading(true);
    Promise.all([
      getAnalysisForIssue(workspaceId, selectedIssue.full_name, selectedIssue.number),
      getPlanForIssue(workspaceId, selectedIssue.full_name, selectedIssue.number),
      getWorktreeForIssue(workspaceId, selectedIssue.full_name, selectedIssue.number),
    ])
      .then(([a, p, wt]) => {
        if (cancelled) return;
        setAnalysis(a);
        setPlan(p);
        setWorktree(wt);
      })
      .catch(() => {
        if (cancelled) return;
        setAnalysis(null);
        setPlan(null);
        setWorktree(null);
      })
      .finally(() => {
        if (cancelled) return;
        setAnalysisLoading(false);
        setPlanLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedIssue, workspaceId]);

  const query = addRepoInput.trim().toLowerCase();
  const workspaceFullNames = new Set(repos.map((r) => r.full_name));
  const suggestions = (userRepos ?? [])
    .filter(
      (r) =>
        !workspaceFullNames.has(r.full_name) &&
        r.full_name.toLowerCase().includes(query)
    )
    .slice(0, 20);

  useEffect(() => {
    if (autocompleteOpen && suggestions.length > 0 && dropdownRef.current) {
      const el = dropdownRef.current.querySelector(
        `[id="add-repo-option-${suggestions[highlightedIndex]?.id}"]`
      );
      el?.scrollIntoView({ block: "nearest", behavior: "auto" });
    }
  }, [autocompleteOpen, suggestions, highlightedIndex]);

  /* Prefetch issues when workspace repos are loaded so the hover panel opens instantly */
  useEffect(() => {
    if (repos.length === 0) {
      setIssuesByRepo([]);
      setIssuesLoading(false);
      setIssuesError(null);
      return;
    }
    let cancelled = false;
    setIssuesLoading(true);
    setIssuesError(null);
    Promise.all(
      repos.map(async (repo) => {
        const fullName = repo.full_name || `${repo.owner}/${repo.name}`;
        try {
          const issues = await listRepoOpenIssues(fullName);
          return { full_name: fullName, issues, error: null as string | null };
        } catch (e) {
          return { full_name: fullName, issues: [] as GitHubIssue[], error: String(e) };
        }
      })
    )
      .then((results) => {
        if (cancelled) return;
        const firstError = results.find((r) => r.error)?.error ?? null;
        if (firstError) setIssuesError(firstError);
        setIssuesByRepo(results.filter((g) => g.issues.length > 0).map(({ full_name, issues }) => ({ full_name, issues })));
      })
      .catch((e) => {
        if (!cancelled) setIssuesError(String(e));
      })
      .finally(() => {
        if (!cancelled) setIssuesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repos]);

  async function load() {
    setLoading(true);
    try {
      const [ws, repoList, agents, skills] = await Promise.all([
        getWorkspace(workspaceId),
        listReposForWorkspace(workspaceId),
        listAgentsForWorkspace(workspaceId),
        listSkillsForWorkspace(workspaceId),
      ]);
      setWorkspace(ws ?? null);
      setWorkspaceNameInput(ws?.name ?? "");
      if (ws && onWorkspaceNameChange) {
        onWorkspaceNameChange(ws.name);
      }
      setRepos(repoList);
      setAgentCount(agents.length);
      setSkillCount(skills.length);
    } finally {
      setLoading(false);
    }
  }

  async function triggerPlanGeneration() {
    if (!selectedIssue || !analysis?.result) return;
    setPlanLoading(true);
    try {
      const analysisResult: AnalysisResult = JSON.parse(analysis.result);
      const [agents, skills] = await Promise.all([
        listAgentsForWorkspace(workspaceId),
        listSkillsForWorkspace(workspaceId),
      ]);
      const p = await createPlan(workspaceId, selectedIssue.full_name, selectedIssue.number);
      setPlan(p);
      setIssueTab("plan");
      runPlanGeneration(p, selectedIssue, analysisResult, agents, skills, setPlan);
    } finally {
      setPlanLoading(false);
    }
  }

  // Debounce workspace name updates while typing
  useEffect(() => {
    if (!workspace) return;
    const trimmedName = workspaceNameInput.trim();
    if (!trimmedName || trimmedName === workspace.name) {
      return;
    }

    setWorkspaceSaveError(null);
    const timeoutId = setTimeout(async () => {
      setSavingWorkspace(true);
      try {
        const updated = await updateWorkspaceName(workspace.id, trimmedName);
        if (updated) {
          setWorkspace(updated);
          setWorkspaceNameInput(updated.name);
          if (onWorkspaceNameChange) {
            onWorkspaceNameChange(updated.name);
          }
        }
      } catch (err) {
        setWorkspaceSaveError(String(err));
      } finally {
        setSavingWorkspace(false);
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [workspaceNameInput, workspace]);

  async function handleAddRepo() {
    const input = addRepoInput.trim();
    if (!input) return;

    const match = input.match(/^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)$/);
    if (!match) {
      setAddError('Use format "owner/repo" (e.g. datashaman/sparky)');
      return;
    }

    const [, owner, name] = match;
    setAddError(null);
    setAdding(true);

    try {
      const githubRepo = await fetchRepo(owner, name);
      const repo = await getOrCreateRepo(
        githubRepo.full_name,
        githubRepo.owner.login,
        githubRepo.name,
        githubRepo.clone_url ?? githubRepo.html_url
      );
      await addRepoToWorkspace(workspaceId, repo.id);
      setAddRepoInput("");
      setRepos(await listReposForWorkspace(workspaceId));
    } catch (e) {
      setAddError(String(e));
    } finally {
      setAdding(false);
    }
  }

  async function handleRemoveRepo(repoId: string) {
    await removeRepoFromWorkspace(workspaceId, repoId);
    setRepos(await listReposForWorkspace(workspaceId));
  }

  async function handleDeleteWorkspace() {
    if (!workspace) return;

    // First click: show inline confirmation state instead of relying on window.confirm
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }

    await deleteWorkspace(workspaceId);
    onDeleted();
  }

  async function loadUserRepos() {
    if (userRepos !== null) {
      setAutocompleteOpen(true);
      return;
    }
    setLoadingRepos(true);
    try {
      const list = await listUserRepos();
      setUserRepos(list);
      setAutocompleteOpen(true);
    } catch (e) {
      setAddError(String(e));
      setAutocompleteOpen(false);
    } finally {
      setLoadingRepos(false);
    }
  }

  async function handleAddRepoFromSelection(gh: GitHubRepo) {
    setAddError(null);
    setAdding(true);
    setAutocompleteOpen(false);
    try {
      const repo = await getOrCreateRepo(
        gh.full_name,
        gh.owner.login,
        gh.name,
        gh.clone_url ?? gh.html_url
      );
      await addRepoToWorkspace(workspaceId, repo.id);
      setAddRepoInput("");
      setRepos(await listReposForWorkspace(workspaceId));
    } catch (e) {
      setAddError(String(e));
    } finally {
      setAdding(false);
    }
  }

  function onIssuesPanelAreaEnter() {
    if (issuesPanelCloseTimeoutRef.current) {
      clearTimeout(issuesPanelCloseTimeoutRef.current);
      issuesPanelCloseTimeoutRef.current = null;
    }
    if (issuesPanelOpen) return;
    if (issuesPanelOpenDelayRef.current) return;
    issuesPanelOpenDelayRef.current = setTimeout(() => {
      issuesPanelOpenDelayRef.current = null;
      setIssuesPanelOpen(true);
    }, ISSUES_PANEL_OPEN_DELAY_MS);
  }

  function onIssuesPanelAreaLeave() {
    if (issuesPanelOpenDelayRef.current) {
      clearTimeout(issuesPanelOpenDelayRef.current);
      issuesPanelOpenDelayRef.current = null;
    }
    issuesPanelCloseTimeoutRef.current = setTimeout(() => {
      issuesPanelCloseTimeoutRef.current = null;
      setIssuesPanelOpen(false);
    }, 200);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (autocompleteOpen && suggestions.length > 0 && highlightedIndex < suggestions.length) {
        handleAddRepoFromSelection(suggestions[highlightedIndex]);
      } else {
        handleAddRepo();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      setHighlightedIndex((i) => (i < suggestions.length - 1 ? i + 1 : i));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      setHighlightedIndex((i) => (i > 0 ? i - 1 : 0));
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setAutocompleteOpen(false);
    }
  }

  useEffect(() => {
    if (autocompleteOpen && suggestions.length > 0 && highlightedIndex < suggestions.length && dropdownRef.current) {
      const gh = suggestions[highlightedIndex];
      const el = dropdownRef.current.querySelector(`#add-repo-option-${gh?.id}`);
      (el as HTMLElement)?.scrollIntoView({ block: "nearest", behavior: "auto" });
    }
  }, [autocompleteOpen, highlightedIndex, suggestions]);

  function toggleToolbarMode() {
    const next = !toolbarCompact;
    setToolbarCompact(next);
    try {
      localStorage.setItem(TOOLBAR_COMPACT_KEY, String(next));
    } catch {
      /* ignore */
    }
  }

  if (loading) {
    return <p className="loading">Loading…</p>;
  }

  if (!workspace) {
    return (
      <div className="workspace-detail">
        <div className="workspace-detail-body">
          <nav className={`workspace-toolbar ${toolbarCompact ? "compact" : "expanded"}`} aria-label="Workspace navigation">
            <button type="button" className="workspace-toolbar-btn" onClick={() => { setSelectedIssue(null); onBackToWorkspaces ? onBackToWorkspaces() : setPage("workspaces"); }} title="All Workspaces">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect width="8" height="4" x="2" y="4" rx="1" />
                <path d="M10 4h12" />
                <rect width="8" height="4" x="2" y="12" rx="1" />
                <path d="M10 12h12" />
                <rect width="8" height="4" x="2" y="20" rx="1" />
                <path d="M10 20h12" />
              </svg>
              <span className="workspace-toolbar-label">All Workspaces</span>
            </button>
          </nav>
          <div className="workspace-detail-content">
            <ErrorMessage message="Workspace not found." />
            <WorkspaceList
              onSelectWorkspace={(id) => {
                onSwitchWorkspace(id);
                setPage("dashboard");
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-detail">
      <div className="workspace-detail-body">
        <nav
          className={`workspace-toolbar ${toolbarCompact ? "compact" : "expanded"}`}
          aria-label="Workspace navigation"
        >
          <button
            type="button"
            className={`workspace-toolbar-btn ${page === "workspaces" && !selectedIssue ? "active" : ""}`}
            onClick={() => { setSelectedIssue(null); onBackToWorkspaces ? onBackToWorkspaces() : setPage("workspaces"); }}
            title="All Workspaces"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect width="8" height="4" x="2" y="3" rx="1" />
              <path d="M10 3h12" />
              <rect width="8" height="4" x="2" y="11" rx="1" />
              <path d="M10 11h12" />
              <rect width="8" height="4" x="2" y="19" rx="1" />
              <path d="M10 19h12" />
            </svg>
            <span className="workspace-toolbar-label">All Workspaces</span>
          </button>
          <button
            type="button"
            className={`workspace-toolbar-btn ${page === "dashboard" && !selectedIssue ? "active" : ""}`}
            onClick={() => { setSelectedIssue(null); setPage("dashboard"); }}
            title="Dashboard"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect width="7" height="9" x="3" y="3" rx="1" />
              <rect width="7" height="5" x="14" y="3" rx="1" />
              <rect width="7" height="9" x="14" y="12" rx="1" />
              <rect width="7" height="5" x="3" y="16" rx="1" />
            </svg>
            <span className="workspace-toolbar-label">Dashboard</span>
          </button>
          <button
            type="button"
            className={`workspace-toolbar-btn ${issuesPanelOpen || selectedIssue ? "active" : ""}`}
            title="Issues"
            onMouseEnter={onIssuesPanelAreaEnter}
            onMouseLeave={onIssuesPanelAreaLeave}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4" />
              <path d="M12 16h.01" />
            </svg>
            <span className="workspace-toolbar-label">Issues</span>
          </button>
          <button
            type="button"
            className={`workspace-toolbar-btn ${page === "agents" && !selectedIssue ? "active" : ""}`}
            onClick={() => { setSelectedIssue(null); setSelectedAgentId(null); setPage("agents"); }}
            title="Agents"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 8V4H8" />
              <rect width="16" height="12" x="4" y="8" rx="2" />
              <path d="M2 14h2" />
              <path d="M20 14h2" />
              <path d="M15 13v2" />
              <path d="M9 13v2" />
            </svg>
            <span className="workspace-toolbar-label">Agents</span>
          </button>
          <button
            type="button"
            className={`workspace-toolbar-btn ${page === "skills" && !selectedIssue ? "active" : ""}`}
            onClick={() => { setSelectedIssue(null); setSelectedSkillId(null); setPage("skills"); }}
            title="Skills"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" />
              <path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" />
            </svg>
            <span className="workspace-toolbar-label">Skills</span>
          </button>
          <div className="workspace-toolbar-spacer" aria-hidden />
          <div className="workspace-toolbar-bottom">
            <button
              type="button"
              className={`workspace-toolbar-btn ${page === "settings" && !selectedIssue ? "active" : ""}`}
              onClick={() => { setSelectedIssue(null); setPage("settings"); }}
              title="Settings"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <span className="workspace-toolbar-label">Settings</span>
            </button>
          </div>
        </nav>

        <div
          className={`workspace-issues-panel ${issuesPanelOpen ? "open" : ""}`}
          onMouseEnter={onIssuesPanelAreaEnter}
          onMouseLeave={onIssuesPanelAreaLeave}
        >
          <div className="workspace-issues-panel-inner">
            {issuesLoading && <p className="empty-state">Loading…</p>}
            {issuesError && <p className="workspace-issues-panel-error">{issuesError}</p>}
            {!issuesLoading && !issuesError && issuesByRepo.length === 0 && (
              <p className="empty-state">No open issues.</p>
            )}
            {!issuesLoading && !issuesError && issuesByRepo.length > 0 && (
              <ul className="workspace-issues-list">
                {issuesByRepo.map(({ full_name, issues }) => (
                  <li key={full_name} className="workspace-issues-repo-group">
                    <span className="workspace-issues-repo-name">{full_name}</span>
                    <ul className="workspace-issues-repo-issues">
                      {issues.map((issue) => (
                        <li key={issue.id}>
                          <button
                            type="button"
                            className="workspace-issues-item"
                            onClick={() => {
                              setSelectedIssue({ ...issue, full_name });
                              setIssuesPanelOpen(false);
                            }}
                          >
                            <span className="workspace-issues-item-title">#{issue.number} {issue.title}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="workspace-sidebar-border">
          <button
            type="button"
            className="workspace-sidebar-toggle"
            onClick={toggleToolbarMode}
            title={toolbarCompact ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={toolbarCompact ? "Expand sidebar" : "Collapse sidebar"}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {toolbarCompact ? (
                <path d="m9 18 6-6-6-6" />
              ) : (
                <path d="m15 18-6-6 6-6" />
              )}
            </svg>
          </button>
        </div>

        <div className="workspace-detail-content">
          {selectedIssue ? (
            <div className="workspace-page workspace-page-issue">
              <div className="issue-detail-header">
                <h2 className="issue-detail-title">{selectedIssue.title}</h2>
                <div className="issue-detail-meta">
                  <span className={`issue-state-badge issue-state-${selectedIssue.state}`}>
                    {selectedIssue.state === "open" ? (
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"/></svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.28 6.78a.75.75 0 0 0-1.06-1.06L7.25 8.69 5.78 7.22a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l3.5-3.5Z"/><path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0Zm-1.5 0a6.5 6.5 0 1 0-13 0 6.5 6.5 0 0 0 13 0Z"/></svg>
                    )}
                    {selectedIssue.state}
                  </span>
                  <a href={selectedIssue.html_url} target="_blank" rel="noopener noreferrer" className="issue-detail-repo-link">
                    {selectedIssue.full_name}#{selectedIssue.number}
                  </a>
                  {selectedIssue.user && (
                    <span className="issue-detail-author">
                      opened by {selectedIssue.user.login}
                    </span>
                  )}
                </div>
                {selectedIssue.labels && selectedIssue.labels.length > 0 && (
                  <div className="issue-detail-labels">
                    {selectedIssue.labels.map((label) => (
                      <span
                        key={label.id}
                        className="issue-label"
                        style={{
                          background: `#${label.color}`,
                          color: labelTextColor(label.color),
                          borderColor: `#${label.color}`,
                        }}
                      >
                        {label.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="issue-tabs">
                <button
                  type="button"
                  className={`issue-tab ${issueTab === "issue" ? "issue-tab-active" : ""}`}
                  onClick={() => setIssueTab("issue")}
                >
                  Issue
                </button>
                <button
                  type="button"
                  className={`issue-tab ${issueTab === "analysis" ? "issue-tab-active" : ""}`}
                  onClick={() => {
                    setIssueTab("analysis");
                    if (!analysis && !analysisLoading) {
                      createAnalysis(workspaceId, selectedIssue.full_name, selectedIssue.number).then((a) => {
                        setAnalysis(a);
                        runAnalysis(a, selectedIssue, setAnalysis);
                      });
                    }
                  }}
                >
                  Analysis
                  {analysis && (
                    <span className={`issue-tab-dot issue-tab-dot-${analysis.status}`} />
                  )}
                </button>
                {(analysis?.status === "done" && (allCreated || plan)) && (
                  <button
                    type="button"
                    className={`issue-tab ${issueTab === "plan" ? "issue-tab-active" : ""}`}
                    onClick={() => {
                      setIssueTab("plan");
                      if (!plan && !planLoading) {
                        triggerPlanGeneration();
                      }
                    }}
                  >
                    Plan
                    {plan && (
                      <span className={`issue-tab-dot issue-tab-dot-${plan.status}`} />
                    )}
                  </button>
                )}
                {(analysis?.status === "done" || plan?.status === "done") && (
                  <div className="issue-tabs-actions">
                    {analysis?.status === "done" && (
                      <button
                        type="button"
                        className="analyse-btn analyse-btn-inline"
                        onClick={async () => {
                          const a = await createAnalysis(workspaceId, selectedIssue.full_name, selectedIssue.number);
                          setAnalysis(a);
                          setPlan(null);
                          setAllCreated(false);
                          setIssueTab("analysis");
                          runAnalysis(a, selectedIssue, setAnalysis);
                        }}
                      >
                        Re-analyse
                      </button>
                    )}
                    {plan?.status === "done" && (
                      <button
                        type="button"
                        className="analyse-btn analyse-btn-inline"
                        onClick={() => triggerPlanGeneration()}
                      >
                        Re-plan
                      </button>
                    )}
                    <button
                      type="button"
                      className="analyse-btn analyse-btn-inline analyse-btn-danger"
                      onClick={async () => {
                        const { full_name, number } = selectedIssue;
                        const wt = _worktree;
                        if (wt && wt.status === "ready") {
                          try { await removeWorktree(wt, setWorktree); } catch { /* best-effort */ }
                        }

                        // Delete skills and agents that were created from this analysis
                        if (analysis?.result) {
                          try {
                            const parsed: AnalysisResult = JSON.parse(analysis.result);
                            const recommendedSkillNames = new Set(parsed.skills.map((s) => s.name));
                            const recommendedAgentNames = new Set(parsed.agents.map((a) => a.name));
                            const [wsSkills, wsAgents] = await Promise.all([
                              listSkillsForWorkspace(workspaceId),
                              listAgentsForWorkspace(workspaceId),
                            ]);
                            await Promise.all([
                              ...wsSkills.filter((s) => recommendedSkillNames.has(s.name)).map((s) => deleteSkill(s.id)),
                              ...wsAgents.filter((a) => recommendedAgentNames.has(a.name)).map((a) => deleteAgent(a.id)),
                            ]);
                          } catch { /* best-effort */ }
                        }

                        await Promise.all([
                          deleteAnalysesForIssue(workspaceId, full_name, number),
                          deletePlansForIssue(workspaceId, full_name, number),
                        ]);
                        setAnalysis(null);
                        setPlan(null);
                        setWorktree(null);
                        setAllCreated(false);
                        setIssueTab("issue");
                      }}
                    >
                      Reset
                    </button>
                  </div>
                )}
              </div>
              {issueTab === "issue" ? (
                selectedIssue.body ? (
                  <div
                    className="issue-detail-body markdown-body"
                    dangerouslySetInnerHTML={{ __html: marked.parse(selectedIssue.body, { async: false }) as string }}
                  />
                ) : (
                  <p className="empty-state">No description.</p>
                )
              ) : issueTab === "analysis" ? (
                <div className="issue-analysis-tab">
                  {analysis?.status === "running" && (
                    <p className="analysis-running">Analysing...</p>
                  )}
                  {analysis?.status === "done" && analysis.result && (() => {
                    try {
                      const parsed: AnalysisResult = JSON.parse(analysis.result);
                      return <AnalysisView result={parsed} workspaceId={workspaceId} onAllCreated={() => setAllCreated(true)} />;
                    } catch {
                      return (
                        <div
                          className="analysis-result markdown-body"
                          dangerouslySetInnerHTML={{ __html: marked.parse(analysis.result, { async: false }) as string }}
                        />
                      );
                    }
                  })()}
                  {analysis?.status === "error" && (
                    <div className="analysis-error">
                      <p>{analysis.error}</p>
                      <button
                        type="button"
                        className="analyse-btn"
                        onClick={async () => {
                          const a = await createAnalysis(workspaceId, selectedIssue.full_name, selectedIssue.number);
                          setAnalysis(a);
                          runAnalysis(a, selectedIssue, setAnalysis);
                        }}
                      >
                        Retry
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="issue-plan-tab">
                  {(plan?.status === "pending" || plan?.status === "running") && (
                    <p className="analysis-running">Generating plan...</p>
                  )}
                  {plan?.status === "done" && plan.result && (() => {
                    try {
                      const parsed: ExecutionPlanResult = JSON.parse(plan.result);
                      return (
                        <PlanView
                          result={parsed}
                          stepStatuses={stepStatuses}
                          executing={executing}
                          executionError={executionError}
                          onExecute={() => {
                            if (executing || !selectedIssue) return;
                            setExecuting(true);
                            setStepStatuses(new Map());
                            setExecutionError(null);
                            executePlan({
                              planResult: parsed,
                              workspaceId,
                              issue: selectedIssue,
                              onStepUpdate: (order, status) => {
                                setStepStatuses((prev) => {
                                  const next = new Map(prev);
                                  next.set(order, status);
                                  return next;
                                });
                              },
                              onWorktreeUpdate: setWorktree,
                            })
                              .catch((e) => {
                                const msg = e instanceof Error ? e.message : String(e);
                                console.error("[execute] failed:", msg);
                                setExecutionError(msg);
                              })
                              .finally(() => setExecuting(false));
                          }}
                        />
                      );
                    } catch {
                      return <p className="empty-state">Failed to parse plan result.</p>;
                    }
                  })()}
                  {plan?.status === "error" && (
                    <div className="analysis-error">
                      <p>{plan.error}</p>
                      <button
                        type="button"
                        className="analyse-btn"
                        onClick={() => triggerPlanGeneration()}
                      >
                        Retry
                      </button>
                    </div>
                  )}
                  {!plan && (
                    <p className="empty-state">No plan generated yet.</p>
                  )}
                </div>
              )}
            </div>
          ) : page === "workspaces" ? (
            <div className="workspace-page workspace-page-workspaces">
              <WorkspaceList
                onSelectWorkspace={(id) => {
                  setSelectedIssue(null);
                  onSwitchWorkspace(id);
                  setPage("dashboard");
                }}
              />
            </div>
          ) : page === "dashboard" ? (
            <div className="workspace-page workspace-page-dashboard">
              <div className="dashboard-metrics">
                <div className="metric-card" onClick={() => setPage("settings")} role="button" tabIndex={0}>
                  <span className="metric-value">{repos.length}</span>
                  <span className="metric-label">Repos</span>
                </div>
                <div className="metric-card" role="button" tabIndex={0} onClick={() => { /* open issues panel */ onIssuesPanelAreaEnter(); }}>
                  <span className="metric-value">{issuesByRepo.reduce((sum, g) => sum + g.issues.length, 0)}</span>
                  <span className="metric-label">Open issues</span>
                </div>
                <div className="metric-card" onClick={() => setPage("agents")} role="button" tabIndex={0}>
                  <span className="metric-value">{agentCount}</span>
                  <span className="metric-label">Agents</span>
                </div>
                <div className="metric-card" onClick={() => setPage("skills")} role="button" tabIndex={0}>
                  <span className="metric-value">{skillCount}</span>
                  <span className="metric-label">Skills</span>
                </div>
              </div>

              {repos.length > 0 && (
                <section className="dashboard-section">
                  <h3>Repos</h3>
                  <ul className="dashboard-repo-list">
                    {repos.map((repo) => {
                      const repoIssues = issuesByRepo.find((g) => g.full_name === repo.full_name);
                      const issueCount = repoIssues?.issues.length ?? 0;
                      return (
                        <li key={repo.id} className="dashboard-repo-item">
                          <a
                            href={repo.url ?? `https://github.com/${repo.full_name}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="dashboard-repo-name"
                          >
                            {repo.full_name}
                          </a>
                          {issueCount > 0 && (
                            <span className="dashboard-repo-issues">{issueCount} open</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {issuesByRepo.length > 0 && (
                <section className="dashboard-section">
                  <h3>Recent issues</h3>
                  <ul className="dashboard-issues-list">
                    {issuesByRepo.flatMap(({ full_name, issues }) =>
                      issues.slice(0, 3).map((issue) => (
                        <li key={issue.id} className="dashboard-issue-item">
                          <button
                            type="button"
                            className="dashboard-issue-btn"
                            onClick={() => setSelectedIssue({ ...issue, full_name })}
                          >
                            <span className="dashboard-issue-number">#{issue.number}</span>
                            <span className="dashboard-issue-title">{issue.title}</span>
                            <span className="dashboard-issue-repo">{full_name}</span>
                          </button>
                        </li>
                      ))
                    ).slice(0, 10)}
                  </ul>
                </section>
              )}
            </div>
          ) : page === "agents" ? (
            <div className="workspace-page workspace-page-agents">
              {selectedAgentId ? (
                <AgentDetail
                  agentId={selectedAgentId}
                  workspaceId={workspaceId}
                  onBack={() => setSelectedAgentId(null)}
                  onDeleted={() => { setSelectedAgentId(null); load(); }}
                />
              ) : (
                <AgentsList workspaceId={workspaceId} onSelectAgent={setSelectedAgentId} />
              )}
            </div>
          ) : page === "skills" ? (
            <div className="workspace-page workspace-page-skills">
              {selectedSkillId ? (
                <SkillDetail
                  skillId={selectedSkillId}
                  onBack={() => setSelectedSkillId(null)}
                  onDeleted={() => { setSelectedSkillId(null); load(); }}
                />
              ) : (
                <SkillsList workspaceId={workspaceId} onSelectSkill={setSelectedSkillId} />
              )}
            </div>
          ) : page === "settings" ? (
            <div className="workspace-page workspace-page-settings">
      <section className="settings-card">
        <h3 className="settings-card-title">General</h3>
        <div className="settings-card-body">
          <div className="settings-field">
            <label htmlFor="workspace-name" className="settings-label">Name</label>
            <input
              id="workspace-name"
              type="text"
              className="settings-input"
              value={workspaceNameInput}
              onChange={(e) => setWorkspaceNameInput(e.target.value)}
              placeholder="Workspace name"
              autoComplete="off"
            />
            {savingWorkspace && !workspaceSaveError && (
              <span className="settings-saving">Saving…</span>
            )}
          </div>
          {workspaceSaveError && <ErrorMessage message={workspaceSaveError} />}
        </div>
      </section>

      <section className="settings-card">
        <h3 className="settings-card-title">Repos</h3>
        <div className="settings-card-body">
          <form
            className="add-repo-autocomplete"
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault();
              if (autocompleteOpen && suggestions.length > 0 && highlightedIndex < suggestions.length) {
                handleAddRepoFromSelection(suggestions[highlightedIndex]);
              } else {
                handleAddRepo();
              }
            }}
          >
            <div className="settings-add-repo-row">
              <input
                ref={inputRef}
                type="text"
                className="settings-input"
                value={addRepoInput}
                onChange={(e) => {
                  setAddRepoInput(e.target.value);
                  setAutocompleteOpen(true);
                  setHighlightedIndex(0);
                }}
                onFocus={() => loadUserRepos()}
                onKeyDown={handleKeyDown}
                onBlur={() => setTimeout(() => setAutocompleteOpen(false), 150)}
                disabled={adding}
                placeholder="Search or type owner/repo…"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={autocompleteOpen}
                aria-controls="add-repo-listbox"
                aria-activedescendant={
                  suggestions.length > 0 && highlightedIndex < suggestions.length
                    ? `add-repo-option-${suggestions[highlightedIndex].id}`
                    : undefined
                }
                id="add-repo-input"
              />
              <button type="button" className="settings-add-btn" onClick={(e) => { e.preventDefault(); handleAddRepo(); }} disabled={adding}>
                {adding ? "Adding…" : "Add"}
              </button>
            </div>
            {autocompleteOpen && (
              <div
                ref={dropdownRef}
                className="add-repo-dropdown"
                role="listbox"
                id="add-repo-listbox"
                aria-labelledby="add-repo-input"
              >
                {loadingRepos ? (
                  <div className="add-repo-dropdown-item add-repo-dropdown-loading">
                    Loading your repos…
                  </div>
                ) : suggestions.length === 0 ? (
                  <div className="add-repo-dropdown-item add-repo-dropdown-empty">
                    {userRepos?.length === 0
                      ? "No repos found"
                      : query
                        ? "No matching repos"
                        : "Type to search your repos"}
                  </div>
                ) : (
                  suggestions.map((gh, i) => (
                    <div
                      key={gh.id}
                      id={`add-repo-option-${gh.id}`}
                      role="option"
                      aria-selected={i === highlightedIndex}
                      className={`add-repo-dropdown-item ${i === highlightedIndex ? "highlighted" : ""}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleAddRepoFromSelection(gh);
                      }}
                    >
                      {gh.full_name}
                      {gh.private && (
                        <span className="add-repo-private-badge" title="Private">🔒</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
            {addError && <ErrorMessage message={addError} />}
          </form>

          {repos.length === 0 ? (
            <p className="empty-state">No repos yet.</p>
          ) : (
            <ul className="settings-repo-list">
              {repos.map((repo) => (
                <li key={repo.id} className="settings-repo-item">
                  <a
                    href={repo.url ?? `https://github.com/${repo.full_name}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="settings-repo-name"
                  >
                    {repo.full_name}
                  </a>
                  <button
                    onClick={() => handleRemoveRepo(repo.id)}
                    className="settings-repo-remove"
                    title="Remove from workspace"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className={`settings-card settings-card-danger ${confirmingDelete ? "settings-card-danger-confirming" : ""}`}>
        <h3 className="settings-card-title">Danger zone</h3>
        <div className="settings-card-body">
          <div className="settings-danger-row">
            <p className="settings-danger-desc">
              {confirmingDelete
                ? `Really delete "${workspace.name}"? This cannot be undone.`
                : "Permanently delete this workspace and all associated data."}
            </p>
            <div className="settings-danger-actions">
              <button
                type="button"
                onClick={handleDeleteWorkspace}
                className="settings-danger-btn"
              >
                {confirmingDelete ? "Confirm delete" : "Delete workspace"}
              </button>
              {confirmingDelete && (
                <button
                  type="button"
                  className="settings-danger-cancel"
                  onClick={() => setConfirmingDelete(false)}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
          </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
