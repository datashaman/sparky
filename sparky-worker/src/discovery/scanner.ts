import { writeFileSync, mkdirSync, existsSync, readFileSync, lstatSync } from "node:fs";
import { join } from "node:path";
import type { DiscoveredManifest, FrameworkResult } from "./types.js";
import { scan as scanClaudeCode } from "./frameworks/claude-code.js";
import { scan as scanCursor } from "./frameworks/cursor.js";
import { scan as scanGitHubCopilot } from "./frameworks/github-copilot.js";
import { scan as scanMcp } from "./frameworks/mcp.js";
import { scan as scanGeneric } from "./frameworks/generic.js";

const FRAMEWORK_SCANNERS: Array<(repoRoot: string) => FrameworkResult> = [
  scanClaudeCode,
  scanCursor,
  scanGitHubCopilot,
  scanMcp,
  scanGeneric,
];

/** Run all framework scanners and merge results into a DiscoveredManifest. */
export function scanRepository(repoRoot: string): DiscoveredManifest {
  const results: FrameworkResult[] = [];

  for (const scanner of FRAMEWORK_SCANNERS) {
    try {
      const result = scanner(repoRoot);
      if (result.agents.length > 0 || result.skills.length > 0 || result.commands.length > 0 || result.context_files.length > 0) {
        results.push(result);
      }
    } catch (err) {
      console.warn(`[discovery] Scanner failed:`, err);
    }
  }

  // Deduplicate by name (first scanner wins for agents/skills)
  const seenAgents = new Set<string>();
  const seenSkills = new Set<string>();
  const seenContextFiles = new Set<string>();

  const manifest: DiscoveredManifest = {
    version: 1,
    scanned_at: new Date().toISOString(),
    frameworks: results.map((r) => r.framework),
    agents: [],
    skills: [],
    commands: [],
    context_files: [],
  };

  for (const result of results) {
    for (const agent of result.agents) {
      if (!seenAgents.has(agent.name)) {
        seenAgents.add(agent.name);
        manifest.agents.push(agent);
      }
    }
    for (const skill of result.skills) {
      if (!seenSkills.has(skill.name)) {
        seenSkills.add(skill.name);
        manifest.skills.push(skill);
      }
    }
    for (const cmd of result.commands) {
      manifest.commands.push(cmd);
    }
    for (const cf of result.context_files) {
      if (!seenContextFiles.has(cf.path)) {
        seenContextFiles.add(cf.path);
        manifest.context_files.push(cf);
      }
    }
  }

  return manifest;
}

/** Write the discovered manifest to .sparky/cache/ and ensure .gitignore exists. */
export function writeManifestCache(repoRoot: string, manifest: DiscoveredManifest): void {
  const sparkyDir = join(repoRoot, ".sparky");
  const cacheDir = join(sparkyDir, "cache");

  mkdirSync(cacheDir, { recursive: true });

  // Write .gitignore if missing
  const gitignorePath = join(sparkyDir, ".gitignore");
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, "cache/\n", "utf-8");
  }

  writeFileSync(join(cacheDir, "discovered.json"), JSON.stringify(manifest, null, 2), "utf-8");
  writeFileSync(join(cacheDir, "last-scan.json"), JSON.stringify({
    scanned_at: manifest.scanned_at,
    frameworks: manifest.frameworks,
  }, null, 2), "utf-8");
}

/** Check if the cached manifest is stale by comparing file mtimes. */
export function isCacheStale(repoRoot: string): boolean {
  const lastScanPath = join(repoRoot, ".sparky", "cache", "last-scan.json");
  try {
    const stat = lstatSync(lastScanPath);
    const lastScanTime = stat.mtimeMs;

    // Check if any well-known config files are newer than the cache
    const filesToCheck = [
      "CLAUDE.md", ".claude/settings.json", ".cursorrules",
      ".cursor/rules", ".github/copilot-instructions.md",
      ".mcp.json", "AGENTS.md", ".sparky/manifest.json",
    ];

    for (const file of filesToCheck) {
      const filePath = join(repoRoot, file);
      try {
        const fileStat = lstatSync(filePath);
        if (fileStat.mtimeMs > lastScanTime) return true;
      } catch {
        // File doesn't exist — not stale
      }
    }

    return false;
  } catch {
    // No cache exists
    return true;
  }
}

/** Read the cached discovered manifest, or null if not available. */
export function readCachedManifest(repoRoot: string): DiscoveredManifest | null {
  const discoveredPath = join(repoRoot, ".sparky", "cache", "discovered.json");
  try {
    const content = readFileSync(discoveredPath, "utf-8");
    return JSON.parse(content) as DiscoveredManifest;
  } catch {
    return null;
  }
}
