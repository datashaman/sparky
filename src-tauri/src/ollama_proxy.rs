use reqwest::Client;
use serde::{Deserialize, Serialize};
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

#[derive(Deserialize)]
struct OllamaTagsResponse {
    models: Vec<OllamaModelEntry>,
}

#[derive(Deserialize)]
struct OllamaModelEntry {
    name: String,
}

static OLLAMA_LIST_CLIENT: LazyLock<Client> = LazyLock::new(|| {
    Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .expect("Failed to create Ollama list client")
});

#[tauri::command]
pub async fn ollama_list_models() -> Result<Vec<String>, String> {
    let res = OLLAMA_LIST_CLIENT
        .get("http://localhost:11434/api/tags")
        .send()
        .await
        .map_err(|e| format!("Ollama request failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Ollama API {}", res.status()));
    }

    let tags: OllamaTagsResponse = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

    Ok(tags.models.into_iter().map(|m| m.name).collect())
}
