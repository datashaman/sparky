import { execSync } from "node:child_process";
import { realpathSync } from "node:fs";

const ALLOWED_BASH_COMMANDS = new Set([
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

export async function runBash(worktreePath: string, command: string): Promise<string> {
  const root = realpathSync(worktreePath);

  // Validate command starts with an allowed program
  const firstWord = command.split(/\s/)[0] ?? "";
  const baseCmd = firstWord.split("/").pop() ?? firstWord;
  if (!ALLOWED_BASH_COMMANDS.has(baseCmd)) {
    throw new Error(
      `Command '${baseCmd}' is not in the allowed list. Allowed: ${[...ALLOWED_BASH_COMMANDS].join(", ")}`,
    );
  }

  try {
    const stdout = execSync(command, {
      cwd: root,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        HOME: root,
        PATH: "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
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
