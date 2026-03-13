import { useState, useEffect, useRef } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize, LogicalPosition } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getWorkspace } from "./data/workspaces";
import { WorkspaceList } from "./components/WorkspaceList";
import { WorkspaceDetail } from "./components/WorkspaceDetail";
import { ErrorMessage } from "./components/ErrorMessage";
import { UserSettings } from "./components/UserSettings";
import "./App.css";

const DETAIL_WINDOW_STATE_KEY = "sparky_detail_window_state";
const DETAIL_WORKSPACE_ID_KEY = "sparky_detail_workspace_id";

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
  } catch (e) {
    console.error("Failed to read detail window state from localStorage", e);
    return null;
  }
}

function storeDetailWindowState(state: DetailWindowState): void {
  try {
    localStorage.setItem(DETAIL_WINDOW_STATE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("Failed to store detail window state to localStorage", e);
  }
}

function getStoredDetailWorkspaceId(): string | null {
  try {
    const id = localStorage.getItem(DETAIL_WORKSPACE_ID_KEY);
    return id && id.length > 0 ? id : null;
  } catch {
    return null;
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
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false);
  const [userSettingsOpen, setUserSettingsOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const workspacesShownRef = useRef(false);
  const [windowLabel, setWindowLabel] = useState<string | null>(() =>
    isTauri() ? getCurrentWindow().label : null
  );

  useEffect(() => {
    if (!isTauri()) {
      setUser({ login: "preview", id: 0 });
      setWindowLabel("web");
      return;
    }

    const win = getCurrentWindow();
    setWindowLabel(win.label);

    const stored = localStorage.getItem("github_user");
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as GitHubUser;
        setUser(parsed);

        if (win.label === "login") {
          (async () => {
            try {
              // Ensure the workspaces window exists; it will show itself after content loads
              const existing = await WebviewWindow.getByLabel("workspaces");
              if (!existing) new WebviewWindow("workspaces");
            } catch (e) {
              console.error("Failed to create workspaces window on startup", e);
            }
            try {
              await win.close();
            } catch (e) {
              console.error("Failed to close login window on startup", e);
            }
          })();
        } else if (win.label === "workspaces") {
          // Window will be shown after content loads via onReady → showWorkspacesWindow
        }
      } catch (e) {
        console.error("Failed to parse stored github_user", e);
        localStorage.removeItem("github_user");
      }
    } else {
      if (win.label === "login") {
        (async () => {
          try {
            await win.show();
          } catch (e) {
            console.error("Failed to show login window on startup", e);
          }
        })();
      }
    }

    // Workspaces window: listen for github_user changes (login sets it then shows us)
    if (win.label === "workspaces") {
      const onStorage = (e: StorageEvent) => {
        if (e.key === "github_user" && e.newValue) {
          try {
            setUser(JSON.parse(e.newValue) as GitHubUser);
          } catch (err) {
            console.error("Failed to parse github_user from storage event", err);
          }
        }
      };
      window.addEventListener("storage", onStorage);
      return () => window.removeEventListener("storage", onStorage);
    }
  }, []);

  // Detail window: read workspace id from localStorage and react to storage events
  useEffect(() => {
    if (windowLabel !== "detail") return;
    const id = getStoredDetailWorkspaceId();
    setSelectedWorkspaceId(id);

    function onStorage(e: StorageEvent) {
      if (e.key === DETAIL_WORKSPACE_ID_KEY && e.newValue) {
        setSelectedWorkspaceId(e.newValue);
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [windowLabel]);

  // Restore detail window size/position (detail window only)
  useEffect(() => {
    if (!isTauri() || windowLabel !== "detail") return;
    const win = getCurrentWindow();
    let cancelled = false;

    (async () => {
      const saved = getStoredDetailWindowState();
      try {
        if (cancelled) return;
        if (saved) {
          await win.setSize(new LogicalSize(saved.width, saved.height));
          await win.setPosition(new LogicalPosition(saved.x, saved.y));
          if (saved.fullscreen) {
            await win.setFullscreen(true);
          } else if (saved.maximized) {
            await (win as any).setMaximized(true);
          }
        }
      } catch (e) {
        console.error("Failed to restore detail window state", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [windowLabel]);

  // Persist detail window size/position (detail window only)
  useEffect(() => {
    if (!isTauri() || windowLabel !== "detail") return;
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
      } catch (e) {
        console.error("Failed to persist detail window state", e);
      }
    }

    function debouncedSave() {
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
        saveTimeout = null;
        saveWindowState();
      }, 200);
    }

    const unlistenPromises = [win.onResized(debouncedSave), win.onMoved(debouncedSave)];

    return () => {
      if (saveTimeout) clearTimeout(saveTimeout);
      void Promise.all(unlistenPromises).then((fns) =>
        fns.forEach((fn) => {
          try {
            fn();
          } catch (e) {
            console.error("Failed to unlisten window resize/move", e);
          }
        }),
      );
    };
  }, [windowLabel]);

  // Workspaces window: when user closes via X, exit app only if no other visible window (detail)
  useEffect(() => {
    if (!isTauri() || windowLabel !== "workspaces") return;
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    win
      .onCloseRequested(async () => {
        try {
          const detail = await WebviewWindow.getByLabel("detail");
          const detailVisible = detail ? await detail.isVisible() : false;
          if (!detailVisible) {
            const { exit } = await import("@tauri-apps/plugin-process");
            await exit(0);
          }
        } catch (e) {
          console.error("Failed to handle workspaces close", e);
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      unlisten?.();
    };
  }, [windowLabel]);

  // Detail window: when user closes via X, go back to workspaces instead of closing
  useEffect(() => {
    if (!isTauri() || windowLabel !== "detail") return;
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    win
      .onCloseRequested((event) => {
        event.preventDefault();
        unlisten?.();
        (async () => {
          try {
            const ws = await WebviewWindow.getByLabel("workspaces");
            if (ws) await ws.show();
            await win.hide();
          } catch (e) {
            console.error("Failed to switch to workspaces on detail close", e);
          }
        })();
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      unlisten?.();
    };
  }, [windowLabel]);

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
      } catch (e) {
        console.error("Failed to load workspace name", e);
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
    setError(null);
    setLoading(true);

    try {
      if (isTauri()) {
        const token = await invoke<string>("github_login_web");
        const userResult = await invoke<GitHubUser>("github_get_user", {
          accessToken: token,
        });
        setUser(userResult);
        localStorage.setItem("github_token", token);
        localStorage.setItem("github_user", JSON.stringify(userResult));

        if (windowLabel === "login") {
          const current = getCurrentWindow();
          try {
            // Ensure the workspaces window exists; it will show itself after content loads
            const existing = await WebviewWindow.getByLabel("workspaces");
            if (!existing) new WebviewWindow("workspaces");
          } catch (e) {
            console.error("Failed to create workspaces window", e);
          }
          try {
            await current.close();
          } catch (e) {
            console.error("Failed to close login window", e);
          }
        }
      } else {
        setError("Sign in requires the Sparky desktop app.");
      }
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

  async function showWorkspacesWindow() {
    if (!isTauri() || workspacesShownRef.current) return;
    workspacesShownRef.current = true;
    try {
      await getCurrentWindow().show();
    } catch (e) {
      console.error("Failed to show workspaces window", e);
    }
  }

  async function goBackToWorkspacesWindow() {
    if (!isTauri() || windowLabel !== "detail") return;
    const current = getCurrentWindow();
    try {
      const ws = await WebviewWindow.getByLabel("workspaces");
      if (ws) await ws.show();
      await current.hide();
    } catch (e) {
      console.error("Failed to go back to workspaces window", e);
    }
  }

  // --- Dedicated login window ---
  if (windowLabel === "login") {
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
        <UserSettings open={userSettingsOpen} onClose={() => setUserSettingsOpen(false)} />
      </main>
    );
  }

  // --- Dedicated workspaces window (list only) ---
  if (windowLabel === "workspaces" && user) {
    return (
      <main className="container app-layout app-layout-workspaces">
        <div className="app-content app-content-workspaces">
          <header className="app-header">
            <h1 className="app-title">Sparky</h1>
            <div className="header-actions">
              <button
                type="button"
                className="header-btn header-btn-new"
                onClick={() => setCreateDrawerOpen(true)}
                aria-label="New workspace"
              >
                + New
              </button>
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
                      onClick={() => { setUserMenuOpen(false); setUserSettingsOpen(true); }}
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
            </div>
          </header>
          <WorkspaceList
            createDrawerOpen={createDrawerOpen}
            onCloseCreateDrawer={() => setCreateDrawerOpen(false)}
            onReady={showWorkspacesWindow}
            onSelectWorkspace={async (id) => {
              try {
                localStorage.setItem(DETAIL_WORKSPACE_ID_KEY, id);
                const existing = await WebviewWindow.getByLabel("detail");
                const detailWindow = existing ?? new WebviewWindow("detail");
                await detailWindow.show();
                const current = getCurrentWindow();
                await current.hide();
              } catch (e) {
                console.error("Failed to open detail window", e);
              }
            }}
          />
        </div>
        <UserSettings open={userSettingsOpen} onClose={() => setUserSettingsOpen(false)} />
      </main>
    );
  }

  // --- Dedicated detail window (workspace detail only) ---
  if (windowLabel === "detail" && user && selectedWorkspaceId) {
    return (
      <main className="container app-layout app-layout-detail">
        <div className="app-content app-content-detail">
          <header className="app-header">
            <h1 className="app-title">{workspaceName ?? "Sparky"}</h1>
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
                    onClick={() => { setUserMenuOpen(false); setUserSettingsOpen(true); }}
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
          <WorkspaceDetail
            workspaceId={selectedWorkspaceId}
            onSwitchWorkspace={(id) => {
              setSelectedWorkspaceId(id);
              localStorage.setItem(DETAIL_WORKSPACE_ID_KEY, id);
            }}
            onDeleted={goBackToWorkspacesWindow}
            onWorkspaceNameChange={setWorkspaceName}
            onBackToWorkspaces={goBackToWorkspacesWindow}
          />
        </div>
        <UserSettings open={userSettingsOpen} onClose={() => setUserSettingsOpen(false)} />
      </main>
    );
  }

  // --- Detail window but no workspace selected yet (shouldn't normally show) ---
  if (windowLabel === "detail") {
    return (
      <main className="container">
        <p className="loading">No workspace selected.</p>
      </main>
    );
  }

  // --- Web preview: combined workspaces + detail with view state ---
  if (user) {
    return (
      <main
        className={`container app-layout ${
          view === "detail" ? "app-layout-detail" : view === "workspaces" ? "app-layout-workspaces" : ""
        }`}
      >
        <div
          className={
            view === "detail"
              ? "app-content app-content-detail"
              : view === "workspaces"
                ? "app-content app-content-workspaces"
                : "app-content"
          }
        >
          <header className="app-header">
            <h1 className="app-title">
              {view === "detail" && workspaceName ? workspaceName : "Sparky"}
            </h1>
            <div className="header-actions">
              {view === "workspaces" && (
                <button
                  type="button"
                  className="header-btn header-btn-new"
                  onClick={() => setCreateDrawerOpen(true)}
                  aria-label="New workspace"
                >
                  + New
                </button>
              )}
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
                      onClick={() => { setUserMenuOpen(false); setUserSettingsOpen(true); }}
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
            </div>
          </header>
          {view === "workspaces" ? (
            <WorkspaceList
              createDrawerOpen={createDrawerOpen}
              onCloseCreateDrawer={() => setCreateDrawerOpen(false)}
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
                setWorkspaceName(null);
              }}
              onWorkspaceNameChange={(name) => setWorkspaceName(name)}
            />
          ) : null}
        </div>
        <UserSettings open={userSettingsOpen} onClose={() => setUserSettingsOpen(false)} />
      </main>
    );
  }

  // --- Web preview: login ---
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
