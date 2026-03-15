import { scanRepository, writeManifestCache, isCacheStale, readCachedManifest } from "./scanner.js";
import type { DiscoveredManifest } from "./types.js";

export { getAgentsFromManifest, getSkillsFromManifest, getToolIdsForManifestAgent, buildManifestSkillResolver, getManifestContextFiles } from "./manifest-reader.js";
export type { DiscoveredManifest, DiscoveredAgent, DiscoveredSkill, DiscoveredCommand, DiscoveredContextFile, ManifestOverrides } from "./types.js";

/** Full scan: run all framework scanners and write cache. */
export function scanRepo(worktreePath: string): DiscoveredManifest {
  const manifest = scanRepository(worktreePath);
  writeManifestCache(worktreePath, manifest);
  return manifest;
}

/** Scan only if cache is stale. Returns the manifest either way. */
export function ensureManifest(worktreePath: string): DiscoveredManifest {
  if (!isCacheStale(worktreePath)) {
    const cached = readCachedManifest(worktreePath);
    if (cached) return cached;
  }
  return scanRepo(worktreePath);
}
