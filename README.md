# Sparky

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

AI-powered GitHub issue resolution, right from your desktop.

Sparky is a Tauri desktop app that takes a GitHub issue and drives it through a full resolution pipeline: **analysis, planning, critic review, execution, and adaptive replanning** -- all powered by your choice of LLM provider.

Work happens in sandboxed git worktrees, so your main branch stays clean.

## Features

- **Automated Issue Resolution** -- Point Sparky at a GitHub issue and it autonomously analyzes, plans, and implements a solution
- **Multi-Phase AI Pipeline** -- Issues flow through Analysis, Planning, Critic Review, and Execution stages for higher-quality results
- **Dual-Model Architecture** -- Uses powerful reasoning models (Opus-class) for planning and fast models (Sonnet-class) for execution, optimizing cost and quality
- **6 LLM Providers** -- Works with OpenAI, Anthropic, Gemini, Ollama, OpenRouter, and LiteLLM -- use cloud or run fully local
- **Sandboxed Execution** -- All file edits and shell commands run inside isolated git worktrees, keeping your main branch safe
- **Built-in Tool Suite** -- Agents can read, write, search, and run shell commands with an allowlist-based security model
- **Agents & Skills** -- Define reusable AI agents and callable skills scoped to your workspace for domain-specific automation
- **Critic Review** -- Plans are automatically reviewed and refined by a critic agent before execution begins
- **Adaptive Replanning** -- If execution hits a wall, the agent re-plans on the fly instead of failing
- **Subissue Decomposition** -- High-complexity issues are automatically broken into smaller, linked subissues on GitHub
- **Interactive Clarification** -- The agent can ask you questions mid-analysis or mid-execution when it encounters ambiguity
- **Session Durability** -- Pipeline execution runs in a background worker process, surviving app restarts
- **Desktop App** -- Native macOS app built with Tauri -- fast, lightweight, and runs locally
- **GitHub Integration** -- OAuth device flow authentication, repo cloning, worktree management, and issue tracking built in
- **Local Model Support** -- Run entirely offline with Ollama or LiteLLM -- no data leaves your machine
- **Workspace Management** -- Organize repos, configure providers, and track execution history per workspace
- **Execution Logs** -- Full transparency into every LLM call, tool invocation, and decision the agent makes

## Quickstart

### Prerequisites

- [Node.js](https://nodejs.org/) (v24+)
- [Rust](https://rustup.rs/) (stable)

### Install and run

```bash
git clone https://github.com/datashaman/sparky.git
cd sparky
npm install
npm run tauri dev
```

### First run

1. **Connect GitHub** -- Sparky uses OAuth device flow. Follow the on-screen prompts to authenticate.
2. **Create a workspace** -- Group your repos however you like.
3. **Add a repo** -- Pick any GitHub repo you have access to.
4. **Select an issue** -- Choose an open issue to resolve.
5. **Configure your provider** -- Go to Settings and set your LLM provider and API key.
6. **Run the pipeline** -- Hit **Analyze**, review the output, then **Plan**, then **Execute**.

## Pipeline overview

Each issue flows through five stages:

| Stage | What happens |
|-------|-------------|
| **Analysis** | AI reads the issue, classifies type and complexity, and outlines an approach |
| **Planning** | Generates a step-by-step plan with task dependencies |
| **Critic Review** | A separate LLM pass validates the plan and suggests refinements |
| **Execution** | The LLM executes each step using sandboxed tools in an isolated git worktree |
| **Adaptive Replanning** | If execution diverges from the plan, remaining steps are automatically adjusted |

For a deeper look at internals, see [docs/architecture.md](docs/architecture.md).

## Supported providers

| Provider | Type | API Key |
|----------|------|---------|
| OpenAI | Cloud | Required |
| Anthropic | Cloud | Required |
| Gemini | Cloud | Required |
| Ollama | Local | Not needed |
| OpenRouter | Cloud | Required |
| LiteLLM | Local proxy | Optional |

Set your provider and API key in **Settings** within the app. You can use different providers for different pipeline stages (e.g., a stronger model for planning, a faster one for execution).

## Project structure

```
sparky/
├── src/                  # React frontend (TypeScript)
│   ├── components/       # UI components (workspace, analysis, plan views)
│   ├── data/             # Data layer and type definitions
│   ├── lib/              # Shared utilities
│   └── db.ts             # SQLite database interface
├── sparky-worker/        # Node.js worker process (pipeline execution)
│   └── src/
│       ├── pipeline/     # Analysis, plan, and execution pipelines
│       ├── llm/          # LLM provider integrations (Anthropic, OpenAI, Gemini)
│       └── tools/        # Sandboxed tool implementations
├── src-tauri/            # Rust backend
│   └── src/
│       ├── lib.rs        # Tauri command handlers
│       ├── git_ops.rs    # Git worktree management
│       ├── agent_tools.rs # Sandboxed tool execution
│       ├── github_auth.rs # OAuth device flow
│       └── *_proxy.rs    # Local provider proxies (Ollama, LiteLLM)
├── docs/                 # Architecture and design docs
└── package.json
```

## License

Licensed under the [Apache License 2.0](LICENSE).
