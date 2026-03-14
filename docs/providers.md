# Provider Reference

Sparky supports multiple LLM providers. Each provider can be selected in the settings panel, along with the specific model to use.

## Two-Tier Model Configuration

Sparky uses a two-tier model system:

- **Analysis/Planning model** -- used for reasoning-heavy tasks such as analysis, planning, and critic review.
- **Execution model** -- used for step execution. This can be a cheaper or faster model to reduce cost and latency.

If the execution model is not set, it falls back to the planning model. Individual agents can override the provider and model with their own settings.

---

## OpenAI

**API key required.** Set your OpenAI API key in the settings panel.

### Available Models

| Model | Notes |
|-------|-------|
| gpt-5.4 | Latest flagship |
| gpt-5.2 | |
| gpt-5-mini | Cost-efficient |
| o4-mini | Reasoning model |
| o3 | Reasoning model |
| o3-mini | Reasoning model (compact) |
| gpt-4.1 | |
| gpt-4.1-mini | |
| gpt-4o | |
| gpt-4o-mini | |

### Special Notes

- Supports structured output via `json_schema` response format.
- Supports tool calling.
- API calls are made directly from the frontend.

---

## Anthropic

**API key required.** Set your Anthropic API key in the settings panel.

### Available Models

| Model | Notes |
|-------|-------|
| claude-opus-4-6 | Most capable |
| claude-sonnet-4-6 | Balanced performance |
| claude-opus-4-5 | |
| claude-sonnet-4-5 | |
| claude-haiku-4-5 | Fast and lightweight |

### Special Notes

- Uses Anthropic's native `tool_use` format for tool calling.
- Direct browser access header is enabled for API calls from the frontend.

---

## Gemini

**API key required.** Use a Google AI API key, obtainable from Google AI Studio.

### Available Models

| Model | Notes |
|-------|-------|
| gemini-2.5-pro | Most capable |
| gemini-2.5-flash | Fast |
| gemini-2.5-flash-lite | Lightweight |
| gemini-2.0-flash | |

### Special Notes

- Uses the `functionCall` format for tool calling.
- Uses `responseSchema` for structured output.

---

## Ollama

**No API key needed.** Ollama runs locally on your machine.

### Setup

1. Install from [ollama.com](https://ollama.com).
2. Pull the models you want to use:
   ```
   ollama pull <model>
   ```
3. The Ollama server runs at `localhost:11434`.

### Available Models

The model dropdown is dynamically populated from your locally pulled models.

### Special Notes

- Requests are proxied through the Tauri backend to bypass CORS restrictions.
- Uses `json_object` format for structured output, with the schema provided in the system prompt.

---

## OpenRouter

**API key required.** Get a key at [openrouter.ai/keys](https://openrouter.ai/keys).

### Available Models

344+ models from multiple providers. The model dropdown is dynamically populated from the `/api/v1/models` endpoint.

### Special Notes

- Uses an OpenAI-compatible API format.

---

## LiteLLM

**API key is optional**, depending on your deployment configuration.

### Setup

1. Install the proxy:
   ```
   pip install litellm[proxy]
   ```
2. Run with a single model:
   ```
   litellm --model <model>
   ```
   Or use a `config.yaml` for multiple models.
3. The proxy runs at `localhost:4000`.

### Available Models

The model dropdown is dynamically populated from the `/v1/models` endpoint.

### Special Notes

- Requests are proxied through the Tauri backend to bypass CORS restrictions.
- LiteLLM acts as a unified proxy, so you can use it to access models from any supported backend provider.
