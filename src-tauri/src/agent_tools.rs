use serde::Serialize;
use std::path::{Path, PathBuf};

/// Resolve a relative path within a sandbox root, ensuring no escape.
/// For non-existent paths, walks up to the nearest existing ancestor
/// and validates that it's inside the sandbox, allowing writes to new subdirs.
fn sandbox_resolve(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let root = root
        .canonicalize()
        .map_err(|e| format!("Cannot canonicalize root: {}", e))?;

    let target = root.join(relative);

    if target.exists() {
        let resolved = target
            .canonicalize()
            .map_err(|e| format!("Cannot canonicalize path: {}", e))?;
        if !resolved.starts_with(&root) {
            return Err("Path escapes sandbox".into());
        }
        return Ok(resolved);
    }

    // For non-existent paths, find the nearest existing ancestor and
    // canonicalize it, then re-append the remaining components.
    let mut existing = target.clone();
    let mut tail = Vec::new();
    while !existing.exists() {
        tail.push(
            existing
                .file_name()
                .ok_or_else(|| "Invalid path".to_string())?
                .to_os_string(),
        );
        existing = existing
            .parent()
            .ok_or_else(|| "Invalid path".to_string())?
            .to_path_buf();
    }
    let mut resolved = existing
        .canonicalize()
        .map_err(|e| format!("Cannot canonicalize ancestor: {}", e))?;
    if !resolved.starts_with(&root) {
        return Err("Path escapes sandbox".into());
    }
    for component in tail.into_iter().rev() {
        resolved.push(component);
    }

    Ok(resolved)
}

#[tauri::command]
pub async fn tool_read_file(worktree_path: String, file_path: String) -> Result<String, String> {
    let root = Path::new(&worktree_path);
    let resolved = sandbox_resolve(root, &file_path)?;
    std::fs::read_to_string(&resolved).map_err(|e| format!("Read failed: {}", e))
}

#[tauri::command]
pub async fn tool_write_file(
    worktree_path: String,
    file_path: String,
    content: String,
) -> Result<(), String> {
    let root = Path::new(&worktree_path);
    let resolved = sandbox_resolve(root, &file_path)?;
    if let Some(parent) = resolved.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot create directories: {}", e))?;
    }
    std::fs::write(&resolved, &content).map_err(|e| format!("Write failed: {}", e))
}

#[tauri::command]
pub async fn tool_edit_file(
    worktree_path: String,
    file_path: String,
    old_text: String,
    new_text: String,
) -> Result<(), String> {
    let root = Path::new(&worktree_path);
    let resolved = sandbox_resolve(root, &file_path)?;
    let contents =
        std::fs::read_to_string(&resolved).map_err(|e| format!("Read failed: {}", e))?;

    let count = contents.matches(&old_text).count();
    if count == 0 {
        return Err("old_text not found in file".into());
    }
    if count > 1 {
        return Err(format!(
            "old_text matches {} times — must be unique",
            count
        ));
    }

    let updated = contents.replacen(&old_text, &new_text, 1);
    std::fs::write(&resolved, &updated).map_err(|e| format!("Write failed: {}", e))
}

#[tauri::command]
pub async fn tool_glob(worktree_path: String, pattern: String) -> Result<Vec<String>, String> {
    let root = Path::new(&worktree_path)
        .canonicalize()
        .map_err(|e| format!("Cannot canonicalize root: {}", e))?;

    let full_pattern = root.join(&pattern);
    let full_pattern_str = full_pattern
        .to_str()
        .ok_or_else(|| "Invalid pattern path".to_string())?;

    let entries =
        glob::glob(full_pattern_str).map_err(|e| format!("Invalid glob pattern: {}", e))?;

    let mut results = Vec::new();
    for entry in entries {
        let path = entry.map_err(|e| format!("Glob error: {}", e))?;
        let canonical = path
            .canonicalize()
            .map_err(|e| format!("Cannot canonicalize: {}", e))?;
        if !canonical.starts_with(&root) {
            continue;
        }
        if let Ok(relative) = canonical.strip_prefix(&root) {
            results.push(relative.to_string_lossy().into_owned());
        }
    }

    Ok(results)
}

#[derive(Serialize)]
pub struct GrepMatch {
    pub file: String,
    pub line: u32,
    pub text: String,
}

#[tauri::command]
pub async fn tool_grep(
    worktree_path: String,
    pattern: String,
    glob_filter: Option<String>,
) -> Result<Vec<GrepMatch>, String> {
    let root = Path::new(&worktree_path)
        .canonicalize()
        .map_err(|e| format!("Cannot canonicalize root: {}", e))?;

    let mut args = vec!["-rn"];
    if let Some(ref g) = glob_filter {
        args.push("--include");
        args.push(g.as_str());
    }
    args.push("-e");
    args.push(&pattern);
    args.push(".");

    let output = std::process::Command::new("grep")
        .args(&args)
        .current_dir(&root)
        .output()
        .map_err(|e| format!("grep failed to start: {}", e))?;

    // grep returns exit code 1 for "no matches" — that's not an error
    if !output.status.success() && output.status.code() != Some(1) {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("grep failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut matches = Vec::new();

    for line in stdout.lines() {
        // Format: ./path/to/file:linenum:text
        let rest = line.strip_prefix("./").unwrap_or(line);
        let mut parts = rest.splitn(3, ':');
        let file = parts.next().unwrap_or("").to_string();
        let line_num: u32 = parts
            .next()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let text = parts.next().unwrap_or("").to_string();
        matches.push(GrepMatch {
            file,
            line: line_num,
            text,
        });
    }

    Ok(matches)
}

#[derive(Serialize)]
pub struct BashResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

/// Commands allowed in the sandbox bash tool.
const ALLOWED_BASH_COMMANDS: &[&str] = &[
    "ls", "find", "cat", "head", "tail", "wc", "sort", "uniq", "diff",
    "mkdir", "cp", "mv", "rm", "touch",
    "git", "npm", "npx", "node", "cargo", "rustc",
    "python", "python3", "pip", "pip3",
    "make", "cmake",
    "echo", "printf", "test", "true", "false",
    "sed", "awk", "cut", "tr", "xargs",
    "which", "env", "pwd", "date",
    "tsc", "eslint", "prettier",
];

#[tauri::command]
pub async fn tool_bash(worktree_path: String, command: String) -> Result<BashResult, String> {
    let root = Path::new(&worktree_path)
        .canonicalize()
        .map_err(|e| format!("Cannot canonicalize root: {}", e))?;

    // Validate the command starts with an allowed program
    let first_word = command.split_whitespace().next().unwrap_or("");
    // Strip any path prefix to get the base command name
    let base_cmd = first_word.rsplit('/').next().unwrap_or(first_word);
    if !ALLOWED_BASH_COMMANDS.contains(&base_cmd) {
        return Err(format!(
            "Command '{}' is not in the allowed list. Allowed: {}",
            base_cmd,
            ALLOWED_BASH_COMMANDS.join(", ")
        ));
    }

    let output = std::process::Command::new("sh")
        .arg("-c")
        .arg(&command)
        .current_dir(&root)
        .env("HOME", &root)
        .env("PATH", "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin")
        .output()
        .map_err(|e| format!("bash failed to start: {}", e))?;

    Ok(BashResult {
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        exit_code: output.status.code().unwrap_or(-1),
    })
}
