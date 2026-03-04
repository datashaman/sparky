# Sparky — Claude Code Project Instructions

## What This Is

Sparky is an AI-powered workflow engine that orchestrates Claude agents to groom, develop, review, and release Stories, Bugs, and Ops Requests. It uses the `claude_agent_sdk` package.

## Architecture

- **Models** (`models.py`): Pure dataclasses with enums. No methods beyond `ChangeSet.all_approved()`.
- **Tools** (`tools.py`): Factory functions returning `@tool`-decorated async closures. Each tool mutates a shared `state: dict` and appends to `history: list`. Tools never return data to Python callers through return values.
- **Agents** (`agents/`): Functions that configure and call `run_agent()` from `sdk.py`. Agent names in `allowed_tools` use the pattern `mcp__tools__<tool_name>`.
- **Workflows** (`workflows/`): Orchestration functions that chain agents, inspect `state` dicts for results, build domain objects (ChangeSet, Worktree, etc.), and implement HITL gates.
- **Sources** (`sources/`): `IssueSource` protocol with GitHub and Jira adapters for fetching real issues.
- **SDK** (`sdk.py`): Thin wrapper around `claude_agent_sdk`. Model is `claude-sonnet-4-6`. Creates in-process MCP servers from tool lists.
- **HITL** (`hitl.py`): `hitl_gate()` reads stdin via `asyncio.to_thread()` to avoid blocking the event loop.

## Conventions

- Everything is async. Entry point: `main()` → `asyncio.run(async_main())`.
- Multi-phase agents make multiple sequential `run_agent()` calls with different tool sets (e.g., `PlanningAgent:groom` then `PlanningAgent:worktree-scan`).
- Logging: two handlers — console at INFO, file (`sparky.log`) at DEBUG. Logger hierarchy under `"sparky"`.
- Python >= 3.13. Package manager: `uv`. Build backend: `uv_build`.
- Imports at the top of the file.

## Running

```bash
uv sync                          # install deps
sparky                           # hardcoded demo
sparky --github owner/repo       # GitHub issues
sparky --jira PROJECT_KEY        # Jira issues
```

## Environment Variables

- `ANTHROPIC_API_KEY` — required always
- `GITHUB_TOKEN` — required for `--github`
- `JIRA_URL`, `JIRA_USER`, `JIRA_TOKEN` — required for `--jira`
