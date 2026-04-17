import type { ResolvedToolsConfig } from './agent-config';

// Tool group definitions — shared between frontend UI and server runtime
export const TOOL_GROUPS: Record<string, string[]> = {
  runtime: ['bash', 'code_interpreter'],
  fs: ['read_file', 'write_file', 'edit_file', 'list_directory', 'apply_patch'],
  web: ['web_search', 'web_fetch'],
  // memory tools are managed by the memory node, not the tools node
  coding: ['bash', 'read_file', 'write_file', 'code_interpreter'],
  media: ['image', 'image_generate', 'show_image', 'canvas'],
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
  full: ['runtime', 'fs', 'web', 'coding', 'communication'],
  coding: ['runtime', 'fs', 'coding'],
  messaging: ['web', 'communication'],
  minimal: ['web'],
  custom: [],
};

export const ALL_TOOL_NAMES = [
  'exec',
  'bash',
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
  'image',
  'image_generate',
  'show_image',
  'canvas',
  'send_message',
  'text_to_speech',
  ...SESSION_TOOL_NAMES,
];

/**
 * Tool names that have a real server-side implementation.
 * Used to filter the system prompt tool summary to only advertise
 * tools the model can actually call.
 */
export const IMPLEMENTED_TOOL_NAMES = new Set<string>([
  'exec',
  'bash', // alias for exec
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
  'canvas',
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
