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

/**
 * Error thrown by editFile that carries the current file contents.
 * This enables the edit-as-gather pattern without a redundant disk read.
 */
export class EditFileError extends Error {
  constructor(message: string, public readonly currentContents: string) {
    super(message);
    this.name = "EditFileError";
  }
}

export async function editFile(worktreePath: string, filePath: string, oldText: string, newText: string): Promise<void> {
  const resolved = sandboxResolve(worktreePath, filePath);
  const contents = readFileSync(resolved, "utf-8");

  // Layer 1: exact match
  const exactCount = contents.split(oldText).length - 1;
  if (exactCount === 1) {
    writeFileSync(resolved, contents.replace(oldText, newText));
    return;
  }
  if (exactCount > 1) {
    throw new EditFileError(`old_text matches ${exactCount} times — must be unique`, contents);
  }

  // Layer 2: normalized line endings (CRLF → LF)
  const normalizedContents = contents.replace(/\r\n/g, "\n");
  const normalizedOld = oldText.replace(/\r\n/g, "\n");
  const lfCount = normalizedContents.split(normalizedOld).length - 1;
  if (lfCount === 1) {
    writeFileSync(resolved, normalizedContents.replace(normalizedOld, newText));
    return;
  }
  if (lfCount > 1) {
    throw new EditFileError(`old_text matches ${lfCount} times after line ending normalization — must be unique`, contents);
  }

  // Layer 3: trimmed trailing whitespace per line
  const trimLines = (s: string) => s.split("\n").map((l) => l.trimEnd()).join("\n");
  const trimmedContents = trimLines(normalizedContents);
  const trimmedOld = trimLines(normalizedOld);
  const trimCount = trimmedContents.split(trimmedOld).length - 1;
  if (trimCount === 1) {
    writeFileSync(resolved, trimmedContents.replace(trimmedOld, newText));
    return;
  }
  if (trimCount > 1) {
    throw new EditFileError(`old_text matches ${trimCount} times after whitespace normalization — must be unique`, contents);
  }

  throw new EditFileError("old_text not found in file (tried exact, line-ending normalized, and whitespace-trimmed matching)", contents);
}
