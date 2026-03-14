# Sparky — AI-Powered GitHub Issue Resolution

- **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS v4
- **Backend:** Rust (Tauri v2 commands)
- **Worker:** Node.js process for pipeline execution
- **Database:** SQLite via better-sqlite3 (worker) and @tauri-apps/plugin-sql (frontend)

## Commands

```
npm run tauri dev     # Development
npm run tauri build   # Production build
npx tsc --noEmit      # TypeScript check
cargo check           # Rust check (run from src-tauri/)
```

## Project Structure

```
src/                          # React frontend
  components/                 # UI components
  data/                       # Data layer, LLM integration, tools
  lib/                        # Shared utilities
  db.ts                       # Database schema and migrations
sparky-worker/                # Node.js worker process
  src/
    pipeline/                 # Analysis, plan, execution pipelines
    llm/                      # LLM provider loops (anthropic, openai, gemini)
    tools/                    # Sandboxed tool implementations
    types.ts                  # Worker type definitions
    db.ts                     # Worker database access (better-sqlite3)
src-tauri/
  src/
    lib.rs                    # Tauri command registration
    agent_tools.rs            # Sandboxed file/shell tools
    git_ops.rs                # Git clone/worktree operations
    github_auth.rs            # OAuth device flow
    ollama_proxy.rs           # Ollama CORS proxy
    litellm_proxy.rs          # LiteLLM CORS proxy
    execution_log.rs          # Execution logging
```

## Architecture

- **Pipeline:** Issue -> Analysis -> Plan (+ Critic) -> Execution (+ Replanning)
- **Two model tiers:** planning (Opus-class) and execution (Sonnet-class)
- **6 providers:** OpenAI, Anthropic, Gemini, Ollama, OpenRouter, LiteLLM
- **Agents/Skills:** workspace-scoped; skills callable on demand via `use_skill` tool
- **Tools:** sandboxed to git worktree, 8 tools (6 file/shell + use_skill + ask_user) with allowlist

## Key Files

| File | Purpose |
|------|---------|
| `src/data/llm.ts` | Frontend LLM API integration (callLLM, callLLMWithTools, provider loops) |
| `src/data/executePlan.ts` | Execution engine with tool-use loop |
| `src/data/generatePlan.ts` | Plan generation with critic review |
| `src/data/analyseIssue.ts` | Issue analysis with structured output |
| `src/data/types.ts` | All TypeScript interfaces |
| `src/data/tools.ts` | Tool schemas and handler |
| `src/data/agents.ts` | Agent/provider/model definitions |
| `src/components/WorkspaceDetail.tsx` | Main workspace UI (large file) |
| `src/components/UserSettings.tsx` | Provider/model configuration |
| `sparky-worker/src/pipeline/analyse.ts` | Worker analysis pipeline |
| `sparky-worker/src/pipeline/plan.ts` | Worker plan generation + critic |
| `sparky-worker/src/pipeline/execute.ts` | Worker execution + replanning |
| `sparky-worker/src/llm/index.ts` | Worker LLM routing (callLLM, callLLMWithTools) |
| `sparky-worker/src/tools/index.ts` | Worker tool schemas + handler |

## Conventions

- TypeScript strict mode
- Provider type: `AgentProvider` union in `types.ts`
- Models: `AGENT_MODELS` in `agents.ts` (empty array = dynamic fetch)
- Database migrations: add to `ADDITIONAL_TABLES` in `db.ts` (uses `IF NOT EXISTS`)
- Tauri commands: add to `lib.rs` `invoke_handler` macro

## Adding a New Provider

1. Add to `AgentProvider` type in `src/data/types.ts`
2. Add to `AGENT_PROVIDERS` and `AGENT_MODELS` in `src/data/agents.ts`
3. Add case to `callLLM` and `callLLMWithTools` in `src/data/llm.ts`
4. If local: create proxy module in `src-tauri/src/`, register in `lib.rs`
5. If dynamic models: create `src/data/{provider}Models.ts`
6. Add `PROVIDER_COLORS` in `AgentsList`, `SkillsList`, `SkillDetail`
7. Add to `UserSettings` validation strings and model selector logic
8. Add to `KEYLESS_PROVIDERS` if no API key needed
9. Update all 5 model selector components (`UserSettings`, `AgentsList`, `AgentDetail`, `SkillsList`, `SkillDetail`)
