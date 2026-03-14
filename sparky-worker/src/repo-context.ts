import { readFileSync, existsSync } from "node:fs";
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

const MAX_FILE_SIZE = 8000;

/**
 * Read contextual documentation from a repo worktree.
 * Returns a formatted string suitable for injection into a system prompt,
 * or an empty string if no docs are found.
 */
export function readRepoContext(worktreePath: string): string {
  const sections: string[] = [];

  for (const filename of CONTEXT_FILES) {
    const filepath = join(worktreePath, filename);
    if (!existsSync(filepath)) continue;

    try {
      let content = readFileSync(filepath, "utf-8").trim();
      if (!content) continue;
      if (content.length > MAX_FILE_SIZE) {
        content = content.slice(0, MAX_FILE_SIZE) + "\n... (truncated)";
      }
      sections.push(`### ${filename}\n\n${content}`);
    } catch {
      // Skip unreadable files
    }
  }

  if (sections.length === 0) return "";

  return `## Repository documentation\n\nThe following documentation was found in the repository:\n\n${sections.join("\n\n---\n\n")}`;
}
