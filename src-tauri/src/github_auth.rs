//! GitHub OAuth - Web flow (loopback) or Device flow.
//!
//! For web flow (recommended): set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, and add
//! http://127.0.0.1:8765/callback as Authorization callback URL in your OAuth App.
//!
//! For device flow: set GITHUB_CLIENT_ID only.

use axum::{
    extract::Query,
    response::{Html, IntoResponse},
    routing::get,
    Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::{Rng, RngExt};
use reqwest::header::{ACCEPT, USER_AGENT};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;

const APP_USER_AGENT: &str = "Sparky/1.0 (OAuth)";
const REDIRECT_PORT: u16 = 8765;
const REDIRECT_URI: &str = "http://127.0.0.1:8765/callback";

fn format_api_error(status: reqwest::StatusCode, body: &str) -> String {
    let body_trimmed = body.trim();
    if body_trimmed.starts_with('<') && body_trimmed.contains("html") {
        return format!(
            "GitHub is experiencing issues (HTTP {}). Please try again in a few minutes. See https://www.githubstatus.com for status.",
            status
        );
    }
    if body_trimmed.len() > 300 {
        format!("GitHub API error (HTTP {}): {}...", status, &body_trimmed[..300])
    } else {
        format!("GitHub API error (HTTP {}): {}", status, body_trimmed)
    }
}

fn github_client_id() -> Result<&'static str, String> {
    option_env!("GITHUB_CLIENT_ID").ok_or_else(|| {
        "Set GITHUB_CLIENT_ID env var when building. Create an OAuth App at https://github.com/settings/developers".to_string()
    })
}

fn github_client_secret() -> Result<&'static str, String> {
    option_env!("GITHUB_CLIENT_SECRET").ok_or_else(|| {
        "Set GITHUB_CLIENT_SECRET env var when building. Add it in .env for web flow. See https://github.com/settings/developers".to_string()
    })
}

#[derive(Debug, Deserialize)]
struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    #[allow(dead_code)]
    token_type: Option<String>,
    #[allow(dead_code)]
    scope: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubUser {
    pub login: String,
    pub id: u64,
    pub avatar_url: Option<String>,
    pub name: Option<String>,
}

#[derive(serde::Serialize)]
pub struct DeviceFlowResult {
    pub user_code: String,
    pub verification_uri: String,
    pub device_code: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(serde::Serialize)]
pub struct GitHubUserResult {
    pub login: String,
    pub id: u64,
    pub avatar_url: Option<String>,
    pub name: Option<String>,
}

pub async fn start_device_flow() -> Result<DeviceFlowResult, String> {
    let client_id = github_client_id()?;
    let client = reqwest::Client::new();

    let params = [
        ("client_id", client_id),
        ("scope", "read:user user:email repo"),
    ];

    let response = client
        .post("https://github.com/login/device/code")
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, APP_USER_AGENT)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format_api_error(status, &text));
    }

    let data: DeviceCodeResponse = response
        .json()
        .await
        .map_err(|e| format!("Invalid response: {}", e))?;

    Ok(DeviceFlowResult {
        user_code: data.user_code,
        verification_uri: data.verification_uri,
        device_code: data.device_code,
        expires_in: data.expires_in,
        interval: data.interval,
    })
}

pub async fn poll_for_token(device_code: &str, interval_secs: u64) -> Result<String, String> {
    let client_id = github_client_id()?;
    let client = reqwest::Client::new();

    let params = [
        ("client_id", client_id),
        ("device_code", device_code),
        ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
    ];

    loop {
        let response = client
            .post("https://github.com/login/oauth/access_token")
            .header(ACCEPT, "application/json")
            .header(USER_AGENT, APP_USER_AGENT)
            .form(&params)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        let data: TokenResponse = response
            .json()
            .await
            .map_err(|e| format!("Invalid response: {}", e))?;

        if let Some(token) = data.access_token {
            return Ok(token);
        }

        if let Some(error) = data.error {
            // authorization_pending and slow_down mean "keep polling"
            match error.as_str() {
                "authorization_pending" => {
                    tokio::time::sleep(tokio::time::Duration::from_secs(interval_secs)).await;
                }
                "slow_down" => {
                    tokio::time::sleep(tokio::time::Duration::from_secs(interval_secs + 5)).await;
                }
                _ => {
                    let desc = data
                        .error_description
                        .unwrap_or_else(|| error.clone());
                    return Err(format!("{}: {}", error, desc));
                }
            }
        } else {
            tokio::time::sleep(tokio::time::Duration::from_secs(interval_secs)).await;
        }
    }
}

