import { execSync } from "node:child_process";
import { realpathSync } from "node:fs";

const DEFAULT_ALLOWED_COMMANDS = new Set([
  // Shell builtins
  "cd", "export", "unset", "set", "source", "type",
  // File utilities
  "ls", "find", "cat", "head", "tail", "wc", "sort", "uniq", "diff",
  "mkdir", "cp", "mv", "rm", "touch",
  // VCS & package managers
  "git", "npm", "npx", "node", "cargo", "rustc",
  "python", "python3", "pip", "pip3",
  "php", "composer", "artisan",
  "ruby", "gem", "bundle", "rake", "rails",
  "go",
  "java", "javac", "mvn", "mvnw", "gradle", "gradlew",
  "make", "cmake",
  // Text processing
  "echo", "printf", "test", "true", "false",
  "sed", "awk", "cut", "tr", "xargs", "grep",
  // System info
  "which", "env", "pwd", "date",
  // Dev tools
  "tsc", "eslint", "prettier",
]);

/** Characters that are always dangerous (command substitution, subshells, redirects). */
const DANGEROUS_CHARS = /[$`()<>\n\r]/;

/**
 * Split a command string on safe chaining operators (&& and ||).
 * Returns individual sub-commands to validate independently.
 * Pipe (|) is also allowed — each segment is validated.
 */
function splitChainedCommands(command: string): string[] {
  return command.split(/\s*(?:&&|\|\||[|;])\s*/).map((s) => s.trim()).filter(Boolean);
}

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
    // Reject truly dangerous shell metacharacters (command substitution, subshells, redirects)
    if (DANGEROUS_CHARS.test(command)) {
      throw new Error(
        "Command contains dangerous shell metacharacters ($`()<>) which are not allowed for security.",
      );
    }

    // Build effective allowlist: defaults + user-configured extras
    const allowed = new Set(DEFAULT_ALLOWED_COMMANDS);
    if (sandboxConfig?.allowedBinaries) {
      for (const bin of sandboxConfig.allowedBinaries) {
        // Support both full paths ("/opt/homebrew/bin/php") and bare names ("php")
        const base = bin.split("/").pop() ?? bin;
        if (base) allowed.add(base);
      }
    }

    // Validate each sub-command in a chain (cd foo && cat bar.txt)
    const subCommands = splitChainedCommands(command);
    if (subCommands.length === 0) {
      throw new Error("Empty command.");
    }

    for (const sub of subCommands) {
      const firstWord = sub.split(/\s/)[0] ?? "";
      const baseCmd = firstWord.split("/").pop() ?? firstWord;
      if (!allowed.has(baseCmd)) {
        throw new Error(
          `Command '${baseCmd}' is not in the allowed list. Allowed: ${[...allowed].sort().join(", ")}`,
        );
      }
    }
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
