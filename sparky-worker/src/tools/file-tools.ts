import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

/**
 * Resolve a relative path within a sandbox root, ensuring no escape.
 * Mirrors agent_tools.rs sandbox_resolve.
 */
export function sandboxResolve(root: string, relative: string): string {
  const canonRoot = realpathSync(root);
  const target = join(canonRoot, relative);

  if (existsSync(target)) {
    const resolved = realpathSync(target);
    if (!resolved.startsWith(canonRoot)) {
      throw new Error("Path escapes sandbox");
    }
    return resolved;
  }

  // For non-existent paths, walk up to nearest existing ancestor
  let existing = resolve(target);
  const tail: string[] = [];
  while (!existsSync(existing)) {
    const base = existing.split("/").pop();
    if (!base) throw new Error("Invalid path");
    tail.push(base);
    existing = dirname(existing);
  }
  let resolved = realpathSync(existing);
  if (!resolved.startsWith(canonRoot)) {
    throw new Error("Path escapes sandbox");
  }
  for (const component of tail.reverse()) {
    resolved = join(resolved, component);
  }
  return resolved;
}

export async function readFile(worktreePath: string, filePath: string): Promise<string> {
  const resolved = sandboxResolve(worktreePath, filePath);
  return readFileSync(resolved, "utf-8");
}

export async function writeFile(worktreePath: string, filePath: string, content: string): Promise<void> {
  const resolved = sandboxResolve(worktreePath, filePath);
  const parent = dirname(resolved);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
  writeFileSync(resolved, content);
}

export async function editFile(worktreePath: string, filePath: string, oldText: string, newText: string): Promise<void> {
  const resolved = sandboxResolve(worktreePath, filePath);
  const contents = readFileSync(resolved, "utf-8");

  const count = contents.split(oldText).length - 1;
  if (count === 0) {
    throw new Error("old_text not found in file");
  }
  if (count > 1) {
    throw new Error(`old_text matches ${count} times — must be unique`);
  }

  const updated = contents.replace(oldText, newText);
  writeFileSync(resolved, updated);
}