/// PKCE code_verifier: 43-128 chars, generate random base64url
fn pkce_code_verifier() -> String {
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// PKCE code_challenge = base64url(SHA256(code_verifier))
fn pkce_code_challenge(verifier: &str) -> String {
    let hash = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(hash)
}

const SUCCESS_HTML: &str = r#"<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sparky – Signed in</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html{background:#1e1e1e;min-height:100%}
body{margin:0;padding:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;font-size:16px;background:#1e1e1e;color:#e8e8e8}
p{margin:0;padding:2rem;text-align:center;max-width:320px;color:#e8e8e8}
</style>
</head><body style="background:#1e1e1e;color:#e8e8e8;margin:0"><p>Signed in successfully. You can close this window.</p></body></html>"#;

const ERROR_HTML: &str = r#"<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sparky – Error</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html{background:#1e1e1e;min-height:100%}
body{margin:0;padding:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;font-size:16px;background:#1e1e1e;color:#e8e8e8}
p{margin:0;padding:2rem;text-align:center;max-width:320px;color:#fca5a5}
</style>
</head><body style="background:#1e1e1e;color:#e8e8e8;margin:0"><p>Authentication failed. You can close this window.</p></body></html>"#;

/// Web flow: open browser, local server receives callback, exchange code for token.
pub async fn login_with_web_flow() -> Result<String, String> {
    let client_id = github_client_id()?;
    let client_secret = github_client_secret()?;

    let state: String = {
        let mut rng = rand::rng();
        (0..32).map(|_| char::from(rng.random_range(b'a'..=b'z'))).collect()
    };
    let code_verifier = pkce_code_verifier();
    let code_challenge = pkce_code_challenge(&code_verifier);

    let auth_url = format!(
        "https://github.com/login/oauth/authorize?client_id={}&redirect_uri={}&scope=read:user%20user:email%20repo&state={}&code_challenge={}&code_challenge_method=S256",
        client_id,
        urlencoding::encode(REDIRECT_URI),
        state,
        code_challenge
    );

    let (tx, rx) = oneshot::channel::<Result<String, String>>();
    let tx_shared = Arc::new(Mutex::new(Some(tx)));
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let shutdown_shared = Arc::new(Mutex::new(Some(shutdown_tx)));

    let state_callback = state.clone();
    let code_verifier_callback = code_verifier.clone();
    let client_id_callback = client_id.to_string();
    let client_secret_callback = client_secret.to_string();

    let addr = SocketAddr::from(([127, 0, 0, 1], REDIRECT_PORT));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("Could not bind to 127.0.0.1:8765. Is another app using that port? {}", e))?;

    let app = Router::new().route("/callback", get({
        let tx_shared = tx_shared.clone();
        let shutdown_shared = shutdown_shared.clone();
        let state = state_callback.clone();
        let code_verifier = code_verifier_callback.clone();
        let client_id = client_id_callback.clone();
        let client_secret = client_secret_callback.clone();
        move |Query(params): Query<CallbackQuery>| {
            let tx_shared = tx_shared.clone();
            let shutdown_shared = shutdown_shared.clone();
            let state = state.clone();
            let code_verifier = code_verifier.clone();
            let client_id = client_id.clone();
            let client_secret = client_secret.clone();
            async move {
                let trigger_shutdown = || {
                    if let Ok(mut guard) = shutdown_shared.lock() {
                        if let Some(sender) = guard.take() {
                            let _ = sender.send(());
                        }
                    }
                };
                let send_result = |r: Result<String, String>| {
                    if let Ok(mut guard) = tx_shared.lock() {
                        if let Some(sender) = guard.take() {
                            let _ = sender.send(r);
                        }
                    }
                    trigger_shutdown();
                };
                if let Some(err) = params.error {
                    send_result(Err(params.error_description.unwrap_or(err)));
                    return Html(ERROR_HTML).into_response();
                }
                let code = match params.code {
                    Some(c) => c,
                    None => {
                        send_result(Err("No code in callback".to_string()));
                        return Html(ERROR_HTML).into_response();
                    }
                };
                if params.state.as_deref() != Some(state.as_str()) {
                    send_result(Err("State mismatch".to_string()));
                    return Html(ERROR_HTML).into_response();
                }
                match exchange_code_for_token(&client_id, &client_secret, &code, &code_verifier).await {
                    Ok(token) => {
                        send_result(Ok(token.clone()));
                        Html(SUCCESS_HTML).into_response()
                    }
                    Err(e) => {
                        send_result(Err(e.clone()));
                        Html(ERROR_HTML).into_response()
                    }
                }
            }
        }
    }));

    let serve = axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = shutdown_rx.await;
        });
    let server_handle = tokio::spawn(async move {
        let _ = serve.await;
    });

    open::that(&auth_url).map_err(|e| format!("Could not open browser: {}", e))?;

    const LOGIN_TIMEOUT_SECS: u64 = 300; // 5 minutes
    let result = tokio::select! {
        res = rx => res.map_err(|e| format!("Callback failed: {}", e)),
        _ = tokio::time::sleep(std::time::Duration::from_secs(LOGIN_TIMEOUT_SECS)) => {
            // Timeout – trigger shutdown so port 8765 is released for next attempt
            if let Ok(mut guard) = shutdown_shared.lock() {
                if let Some(s) = guard.take() {
                    let _ = s.send(());
                }
            }
            Err("Login timed out. Please try again.".to_string())
        }
    }?;

    // Ensure server shuts down and releases port 8765 before returning
    let _ = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        server_handle,
    )
    .await;

    result
}

async fn exchange_code_for_token(
    client_id: &str,
    client_secret: &str,
    code: &str,
    code_verifier: &str,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let params = [
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("code", code),
        ("redirect_uri", REDIRECT_URI),
        ("code_verifier", code_verifier),
    ];
    let response = client
        .post("https://github.com/login/oauth/access_token")
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, APP_USER_AGENT)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let data: TokenResponse = response
        .json()
        .await
        .map_err(|e| format!("Invalid response: {}", e))?;

    if let Some(token) = data.access_token {
        return Ok(token);
    }
    let err = data
        .error_description
        .or(data.error)
        .unwrap_or_else(|| "Unknown error".to_string());
    Err(err)
}

pub async fn get_user(access_token: &str) -> Result<GitHubUserResult, String> {
    let client = reqwest::Client::new();

    let response = client
        .get("https://api.github.com/user")
        .header(ACCEPT, "application/vnd.github+json")
        .header(USER_AGENT, APP_USER_AGENT)
        .header(
            reqwest::header::AUTHORIZATION,
            format!("Bearer {}", access_token),
        )
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format_api_error(status, &text));
    }

    let user: GitHubUser = response
        .json()
        .await
        .map_err(|e| format!("Invalid response: {}", e))?;

    Ok(GitHubUserResult {
        login: user.login,
        id: user.id,
        avatar_url: user.avatar_url,
        name: user.name,
    })
}
