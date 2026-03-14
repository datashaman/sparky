# Tools Reference

11 tools are available. Six are file/shell operations confined to the issue's git worktree (path escape prevented by `sandbox_resolve`). Two are always-on interaction tools (`use_skill`, `ask_user`). Three are GitHub issue tools (`create_issue`, `update_issue`, `close_issue`) available only during the analysis phase.

## read_file

Read a file's contents.

| Field | Value |
|---|---|
| **Parameters** | `file_path` (string, relative to worktree root) |
| **Returns** | File text content |
| **Dangerous** | No |

Results are truncated at 10,000 characters.

## write_file

Create or overwrite a file.

| Field | Value |
|---|---|
| **Parameters** | `file_path` (string), `content` (string) |
| **Returns** | `"File written successfully."` |
| **Dangerous** | Yes |

Creates parent directories automatically.

## edit_file

Find-and-replace text in a file.

| Field | Value |
|---|---|
| **Parameters** | `file_path` (string), `old_text` (string), `new_text` (string) |
| **Returns** | `"Edit applied successfully."` |
| **Dangerous** | Yes |

`old_text` must appear exactly once in the file (uniqueness enforced).

## glob

Find files matching a glob pattern.

| Field | Value |
|---|---|
| **Parameters** | `pattern` (string, e.g. `**/*.ts`) |
| **Returns** | Newline-delimited relative file paths (truncated at 10,000 chars) |
| **Dangerous** | No |

## grep

Search file contents with regex.

| Field | Value |
|---|---|
| **Parameters** | `pattern` (string), `glob_filter` (optional string, e.g. `*.ts`) |
| **Returns** | Newline-delimited `file:line:text` entries, or "No matches found." (truncated at 10,000 chars) |
| **Dangerous** | No |

Uses `-rn -e` flags for safe pattern handling.

## bash

Run a shell command in the worktree.

| Field | Value |
|---|---|
| **Parameters** | `command` (string) |
| **Returns** | Combined text: stdout, then `STDERR: ...` if present, then `Exit code: N` (truncated at 10,000 chars) |
| **Dangerous** | Yes |

Command must start with an allowed program. Restricted `PATH` and `HOME` env.

### Allowed bash commands

`ls`, `find`, `cat`, `head`, `tail`, `wc`, `sort`, `uniq`, `diff`, `mkdir`, `cp`, `mv`, `rm`, `touch`, `git`, `npm`, `npx`, `node`, `cargo`, `rustc`, `python`, `python3`, `pip`, `pip3`, `make`, `cmake`, `echo`, `printf`, `test`, `true`, `false`, `sed`, `awk`, `cut`, `tr`, `xargs`, `which`, `env`, `pwd`, `date`, `tsc`, `eslint`, `prettier`

## use_skill

Load a workspace skill's content by name.

| Field | Value |
|---|---|
| **Parameters** | `skill_name` (string, required), `arguments` (string, optional — customizes the skill's output) |
| **Returns** | Skill markdown content (truncated at 10,000 chars), or error if skill not found |
| **Dangerous** | No |

Always available, even when an agent has restricted tools. The LLM decides at runtime which skills to call based on the task at hand. Skills are not pre-allocated to plan steps.

## ask_user

Ask the user a question to clarify intent or get direction.

| Field | Value |
|---|---|
| **Parameters** | `question` (string, required), `options` (string array, required), `allow_multiple` (boolean, optional) |
| **Returns** | `"User selected: ..."` or `"User did not select any option."` |
| **Dangerous** | No |

Always available. Presents the user with a multiple-choice prompt and waits for a response.

## create_issue

Create a GitHub subissue linked to the parent issue.

| Field | Value |
|---|---|
| **Parameters** | `title` (string, required), `body` (string, required), `labels` (string array, optional) |
| **Returns** | `"Created issue #N: <url>"` |
| **Dangerous** | Yes |
| **Availability** | Analysis phase only |

Automatically appends "Part of #N" to the body, linking the subissue to the parent. The created issue number is tracked in the session for use by `update_issue` and `close_issue`.

## update_issue

Update a subissue's title or body.

| Field | Value |
|---|---|
| **Parameters** | `issue_number` (number, required), `title` (string, optional), `body` (string, optional) |
| **Returns** | `"Issue #N updated."` |
| **Dangerous** | Yes |
| **Availability** | Analysis phase only |

Restricted to issues created by the agent in the current session. Attempting to update any other issue returns an error.

## close_issue

Close a subissue created by the agent.

| Field | Value |
|---|---|
| **Parameters** | `issue_number` (number, required), `reason` (enum: `"completed"` or `"not_planned"`, required) |
| **Returns** | `"Issue #N closed (reason)."` |
| **Dangerous** | Yes |
| **Availability** | Analysis phase only |

Restricted to issues created by the agent in the current session. The `reason` maps to GitHub's `state_reason` field.

## Security Model

1. **Path sandboxing** -- All paths resolved against worktree root; no escape possible.
2. **Unique match requirement** -- `edit_file` requires `old_text` to match exactly once, preventing accidental bulk changes.
3. **Safe defaults for agents** -- Agents default to read-only tools (`read_file`, `glob`, `grep`), plus `use_skill` and `ask_user`.
4. **Explicit dangerous tool grants** -- Dangerous tools (`write_file`, `edit_file`, `bash`) must be explicitly granted to agents.
5. **Bash command allowlist** -- Prevents arbitrary program execution.
6. **Output truncation** -- Output truncated to 10,000 characters to prevent context overflow.
7. **Always-available interaction tools** -- `use_skill` and `ask_user` are included in all tool sets regardless of agent restrictions.
8. **GitHub tool session scoping** -- `update_issue` and `close_issue` can only operate on issues created by the agent in the current session, preventing modification of arbitrary issues.
9. **GitHub tools restricted to analysis** -- `create_issue`, `update_issue`, and `close_issue` are only available during the analysis phase, not during planning or execution.

## Agent Tool Configuration

When creating an agent, select which tools it can use. If no tools are configured, the agent gets safe defaults: `read_file`, `glob`, `grep`. The `use_skill` and `ask_user` tools are always included regardless of configuration. The issue LLM (non-agent steps) gets all tools.
