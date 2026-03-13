import { useState, useEffect } from "react";
import { listWorkspaces, createWorkspace, deleteWorkspace } from "../data/workspaces";
import { ErrorMessage } from "./ErrorMessage";
import type { Workspace } from "../data/types";

interface Props {
  onSelectWorkspace: (id: string) => void;
}

export function WorkspaceList({ onSelectWorkspace }: Props) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      await createWorkspace(newName.trim());
      setNewName("");
      await load();
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

    // First click: arm delete for this workspace only
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

  return (
    <div className="workspace-list">
      <h2>Workspaces</h2>
      <form onSubmit={handleCreate} className="create-workspace">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New workspace name"
          disabled={creating}
        />
        <button type="submit" disabled={creating || !newName.trim()}>
          {creating ? "Creating…" : "Create workspace"}
        </button>
      </form>
      {workspaces.length === 0 ? (
        <p className="empty">No workspaces yet. Create one above.</p>
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
              <span className="workspace-name">{w.name}</span>
              <button
                type="button"
                className="workspace-delete"
                onClick={(e) => handleDelete(w.id, e)}
                aria-label={confirmingDeleteId === w.id ? `Confirm delete ${w.name}` : `Delete ${w.name}`}
              >
                {confirmingDeleteId === w.id ? "!" : "×"}
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
  );
}
