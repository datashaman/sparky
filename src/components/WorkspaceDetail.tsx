import { useState, useEffect, useRef } from "react";
import { getWorkspace, deleteWorkspace } from "../data/workspaces";
import {
  getOrCreateRepo,
  listReposForWorkspace,
} from "../data/repos";
import { addRepoToWorkspace, removeRepoFromWorkspace } from "../data/workspaceRepos";
import { fetchRepo, listUserRepos, type GitHubRepo } from "../github";
import { ErrorMessage } from "./ErrorMessage";
import type { Workspace, Repo } from "../data/types";

interface WorkspaceDetailProps {
  workspaceId: string;
  onBack: () => void;
  onDeleted: () => void;
}

export function WorkspaceDetail({ workspaceId, onBack, onDeleted }: WorkspaceDetailProps) {
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

  async function load() {
    setLoading(true);
    try {
      const [ws, repoList] = await Promise.all([
        getWorkspace(workspaceId),
        listReposForWorkspace(workspaceId),
      ]);
      setWorkspace(ws ?? null);
      setRepos(repoList);
    } finally {
      setLoading(false);
    }
  }

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
    if (!workspace || !confirm(`Delete workspace "${workspace.name}"?`)) return;
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

  if (loading) {
    return <p className="loading">Loading…</p>;
  }

  if (!workspace) {
    return (
      <div>
        <ErrorMessage message="Workspace not found." />
        <button onClick={onBack}>Back to workspaces</button>
      </div>
    );
  }

  return (
    <div className="workspace-detail">
      <div className="workspace-detail-header">
        <button onClick={onBack} className="back-btn">
          ← Back
        </button>
        <h1>{workspace.name}</h1>
        <button onClick={handleDeleteWorkspace} className="delete-workspace-btn">
          Delete workspace
        </button>
      </div>

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
    </div>
  );
}
