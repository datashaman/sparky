import type { FrameworkResult, DiscoveredSkill, DiscoveredContextFile } from "../types.js";
import { safeRead } from "./safe-read.js";

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

