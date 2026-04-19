import type { ResolvedToolsConfig } from './agent-config';

/**
 * Tool name aliases — legacy names that map to canonical ones. The server
 * registry's `TOOL_ALIASES` must stay in sync with this map. Keep this
 * list tiny — aliases are a source of confusion and duplication bugs.
 *
 * The alias map is applied inside `resolveToolNames` so every downstream
 * consumer (UI picker, system-prompt summary, server runtime) sees only
 * canonical names. Saved agent configs that still reference an alias in
 * `enabledTools` silently resolve to the canonical name.
 */
export const TOOL_NAME_ALIASES: Readonly<Record<string, string>> = {
  bash: 'exec',
};

/** Resolve an alias to its canonical name, or return the input unchanged. */
export function canonicalizeToolName(name: string): string {
  return TOOL_NAME_ALIASES[name] ?? name;
}

// Tool group definitions — shared between frontend UI and server runtime.
// Groups expand to canonical names only; aliases never appear here.
export const TOOL_GROUPS: Record<string, string[]> = {
  runtime: ['exec', 'code_interpreter'],
  fs: ['read_file', 'write_file', 'edit_file', 'list_directory', 'apply_patch'],
  web: ['web_search', 'web_fetch'],
  // memory tools are managed by the memory node, not the tools node
  coding: ['exec', 'read_file', 'write_file', 'code_interpreter'],
  media: ['image', 'image_generate', 'show_image', 'canva', 'music_generate'],
  communication: ['send_message', 'text_to_speech'],
  human: ['ask_user', 'confirm_action'],
  sessions: [
    'sessions_list',
    'sessions_history',
    'sessions_send',
    'sessions_spawn',
    'sessions_yield',
    'subagents',
    'session_status',
  ],
};

export const SESSION_TOOL_NAMES = [
  'sessions_list',
  'sessions_history',
  'sessions_send',
  'sessions_spawn',
  'sessions_yield',
  'subagents',
  'session_status',
] as const;

export const TOOL_PROFILES: Record<string, string[]> = {
  full: ['runtime', 'fs', 'web', 'coding', 'communication'],
  coding: ['runtime', 'fs', 'coding'],
  messaging: ['web', 'communication'],
  minimal: ['web'],
  custom: [],
};

/**
 * Canonical tool names rendered in the Tools node's "Individual Tools"
 * picker. Aliases (see `TOOL_NAME_ALIASES`) are NOT listed here —
 * showing both sides of an alias led to configs enabling the same
 * module twice and tripping Gemini's "Duplicate function declaration"
 * validation. If a saved config still has an alias in `enabledTools`,
 * `resolveToolNames` canonicalizes it on the way to the runtime.
 */
export const ALL_TOOL_NAMES = [
  'exec',
  'code_execution',
  'code_interpreter',
  'read_file',
  'write_file',
  'edit_file',
  'list_directory',
  'apply_patch',
  'web_search',
  'web_fetch',
  'calculator',
  'canva',
  'image',
  'image_generate',
  'show_image',
  'send_message',
  'text_to_speech',
  'ask_user',
  'confirm_action',
  'music_generate',
  ...SESSION_TOOL_NAMES,
];

/**
 * Tool names that have a real server-side implementation.
 * Used to filter the system prompt tool summary to only advertise
 * tools the model can actually call.
 */
export const IMPLEMENTED_TOOL_NAMES = new Set<string>([
  'exec',
  'bash', // alias for exec — kept for backward compat with saved configs
  'code_execution',
  'calculator',
  'web_search',
  'web_fetch',
  'read_file',
  'write_file',
  'edit_file',
  'list_directory',
  'apply_patch',
  'image',
  'image_generate',
  'show_image',
  'canva',
  'text_to_speech',
  'ask_user',
  'confirm_action',
  'music_generate',
  // memory tools are managed by the memory node, not the tools node
  ...SESSION_TOOL_NAMES,
]);

/**
 * Expand profile + groups + custom enabledTools into a flat deduplicated list.
 *
 * `enabledGroups` is the source of truth for which groups are active.
 * The profile is a UI preset that pre-populates enabledGroups; it is only
 * used as a fallback when no groups are explicitly enabled.
 */
export function resolveToolNames(config: ResolvedToolsConfig): string[] {
  const names = new Set<string>();
  // Canonicalize at the add-site so aliases coming from any source
  // (groups, saved `enabledTools`, plugin-declared tool lists) end up
  // deduplicated under one canonical name.
  const add = (tool: string) => names.add(canonicalizeToolName(tool));

  // Use enabledGroups as the source of truth when present.
  // Fall back to profile expansion only when no groups are explicitly enabled.
  const activeGroups = config.enabledGroups.length > 0
    ? config.enabledGroups
    : TOOL_PROFILES[config.profile] ?? [];

  for (const group of activeGroups) {
    for (const tool of TOOL_GROUPS[group] ?? []) {
      add(tool);
    }
  }

  for (const tool of config.resolvedTools) {
    add(tool);
  }

  for (const plugin of config.plugins) {
    if (plugin.enabled) {
      for (const tool of plugin.tools) {
        add(tool);
      }
    }
  }

  return [...names];
}
