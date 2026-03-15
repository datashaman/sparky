use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::unix::OwnedWriteHalf;
use tokio::net::UnixStream;
use tokio::sync::Mutex;

/// Shared worker connection state, managed via Tauri app state.
pub struct WorkerState {
    socket_path: PathBuf,
    db_path: PathBuf,
    worker_script: PathBuf,
    /// Write half for sending commands to the worker.
    writer: Arc<Mutex<Option<OwnedWriteHalf>>>,
    /// Serialize calls to worker_ensure_running to prevent races.
    #[allow(dead_code)]
    startup_lock: Arc<Mutex<()>>,
}

impl WorkerState {
    pub fn new(app_data_dir: PathBuf, resource_dir: PathBuf) -> Self {
        // In dev mode, resource_dir points into target/debug/ where the worker
        // script doesn't exist. Fall back to the project root's sparky-worker/.
        let candidate = resource_dir.join("sparky-worker").join("dist").join("main.js");
        let worker_script = if candidate.exists() {
            candidate
        } else {
            // Walk up from src-tauri/target/.../resource_dir to find the project root
            let mut dir = resource_dir.as_path();
            loop {
                let dev_candidate = dir.join("sparky-worker").join("dist").join("main.js");
                if dev_candidate.exists() {
                    break dev_candidate;
                }
                match dir.parent() {
                    Some(parent) => dir = parent,
                    None => break candidate, // give up, use original
                }
            }
        };
        Self {
            socket_path: app_data_dir.join("sparky.sock"),
            db_path: app_data_dir.join("sparky.db"),
            worker_script,
            writer: Arc::new(Mutex::new(None)),
            startup_lock: Arc::new(Mutex::new(())),
        }
    }
}

/// Check if the tmux session is running.
fn tmux_session_exists(tmux: &str, session_name: &str) -> bool {
    std::process::Command::new(tmux)
        .args(["has-session", "-t", session_name])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Start the tmux session with the worker process.
fn start_tmux_session(
    tmux: &str,
    node: &str,
    session_name: &str,
    script_path: &str,
    db_path: &str,
    socket_path: &str,
) -> Result<(), String> {
    let cmd = format!(
        "{} {} --db {} --socket {}",
        shell_escape(node),
        shell_escape(script_path),
        shell_escape(db_path),
        shell_escape(socket_path),
    );

    let output = std::process::Command::new(tmux)
        .args(["new-session", "-d", "-s", session_name, &cmd])
        .output()
        .map_err(|e| format!("Failed to start tmux: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("tmux new-session failed: {}", stderr));
    }
    Ok(())
}

fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

const SESSION_NAME: &str = "sparky-worker";

/// Resolve full path for a command by asking the user's login shell.
/// Falls back to common homebrew/system locations.
fn resolve_bin(name: &str) -> String {
    // Try the user's login shell first (picks up nvm, pyenv, etc.)
    if let Ok(output) = std::process::Command::new("/bin/zsh")
        .args(["-l", "-c", &format!("which {}", name)])
        .output()
    {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() && std::path::Path::new(&path).exists() {
                return path;
            }
        }
    }

    let candidates = [
        format!("/opt/homebrew/bin/{}", name),
        format!("/usr/local/bin/{}", name),
        format!("/usr/bin/{}", name),
    ];
    for c in &candidates {
        if std::path::Path::new(c).exists() {
            return c.clone();
        }
    }
    // Fall back to bare name and hope PATH has it
    name.to_string()
}

/// Ensure the worker process is running in tmux and connect to its socket.
/// Waits for the socket connection before returning.
#[tauri::command]
pub async fn worker_ensure_running(app: AppHandle) -> Result<String, String> {
    let state = app.state::<WorkerState>();

    // Serialize startup attempts to prevent races
    let _startup_guard = state.startup_lock.lock().await;

    // Already connected — nothing to do (check inside lock to avoid races)
    {
        let guard = state.writer.lock().await;
        if guard.is_some() {
            return Ok("Worker already connected".into());
        }
    }

    let tmux = resolve_bin("tmux");
    let node = resolve_bin("node");

    // Kill any existing session and start fresh — we have no connection
    // so any existing session is stale from a previous app run
    if tmux_session_exists(&tmux, SESSION_NAME) {
        let _ = std::process::Command::new(&tmux)
            .args(["kill-session", "-t", SESSION_NAME])
            .status();
    }

    let script = state
        .worker_script
        .to_str()
        .ok_or("Invalid worker script path")?;
    let db = state.db_path.to_str().ok_or("Invalid db path")?;
    let sock = state.socket_path.to_str().ok_or("Invalid socket path")?;

    // Remove stale socket file
    let _ = std::fs::remove_file(&state.socket_path);

    start_tmux_session(&tmux, &node, SESSION_NAME, script, db, sock)?;

    // Connect to socket with retry — await until connected
    let sock_path = state.socket_path.clone();
    for attempt in 0..10 {
        tokio::time::sleep(tokio::time::Duration::from_millis(500 * (attempt + 1))).await;
        match UnixStream::connect(&sock_path).await {
            Ok(stream) => {
                let (reader, writer) = stream.into_split();

                // Store writer for worker_send
                {
                    let mut guard = state.writer.lock().await;
                    *guard = Some(writer);
                }

                // Spawn background reader that emits Tauri events
                let app_handle = app.clone();
                tokio::spawn(async move {
                    let buf_reader = BufReader::new(reader);
                    let mut lines = buf_reader.lines();

                    while let Ok(Some(line)) = lines.next_line().await {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            continue;
                        }
                        let _ = app_handle.emit("worker-event", trimmed.to_string());
                    }
                });

                return Ok("Worker connected".into());
            }
            Err(_) if attempt < 9 => continue,
            Err(e) => {
                return Err(format!("Failed to connect to worker after retries: {}", e));
            }
        }
    }

    Err("Failed to connect to worker socket".into())
}

/// Send a JSON command to the worker via the Unix socket.
#[tauri::command]
pub async fn worker_send(app: AppHandle, message: String) -> Result<(), String> {
    let state = app.state::<WorkerState>();
    let mut guard = state.writer.lock().await;

    let writer = guard
        .as_mut()
        .ok_or("Worker not connected. Call worker_ensure_running first.")?;

    let msg = if message.ends_with('\n') {
        message
    } else {
        format!("{}\n", message)
    };

    writer
        .write_all(msg.as_bytes())
        .await
        .map_err(|e| format!("Failed to send to worker: {}", e))?;

    Ok(())
}

/// Subscribe to worker events. Now handled automatically by worker_ensure_running,
/// which spawns a background reader. This command is kept for backward compatibility.
#[tauri::command]
pub async fn worker_subscribe(_app: AppHandle) -> Result<(), String> {
    // Event subscription is now set up automatically in worker_ensure_running.
    Ok(())
}
