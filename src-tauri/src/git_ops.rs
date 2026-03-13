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

/// Build the auth header value for git HTTP operations.
fn auth_header(access_token: &str) -> String {
    use base64::Engine;
    let credentials = format!("x-access-token:{}", access_token);
    let encoded = base64::engine::general_purpose::STANDARD.encode(credentials.as_bytes());
    format!("Authorization: Basic {}", encoded)
}

/// Run a git command, returning stdout on success or an error with stderr.
fn run_git(args: &[&str], cwd: &std::path::Path) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("git {} failed to start: {}", args[0], e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git {} failed: {}", args[0], stderr));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Resolve the default branch from the cloned repo (e.g. "origin/main" or "origin/master").
fn resolve_default_branch(clone_path: &std::path::Path) -> Result<String, String> {
    // Try symbolic-ref for origin/HEAD first
    if let Ok(output) = run_git(
        &["symbolic-ref", "refs/remotes/origin/HEAD", "--short"],
        clone_path,
    ) {
        let branch = output.trim().to_string();
        if !branch.is_empty() {
            return Ok(branch);
        }
    }

    // Fallback: check common names
    for candidate in &["origin/main", "origin/master"] {
        let result = Command::new("git")
            .args(["rev-parse", "--verify", candidate])
            .current_dir(clone_path)
            .output();
        if let Ok(out) = result {
            if out.status.success() {
                return Ok(candidate.to_string());
            }
        }
    }

    Err("Could not determine default branch".into())
}

#[tauri::command]
pub async fn git_clone_repo(
    app: AppHandle,
    repo_full_name: String,
    access_token: String,
) -> Result<String, String> {
    let (owner, name) = parse_repo_name(&repo_full_name)?;
    let clone_path = repo_path(&app, owner, name)?;
    let header = auth_header(&access_token);

    tauri::async_runtime::spawn_blocking(move || {
        // Already cloned? Just fetch.
        if clone_path.join(".git").exists() {
            run_git(
                &[
                    "-c",
                    &format!("http.extraHeader={}", header),
                    "fetch",
                    "--all",
                ],
                &clone_path,
            )?;
            return Ok(clone_path.to_string_lossy().to_string());
        }

        // Create parent dirs
        if let Some(parent) = clone_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("mkdir failed: {}", e))?;
        }

        // Clone with auth header (no token in URL)
        let clone_url = format!("https://github.com/{}.git", repo_full_name);
        let output = Command::new("git")
            .args([
                "-c",
                &format!("http.extraHeader={}", header),
                "clone",
                &clone_url,
                &clone_path.to_string_lossy(),
            ])
            .output()
            .map_err(|e| format!("git clone failed to start: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git clone failed: {}", stderr));
        }

        Ok(clone_path.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| format!("spawn_blocking failed: {}", e))?
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
    let wt_path = worktrees_dir(&app)?
        .join(owner)
        .join(name)
        .join(format!("issue-{}", issue_number));

    tauri::async_runtime::spawn_blocking(move || {
        if !clone_path.join(".git").exists() {
            return Err("Repo not cloned. Call git_clone_repo first.".into());
        }

        let branch_name = format!("sparky/issue-{}", issue_number);

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

        // Resolve base branch: caller-provided, or detect from repo
        let base = match base_branch {
            Some(b) => b,
            None => resolve_default_branch(&clone_path)?,
        };

        run_git(
            &[
                "worktree",
                "add",
                "-b",
                &branch_name,
                &wt_path.to_string_lossy(),
                &base,
            ],
            &clone_path,
        )?;

        Ok(GitWorktreeResult {
            path: wt_path.to_string_lossy().to_string(),
            branch_name,
        })
    })
    .await
    .map_err(|e| format!("spawn_blocking failed: {}", e))?
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

    tauri::async_runtime::spawn_blocking(move || {
        if !wt_path.exists() {
            return Ok(());
        }

        let result = run_git(
            &[
                "worktree",
                "remove",
                "--force",
                &wt_path.to_string_lossy(),
            ],
            &clone_path,
        );

        if result.is_err() {
            // Fallback: remove directory and prune
            std::fs::remove_dir_all(&wt_path)
                .map_err(|e| format!("Failed to remove worktree dir: {}", e))?;
            let _ = run_git(&["worktree", "prune"], &clone_path);
        }

        Ok(())
    })
    .await
    .map_err(|e| format!("spawn_blocking failed: {}", e))?
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
    tauri::async_runtime::spawn_blocking(move || {
        let path = std::path::Path::new(&worktree_path);
        if !path.exists() {
            return Err("Worktree path does not exist".into());
        }

        let status_text = run_git(&["status", "--porcelain"], path)?;
        let changed_files = status_text.lines().filter(|l| !l.is_empty()).count();

        Ok(GitWorktreeStatusResult {
            changed_files: changed_files as u32,
            clean: changed_files == 0,
        })
    })
    .await
    .map_err(|e| format!("spawn_blocking failed: {}", e))?
}
