import path from 'path';
import { fileURLToPath } from 'url';
import { BUNDLED_SKILLS_ROOT_PLACEHOLDER } from '../../shared/default-tool-skills';

/**
 * Absolute path to the directory that holds bundled SKILL.md files
 * (`server/skills/bundled/<id>/SKILL.md`). Resolved relative to this module
 * so it works under tsx (source) and under a compiled layout.
 */
export function getBundledSkillsRoot(): string {
  const here = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(here), 'bundled');
}

/**
 * Replace occurrences of the bundled-skills-root placeholder with the
 * absolute path the server resolves at runtime. The client emits paths like
 * `{SAM_BUNDLED_ROOT}/exec/SKILL.md` so the install root doesn't have to
 * round-trip through saved AgentConfigs.
 */
export function substituteBundledSkillsRoot(text: string): string {
  if (!text.includes(BUNDLED_SKILLS_ROOT_PLACEHOLDER)) return text;
  const root = getBundledSkillsRoot();
  return text.split(BUNDLED_SKILLS_ROOT_PLACEHOLDER).join(root);
}
