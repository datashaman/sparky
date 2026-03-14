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
}

impl WorkerState {
    pub fn new(app_data_dir: PathBuf, resource_dir: PathBuf) -> Self {
        Self {
            socket_path: app_data_dir.join("sparky.sock"),
            db_path: app_data_dir.join("sparky.db"),
            worker_script: resource_dir.join("sparky-worker").join("dist").join("main.js"),
            writer: Arc::new(Mutex::new(None)),
        }
    }
}

/// Check if the tmux session is running.
fn tmux_session_exists(session_name: &str) -> bool {
    std::process::Command::new("tmux")
        .args(["has-session", "-t", session_name])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Start the tmux session with the worker process.
fn start_tmux_session(
    session_name: &str,
    script_path: &str,
    db_path: &str,
    socket_path: &str,
) -> Result<(), String> {
    let cmd = format!(
        "node {} --db {} --socket {}",
        shell_escape(script_path),
        shell_escape(db_path),
        shell_escape(socket_path),
    );

    let status = std::process::Command::new("tmux")
        .args(["new-session", "-d", "-s", session_name, &cmd])
        .status()
        .map_err(|e| format!("Failed to start tmux: {}", e))?;

    if !status.success() {
        return Err("tmux new-session failed".into());
    }
    Ok(())
}

fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

const SESSION_NAME: &str = "sparky-worker";

/// Ensure the worker process is running in tmux and connect to its socket.
/// Waits for the socket connection before returning.
#[tauri::command]
pub async fn worker_ensure_running(app: AppHandle) -> Result<String, String> {
    let state = app.state::<WorkerState>();

    // Start tmux if needed
    if !tmux_session_exists(SESSION_NAME) {
        let script = state
            .worker_script
            .to_str()
            .ok_or("Invalid worker script path")?;
        let db = state.db_path.to_str().ok_or("Invalid db path")?;
        let sock = state.socket_path.to_str().ok_or("Invalid socket path")?;

        // Remove stale socket file
        let _ = std::fs::remove_file(&state.socket_path);

        start_tmux_session(SESSION_NAME, script, db, sock)?;
    }

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
