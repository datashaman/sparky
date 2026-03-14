# Sparky Setup Guide

## Prerequisites

Before you begin, make sure you have:

- **Node.js 18+** — check with `node --version`
- **Rust (latest stable)** — install via [rustup](https://rustup.rs/)
- **Tauri CLI v2** — install with `cargo install tauri-cli`
- **A GitHub account** — for authentication and repo integration
- **At least one LLM provider configured** — see [Provider Configuration](#provider-configuration) below

## Installation

Clone the repository and start the development build:

```bash
git clone https://github.com/datashaman/sparky.git
cd sparky
npm install
npm run tauri dev
```

This compiles the Rust backend, bundles the frontend, and opens the app window.

## GitHub Authentication

1. Click the **Settings** gear icon in the app.
2. Click **Login with GitHub**.
3. Follow the OAuth device flow or web flow prompt.
4. Once authenticated, your token is stored in localStorage.

You need this to create issues, read repos, and use GitHub-backed features.

## Provider Configuration

Sparky uses two model tiers:

| Tier | Purpose | Recommended choice |
|------|---------|-------------------|
| **Analysis / Planning** | Reasoning-heavy tasks (specs, plans, critique) | A strong reasoning model (e.g. opus, o1) |
| **Execution** | Implementation grunt work (code gen, refining) | A cheaper/faster model (e.g. sonnet, gpt-4o) |

To configure a provider:

1. Open the **Settings** panel.
2. Select a provider from the dropdown.
3. Enter your API key (not needed for Ollama or LiteLLM).
4. Select or type a model name.
5. Repeat for both the Analysis/Planning and Execution tiers.

## Local Provider Setup

If you prefer to run models locally, Sparky supports Ollama and LiteLLM.

### Ollama

1. Install Ollama from [ollama.com](https://ollama.com).
2. Pull a model:
   ```bash
   ollama pull qwen2.5
   ```
3. Ollama runs at `localhost:11434` by default.
4. In Sparky Settings, select **ollama** as the provider and pick your model from the dropdown.

No API key is needed.

### LiteLLM

1. Install the proxy:
   ```bash
   pip install litellm[proxy]
   ```
2. Start it with a model:
   ```bash
   litellm --model gpt-4o
   ```
   Or point it at a `config.yaml` for more complex setups.
3. LiteLLM runs at `localhost:4000` by default.
4. In Sparky Settings, select **litellm** as the provider.

No API key is needed for the local proxy itself (your upstream provider keys go in the LiteLLM config).

## Building for Production

To create a release build:

```bash
npm run tauri build
```

The output binary is placed in `src-tauri/target/release/bundle/`.

## Database

Sparky uses SQLite for local storage.

- The database file lives in the OS app data directory (managed by Tauri).
- Migrations run automatically on startup.
- No manual database setup is needed.
