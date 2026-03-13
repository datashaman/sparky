import { useState, useEffect, useRef } from "react";
import { getWorkspace, deleteWorkspace, updateWorkspaceName } from "../data/workspaces";
import {
  getOrCreateRepo,
  listReposForWorkspace,
} from "../data/repos";
import { addRepoToWorkspace, removeRepoFromWorkspace } from "../data/workspaceRepos";
import { fetchRepo, listUserRepos, listRepoOpenIssues, type GitHubRepo, type GitHubIssue } from "../github";
import { WorkspaceList } from "./WorkspaceList";
import { ErrorMessage } from "./ErrorMessage";
import type { Workspace, Repo } from "../data/types";

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
  const [workspaceNameInput, setWorkspaceNameInput] = useState("");
  const [savingWorkspace, setSavingWorkspace] = useState(false);
  const [workspaceSaveError, setWorkspaceSaveError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    load();
  }, [workspaceId]);

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
      const [ws, repoList] = await Promise.all([
        getWorkspace(workspaceId),
        listReposForWorkspace(workspaceId),
      ]);
      setWorkspace(ws ?? null);
      setWorkspaceNameInput(ws?.name ?? "");
      if (ws && onWorkspaceNameChange) {
        onWorkspaceNameChange(ws.name);
      }
      setRepos(repoList);
    } finally {
      setLoading(false);
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
            onClick={() => { setSelectedIssue(null); setPage("agents"); }}
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
            onClick={() => { setSelectedIssue(null); setPage("skills"); }}
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
                <p className="issue-detail-meta">
                  <a href={selectedIssue.html_url} target="_blank" rel="noopener noreferrer">
                    {selectedIssue.full_name}#{selectedIssue.number}
                  </a>
                  {selectedIssue.state && ` · ${selectedIssue.state}`}
                </p>
              </div>
              {selectedIssue.body ? (
                <div className="issue-detail-body">{selectedIssue.body}</div>
              ) : (
                <p className="empty-state">No description.</p>
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
                <div className="metric-card">
                  <span className="metric-value">{repos.length}</span>
                  <span className="metric-label">Repos</span>
                </div>
                <div className="metric-card">
                  <span className="metric-value">—</span>
                  <span className="metric-label">Issues</span>
                </div>
                <div className="metric-card">
                  <span className="metric-value">—</span>
                  <span className="metric-label">Agents</span>
                </div>
              </div>
              <section className="dashboard-recent">
                <h3>Recent events</h3>
                <p className="empty-state">No recent events.</p>
              </section>
            </div>
          ) : page === "agents" ? (
            <div className="workspace-page workspace-page-agents">
              <p className="empty-state">Agents page — coming soon.</p>
            </div>
          ) : page === "skills" ? (
            <div className="workspace-page workspace-page-skills">
              <p className="empty-state">Skills page — coming soon.</p>
            </div>
          ) : page === "settings" ? (
            <div className="workspace-page workspace-page-settings">
      <section className="workspace-settings-section">
        <h3>Workspace details</h3>
        <div className="workspace-settings-form">
          <div className="form-row">
            <label htmlFor="workspace-name">Name</label>
            <input
              id="workspace-name"
              type="text"
              value={workspaceNameInput}
              onChange={(e) => setWorkspaceNameInput(e.target.value)}
              placeholder="Workspace name"
              autoComplete="off"
            />
          </div>
          {workspaceSaveError && <ErrorMessage message={workspaceSaveError} />}
          {savingWorkspace && !workspaceSaveError && (
            <p className="workspace-settings-status">Saving…</p>
          )}
        </div>
      </section>

      <div className="add-repo-section">
        <h3>Add repo</h3>
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
          <div className="add-repo-row">
            <input
              ref={inputRef}
              type="text"
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
              className="add-repo-input"
              id="add-repo-input"
            />
            <button type="button" onClick={(e) => { e.preventDefault(); handleAddRepo(); }} disabled={adding}>
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
      </div>

      <div className="repo-list-section">
        <h3>Repos ({repos.length})</h3>
        {repos.length === 0 ? (
          <p className="empty-state">No repos yet. Add one above.</p>
        ) : (
          <ul className="repo-list">
            {repos.map((repo) => (
              <li key={repo.id} className="repo-item">
                <a
                  href={repo.url ?? `https://github.com/${repo.full_name}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="repo-link"
                >
                  {repo.full_name}
                </a>
                <button
                  onClick={() => handleRemoveRepo(repo.id)}
                  className="remove-repo-btn"
                  title="Remove from workspace"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <section className={`settings-danger-zone ${confirmingDelete ? "settings-danger-zone-confirming" : ""}`}>
        <h3>Danger Zone</h3>
        <div className="danger-zone-content">
          <p className="danger-zone-desc">
            {confirmingDelete
              ? `Really delete workspace "${workspace.name}"? This cannot be undone.`
              : "Permanently delete this workspace and remove all associated data. This action cannot be undone."}
          </p>
          <button
            type="button"
            onClick={handleDeleteWorkspace}
            className="delete-workspace-btn"
          >
            {confirmingDelete ? "Confirm delete" : "Delete workspace"}
          </button>
          {confirmingDelete && (
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
            >
              Cancel
            </button>
          )}
        </div>
      </section>
          </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
