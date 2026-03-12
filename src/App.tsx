import { useState, useEffect } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { WorkspaceList } from "./components/WorkspaceList";
import { WorkspaceDetail } from "./components/WorkspaceDetail";
import { ErrorMessage } from "./components/ErrorMessage";
import "./App.css";

interface GitHubUser {
  login: string;
  id: number;
  avatar_url?: string;
  name?: string;
}

function App() {
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"workspaces" | "detail">("workspaces");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) {
      setUser({ login: "preview", id: 0 });
      return;
    }
    const stored = localStorage.getItem("github_user");
    if (stored) {
      try {
        setUser(JSON.parse(stored));
      } catch {
        localStorage.removeItem("github_user");
      }
    }
  }, []);

  // Resize window to match content: compact for sign-in, larger for workspaces
  useEffect(() => {
    if (!isTauri()) return;
    const size = user ? new LogicalSize(680, 560) : new LogicalSize(400, 280);
    getCurrentWindow()
      .setSize(size)
      .catch(() => {});
  }, [user]);

  async function handleGitHubLogin() {
    if (!isTauri()) {
      setError("Sign in requires the Sparky desktop app.");
      return;
    }
    setError(null);
    setLoading(true);

    try {
      const token = await invoke<string>("github_login_web");
      const userResult = await invoke<GitHubUser>("github_get_user", {
        accessToken: token,
      });
      setUser(userResult);
      localStorage.setItem("github_token", token);
      localStorage.setItem("github_user", JSON.stringify(userResult));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    setUser(null);
    localStorage.removeItem("github_token");
    localStorage.removeItem("github_user");
  }

  if (user) {
    return (
      <main className="container app-layout">
        <div className="app-content">
          <header className="app-header">
            <h1>Sparky</h1>
            <div className="user-card header-user">
              {user.avatar_url && (
                <img
                  src={user.avatar_url}
                  alt={user.login}
                  className="avatar"
                  width={32}
                  height={32}
                />
              )}
              <span className={`user-login ${user.login === "preview" ? "preview-badge" : ""}`}>
                @{user.login}
              </span>
              <button onClick={handleLogout} className="logout-btn">
                Log out
              </button>
            </div>
          </header>

          {view === "workspaces" ? (
            <WorkspaceList
              onSelectWorkspace={(id) => {
                setSelectedWorkspaceId(id);
                setView("detail");
              }}
            />
          ) : selectedWorkspaceId ? (
            <WorkspaceDetail
              workspaceId={selectedWorkspaceId}
              onBack={() => {
                setView("workspaces");
                setSelectedWorkspaceId(null);
              }}
              onDeleted={() => {
                setView("workspaces");
                setSelectedWorkspaceId(null);
              }}
            />
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <main className="container">
      <h1>Welcome to Sparky</h1>

      <div className="sign-in-content">
        {error && <ErrorMessage message={error} />}

        <button
          onClick={handleGitHubLogin}
          disabled={loading}
          className="github-btn"
          type="button"
        >
          <svg className="github-logo" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
          </svg>
          <span>{loading ? "Opening browser…" : "Sign in with GitHub"}</span>
        </button>
      </div>
    </main>
  );
}

export default App;
