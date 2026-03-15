import { buildManifestSkillResolver } from "../discovery/index.js";
import type { SkillResolver } from "./index.js";

/** Build a skill resolver from the discovered manifest in the worktree. */
export function buildSkillResolver(worktreePath: string): SkillResolver {
  return buildManifestSkillResolver(worktreePath);
}
