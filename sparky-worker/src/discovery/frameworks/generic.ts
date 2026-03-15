import { readFileSync, lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { FrameworkResult, DiscoveredSkill, DiscoveredContextFile } from "../types.js";

/** Well-known documentation files that provide context regardless of framework. */
const GENERIC_FILES: Array<{ path: string; role: "instructions" | "context" }> = [
  { path: "AGENTS.md", role: "instructions" },
  { path: "CONTRIBUTING.md", role: "context" },
  { path: "README.md", role: "context" },
];

/** Scan for generic documentation files: AGENTS.md, CONTRIBUTING.md, README.md. */
export function scan(repoRoot: string): FrameworkResult {
  const skills: DiscoveredSkill[] = [];
  const context_files: DiscoveredContextFile[] = [];

  for (const { path, role } of GENERIC_FILES) {
    const content = safeRead(repoRoot, path);
    if (content === null) continue;

    context_files.push({
      path,
      source: "generic",
      role,
    });

    // AGENTS.md gets promoted to a skill
    if (path === "AGENTS.md") {
      skills.push({
        name: "agents-guide",
        source: "generic",
        description: "Agent guidelines from AGENTS.md",
        content,
        file_path: path,
      });
    }
  }

  return { framework: "generic", agents: [], skills, commands: [], context_files };
}

function safeRead(root: string, relativePath: string): string | null {
  const filepath = join(root, relativePath);
  try {
    const stat = lstatSync(filepath);
    if (stat.isSymbolicLink()) return null;
    if (!stat.isFile()) return null;
    const resolved = realpathSync(filepath);
    const resolvedRoot = realpathSync(root);
    if (!resolved.startsWith(resolvedRoot + "/") && resolved !== resolvedRoot) return null;
    return readFileSync(filepath, "utf-8").trim() || null;
  } catch {
    return null;
  }
}
