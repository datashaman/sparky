import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import type { FrameworkResult, DiscoveredSkill, DiscoveredContextFile, DiscoveredAgent } from "../types.js";
import { safeRead } from "./safe-read.js";

/** Scan for Cursor configuration: .cursorrules, .cursor/rules/ directory. */
export function scan(repoRoot: string): FrameworkResult {
  const agents: DiscoveredAgent[] = [];
  const skills: DiscoveredSkill[] = [];
  const context_files: DiscoveredContextFile[] = [];

  // .cursorrules (root-level)
  const cursorrules = safeRead(repoRoot, ".cursorrules");
  if (cursorrules !== null) {
    skills.push({
      name: "cursor-rules",
      source: "cursor",
      description: "Cursor rules from .cursorrules",
      content: cursorrules,
      file_path: ".cursorrules",
    });
    context_files.push({
      path: ".cursorrules",
      source: "cursor",
      role: "rules",
    });
  }

  // .cursor/rules/ directory
  const rulesDir = join(repoRoot, ".cursor", "rules");
  if (existsSync(rulesDir) && lstatSync(rulesDir).isDirectory()) {
    try {
      for (const file of readdirSync(rulesDir)) {
        if (!file.endsWith(".md") && !file.endsWith(".mdc")) continue;
        const content = safeRead(rulesDir, file);
        if (content === null) continue;
        const name = `cursor-${basename(file, file.endsWith(".mdc") ? ".mdc" : ".md")}`;
        skills.push({
          name,
          source: "cursor",
          description: `Cursor rule: ${basename(file)}`,
          content,
          file_path: `.cursor/rules/${file}`,
        });
        context_files.push({
          path: `.cursor/rules/${file}`,
          source: "cursor",
          role: "rules",
        });
      }
    } catch {
      // ignore read errors
    }
  }

  // Create an agent if we found any cursor config
  if (skills.length > 0) {
    agents.push({
      name: "cursor",
      source: "cursor",
      description: "Cursor agent from .cursorrules config",
      instructions: skills.map((s) => s.content).join("\n\n"),
      skills: skills.map((s) => s.name),
      tools: ["read", "write", "edit", "bash", "glob", "grep"],
      delegation: { cli: "cursor", args: [], available: false },
    });
  }

  return { framework: "cursor", agents, skills, commands: [], context_files };
}

