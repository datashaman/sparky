import { getSkillsForWorkspace } from "../db.js";
import type { SkillResolver } from "./index.js";

/** Build a skill resolver from the workspace's skills in the database. */
export function buildSkillResolver(workspaceId: string): SkillResolver {
  const skills = getSkillsForWorkspace(workspaceId);
  const byName = new Map(skills.map((s) => [s.name, s]));

  return (skillName: string, args?: string): string | null => {
    const skill = byName.get(skillName);
    if (!skill?.content) return null;
    return args ? `${skill.content}\n\n## Arguments\n${args}` : skill.content;
  };
}
