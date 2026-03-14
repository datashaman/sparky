# Sparky

AI-powered GitHub issue resolution, right from your desktop.

Sparky is a Tauri desktop app that takes a GitHub issue and drives it through a full resolution pipeline: **analysis, planning, critic review, execution, and adaptive replanning** -- all powered by your choice of LLM provider.

Work happens in sandboxed git worktrees, so your main branch stays clean.

## Quickstart

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://rustup.rs/) (stable)
- [Tauri CLI](https://tauri.app/start/): `cargo install tauri-cli`

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

For a deeper look at internals, see [docs/agent-platform-internals-report.md](docs/agent-platform-internals-report.md).

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
│   ├── lib/              # LLM pipeline logic (agents, skills, tools)
│   └── db.ts             # SQLite database interface
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

Private project.
