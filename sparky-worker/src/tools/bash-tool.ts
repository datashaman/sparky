import { execSync } from "node:child_process";
import { realpathSync } from "node:fs";

const DEFAULT_ALLOWED_COMMANDS = new Set([
  "ls", "find", "cat", "head", "tail", "wc", "sort", "uniq", "diff",
  "mkdir", "cp", "mv", "rm", "touch",
  "git", "npm", "npx", "node", "cargo", "rustc",
  "python", "python3", "pip", "pip3",
  "make", "cmake",
  "echo", "printf", "test", "true", "false",
  "sed", "awk", "cut", "tr", "xargs",
  "which", "env", "pwd", "date",
  "tsc", "eslint", "prettier",
]);

export interface BashSandboxConfig {
  /** Extra binaries to allow beyond the defaults. */
  allowedBinaries: string[];
  /** Skip the allowlist entirely. Dangerous — allows any command. */
  allowAll: boolean;
}

export async function runBash(
  worktreePath: string,
  command: string,
  sandboxConfig?: BashSandboxConfig,
): Promise<string> {
  const root = realpathSync(worktreePath);
  const allowAll = sandboxConfig?.allowAll ?? false;

  if (!allowAll) {
    // Build effective allowlist: defaults + user-configured extras
    const allowed = new Set(DEFAULT_ALLOWED_COMMANDS);
    if (sandboxConfig?.allowedBinaries) {
      for (const bin of sandboxConfig.allowedBinaries) {
        // Support both full paths ("/opt/homebrew/bin/php") and bare names ("php")
        const base = bin.split("/").pop() ?? bin;
        if (base) allowed.add(base);
      }
    }

    // Validate command starts with an allowed program
    const firstWord = command.split(/\s/)[0] ?? "";
    const baseCmd = firstWord.split("/").pop() ?? firstWord;
    if (!allowed.has(baseCmd)) {
      throw new Error(
        `Command '${baseCmd}' is not in the allowed list. Allowed: ${[...allowed].sort().join(", ")}`,
      );
    }
  }

  // Reject shell metacharacters that could bypass the allowlist
  const DANGEROUS_CHARS = /[;|&$`()<>]/;
  if (!allowAll && DANGEROUS_CHARS.test(command)) {
    throw new Error(
      "Command contains shell metacharacters (;|&$`()<>) which are not allowed for security.",
    );
  }

  // Use the inherited PATH so nvm/homebrew/etc binaries are available
  const envPath = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

  try {
    const stdout = execSync(command, {
      cwd: root,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        HOME: root,
        PATH: envPath,
      },
      shell: "/bin/sh",
    });
    return stdout + "\nExit code: 0";
  } catch (e: unknown) {
    if (isExecError(e)) {
      let output = "";
      if (e.stdout) output += e.stdout;
      if (e.stderr) output += (output ? "\n" : "") + "STDERR: " + e.stderr;
      output += (output ? "\n" : "") + `Exit code: ${e.status ?? -1}`;
      return output;
    }
    throw e;
  }
}

function isExecError(e: unknown): e is { status: number; stdout: string; stderr: string } {
  return typeof e === "object" && e !== null && "status" in e;
}
