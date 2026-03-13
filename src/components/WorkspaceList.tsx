import { useState, useEffect, useRef } from "react";
import { listWorkspaces, createWorkspace, deleteWorkspace } from "../data/workspaces";
import { getOrCreateRepo } from "../data/repos";
import { addRepoToWorkspace } from "../data/workspaceRepos";
import { listUserRepos, type GitHubRepo } from "../github";
import { ErrorMessage } from "./ErrorMessage";
import type { Workspace } from "../data/types";

interface Props {
  onSelectWorkspace: (id: string) => void;
  createDrawerOpen?: boolean;
  onCloseCreateDrawer?: () => void;
  onReady?: () => void;
}

export function WorkspaceList({ onSelectWorkspace, createDrawerOpen = false, onCloseCreateDrawer, onReady }: Props) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const [selectedRepos, setSelectedRepos] = useState<GitHubRepo[]>([]);
  const [userRepos, setUserRepos] = useState<GitHubRepo[] | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [repoFilter, setRepoFilter] = useState("");

  const nameTaken = newName.trim().length > 0 &&
    workspaces.some((w) => w.name.toLowerCase() === newName.trim().toLowerCase());
  const selectedFullNames = new Set(selectedRepos.map((r) => r.full_name));
  const filteredRepos = (userRepos ?? []).filter((r) =>
    r.full_name.toLowerCase().includes(repoFilter.trim().toLowerCase())
  );

  const initialLoad = useRef(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const list = await listWorkspaces();
      setWorkspaces(list);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Signal ready after first render with content
  useEffect(() => {
    if (!loading && initialLoad.current) {
      initialLoad.current = false;
      // Short delay so the DOM has laid out (rAF won't fire for hidden windows)
      setTimeout(() => onReady?.(), 50);
    }
  }, [loading]);

  /* Load repos when create drawer opens (repos are required) */
  useEffect(() => {
    if (createDrawerOpen) loadUserRepos();
  }, [createDrawerOpen]);

  /* Prevent window scroll when drawer is open */
  useEffect(() => {
    if (createDrawerOpen) {
      const prevHtml = document.documentElement.style.overflow;
      const prevBody = document.body.style.overflow;
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
      return () => {
        document.documentElement.style.overflow = prevHtml;
        document.body.style.overflow = prevBody;
      };
    }
  }, [createDrawerOpen]);

  async function loadUserRepos() {
    if (userRepos !== null) return;
    setLoadingRepos(true);
    setAddError(null);
    try {
      const list = await listUserRepos();
      setUserRepos(list);
    } catch (e) {
      setAddError(String(e));
    } finally {
      setLoadingRepos(false);
    }
  }

  function toggleRepo(gh: GitHubRepo) {
    setSelectedRepos((prev) => {
      const has = prev.some((r) => r.full_name === gh.full_name);
      if (has) return prev.filter((r) => r.full_name !== gh.full_name);
      return [...prev, gh];
    });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || creating) return;
    setCreating(true);
    setError(null);
    setAddError(null);
    try {
      const workspace = await createWorkspace(newName.trim());
      for (const gh of selectedRepos) {
        const repo = await getOrCreateRepo(
          gh.full_name,
          gh.owner.login,
          gh.name,
          gh.clone_url ?? gh.html_url
        );
        await addRepoToWorkspace(workspace.id, repo.id);
      }
      setNewName("");
      setSelectedRepos([]);
      await load();
      onCloseCreateDrawer?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  }

  function handleKeyDown(w: Workspace, e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelectWorkspace(w.id);
    }
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();

    if (confirmingDeleteId !== id) {
      setConfirmingDeleteId(id);
      return;
    }

    setError(null);
    try {
      await deleteWorkspace(id);
      setConfirmingDeleteId(null);
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  if (loading) return <p className="loading">Loading workspaces…</p>;
  if (error) return <ErrorMessage message={error} />;

  // Stable color for workspace icon based on name
  function workspaceColor(name: string): string {
    const colors = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ef4444", "#14b8a6"];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  return (
    <div className="workspace-list">
      {/* Primary: select existing workspace (scrolls) */}
      <div className="workspace-list-scroll">
        {workspaces.length === 0 ? (
          <div className="workspace-empty-state">
            <div className="workspace-empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="18" rx="2" />
                <path d="M8 7h8M8 11h5" />
              </svg>
            </div>
            <p className="workspace-empty-title">No workspaces yet</p>
            <p className="workspace-empty-hint">Create a workspace to organize your repos and start tracking issues.</p>
          </div>
        ) : (
          <ul className="workspace-items">
          {workspaces.map((w) => (
            <li
              key={w.id}
              className={`workspace-item ${confirmingDeleteId === w.id ? "workspace-item-confirming-delete" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => onSelectWorkspace(w.id)}
              onKeyDown={(e) => handleKeyDown(w, e)}
              aria-label={`Open ${w.name}`}
            >
              <span className="workspace-item-icon" style={{ background: workspaceColor(w.name) }}>
                {w.name.charAt(0).toUpperCase()}
              </span>
              <span className="workspace-item-info">
                <span className="workspace-name">{w.name}</span>
                <span className="workspace-meta">
                  {w.repo_count != null && w.repo_count > 0
                    ? `${w.repo_count} repo${w.repo_count === 1 ? "" : "s"}`
                    : "No repos"}
                  {" \u00b7 "}
                  {formatDate(w.created_at)}
                </span>
              </span>
              <button
                type="button"
                className="workspace-delete"
                onClick={(e) => handleDelete(w.id, e)}
                aria-label={confirmingDeleteId === w.id ? `Confirm delete ${w.name}` : `Delete ${w.name}`}
              >
                {confirmingDeleteId === w.id ? "!" : "\u00d7"}
              </button>
              {confirmingDeleteId === w.id && (
                <button
                  type="button"
                  className="workspace-delete-cancel"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmingDeleteId(null);
                  }}
                >
                  Cancel
                </button>
              )}
            </li>
          ))}
        </ul>
        )}
      </div>
      {/* Create workspace: slide-out drawer from right */}
      <div
        className={`create-workspace-drawer ${createDrawerOpen ? "create-workspace-drawer-open" : ""}`}
        aria-hidden={!createDrawerOpen}
      >
        <div className="create-workspace-drawer-backdrop" onClick={onCloseCreateDrawer} />
        <div className="create-workspace-drawer-panel">
          <div className="create-workspace-drawer-header">
            <h3>New workspace</h3>
            <button
              type="button"
              className="create-workspace-drawer-close"
              onClick={onCloseCreateDrawer}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <form
            onSubmit={handleCreate}
            className="create-workspace create-workspace-form"
            autoComplete="off"
            onFocusCapture={() => {
              if (userRepos === null) loadUserRepos();
            }}
          >
            <div className="create-workspace-body">
            <div className="create-workspace-field">
              <label htmlFor="create-workspace-name">Name</label>
              <input
                id="create-workspace-name"
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. My workspace"
                disabled={creating}
              />
            </div>
            <div className="create-workspace-field create-workspace-repos">
              <div className="create-workspace-repos-panel">
                {loadingRepos ? (
                  <p className="create-workspace-repos-loading">Loading your repos…</p>
                ) : addError ? (
                  <ErrorMessage message={addError} />
                ) : (
                  <>
                    <input
                      type="text"
                      className="create-workspace-repos-filter create-workspace-repos-filter-sticky"
                      value={repoFilter}
                      onChange={(e) => setRepoFilter(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
                      placeholder="Filter repos…"
                      autoComplete="new-password"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      data-lpignore="true"
                      data-form-type="other"
                      role="searchbox"
                      aria-label="Filter repos"
                    />
                    {filteredRepos.length === 0 ? (
                      <p className="create-workspace-repos-empty">No repos match</p>
                    ) : (
                      <ul className="create-workspace-repos-list">
                        {filteredRepos.map((gh) => (
                          <li
                            key={gh.id}
                            className={`create-workspace-repos-item ${selectedFullNames.has(gh.full_name) ? "create-workspace-repos-item-selected" : ""}`}
                          >
                            <label>
                              <input
                                type="checkbox"
                                checked={selectedFullNames.has(gh.full_name)}
                                onChange={() => toggleRepo(gh)}
                                disabled={creating}
                              />
                              <span>{gh.full_name}</span>
                              {gh.private && (
                                <span className="add-repo-private-badge" title="Private">
                                  🔒
                                </span>
                              )}
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            </div>
            </div>
            <div className="create-workspace-actions">
              {nameTaken && <p className="create-workspace-name-taken">A workspace with this name already exists</p>}
              <button
                type="submit"
                className="create-workspace-submit"
                disabled={creating || !newName.trim() || nameTaken || selectedRepos.length === 0}
                title={nameTaken ? "Name already taken" : creating || newName.trim() && selectedRepos.length > 0 ? undefined : "Name and at least one repo required"}
              >
                {creating ? "Creating…" : "Create"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
