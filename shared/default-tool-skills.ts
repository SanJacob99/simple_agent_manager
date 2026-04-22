// Manifest of bundled tool skills. The full guidance for each skill lives at
// `<SAM_BUNDLED_ROOT>/<id>/SKILL.md` on disk; the server substitutes the
// real install root into the system prompt at runtime. Agents load a
// skill's content on demand via `read_file`, so the prompt stays compact.
//
// To add a new bundled skill:
//   1. Create `server/skills/bundled/<id>/SKILL.md` with the guidance.
//   2. Add an entry here listing the tool names that surface it.
// Workspace- and managed-tier skills are resolved separately.

export type SkillLocation = 'bundled' | 'managed' | 'workspace';

export interface BundledSkillManifestEntry {
  /** Directory name under the bundled skills root; also the display id. */
  id: string;
  /** One-line summary for the compact "available skills" list. */
  description: string;
  /** Tool names that make this skill eligible. When any of these are in the
   *  resolved tool list, the skill appears in the compact list. */
  triggeredBy: string[];
}

export interface EligibleSkillReference {
  id: string;
  description: string;
  location: SkillLocation;
  /** Full prompt-ready path. For bundled skills this contains the
   *  `{SAM_BUNDLED_ROOT}` placeholder the server substitutes at runtime. */
  path: string;
}

export const BUNDLED_SKILLS_ROOT_PLACEHOLDER = '{SAM_BUNDLED_ROOT}';

export const BUNDLED_SKILLS: BundledSkillManifestEntry[] = [
  {
    id: 'exec',
    description: 'How to drive the shell `exec` tool effectively',
    triggeredBy: ['exec'],
  },
  {
    id: 'code-execution',
    description: 'How to drive the sandboxed Python `code_execution` tool',
    triggeredBy: ['code_execution'],
  },
  {
    id: 'web-search',
    description: 'How to phrase queries and cite results with `web_search`',
    triggeredBy: ['web_search'],
  },
  {
    id: 'image',
    description: 'Generating, showing, and analyzing images',
    triggeredBy: ['image_generate', 'image_analyze', 'show_image'],
  },
  {
    id: 'canva',
    description: 'Rendering HTML/CSS/JS artifacts via the canva preview server',
    triggeredBy: ['canva'],
  },
  {
    id: 'browser',
    description: 'Driving the Playwright-backed browser tool',
    triggeredBy: ['browser'],
  },
  {
    id: 'text-to-speech',
    description: 'Composing input for the `text_to_speech` tool',
    triggeredBy: ['text_to_speech'],
  },
  {
    id: 'music-generate',
    description: 'Composing prompts for the `music_generate` tool',
    triggeredBy: ['music_generate'],
  },
];

/**
 * Filter the manifest down to skills whose triggering tools are actually
 * enabled on the agent, and return prompt-ready references.
 */
export function eligibleBundledSkills(
  enabledToolNames: readonly string[],
): EligibleSkillReference[] {
  const enabled = new Set(enabledToolNames);
  const results: EligibleSkillReference[] = [];
  for (const skill of BUNDLED_SKILLS) {
    if (skill.triggeredBy.some((t) => enabled.has(t))) {
      results.push({
        id: skill.id,
        description: skill.description,
        location: 'bundled',
        path: `${BUNDLED_SKILLS_ROOT_PLACEHOLDER}/${skill.id}/SKILL.md`,
      });
    }
  }
  return results;
}
