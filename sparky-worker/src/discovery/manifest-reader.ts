import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DiscoveredManifest, ManifestOverrides, DiscoveredAgent, DiscoveredSkill } from "./types.js";
import type { Agent, Skill, AgentProvider } from "../types.js";
import type { SkillResolver } from "../tools/index.js";
import { readCachedManifest } from "./scanner.js";

/** Read user overrides from .sparky/manifest.json (committed file). */
function readManifestOverrides(worktreePath: string): ManifestOverrides | null {
  const manifestPath = join(worktreePath, ".sparky", "manifest.json");
  try {
    const content = readFileSync(manifestPath, "utf-8");
    return JSON.parse(content) as ManifestOverrides;
  } catch {
    return null;
  }
}

/** Get the merged manifest (discovered + overrides). */
function getMergedManifest(worktreePath: string): DiscoveredManifest | null {
  const manifest = readCachedManifest(worktreePath);
  if (!manifest) return null;

  const overrides = readManifestOverrides(worktreePath);
  if (!overrides?.overrides) return manifest;

  // Filter ignored agents
  const ignoreSet = new Set(overrides.overrides.ignore ?? []);
  manifest.agents = manifest.agents.filter((a) => !ignoreSet.has(a.name));

  return manifest;
}

/** Convert a DiscoveredAgent to the pipeline's Agent type. */
function toAgent(discovered: DiscoveredAgent, overrides?: ManifestOverrides | null): Agent {
  const agentOverride = overrides?.overrides?.agents?.[discovered.name];
  return {
    id: `discovered:${discovered.source}:${discovered.name}`,
    workspace_id: "",
    name: discovered.name,
    description: discovered.description,
    content: discovered.instructions || null,
    provider: (agentOverride?.provider ?? "anthropic") as AgentProvider,
    model: agentOverride?.model ?? "claude-sonnet-4-6",
    max_turns: agentOverride?.max_turns ?? null,
    background: 0,
    created_at: "",
  };
}

/** Convert a DiscoveredSkill to the pipeline's Skill type. */
function toSkill(discovered: DiscoveredSkill): Skill {
  return {
    id: `discovered:${discovered.source}:${discovered.name}`,
    workspace_id: "",
    name: discovered.name,
    description: discovered.description,
    content: discovered.content || null,
    provider: null,
    model: null,
    created_at: "",
  };
}

/** Drop-in replacement for getAgentsForWorkspace — reads from manifest. */
export function getAgentsFromManifest(worktreePath: string): Agent[] {
  const manifest = getMergedManifest(worktreePath);
  if (!manifest) return [];
  const overrides = readManifestOverrides(worktreePath);
  return manifest.agents.map((a) => toAgent(a, overrides));
}

/** Drop-in replacement for getSkillsForWorkspace — reads from manifest. */
export function getSkillsFromManifest(worktreePath: string): Skill[] {
  const manifest = getMergedManifest(worktreePath);
  if (!manifest) return [];
  return manifest.skills.map(toSkill);
}

/** Drop-in replacement for getToolIdsForAgent — reads from manifest. */
export function getToolIdsForManifestAgent(worktreePath: string, agentName: string): string[] {
  const manifest = getMergedManifest(worktreePath);
  if (!manifest) return [];
  const agent = manifest.agents.find((a) => a.name === agentName);
  return agent?.tools ?? [];
}

/** Drop-in replacement for buildSkillResolver — reads from manifest. */
export function buildManifestSkillResolver(worktreePath: string): SkillResolver {
  const skills = getSkillsFromManifest(worktreePath);
  const byName = new Map(skills.map((s) => [s.name, s]));

  return (skillName: string, args?: string): string | null => {
    const skill = byName.get(skillName);
    if (!skill?.content) return null;
    return args ? `${skill.content}\n\n## Arguments\n${args}` : skill.content;
  };
}

/** Get additional context file paths from manifest (for repo-context.ts). */
export function getManifestContextFiles(worktreePath: string): string[] {
  const manifest = getMergedManifest(worktreePath);
  const overrides = readManifestOverrides(worktreePath);

  const paths: string[] = [];

  if (manifest) {
    for (const cf of manifest.context_files) {
      paths.push(cf.path);
    }
  }

  if (overrides?.extra_context_files) {
    for (const p of overrides.extra_context_files) {
      if (!paths.includes(p)) paths.push(p);
    }
  }

  return paths;
}
