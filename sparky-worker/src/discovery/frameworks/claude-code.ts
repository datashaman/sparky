import { readFileSync, existsSync, readdirSync, lstatSync, realpathSync } from "node:fs";
import { join, basename } from "node:path";
import type { FrameworkResult, DiscoveredAgent, DiscoveredSkill, DiscoveredContextFile, DiscoveredCommand } from "../types.js";

/** Scan for Claude Code configuration: CLAUDE.md, .claude/ directory. */
export function scan(repoRoot: string): FrameworkResult {
  const agents: DiscoveredAgent[] = [];
  const skills: DiscoveredSkill[] = [];
  const commands: DiscoveredCommand[] = [];
  const context_files: DiscoveredContextFile[] = [];

  const claudeMd = safeRead(repoRoot, "CLAUDE.md");
  if (claudeMd !== null) {
    skills.push({
      name: "project-conventions",
      source: "claude-code",
      description: "Project conventions from CLAUDE.md",
      content: claudeMd,
      file_path: "CLAUDE.md",
    });
    context_files.push({
      path: "CLAUDE.md",
      source: "claude-code",
      role: "instructions",
    });
  }

  // Check .claude/ directory for settings, commands, agents
  const claudeDir = join(repoRoot, ".claude");
  if (existsSync(claudeDir) && lstatSync(claudeDir).isDirectory()) {
    // .claude/settings.json
    const settings = safeReadJSON(repoRoot, ".claude/settings.json");
    if (settings) {
      // Extract allowed tools from settings
      const allowedTools = (settings as Record<string, unknown>).allowedTools;
      if (Array.isArray(allowedTools)) {
        // Build agent from settings
        agents.push({
          name: "claude-code",
          source: "claude-code",
          description: "Claude Code agent from .claude/ config",
          instructions: claudeMd ?? "",
          skills: claudeMd ? ["project-conventions"] : [],
          tools: allowedTools.filter((t): t is string => typeof t === "string"),
          delegation: { cli: "claude", args: ["--print"], available: false },
        });
      }
    }

    // .claude/commands/ directory
    const commandsDir = join(claudeDir, "commands");
    if (existsSync(commandsDir) && lstatSync(commandsDir).isDirectory()) {
      for (const file of safeReaddir(commandsDir)) {
        if (!file.endsWith(".md")) continue;
        const content = safeRead(commandsDir, file);
        if (content === null) continue;
        const name = basename(file, ".md");
        commands.push({
          name,
          source: "claude-code",
          description: `Claude Code command: ${name}`,
          command: content,
        });
      }
    }
  }

  // If no agent was created from settings but we have CLAUDE.md, create a basic agent
  if (agents.length === 0 && claudeMd) {
    agents.push({
      name: "claude-code",
      source: "claude-code",
      description: "Claude Code agent from CLAUDE.md",
      instructions: claudeMd,
      skills: ["project-conventions"],
      tools: ["read", "write", "edit", "bash", "glob", "grep"],
      delegation: { cli: "claude", args: ["--print"], available: false },
    });
  }

  return { framework: "claude-code", agents, skills, commands, context_files };
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

function safeReadJSON(root: string, relativePath: string): unknown | null {
  const text = safeRead(root, relativePath);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function safeReaddir(dirPath: string): string[] {
  try {
    return readdirSync(dirPath);
  } catch {
    return [];
  }
}
