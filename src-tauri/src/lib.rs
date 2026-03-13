mod agent_tools;
mod git_ops;
mod github_auth;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn github_start_device_flow() -> Result<github_auth::DeviceFlowResult, String> {
    github_auth::start_device_flow().await
}

#[tauri::command]
async fn github_poll_token(device_code: String, interval: u64) -> Result<String, String> {
    github_auth::poll_for_token(&device_code, interval).await
}

#[tauri::command]
async fn github_login_web() -> Result<String, String> {
    github_auth::login_with_web_flow().await
}

#[tauri::command]
async fn github_get_user(access_token: String) -> Result<github_auth::GitHubUserResult, String> {
    github_auth::get_user(&access_token).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            greet,
            github_start_device_flow,
            github_poll_token,
            github_login_web,
            github_get_user,
            git_ops::git_clone_repo,
            git_ops::git_create_worktree,
            git_ops::git_remove_worktree,
            git_ops::git_worktree_status,
            agent_tools::tool_read_file,
            agent_tools::tool_write_file,
            agent_tools::tool_edit_file,
            agent_tools::tool_glob,
            agent_tools::tool_grep,
            agent_tools::tool_bash,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
