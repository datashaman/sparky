import type { LLMToolDef } from "../types.js";
import { readFile } from "./file-tools.js";
import { writeFile } from "./file-tools.js";
import { editFile, EditFileError } from "./file-tools.js";
import { listFiles } from "./search-tools.js";
import { globFiles } from "./search-tools.js";
import { grepFiles } from "./search-tools.js";
import { runBash } from "./bash-tool.js";
import { createGitHubIssue, updateGitHubIssue, closeGitHubIssue, createPullRequest, type GitHubToolContext } from "./github-tools.js";

export const TOOL_SCHEMAS: LLMToolDef[] = [
  {
    name: "read_file",
    description: "Read a file's contents. Returns the full file text. Use this to understand existing code before making changes. Do NOT use to check if a file exists — use glob instead.",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Path relative to worktree root" },
      },
      required: ["file_path"],
      additionalProperties: false,
    },
  },
  {
    name: "list_files",
    description: "List files and directories in a given path. Returns entries with trailing / for directories. Defaults to the project root. Use this FIRST to orient yourself in unfamiliar codebases before searching for specific files.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path relative to worktree root (default: '.')" },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "write_file",
    description: "Create or overwrite a file with the given content. Use for NEW files or when rewriting most of an existing file. For surgical edits to existing files, use edit_file instead.",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Path relative to worktree root" },
        content: { type: "string", description: "File content to write" },
      },
      required: ["file_path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "edit_file",
    description: "Find-and-replace text in a file. old_text must appear exactly once. Best for targeted changes to existing files. If old_text is not found, re-read the file first — it may have changed.",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Path relative to worktree root" },
        old_text: { type: "string", description: "Exact text to find (must be unique in file)" },
        new_text: { type: "string", description: "Replacement text" },
      },
      required: ["file_path", "old_text", "new_text"],
      additionalProperties: false,
    },
  },
  {
    name: "glob",
    description: "Find files matching a glob pattern. Returns relative paths. Use to discover file structure and check if files exist before reading them.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern (e.g. **/*.ts, src/**/*.rs)" },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
  {
    name: "grep",
    description: "Search file contents with regex. Returns file:line:text matches. Use to find where things are defined or used across the codebase.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern to search for" },
        glob_filter: { type: "string", description: "Optional glob to filter files (e.g. *.ts)" },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
  {
    name: "bash",
    description: "Run a shell command in the worktree directory. Returns stdout, stderr, and exit code. Use for: running tests, checking build status, git operations. Do NOT use for reading files (use read_file) or searching code (use grep/glob). Commands are validated against an allowlist.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to run" },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
  {
    name: "use_skill",
    description: "Load a skill by name. Skills provide domain-specific knowledge and instructions. Call this when a skill's expertise is relevant to your current task. Returns the skill's content.",
    parameters: {
      type: "object",
      properties: {
        skill_name: { type: "string", description: "Name of the skill to load (e.g. react-state-management)" },
        arguments: { type: "string", description: "Optional arguments to pass to the skill" },
      },
      required: ["skill_name"],
      additionalProperties: false,
    },
  },
  {
    name: "ask_user",
    description: "Ask the user a question to clarify intent or get direction. Provide a list of options for the user to choose from. Use this when you need input before proceeding.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question to ask the user" },
        options: {
          type: "array",
          items: { type: "string" },
          description: "List of options for the user to choose from",
        },
        allow_multiple: { type: "boolean", description: "Whether the user can select multiple options (default: false)" },
      },
      required: ["question", "options"],
      additionalProperties: false,
    },
  },
  {
    name: "create_issue",
    description: "Create a GitHub subissue linked to the parent issue. The body will automatically include a 'Part of #N' reference.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Issue title" },
        body: { type: "string", description: "Issue body (markdown)" },
        labels: { type: "array", items: { type: "string" }, description: "Optional labels to apply" },
      },
      required: ["title", "body"],
      additionalProperties: false,
    },
  },
  {
    name: "update_issue",
    description: "Update a subissue's title or body. Only works on issues created by the agent in this session.",
    parameters: {
      type: "object",
      properties: {
        issue_number: { type: "number", description: "Issue number to update" },
        title: { type: "string", description: "New title (optional)" },
        body: { type: "string", description: "New body (optional)" },
      },
      required: ["issue_number"],
      additionalProperties: false,
    },
  },
  {
    name: "close_issue",
    description: "Close an issue. Only works on issues created by the agent in this session.",
    parameters: {
      type: "object",
      properties: {
        issue_number: { type: "number", description: "Issue number to close" },
        reason: { type: "string", enum: ["completed", "not_planned"], description: "Reason for closing: 'completed' or 'not_planned'" },
      },
      required: ["issue_number", "reason"],
      additionalProperties: false,
    },
  },
  {
    name: "create_pull_request",
    description: "Commit all changes, push the branch, and create a pull request linking to the parent issue. Use this as the final step after all code changes are complete.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Pull request title" },
        body: { type: "string", description: "Pull request body describing the changes (markdown)" },
      },
      required: ["title", "body"],
      additionalProperties: false,
    },
  },
];

/** Map tool IDs to schema names. */
const TOOL_ID_TO_SCHEMA_NAME: Record<string, string> = {
  list_files: "list_files",
  read: "read_file",
  write: "write_file",
  edit: "edit_file",
  glob: "glob",
  grep: "grep",
  bash: "bash",
  use_skill: "use_skill",
  ask_user: "ask_user",
  create_issue: "create_issue",
  update_issue: "update_issue",
  close_issue: "close_issue",
  create_pull_request: "create_pull_request",
};

