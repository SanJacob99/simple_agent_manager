import type { ResolvedToolsConfig } from './agent-config';

// Tool group definitions — shared between frontend UI and server runtime
export const TOOL_GROUPS: Record<string, string[]> = {
  runtime: ['bash', 'code_interpreter'],
  fs: ['read_file', 'write_file', 'list_directory'],
  web: ['web_search', 'web_fetch'],
  memory: ['memory_search', 'memory_get', 'memory_save'],
  coding: ['bash', 'read_file', 'write_file', 'code_interpreter'],
  communication: ['send_message'],
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
  full: ['runtime', 'fs', 'web', 'memory', 'coding', 'communication'],
  coding: ['runtime', 'fs', 'coding', 'memory'],
  messaging: ['web', 'communication', 'memory'],
  minimal: ['web'],
  custom: [],
};

export const ALL_TOOL_NAMES = [
  'bash',
  'code_interpreter',
  'read_file',
  'write_file',
  'list_directory',
  'web_search',
  'web_fetch',
  'calculator',
  'memory_search',
  'memory_get',
  'memory_save',
  'send_message',
  'image_generation',
  'text_to_speech',
  ...SESSION_TOOL_NAMES,
];

/**
 * Expand profile + groups + custom enabledTools into a flat deduplicated list.
 *
 * `enabledGroups` is the source of truth for which groups are active.
 * The profile is a UI preset that pre-populates enabledGroups; it is only
 * used as a fallback when no groups are explicitly enabled.
 */
export function resolveToolNames(config: ResolvedToolsConfig): string[] {
  const names = new Set<string>();

  // Use enabledGroups as the source of truth when present.
  // Fall back to profile expansion only when no groups are explicitly enabled.
  const activeGroups = config.enabledGroups.length > 0
    ? config.enabledGroups
    : TOOL_PROFILES[config.profile] ?? [];

  for (const group of activeGroups) {
    for (const tool of TOOL_GROUPS[group] ?? []) {
      names.add(tool);
    }
  }

  for (const tool of config.resolvedTools) {
    names.add(tool);
  }

  for (const plugin of config.plugins) {
    if (plugin.enabled) {
      for (const tool of plugin.tools) {
        names.add(tool);
      }
    }
  }

  return [...names];
}
