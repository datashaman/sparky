import { useState, useEffect, useRef } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  getCurrentWindow,
  LogicalSize,
  LogicalPosition,
} from "@tauri-apps/api/window";
import { getWorkspace } from "./data/workspaces";
import { WorkspaceList } from "./components/WorkspaceList";
import { WorkspaceDetail } from "./components/WorkspaceDetail";
import { ErrorMessage } from "./components/ErrorMessage";
import "./App.css";

const DETAIL_WINDOW_STATE_KEY = "sparky_detail_window_state";

interface DetailWindowState {
  width: number;
  height: number;
  x: number;
  y: number;
  maximized: boolean;
  fullscreen: boolean;
}

interface GitHubUser {
  login: string;
  id: number;
  avatar_url?: string;
  name?: string;
}

function getStoredDetailWindowState(): DetailWindowState | null {
  try {
    const raw = localStorage.getItem(DETAIL_WINDOW_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DetailWindowState;
    if (
      typeof parsed.width !== "number" ||
      typeof parsed.height !== "number" ||
      typeof parsed.x !== "number" ||
      typeof parsed.y !== "number" ||
      typeof parsed.maximized !== "boolean" ||
      typeof parsed.fullscreen !== "boolean"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function storeDetailWindowState(state: DetailWindowState): void {
  try {
    localStorage.setItem(DETAIL_WINDOW_STATE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

function App() {
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"workspaces" | "detail">("workspaces");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

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

  const fullSize = { width: 680, height: 560 };
  const signInSize = { width: 400, height: 280 };

  // Window size: sign-in compact; list view full; detail view restore saved or default
  useEffect(() => {
    if (!isTauri()) return;
    const win = getCurrentWindow();

    if (!user) {
      win.setSize(new LogicalSize(signInSize.width, signInSize.height)).catch(() => {});
      return;
    }

    if (view === "workspaces") {
      win.setSize(new LogicalSize(fullSize.width, fullSize.height)).catch(() => {});
      return;
    }

    if (view === "detail") {
      let cancelled = false;
      (async () => {
        const saved = getStoredDetailWindowState();
        if (cancelled) return;
        if (saved) {
          await win.setSize(new LogicalSize(saved.width, saved.height)).catch(() => {});
          await win.setPosition(new LogicalPosition(saved.x, saved.y)).catch(() => {});
          if (saved.fullscreen) {
            await win.setFullscreen(true).catch(() => {});
          } else if (saved.maximized) {
            await win.setMaximized(true).catch(() => {});
          }
        } else {
          await win.setSize(new LogicalSize(fullSize.width, fullSize.height)).catch(() => {});
        }
      })();
      return () => {
        cancelled = true;
      };
    }
  }, [user, view]);

  // Persist detail window size/position/maximized/fullscreen when on detail view
  useEffect(() => {
    if (!isTauri() || !user || view !== "detail") return;
    const win = getCurrentWindow();
    let saveTimeout: ReturnType<typeof setTimeout> | null = null;

    async function saveWindowState() {
      try {
        const [physicalSize, position, maximized, fullscreen, scaleFactor] = await Promise.all([
          win.innerSize(),
          win.outerPosition(),
          win.isMaximized(),
          win.isFullscreen(),
          win.scaleFactor(),
        ]);
        const logicalSize = physicalSize.toLogical(scaleFactor);
        const logicalPosition = position.toLogical(scaleFactor);
        storeDetailWindowState({
          width: logicalSize.width,
          height: logicalSize.height,
          x: logicalPosition.x,
          y: logicalPosition.y,
          maximized,
          fullscreen,
        });
      } catch {
        // ignore
      }
    }

    function debouncedSave() {
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
        saveTimeout = null;
        saveWindowState();
      }, 200);
    }

    const unlistenPromises = [
      win.onResized(() => debouncedSave()),
      win.onMoved(() => debouncedSave()),
    ];

    return () => {
      if (saveTimeout) clearTimeout(saveTimeout);
      void Promise.all(unlistenPromises).then((fns) => fns.forEach((fn) => fn()));
    };
  }, [user, view]);

  useEffect(() => {
    if (!userMenuOpen) return;
    function handleClick(event: MouseEvent) {
      if (!userMenuRef.current) return;
      if (!userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [userMenuOpen]);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      setWorkspaceName(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const ws = await getWorkspace(selectedWorkspaceId);
        if (!cancelled) {
          setWorkspaceName(ws?.name ?? null);
        }
      } catch {
        if (!cancelled) {
          setWorkspaceName(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedWorkspaceId]);

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
    setUserMenuOpen(false);
  }

  if (user) {
    return (
      <main className={`container app-layout ${view === "detail" ? "app-layout-detail" : ""}`}>
        <div className={view === "detail" ? "app-content app-content-detail" : "app-content"}>
          <header className="app-header">
            <h1 className="app-title">
              {view === "detail" && workspaceName ? workspaceName : "Sparky"}
            </h1>
            <div className="user-card header-user" ref={userMenuRef}>
              <button
                type="button"
                className="header-avatar-button"
                onClick={() => setUserMenuOpen((open) => !open)}
                aria-label="Account menu"
              >
                {user.avatar_url && (
                  <img
                    src={user.avatar_url}
                    alt={user.login}
                    className="avatar"
                    width={28}
                    height={28}
                  />
                )}
              </button>
              {userMenuOpen && (
                <div className="header-user-menu" role="menu">
                  <button
                    type="button"
                    className="header-user-menu-item"
                    // Placeholder for future app-level settings
                    onClick={() => setUserMenuOpen(false)}
                  >
                    Settings
                  </button>
                  <button
                    type="button"
                    className="header-user-menu-item header-user-menu-item-danger"
                    onClick={handleLogout}
                  >
                    Sign out
                  </button>
                </div>
              )}
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
              onSwitchWorkspace={(id) => setSelectedWorkspaceId(id)}
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
