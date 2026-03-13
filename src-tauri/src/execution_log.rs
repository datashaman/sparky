use std::io::Write;
use tauri::AppHandle;
use tauri::Manager;

fn log_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {}", e))?;
    Ok(data_dir.join("execution.log"))
}

#[tauri::command]
pub async fn append_execution_log(app: AppHandle, line: String) -> Result<(), String> {
    let path = log_path(&app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir failed: {}", e))?;
    }
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("Failed to open log file: {}", e))?;
    writeln!(file, "{}", line).map_err(|e| format!("Failed to write log: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn get_execution_log_path(app: AppHandle) -> Result<String, String> {
    let path = log_path(&app)?;
    Ok(path.to_string_lossy().to_string())
}
