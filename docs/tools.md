# Tools Reference

6 sandboxed tools are available to the LLM during plan execution. All operations are confined to the issue's git worktree, and path escape is prevented by `sandbox_resolve` (path canonicalization).

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

## Security Model

1. **Path sandboxing** -- All paths resolved against worktree root; no escape possible.
2. **Unique match requirement** -- `edit_file` requires `old_text` to match exactly once, preventing accidental bulk changes.
3. **Safe defaults for agents** -- Agents default to read-only tools (`read_file`, `glob`, `grep`).
4. **Explicit dangerous tool grants** -- Dangerous tools (`write_file`, `edit_file`, `bash`) must be explicitly granted to agents.
5. **Bash command allowlist** -- Prevents arbitrary program execution.
6. **Output truncation** -- Output truncated to 10,000 characters to prevent context overflow.

## Agent Tool Configuration

When creating an agent, select which tools it can use. If no tools are configured, the agent gets safe defaults: `read_file`, `glob`, `grep`. The issue LLM (non-agent steps) gets all tools.
