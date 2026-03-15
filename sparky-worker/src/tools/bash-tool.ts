import { execSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";

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

/**
 * Characters that are always dangerous (command substitution, subshells).
 * Note: > and < are allowed only in safe redirect patterns (2>/dev/null, 2>&1);
 * raw redirects to files are stripped before checking.
 */
const DANGEROUS_CHARS = /[$`()\n\r]/;

/** Safe redirect patterns that should not trigger the dangerous chars check. */
const SAFE_REDIRECTS = /\s*(?:2>&1|[12]>\/dev\/null|>&\/dev\/null)\s*/g;

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
    // Strip safe redirect patterns before checking for dangerous characters
    const sanitized = command.replace(SAFE_REDIRECTS, " ");

    // Reject truly dangerous shell metacharacters (command substitution, subshells)
    if (DANGEROUS_CHARS.test(sanitized)) {
      throw new Error(
        "Command contains dangerous shell metacharacters ($`()) which are not allowed for security.",
      );
    }

    // Block arbitrary file redirects (> file, < file) that aren't safe patterns
    if (/[<>]/.test(sanitized)) {
      throw new Error(
        "Command contains file redirects (> or <) which are not allowed. Use 2>/dev/null or 2>&1 for stderr suppression.",
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

  // Redirect tool caches to .sparky/cache/home so they don't pollute the worktree
  const cacheHome = join(root, ".sparky", "cache", "home");

  try {
    const stdout = execSync(command, {
      cwd: root,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        HOME: cacheHome,
        PATH: envPath,
        // Composer
        COMPOSER_HOME: join(cacheHome, ".composer"),
        COMPOSER_CACHE_DIR: join(cacheHome, ".composer", "cache"),
        // npm/node
        npm_config_cache: join(cacheHome, ".npm"),
        // pip
        PIP_CACHE_DIR: join(cacheHome, ".pip"),
        // XDG (catches most other tools)
        XDG_CACHE_HOME: join(cacheHome, ".cache"),
        XDG_CONFIG_HOME: join(cacheHome, ".config"),
        XDG_DATA_HOME: join(cacheHome, ".local", "share"),
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
