import { invoke } from "@tauri-apps/api/core";
import type { LLMToolDef } from "./types";

export interface ToolDef {
  id: string;
  name: string;
  description: string;
  dangerous: boolean;
}

export const TOOLS: ToolDef[] = [
  { id: "read", name: "Read", description: "Read a file's contents", dangerous: false },
  { id: "write", name: "Write", description: "Create or overwrite a file", dangerous: true },
  { id: "edit", name: "Edit", description: "Find-and-replace text in a file", dangerous: true },
  { id: "glob", name: "Glob", description: "Find files matching a pattern", dangerous: false },
  { id: "grep", name: "Grep", description: "Search file contents with regex", dangerous: false },
  { id: "bash", name: "Bash", description: "Run a shell command", dangerous: true },
  { id: "use_skill", name: "Skill", description: "Load a skill by name for domain-specific knowledge", dangerous: false },
  { id: "ask_user", name: "Ask User", description: "Ask the user a question for clarification or direction", dangerous: false },
];

/** LLM-facing tool definitions with parameter schemas for function calling. */
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
];

/** Map tool IDs (read, write, etc.) to schema names (read_file, write_file, etc.) */
const TOOL_ID_TO_SCHEMA_NAME: Record<string, string> = {
  read: "read_file",
  write: "write_file",
  edit: "edit_file",
  glob: "glob",
  grep: "grep",
  bash: "bash",
  use_skill: "use_skill",
  ask_user: "ask_user",
};

/** Always-on tools that are included regardless of agent tool restrictions. */
const ALWAYS_ON_TOOLS = new Set(["use_skill", "ask_user"]);

/** Filter TOOL_SCHEMAS to only those allowed by the given tool IDs. Always-on tools are always included. */
export function filterToolSchemas(toolIds: string[]): LLMToolDef[] {
  const allowedNames = new Set(toolIds.map((id) => TOOL_ID_TO_SCHEMA_NAME[id]).filter(Boolean));
  for (const t of ALWAYS_ON_TOOLS) allowedNames.add(t);
  return TOOL_SCHEMAS.filter((t) => allowedNames.has(t.name));
}

const MAX_RESULT_LENGTH = 10000;

function truncate(s: string): string {
  if (s.length <= MAX_RESULT_LENGTH) return s;
  return s.slice(0, MAX_RESULT_LENGTH) + `\n... (truncated, ${s.length} chars total)`;
}

export type SkillResolver = (skillName: string, args?: string) => string | null;

export interface AskUserRequest {
  question: string;
  options: string[];
  allowMultiple: boolean;
}

export type AskUserHandler = (request: AskUserRequest) => Promise<string[]>;

/** Validate and parse ask_user tool input from the LLM. */
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

/** Create a tool handler that intercepts ask_user calls and delegates the rest. */
export function createAskUserInterceptor(
  onAskUser: AskUserHandler | undefined,
  baseHandler: (name: string, input: Record<string, unknown>) => Promise<string>,
): (name: string, input: Record<string, unknown>) => Promise<string> {
  return async (name, input) => {
    if (name === "ask_user") {
      if (!onAskUser) return "Error: user interaction not available.";
      const request = parseAskUserInput(input);
      const selected = await onAskUser(request);
      return selected.length === 0
        ? "User did not select any option."
        : `User selected: ${selected.join(", ")}`;
    }
    return baseHandler(name, input);
  };
}

/**
 * Create a tool call handler that bridges LLM tool calls to Tauri invoke commands.
 * The handler takes a tool name and input, executes the corresponding Tauri command,
 * and returns the result as a string.
 */
export function createToolCallHandler(worktreePath: string, skillResolver?: SkillResolver): (name: string, input: Record<string, unknown>) => Promise<string> {
  return async (name: string, input: Record<string, unknown>): Promise<string> => {
    try {
      switch (name) {
        case "read_file": {
          const result = await invoke<string>("tool_read_file", {
            worktreePath,
            filePath: input.file_path as string,
          });
          return truncate(result);
        }
        case "write_file": {
          await invoke<void>("tool_write_file", {
            worktreePath,
            filePath: input.file_path as string,
            content: input.content as string,
          });
          return "File written successfully.";
        }
        case "edit_file": {
          await invoke<void>("tool_edit_file", {
            worktreePath,
            filePath: input.file_path as string,
            oldText: input.old_text as string,
            newText: input.new_text as string,
          });
          return "Edit applied successfully.";
        }
        case "glob": {
          const results = await invoke<string[]>("tool_glob", {
            worktreePath,
            pattern: input.pattern as string,
          });
          return truncate(results.join("\n"));
        }
        case "grep": {
          const matches = await invoke<{ file: string; line: number; text: string }[]>("tool_grep", {
            worktreePath,
            pattern: input.pattern as string,
            globFilter: (input.glob_filter as string) || null,
          });
          const formatted = matches.map((m) => `${m.file}:${m.line}:${m.text}`).join("\n");
          return truncate(formatted || "No matches found.");
        }
        case "bash": {
          const result = await invoke<{ stdout: string; stderr: string; exit_code: number }>("tool_bash", {
            worktreePath,
            command: input.command as string,
          });
          let output = "";
          if (result.stdout) output += result.stdout;
          if (result.stderr) output += (output ? "\n" : "") + "STDERR: " + result.stderr;
          output += (output ? "\n" : "") + `Exit code: ${result.exit_code}`;
          return truncate(output);
        }
        case "use_skill": {
          if (!skillResolver) return "Error: no skills available in this context.";
          const skillName = input.skill_name as string;
          const args = input.arguments as string | undefined;
          const content = skillResolver(skillName, args);
          if (content === null) return `Error: skill "${skillName}" not found. Check the available skill names.`;
          return truncate(content);
        }
        default:
          return `Unknown tool: ${name}`;
      }
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  };
}
