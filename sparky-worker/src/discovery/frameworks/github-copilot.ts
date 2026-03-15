import { readFileSync, lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { FrameworkResult, DiscoveredSkill, DiscoveredContextFile } from "../types.js";

/** Scan for GitHub Copilot configuration: .github/copilot-instructions.md. */
export function scan(repoRoot: string): FrameworkResult {
  const skills: DiscoveredSkill[] = [];
  const context_files: DiscoveredContextFile[] = [];

  const content = safeRead(repoRoot, ".github/copilot-instructions.md");
  if (content !== null) {
    skills.push({
      name: "copilot-instructions",
      source: "github-copilot",
      description: "GitHub Copilot instructions",
      content,
      file_path: ".github/copilot-instructions.md",
    });
    context_files.push({
      path: ".github/copilot-instructions.md",
      source: "github-copilot",
      role: "instructions",
    });
  }

  return { framework: "github-copilot", agents: [], skills, commands: [], context_files };
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
