use reqwest::Client;
use serde::Serialize;
use std::sync::LazyLock;
use std::time::Duration;

static OLLAMA_CLIENT: LazyLock<Client> = LazyLock::new(|| {
    Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .expect("Failed to create Ollama HTTP client")
});

#[derive(Serialize)]
pub struct OllamaResponse {
    pub status: u16,
    pub body: String,
}

#[tauri::command]
pub async fn ollama_chat(body: String) -> Result<OllamaResponse, String> {
    let res = OLLAMA_CLIENT
        .post("http://localhost:11434/v1/chat/completions")
        .header("content-type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("Ollama request failed: {}", e))?;

    let status = res.status().as_u16();
    let body = res
        .text()
        .await
        .map_err(|e| format!("Failed to read Ollama response: {}", e))?;

    Ok(OllamaResponse { status, body })
}
