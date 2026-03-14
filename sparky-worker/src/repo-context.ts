import { readFileSync, lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";

/**
 * Well-known documentation files to look for in a repository root.
 * Checked in order; all that exist are included.
 */
const CONTEXT_FILES = [
  "CLAUDE.md",
  "README.md",
  "CONTRIBUTING.md",
  "AGENTS.md",
  ".cursor/rules",
];

const DEFAULT_MAX_SIZE = 8000;

/**
 * Read contextual documentation from a repo worktree.
 * Returns a formatted string suitable for injection into a system prompt,
 * or an empty string if no docs are found.
 *
 * @param maxSize - Total budget in characters for all docs combined. Use a smaller
 *   value (e.g. 2000) for small models to avoid crowding out task instructions.
 */
export function readRepoContext(worktreePath: string, maxSize: number = DEFAULT_MAX_SIZE): string {
  const root = realpathSync(worktreePath);
  const sections: string[] = [];
  let totalSize = 0;

  for (const filename of CONTEXT_FILES) {
    const filepath = join(root, filename);

    // Reject symlinks to prevent reading files outside the worktree
    try {
      const stat = lstatSync(filepath);
      if (stat.isSymbolicLink()) continue;
      if (!stat.isFile()) continue;
    } catch {
      continue;
    }

    // Verify resolved path stays inside worktree
    try {
      const resolved = realpathSync(filepath);
      if (!resolved.startsWith(root + "/") && resolved !== root) continue;
    } catch {
      continue;
    }

    try {
      let content = readFileSync(filepath, "utf-8").trim();
      if (!content) continue;
      const headerPrefix = `### ${filename}\n\n`;
      const truncationMarker = "\n... (truncated)";
      const remaining = maxSize - totalSize - headerPrefix.length;
      if (remaining <= 0) break;
      if (content.length > remaining) {
        content = content.slice(0, remaining - truncationMarker.length) + truncationMarker;
      }
      const section = headerPrefix + content;
      totalSize += section.length;
      sections.push(section);
    } catch {
      // Skip unreadable files
    }
  }

  if (sections.length === 0) return "";

  return `## Repository documentation\n\nThe following documentation was found in the repository:\n\n${sections.join("\n\n---\n\n")}`;
}
