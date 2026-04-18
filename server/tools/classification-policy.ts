/**
 * Classification-aware confirmation policy builder.
 *
 * Each `ToolModule` declares a `classification` — `'read-only'`,
 * `'state-mutating'`, or `'destructive'`. This file groups the names of a
 * running agent's enabled tools under those classifications and renders a
 * markdown block that is appended to the system prompt right after the
 * user-editable confirmation policy.
 *
 * The block is regenerated on every runtime construction, so it always
 * reflects the tools this particular agent actually has — never a stale
 * global list.
 */

import { getToolModule, resolveToolName } from './tool-registry';
import type { ToolClassification } from './tool-module';

/**
 * HITL tools themselves never appear in the matrix. They are the mechanism
 * the matrix references, not tools that get classified into it.
 */
const HITL_TOOL_NAMES = new Set(['ask_user', 'confirm_action']);

/**
 * Fallback classifications for tool names that are not served out of the
 * `ToolModule` registry yet — memory tools (built inline by
 * `MemoryEngine`), session tools (injected per-run by the coordinator),
 * provider-plugin tools, and legacy stubs. Unknown tools default to
 * `'state-mutating'` (conservative — require confirmation).
 */
const FALLBACK_CLASSIFICATIONS: Record<string, ToolClassification> = {
  memory_get: 'read-only',
  memory_search: 'read-only',
  memory_save: 'state-mutating',
  sessions_list: 'read-only',
  sessions_history: 'read-only',
  session_status: 'read-only',
  subagents: 'read-only',
  sessions_send: 'state-mutating',
  sessions_spawn: 'state-mutating',
  sessions_yield: 'state-mutating',
  send_message: 'state-mutating',
  code_interpreter: 'state-mutating',
};

export function classifyTool(name: string): ToolClassification {
  const canonical = resolveToolName(name);
  const module = getToolModule(canonical);
  if (module?.classification) return module.classification;
  return FALLBACK_CLASSIFICATIONS[canonical] ?? 'state-mutating';
}

export interface ClassificationGroups {
  readOnly: string[];
  stateMutating: string[];
  destructive: string[];
}

export function groupByClassification(enabledToolNames: string[]): ClassificationGroups {
  const groups: ClassificationGroups = {
    readOnly: [],
    stateMutating: [],
    destructive: [],
  };
  const seen = new Set<string>();
  for (const raw of enabledToolNames) {
    const name = resolveToolName(raw);
    if (HITL_TOOL_NAMES.has(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    switch (classifyTool(name)) {
      case 'read-only':
        groups.readOnly.push(name);
        break;
      case 'state-mutating':
        groups.stateMutating.push(name);
        break;
      case 'destructive':
        groups.destructive.push(name);
        break;
    }
  }
  groups.readOnly.sort();
  groups.stateMutating.sort();
  groups.destructive.sort();
  return groups;
}

function formatNames(names: string[]): string {
  return names.map((n) => `\`${n}\``).join(', ');
}

/**
 * Render the classification matrix as a markdown block, or return `null`
 * when no non-HITL tools are enabled (nothing useful to show).
 */
export function buildToolClassificationMatrix(enabledToolNames: string[]): string | null {
  const groups = groupByClassification(enabledToolNames);
  const total = groups.readOnly.length + groups.stateMutating.length + groups.destructive.length;
  if (total === 0) return null;

  const lines: string[] = ['## Tool confirmation matrix'];
  lines.push('');
  if (groups.readOnly.length) {
    lines.push(`**Read-only — no confirmation needed**: ${formatNames(groups.readOnly)}`);
    lines.push('');
  }
  if (groups.stateMutating.length) {
    lines.push(`**State-mutating — call \`confirm_action\` first**: ${formatNames(groups.stateMutating)}`);
    lines.push('');
  }
  if (groups.destructive.length) {
    lines.push(
      `**Destructive — always \`confirm_action\` and quote the exact impact**: ${formatNames(groups.destructive)}`,
    );
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}