const ALWAYS_ON_TOOLS = new Set(["use_skill", "ask_user"]);

export function filterToolSchemas(toolIds: string[]): LLMToolDef[] {
  const allowedNames = new Set(toolIds.map((id) => TOOL_ID_TO_SCHEMA_NAME[id]).filter(Boolean));
  for (const t of ALWAYS_ON_TOOLS) allowedNames.add(t);
  return TOOL_SCHEMAS.filter((t) => allowedNames.has(t.name));
}

const MAX_RESULT_LENGTH = 10000;
const TAIL_RESERVE = 1000;

/**
 * Smart truncation that preserves both head and tail of the output.
 * Keeping the tail is important because error messages, test results,
 * and command exit status typically appear at the end.
 */
function truncate(s: string): string {
  if (s.length <= MAX_RESULT_LENGTH) return s;

  const headSize = MAX_RESULT_LENGTH - TAIL_RESERVE;
  const head = s.slice(0, headSize);
  const tail = s.slice(-TAIL_RESERVE);
  const omittedChars = s.length - headSize - TAIL_RESERVE;

  return `${head}\n\n... (${omittedChars} chars omitted, ${s.length} chars total) ...\n\n${tail}`;
}

export type SkillResolver = (skillName: string, args?: string) => string | null;

export interface AskUserRequest {
  question: string;
  options: string[];
  allowMultiple: boolean;
}

export type AskUserHandler = (request: AskUserRequest) => Promise<string[]>;

export function parseAskUserInput(input: Record<string, unknown>): AskUserRequest {
  const question = input.question;
  if (typeof question !== "string" || question.length === 0) {
    throw new Error("ask_user: 'question' must be a non-empty string");
  }
  const options = input.options;
  if (!Array.isArray(options) || options.length === 0 || !options.every((o) => typeof o === "string")) {
    throw new Error("ask_user: 'options' must be a non-empty array of strings");
  }
  const allowMultiple = input.allow_multiple === true;
  return { question, options: options as string[], allowMultiple };
}

/** Create a tool handler for a given worktree path. */
export function createToolHandler(
  worktreePath: string,
  skillResolver?: SkillResolver,
  askUserHandler?: AskUserHandler,
  githubContext?: GitHubToolContext,
): (name: string, input: Record<string, unknown>) => Promise<string> {
  const createdIssues = new Set<number>();
  return async (name: string, input: Record<string, unknown>): Promise<string> => {
    try {
      switch (name) {
        case "list_files":
          return truncate(listFiles(worktreePath, (input.path as string) || ".").join("\n"));
        case "read_file":
          return truncate(await readFile(worktreePath, input.file_path as string));
        case "write_file":
          await writeFile(worktreePath, input.file_path as string, input.content as string);
          return "File written successfully.";
        case "edit_file":
          try {
            await editFile(worktreePath, input.file_path as string, input.old_text as string, input.new_text as string);
            return "Edit applied successfully.";
          } catch (editErr) {
            // Edit-as-gather: on failure, include the current file content so
            // the model has fresh context to retry with correct old_text.
            // EditFileError carries the contents from the read already done
            // inside editFile, avoiding redundant I/O and tool allow-list bypass.
            if (editErr instanceof EditFileError) {
              return truncate(`Error: ${editErr.message}\n\nCurrent file content:\n${editErr.currentContents}`);
            }
            return `Error: ${editErr instanceof Error ? editErr.message : String(editErr)}`;
          }
        case "glob":
          return truncate((await globFiles(worktreePath, input.pattern as string)).join("\n"));
        case "grep": {
          const matches = await grepFiles(worktreePath, input.pattern as string, input.glob_filter as string | undefined);
          const formatted = matches.map((m) => `${m.file}:${m.line}:${m.text}`).join("\n");
          return truncate(formatted || "No matches found.");
        }
        case "bash":
          return truncate(await runBash(worktreePath, input.command as string));
        case "use_skill": {
          if (!skillResolver) return "Error: no skills available in this context.";
          const skillName = input.skill_name as string;
          const args = input.arguments as string | undefined;
          const content = skillResolver(skillName, args);
          if (content === null) return `Error: skill "${skillName}" not found. Check the available skill names.`;
          return truncate(content);
        }
        case "ask_user": {
          if (!askUserHandler) return "Error: user interaction not available.";
          const request = parseAskUserInput(input);
          const selected = await askUserHandler(request);
          return selected.length === 0
            ? "User did not select any option."
            : `User selected: ${selected.join(", ")}`;
        }
        case "create_issue": {
          if (!githubContext) return "Error: GitHub tools not available in this context.";
          const result = await createGitHubIssue(
            githubContext,
            input.title as string,
            input.body as string,
            input.labels as string[] | undefined,
          );
          createdIssues.add(result.number);
          return `Created issue #${result.number}: ${result.html_url}`;
        }
        case "update_issue": {
          if (!githubContext) return "Error: GitHub tools not available in this context.";
          return await updateGitHubIssue(
            githubContext,
            input.issue_number as number,
            createdIssues,
            input.title as string | undefined,
            input.body as string | undefined,
          );
        }
        case "close_issue": {
          if (!githubContext) return "Error: GitHub tools not available in this context.";
          return await closeGitHubIssue(githubContext, input.issue_number as number, createdIssues, input.reason as string);
        }
        case "create_pull_request": {
          if (!githubContext) return "Error: GitHub tools not available in this context (no GitHub token).";
          return await createPullRequest(githubContext, worktreePath, input.title as string, input.body as string);
        }
        default:
          return `Unknown tool: ${name}`;
      }
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  };
}
