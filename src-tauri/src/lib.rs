use tauri::Manager;

mod agent_tools;
mod execution_log;
mod git_ops;
mod github_auth;
mod litellm_proxy;
mod ollama_proxy;
mod worker_manager;

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
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_config_dir()
                .expect("failed to resolve app config dir");
            let resource_dir = app
                .path()
                .resource_dir()
                .expect("failed to resolve resource dir");
            app.manage(worker_manager::WorkerState::new(
                app_data_dir,
                resource_dir,
            ));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
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
            execution_log::append_execution_log,
            execution_log::get_execution_log_path,
            ollama_proxy::ollama_chat,
            ollama_proxy::ollama_list_models,
            litellm_proxy::litellm_chat,
            litellm_proxy::litellm_list_models,
            worker_manager::worker_ensure_running,
            worker_manager::worker_send,
            worker_manager::worker_subscribe,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
