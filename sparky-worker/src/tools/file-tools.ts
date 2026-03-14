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

  // Layer 2: normalized line endings (CRLF → LF) — match in normalized space,
  // then find and replace the corresponding region in the original contents.
  const normalizedContents = contents.replace(/\r\n/g, "\n");
  const normalizedOld = oldText.replace(/\r\n/g, "\n");
  const lfCount = normalizedContents.split(normalizedOld).length - 1;
  if (lfCount === 1) {
    const normIdx = normalizedContents.indexOf(normalizedOld);
    const origRegion = mapNormIdxToOriginal(contents, normIdx, normalizedOld.length);
    writeFileSync(resolved, contents.slice(0, origRegion.start) + newText + contents.slice(origRegion.end));
    return;
  }
  if (lfCount > 1) {
    throw new EditFileError(`old_text matches ${lfCount} times after line ending normalization — must be unique`, contents);
  }

  // Layer 3: trimmed trailing whitespace per line — match in trimmed space,
  // then find and replace the corresponding region in the original contents.
  const trimLines = (s: string) => s.split("\n").map((l) => l.trimEnd()).join("\n");
  const trimmedContents = trimLines(normalizedContents);
  const trimmedOld = trimLines(normalizedOld);
  const trimCount = trimmedContents.split(trimmedOld).length - 1;
  if (trimCount === 1) {
    // Map trimmed → normalized → original
    const trimIdx = trimmedContents.indexOf(trimmedOld);
    const normRegion = mapTrimIdxToNormalized(normalizedContents, trimIdx, trimmedOld.length);
    const origRegion = mapNormIdxToOriginal(contents, normRegion.start, normRegion.end - normRegion.start);
    writeFileSync(resolved, contents.slice(0, origRegion.start) + newText + contents.slice(origRegion.end));
    return;
  }
  if (trimCount > 1) {
    throw new EditFileError(`old_text matches ${trimCount} times after trailing-whitespace trimming — must be unique`, contents);
  }

  throw new EditFileError("old_text not found in file (tried exact, line-ending normalized, and trailing-whitespace-trimmed matching)", contents);
}

/**
 * Map a character range from CRLF-normalized (LF-only) space back to original.
 * Walks both strings tracking how \r\n in original maps to \n in normalized.
 */
function mapNormIdxToOriginal(original: string, normStart: number, normLen: number): { start: number; end: number } {
  let oi = 0;
  let ni = 0;
  let start = 0;

  // Advance to normStart
  while (ni < normStart && oi < original.length) {
    if (original[oi] === "\r" && original[oi + 1] === "\n") {
      oi += 2;
    } else {
      oi++;
    }
    ni++;
  }
  start = oi;

  // Advance normLen more characters
  let remaining = normLen;
  while (remaining > 0 && oi < original.length) {
    if (original[oi] === "\r" && original[oi + 1] === "\n") {
      oi += 2;
    } else {
      oi++;
    }
    remaining--;
  }

  return { start, end: oi };
}

/**
 * Map a character range from trimmed space back to normalized (LF) space.
 * Walks line by line since trimming only removes trailing whitespace per line.
 */
function mapTrimIdxToNormalized(normalized: string, trimStart: number, trimLen: number): { start: number; end: number } {
  const normLines = normalized.split("\n");
  const trimmedLines = normLines.map((l) => l.trimEnd());

  let normOffset = 0;
  let trimOffset = 0;
  let start = 0;

  for (let i = 0; i < normLines.length; i++) {
    const tLen = trimmedLines[i].length;
    const nLen = normLines[i].length;

    if (trimOffset + tLen >= trimStart && start === 0) {
      // Start is in this line
      const linePos = trimStart - trimOffset;
      start = normOffset + linePos;
    }

    if (trimOffset + tLen >= trimStart + trimLen) {
      // End is in this line
      const linePos = trimStart + trimLen - trimOffset;
      return { start, end: normOffset + linePos };
    }

    trimOffset += tLen + 1; // +1 for the \n separator
    normOffset += nLen + 1;
  }

  return { start, end: normalized.length };
}
