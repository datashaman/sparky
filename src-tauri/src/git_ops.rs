use std::path::PathBuf;
use std::process::Command;
use tauri::AppHandle;
use tauri::Manager;

fn repos_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {}", e))?;
    Ok(data_dir.join("repos"))
}

fn worktrees_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {}", e))?;
    Ok(data_dir.join("worktrees"))
}

fn parse_repo_name(repo_full_name: &str) -> Result<(&str, &str), String> {
    let parts: Vec<&str> = repo_full_name.split('/').collect();
    if parts.len() != 2 {
        return Err("Invalid repo name, expected owner/name".into());
    }
    Ok((parts[0], parts[1]))
}

fn repo_path(app: &AppHandle, owner: &str, name: &str) -> Result<PathBuf, String> {
    Ok(repos_dir(app)?.join(owner).join(name))
}

#[tauri::command]
pub async fn git_clone_repo(
    app: AppHandle,
    repo_full_name: String,
    access_token: String,
) -> Result<String, String> {
    let (owner, name) = parse_repo_name(&repo_full_name)?;
    let clone_path = repo_path(&app, owner, name)?;

    // Already cloned? Just fetch.
    if clone_path.join(".git").exists() {
        let output = Command::new("git")
            .args(["fetch", "--all"])
            .current_dir(&clone_path)
            .output()
            .map_err(|e| format!("git fetch failed: {}", e))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git fetch failed: {}", stderr));
        }
        return Ok(clone_path.to_string_lossy().to_string());
    }

    // Create parent dirs
    if let Some(parent) = clone_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir failed: {}", e))?;
    }

    let clone_url = format!(
        "https://x-access-token:{}@github.com/{}.git",
        access_token, repo_full_name
    );
    let output = Command::new("git")
        .args(["clone", &clone_url, &clone_path.to_string_lossy()])
        .output()
        .map_err(|e| format!("git clone failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git clone failed: {}", stderr));
    }

    Ok(clone_path.to_string_lossy().to_string())
}

#[derive(serde::Serialize)]
pub struct GitWorktreeResult {
    pub path: String,
    pub branch_name: String,
}

#[tauri::command]
pub async fn git_create_worktree(
    app: AppHandle,
    repo_full_name: String,
    issue_number: u32,
    base_branch: Option<String>,
) -> Result<GitWorktreeResult, String> {
    let (owner, name) = parse_repo_name(&repo_full_name)?;
    let clone_path = repo_path(&app, owner, name)?;

    if !clone_path.join(".git").exists() {
        return Err("Repo not cloned. Call git_clone_repo first.".into());
    }

    let branch_name = format!("sparky/issue-{}", issue_number);
    let wt_path = worktrees_dir(&app)?
        .join(owner)
        .join(name)
        .join(format!("issue-{}", issue_number));

    // Already exists?
    if wt_path.exists() {
        return Ok(GitWorktreeResult {
            path: wt_path.to_string_lossy().to_string(),
            branch_name,
        });
    }

    if let Some(parent) = wt_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir failed: {}", e))?;
    }

    let base = base_branch.unwrap_or_else(|| "origin/main".to_string());

    let output = Command::new("git")
        .args([
            "worktree",
            "add",
            "-b",
            &branch_name,
            &wt_path.to_string_lossy(),
            &base,
        ])
        .current_dir(&clone_path)
        .output()
        .map_err(|e| format!("git worktree add failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git worktree add failed: {}", stderr));
    }

    Ok(GitWorktreeResult {
        path: wt_path.to_string_lossy().to_string(),
        branch_name,
    })
}

#[tauri::command]
pub async fn git_remove_worktree(
    app: AppHandle,
    repo_full_name: String,
    issue_number: u32,
) -> Result<(), String> {
    let (owner, name) = parse_repo_name(&repo_full_name)?;
    let clone_path = repo_path(&app, owner, name)?;
    let wt_path = worktrees_dir(&app)?
        .join(owner)
        .join(name)
        .join(format!("issue-{}", issue_number));

    if !wt_path.exists() {
        return Ok(());
    }

    let output = Command::new("git")
        .args([
            "worktree",
            "remove",
            "--force",
            &wt_path.to_string_lossy(),
        ])
        .current_dir(&clone_path)
        .output()
        .map_err(|e| format!("git worktree remove failed: {}", e))?;

    if !output.status.success() {
        // Fallback: remove directory and prune
        std::fs::remove_dir_all(&wt_path)
            .map_err(|e| format!("Failed to remove worktree dir: {}", e))?;
        let _ = Command::new("git")
            .args(["worktree", "prune"])
            .current_dir(&clone_path)
            .output();
    }

    Ok(())
}

#[derive(serde::Serialize)]
pub struct GitWorktreeStatusResult {
    pub changed_files: u32,
    pub clean: bool,
}

#[tauri::command]
pub async fn git_worktree_status(
    worktree_path: String,
) -> Result<GitWorktreeStatusResult, String> {
    let path = std::path::Path::new(&worktree_path);
    if !path.exists() {
        return Err("Worktree path does not exist".into());
    }

    let output = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(path)
        .output()
        .map_err(|e| format!("git status failed: {}", e))?;

    let status_text = String::from_utf8_lossy(&output.stdout);
    let changed_files = status_text.lines().filter(|l| !l.is_empty()).count();

    Ok(GitWorktreeStatusResult {
        changed_files: changed_files as u32,
        clean: changed_files == 0,
    })
}
