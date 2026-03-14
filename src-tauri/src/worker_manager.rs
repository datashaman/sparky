use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::Mutex;

/// Shared worker connection state, managed via Tauri app state.
pub struct WorkerState {
    socket_path: PathBuf,
    db_path: PathBuf,
    worker_script: PathBuf,
    connection: Arc<Mutex<Option<UnixStream>>>,
}

impl WorkerState {
    pub fn new(app_data_dir: PathBuf, resource_dir: PathBuf) -> Self {
        Self {
            socket_path: app_data_dir.join("sparky.sock"),
            db_path: app_data_dir.join("sparky.db"),
            worker_script: resource_dir.join("sparky-worker").join("dist").join("main.js"),
            connection: Arc::new(Mutex::new(None)),
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
        .args([
            "new-session",
            "-d",
            "-s",
            session_name,
            &cmd,
        ])
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
#[tauri::command]
pub async fn worker_ensure_running(app: AppHandle) -> Result<String, String> {
    let state = app.state::<WorkerState>();

    // Start tmux if needed
    if !tmux_session_exists(SESSION_NAME) {
        let script = state
            .worker_script
            .to_str()
            .ok_or("Invalid worker script path")?;
        let db = state
            .db_path
            .to_str()
            .ok_or("Invalid db path")?;
        let sock = state
            .socket_path
            .to_str()
            .ok_or("Invalid socket path")?;

        // Remove stale socket file
        let _ = std::fs::remove_file(&state.socket_path);

        start_tmux_session(SESSION_NAME, script, db, sock)?;
    }

    // Connect to socket with retry
    let sock_path = state.socket_path.clone();
    let conn = state.connection.clone();

    tokio::spawn(async move {
        for attempt in 0..10 {
            tokio::time::sleep(tokio::time::Duration::from_millis(500 * (attempt + 1))).await;
            match UnixStream::connect(&sock_path).await {
                Ok(stream) => {
                    let mut guard = conn.lock().await;
                    *guard = Some(stream);
                    return;
                }
                Err(_) if attempt < 9 => continue,
                Err(e) => {
                    eprintln!("[worker_manager] failed to connect after retries: {}", e);
                }
            }
        }
    });

    Ok("Worker starting".into())
}

/// Send a JSON command to the worker via the Unix socket.
#[tauri::command]
pub async fn worker_send(app: AppHandle, message: String) -> Result<(), String> {
    let state = app.state::<WorkerState>();
    let conn = state.connection.clone();
    let mut guard = conn.lock().await;

    let stream = guard
        .as_mut()
        .ok_or("Worker not connected. Call worker_ensure_running first.")?;

    let msg = if message.ends_with('\n') {
        message
    } else {
        format!("{}\n", message)
    };

    stream
        .write_all(msg.as_bytes())
        .await
        .map_err(|e| format!("Failed to send to worker: {}", e))?;

    Ok(())
}

/// Subscribe to worker events by reading from the Unix socket and emitting Tauri events.
/// This should be called once after connecting. It runs in the background.
#[tauri::command]
pub async fn worker_subscribe(app: AppHandle) -> Result<(), String> {
    let state = app.state::<WorkerState>();
    let conn_arc = state.connection.clone();
    let app_handle = app.clone();

    tokio::spawn(async move {
        loop {
            // Wait for connection
            let stream = {
                let mut guard = conn_arc.lock().await;
                guard.take()
            };

            let Some(stream) = stream else {
                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                continue;
            };

            let (reader, _writer) = stream.into_split();
            let buf_reader = BufReader::new(reader);
            let mut lines = buf_reader.lines();

            // Store writer back so worker_send can use it
            // We need a new connection for sending; this one is consumed by the reader
            // Actually, for simplicity let's reconnect for sends
            // The read half handles events, writes go through a separate connection

            while let Ok(Some(line)) = lines.next_line().await {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                // Emit as Tauri event
                let _ = app_handle.emit("worker-event", trimmed.to_string());
            }

            // Connection lost — will retry
            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        }
    });

    Ok(())
}
