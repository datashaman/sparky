# Sparky Architecture

## Overview

Sparky is a Tauri desktop application with a Rust backend and React frontend. Its purpose is to analyze GitHub issues, generate execution plans, and autonomously resolve them using LLM-driven tool use inside isolated git worktrees.

The frontend makes LLM API calls directly to cloud providers (OpenAI, Anthropic, Gemini, OpenRouter). Local providers (Ollama, LiteLLM) are proxied through the Rust backend to bypass browser CORS restrictions. Persistence uses SQLite via `@tauri-apps/plugin-sql`, stored at the platform's standard app config location (e.g., `~/Library/Application Support/{bundle-id}/sparky.db` on macOS).

## The Pipeline

An issue flows through five stages: analysis, planning, critic review, execution, and adaptive replanning. Each stage is a distinct module in `src/data/`.

### 1. Issue Analysis (`src/data/analyseIssue.ts`)

The analysis stage takes a GitHub issue and produces a structured assessment using the planning model. The LLM receives the issue body along with any existing skills and agents in the workspace (to avoid recommending duplicates).

The structured output includes:
- **summary** -- one to two sentence description
- **type** -- bug, feature, improvement, question, or other
- **complexity** -- low, medium, or high, with reasoning
- **approach** -- recommended strategy for resolution
- **considerations** -- technical aspects to keep in mind
- **skills** -- 1-3 recommended knowledge bodies, each with a name, description, and full markdown content
- **agents** -- 1-3 recommended specialized workers, each with a name, description, system prompt content, skill references, and tool IDs

The analysis recommends skills and agents but does not create them automatically. The user reviews and creates them through the UI before planning begins.

**Complexity-driven decomposition**: For high-complexity issues, the analysis LLM can decompose the issue into 2-5 smaller subissues using the `create_issue` tool. Each subissue is linked to the parent via "Part of #N" in the body. When decomposition occurs, the analysis result includes `decomposed: true` and a `subissues` array. The UI displays these with a purple "Decomposed" badge and links to the created subissues. Decomposed issues skip the planning and execution stages — each subissue is worked on independently.

The `update_issue` and `close_issue` tools are also available during analysis, but restricted to issues created in the current session (the agent cannot modify arbitrary issues).

### 2. Plan Generation (`src/data/generatePlan.ts`)

The planner takes the analysis result, available agents, and available skills, then produces a step-by-step execution plan. It uses the planning model with structured output.

Each plan contains:
- **goal** -- one-sentence goal statement
- **steps** -- ordered execution steps
- **success_criteria** -- how to verify the issue is resolved

Each step specifies:
- **order** -- 1-based step number
- **title** and **description** -- what to do
- **expected_output** -- what the step should produce
- **depends_on** -- order numbers of prerequisite steps
- **agent_name** -- name of a specialized agent to delegate to, or null if the issue LLM handles it directly

The planner is instructed to keep plans minimal. Every step must represent real work (exploring code, making changes, running tests). Most steps should be handled by the issue LLM directly; agent delegation is only for cases where specialized focus adds clear value. Skills are not allocated to steps -- the LLM invokes them on demand at runtime via the `use_skill` tool.

### 3. Critic Review (`src/data/criticPlan.ts`)

After generation, the plan goes through a critic review using the planning model. The critic evaluates five dimensions:

- **Missing steps** -- are there obvious tasks the plan forgot?
- **Bad dependencies** -- are step dependencies correct and complete?
- **Over-decomposition** -- are steps too granular when they could be combined?
- **Feasibility** -- can each step be accomplished with the available tools and context?
- **Ordering** -- are steps in a logical sequence?

The critic returns a verdict (pass or fail) with a list of issues, each having a severity (error, warning, info), an optional step reference, a description, and a suggestion.

If the verdict is **fail**, the plan enters one refinement cycle: the original plan, critic feedback, and full context are sent to the planning model to produce a corrected plan. The corrected plan is then re-reviewed so the stored verdict reflects its final state. There is no second refinement cycle -- after one correction attempt, the result is accepted regardless of the re-review verdict.

### 4. Execution (`src/data/executePlan.ts`)

Execution is the core loop that actually resolves the issue. It operates inside an isolated git worktree.

**Setup:**
1. Resolve the execution model (may differ from the planning model)
2. Create or reuse a git worktree for the issue
3. Load all workspace agents and skills into lookup maps
4. Mark all steps as pending

**Step execution loop** (while-loop over a mutable step array):

For each step:
1. Verify all dependency steps have completed
2. Resolve the agent if `agent_name` is specified -- this overrides the provider, model, and available tools
3. Build a system prompt containing: the issue context, step instructions, agent instructions (if delegated), and a list of available skills (callable via `use_skill`)
4. Build a user prompt with context from dependency step outputs and the issue body
5. Call the LLM in a tool-use loop (`callLLMWithTools`) with the resolved tools
6. Store the step output for downstream dependency context
7. After each step, run an adaptive replan check (see below)

