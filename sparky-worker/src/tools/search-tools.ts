import { execSync } from "node:child_process";
import { readdirSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import { glob as globFn } from "glob";

export interface GrepMatch {
  file: string;
  line: number;
  text: string;
}

export function listFiles(worktreePath: string, dirPath: string = "."): string[] {
  const root = realpathSync(worktreePath);
  const target = realpathSync(join(root, dirPath));
  if (!target.startsWith(root + "/") && target !== root) {
    throw new Error("Path is outside the worktree.");
  }
  const entries = readdirSync(target, { withFileTypes: true });
  return entries
    .filter((e) => e.name !== ".git")
    .map((e) => {
      const rel = relative(root, join(target, e.name));
      return e.isDirectory() ? `${rel}/` : rel;
    })
    .sort();
}

export async function globFiles(worktreePath: string, pattern: string): Promise<string[]> {
  const root = realpathSync(worktreePath);
  const matches = await globFn(pattern, { cwd: root, nodir: true });
  // Filter to ensure results are within sandbox
  return matches.filter((m) => {
    const abs = `${root}/${m}`;
    try {
      const real = realpathSync(abs);
      return real.startsWith(root);
    } catch {
      return false;
    }
  });
}

export async function grepFiles(
  worktreePath: string,
  pattern: string,
  globFilter?: string,
): Promise<GrepMatch[]> {
  const root = realpathSync(worktreePath);

  const args = ["-rn"];
  if (globFilter) {
    args.push("--include", globFilter);
  }
  args.push("-e", pattern, ".");

  try {
    const stdout = execSync(`grep ${args.map(shellEscape).join(" ")}`, {
      cwd: root,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return parseGrepOutput(stdout, root);
  } catch (e: unknown) {
    // grep returns exit code 1 for "no matches"
    if (isExecError(e) && e.status === 1) {
      return [];
    }
    throw e;
  }
}

function parseGrepOutput(stdout: string, root: string): GrepMatch[] {
  const matches: GrepMatch[] = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const rest = line.startsWith("./") ? line.slice(2) : line;
    const parts = rest.split(":");
    if (parts.length < 3) continue;
    const file = parts[0];
    const lineNum = parseInt(parts[1], 10);
    const text = parts.slice(2).join(":");
    if (!isNaN(lineNum)) {
      matches.push({ file, line: lineNum, text });
    }
  }
  return matches;
}

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function isExecError(e: unknown): e is { status: number } {
  return typeof e === "object" && e !== null && "status" in e;
}
