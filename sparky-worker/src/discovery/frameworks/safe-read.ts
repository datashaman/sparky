import { readFileSync, readdirSync, lstatSync, realpathSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";

/**
 * Check whether `child` is contained within `root` using path.relative().
 * This is portable (no platform-specific separator assumption).
 */
function isContained(root: string, child: string): boolean {
  const rel = relative(root, child);
  return !isAbsolute(rel) && !rel.startsWith("..");
}

/**
 * Safely read a file relative to a root directory.
 * Returns null if the file doesn't exist, is a symlink escaping the root,
 * or is not a regular file.
 */
export function safeRead(root: string, relativePath: string): string | null {
  const filepath = join(root, relativePath);
  try {
    const stat = lstatSync(filepath);
    if (stat.isSymbolicLink()) return null;
    if (!stat.isFile()) return null;
    const resolved = realpathSync(filepath);
    const resolvedRoot = realpathSync(root);
    if (!isContained(resolvedRoot, resolved)) return null;
    return readFileSync(filepath, "utf-8").trim() || null;
  } catch {
    return null;
  }
}

/**
 * Safely read and parse a JSON file relative to a root directory.
 */
export function safeReadJSON(root: string, relativePath: string): unknown | null {
  const text = safeRead(root, relativePath);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Safely list entries in a directory, returning an empty array on error.
 */
export function safeReaddir(dirPath: string): string[] {
  try {
    return readdirSync(dirPath);
  } catch {
    return [];
  }
}