**Agent delegation** works by overriding the execution context for that step: the agent's own provider/model is used, its system prompt content is injected, and its tool set replaces the default. If an agent has no tools configured, it defaults to read-only tools (read, glob, grep). The `use_skill` tool is always available regardless of agent tool restrictions.

**Execution logging**: The execution engine emits real-time log events via an `onLog` callback. Events include LLM requests/responses, tool calls/results, and replan checks/decisions. Each entry carries a timestamp, step order, and type-specific metadata. The UI displays these in a collapsible, auto-scrolling log panel per step.

**Max turns**: Each step has a turn limit (agent's `max_turns` or default 25). On the last turn, the LLM is told to summarize what it accomplished and what remains rather than making more tool calls.

### 5. Adaptive Replanning (`src/data/replanCheck.ts`)

After each step completes, the system checks whether the remaining steps are still valid given what actually happened. This uses the execution model (it is a quick judgment call, not a reasoning-heavy task).

The replan check is **conservative**: it only triggers on clear mismatches between what a step produced and what the remaining steps expect. Minor deviations are tolerated.

If replanning is triggered:
1. The completed steps and their outputs are gathered as context
2. The **planning model** (not the execution model) regenerates the remaining steps, since this is a reasoning task
3. The step array is replaced in-place: completed steps are preserved, remaining steps are swapped out
4. New steps are marked as pending and the UI is notified
5. Execution continues from where it left off

Replan check failures are non-fatal. If the check itself errors, execution continues with the existing plan.

## Two-Model Architecture

Sparky separates planning from execution at the model level, configured independently in Settings:

- **Planning model** (Settings: Analysis/Planning) -- used for issue analysis, plan generation, critic review, plan refinement, and step regeneration during replanning. These tasks require strong reasoning.
- **Execution model** (Settings: Execution) -- used for step execution and replan checks. These tasks are more mechanical (following instructions, using tools) and can use a cheaper or faster model.

**Agent-specific overrides**: Each agent stores its own `provider` and `model`. When a step is delegated to an agent, the agent's model is used instead of the execution model. This allows mixing providers within a single plan -- for example, using a local Ollama model for code generation steps while using a cloud model for review steps.

## Agent and Skill System

**Skills** are reusable bodies of knowledge stored as markdown content. They have a name, description, and content body. During execution, all workspace skills are listed in the system prompt and the LLM can load any skill on demand by calling the `use_skill` tool with the skill's name and optional arguments. Skills are workspace-scoped: they are available to any step within that workspace.

**Agents** are specialized workers with their own configuration:
- **System prompt** (`content` field) -- defines the agent's role, behavior, constraints, and workflow
- **Provider and model** -- can differ from the default execution model
- **Skills** -- skills can be associated with an agent (via `agent_skills`) for organization. All workspace skills are accessible at runtime via `use_skill`.
- **Tools** -- the subset of sandbox tools the agent can access (see Tool Sandbox below); `use_skill` is always available
- **Max turns** -- per-agent turn limit for the tool-use loop
- **Background flag** -- for future use

The analysis stage recommends both skills and agents. The user reviews these recommendations and creates them through the UI. The planner then references existing agents by name when building the execution plan.

## Tool Sandbox

Eleven tools are available. Six are file/shell operations implemented as Tauri commands in Rust (`src-tauri/src/agent_tools.rs`). Two are always-on interaction tools. Three are GitHub issue tools available only during analysis:

| Tool | LLM Name | Description | Dangerous | Availability |
|------|----------|-------------|-----------|-------------|
| Read | `read_file` | Read a file's contents | No | All phases |
| Write | `write_file` | Create or overwrite a file | Yes | All phases |
| Edit | `edit_file` | Find-and-replace text in a file (old_text must be unique) | Yes | All phases |
| Glob | `glob` | Find files matching a glob pattern | No | All phases |
| Grep | `grep` | Search file contents with regex | No | All phases |
| Bash | `bash` | Run a shell command | Yes | All phases |
| Skill | `use_skill` | Load a skill's content by name (with optional arguments) | No | All phases |
| Ask User | `ask_user` | Ask the user a clarifying question | No | All phases |
| Create Issue | `create_issue` | Create a GitHub subissue linked to the parent | Yes | Analysis only |
| Update Issue | `update_issue` | Update a subissue's title or body (session-scoped) | Yes | Analysis only |
| Close Issue | `close_issue` | Close a subissue created in this session | Yes | Analysis only |

**Sandbox enforcement**: All file operations go through `sandbox_resolve`, which canonicalizes paths and verifies they do not escape the worktree root. For non-existent paths (write targets), it walks up to the nearest existing ancestor and validates that ancestor is within the sandbox.

**Agent tool restriction**: When a step is delegated to an agent, only the agent's configured tools are provided to the LLM. Agents with no tools configured default to read-only: read, glob, and grep. The `use_skill` tool is always included regardless of agent restrictions. This prevents an unconfigured agent from accidentally modifying files while still allowing skill access.

**Bash command allowlist**: The bash tool validates that the command starts with an allowed program. The allowlist includes common filesystem commands (`ls`, `find`, `cat`, `cp`, `mv`, `rm`), build tools (`npm`, `cargo`, `make`, `python`), git, and text processing utilities (`sed`, `awk`, `grep`). Commands not on the list are rejected. The command runs with a restricted `PATH` (`/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`) and `HOME` set to the worktree root.

**Result truncation**: All tool results are truncated to 10,000 characters to avoid overwhelming the LLM context.

## Git Worktree Isolation

Each issue gets its own git worktree to prevent concurrent work from interfering:

- **Branch naming**: `sparky/issue-{number}`
- **Worktree location**: under the app's data directory, managed by the Rust backend
- **Lifecycle**: the frontend calls `ensureWorktree` before execution, which clones or fetches the repo and creates the worktree. If one already exists in "ready" state, it is reused.
- **All tool operations are sandboxed to the worktree path** -- there is no access to the main repo or other worktrees.
- **Cleanup**: `removeWorktree` removes the worktree via git and deletes the database record.

Worktree status is tracked in the database with states: creating, ready, error, removing.

## Database

SQLite with auto-migration on first connection. Migrations are idempotent -- `CREATE TABLE IF NOT EXISTS` for tables, error-tolerant `ALTER TABLE ADD COLUMN` for schema evolution.

**Tables:**

| Table | Purpose |
|-------|---------|
| `workspaces` | Named groupings for repos |
| `repos` | GitHub repositories (full_name, owner, name, url) |
| `workspace_repos` | Many-to-many join between workspaces and repos |
| `agents` | Agent definitions (name, description, content/system prompt, provider, model, max_turns) |
| `skills` | Skill definitions (name, description, content/knowledge body) |
| `agent_skills` | Many-to-many join: which skills are assigned to which agents |
| `agent_tools` | Many-to-many join: which tool IDs are assigned to which agents |
| `issue_analyses` | Analysis runs with status tracking and JSON result |
| `execution_plans` | Plan generation runs with status tracking and JSON result |
| `issue_worktrees` | Worktree records with branch name, path, and status |
| `execution_step_results` | Per-step execution results (status, output, error) keyed by plan_id + step_order |

All entities use UUID primary keys (`crypto.randomUUID()`). Timestamps are ISO 8601 strings. The analysis result and plan result are stored as serialized JSON in a `result` TEXT column.

## Provider Architecture

Sparky supports six LLM providers:

| Provider | Structured Output | Tool Use | Connection |
|----------|------------------|----------|------------|
| OpenAI | `json_schema` response format | OpenAI function calling | Direct fetch |
| Anthropic | `json_schema` output config | Native tool_use blocks | Direct fetch |
| Gemini | `responseSchema` generation config | Native functionCall/functionResponse | Direct fetch |
| OpenRouter | `json_schema` response format (OpenAI-compatible) | OpenAI function calling | Direct fetch |
| Ollama | `json_object` + schema in system prompt | OpenAI function calling | Proxied through Rust |
| LiteLLM | `json_schema` response format (OpenAI-compatible) | OpenAI function calling | Proxied through Rust |

**Two code paths for LLM calls:**
- `callLLM` -- single-shot structured output (used by analysis, planning, critic, replan check). Provider-specific request formatting, returns the parsed text.
- `callLLMWithTools` -- multi-turn tool-use loop (used by execution). Three implementations: `anthropicToolLoop` (native Anthropic format), `openaiToolLoop` (shared by OpenAI, OpenRouter, Ollama, LiteLLM), and `geminiToolLoop` (native Gemini format). Accepts an optional `onLog` callback for real-time execution logging of LLM requests, responses, tool calls, and results.

**Local provider proxying**: Ollama and LiteLLM run locally and do not set CORS headers. When running inside Tauri, requests are routed through Rust backend commands (`ollama_chat`, `litellm_chat`) that make the HTTP call server-side. Outside Tauri (development), direct fetch is attempted as a fallback.

**Dynamic model lists**: Ollama, OpenRouter, and LiteLLM support fetching available models at runtime (`src/data/ollamaModels.ts`, `src/data/openrouterModels.ts`, `src/data/litellmModels.ts`), so the user sees what is actually available rather than a hardcoded list.
