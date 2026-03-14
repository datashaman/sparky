use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;
use std::time::Duration;

static LITELLM_CHAT_CLIENT: LazyLock<Client> = LazyLock::new(|| {
    Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .expect("Failed to create LiteLLM chat client")
});

static LITELLM_LIST_CLIENT: LazyLock<Client> = LazyLock::new(|| {
    Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .expect("Failed to create LiteLLM list client")
});

#[derive(Serialize)]
pub struct LitellmResponse {
    pub status: u16,
    pub body: String,
}

#[tauri::command]
pub async fn litellm_chat(body: String, api_key: String) -> Result<LitellmResponse, String> {
    let mut req = LITELLM_CHAT_CLIENT
        .post("http://localhost:4000/v1/chat/completions")
        .header("content-type", "application/json");

    if !api_key.is_empty() {
        req = req.header("authorization", format!("Bearer {}", api_key));
    }

    let res = req
        .body(body)
        .send()
        .await
        .map_err(|e| format!("LiteLLM request failed: {}", e))?;

    let status = res.status().as_u16();
    let body = res
        .text()
        .await
        .map_err(|e| format!("Failed to read LiteLLM response: {}", e))?;

    Ok(LitellmResponse { status, body })
}

#[derive(Deserialize)]
struct OpenAIModelsResponse {
    data: Vec<OpenAIModelEntry>,
}

#[derive(Deserialize)]
struct OpenAIModelEntry {
    id: String,
}

#[tauri::command]
pub async fn litellm_list_models(api_key: String) -> Result<Vec<String>, String> {
    let mut req = LITELLM_LIST_CLIENT
        .get("http://localhost:4000/v1/models");

    if !api_key.is_empty() {
        req = req.header("authorization", format!("Bearer {}", api_key));
    }

    let res = req
        .send()
        .await
        .map_err(|e| format!("LiteLLM request failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("LiteLLM API {}", res.status()));
    }

    let models: OpenAIModelsResponse = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse LiteLLM response: {}", e))?;

    Ok(models.data.into_iter().map(|m| m.id).collect())
}
