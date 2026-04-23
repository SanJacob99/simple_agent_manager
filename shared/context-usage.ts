import type { RunUsage } from './run-types';
import type { ResolvedSystemPrompt } from './agent-config';

/**
 * `customType` used on session transcript entries recording the
 * resolved system prompt for a run. Value stored under `data` is a
 * {@link ResolvedSystemPrompt}. Custom entries do not participate in
 * LLM context on subsequent turns -- this is audit data.
 */
export const TRANSCRIPT_SYSTEM_PROMPT_TYPE = 'sam.system_prompt';

/** Payload shape for `sam.system_prompt` custom transcript entries. */
export type TranscriptSystemPromptData = ResolvedSystemPrompt;

/** Named row inside a breakdown (one skill, one tool, etc.). */
export interface ContextUsageEntry {
  name: string;
  tokens: number;
}

/**
 * Mutually-exclusive token counts for each chunk of the outbound
 * payload. Sums to approximately `contextTokens` (within estimator
 * noise). Only present on snapshots that were computed from the
 * assembled payload -- the provider's post-turn usage is a single
 * total, so `actual` snapshots reuse the most recent preview's
 * per-section shape with `messages` recomputed as the remainder.
 *
 * `skills` is carved out of the system prompt (skills are folded in
 * during prompt assembly). `systemPrompt` here is the non-skills
 * remainder.
 *
 * `skillsEntries` / `toolsEntries` provide per-item detail so the UI
 * can show which skills/tools are largest. They are sorted descending
 * by tokens on the server. Each array's entries sum to the matching
 * aggregate (`skills` / `tools`).
 */
export interface ContextUsageBreakdown {
  systemPrompt: number;
  skills: number;
  tools: number;
  messages: number;
  skillsEntries?: ContextUsageEntry[];
  toolsEntries?: ContextUsageEntry[];
}

/**
 * Unified, model-agnostic snapshot of how full the LLM's context window
 * is for one session. The backend owns this data: it is computed from
 * provider-reported usage on every turn and persisted on the session
 * entry. The client treats it as read-only state.
 */
export interface ContextUsage {
  /** Session this snapshot belongs to. */
  sessionKey: string;
  /** Run that produced this snapshot, when applicable. */
  runId?: string;
  /** Monotonically increasing timestamp (ms since epoch). */
  at: number;

  /**
   * Canonical context fill in tokens. For `source = 'actual'` this is
   * the provider-reported `totalTokens` of the most recent turn. For
   * `source = 'preview'` this is the estimator's prediction of what the
   * next turn will send. For `source = 'persisted'` this is whatever
   * was stored on the session entry (the last actual we saw).
   */
  contextTokens: number;

  /** Model context window (maxTokens the LLM can accept in total). */
  contextWindow: number;

  /**
   * Per-turn usage from the provider (input/output/cache split).
   * Present for `actual` and `persisted`, optional for `preview`.
   */
  usage?: RunUsage;

  /**
   * Per-section breakdown, when available. `preview` snapshots include
   * a fresh breakdown from the assembled payload. `actual` snapshots
   * carry forward the most recent preview's `systemPrompt`, `skills`,
   * and `tools` counts (those chunks do not change within a turn) and
   * recompute `messages` as the remainder. `persisted` snapshots have
   * no breakdown.
   */
  breakdown?: ContextUsageBreakdown;

  /**
   * Where the number came from.
   * - `actual`: provider reported this turn's usage.
   * - `preview`: estimated from the assembled payload before dispatch.
   * - `persisted`: loaded from the session store on session open.
   */
  source: 'actual' | 'preview' | 'persisted';
}

/**
 * Re-derive `messages` in a breakdown using the real post-turn total
 * while keeping the other sections stable. Never goes negative -- if
 * the estimate overshoots, messages collapses to 0.
 */
export function foldActualIntoBreakdown(
  previewBreakdown: ContextUsageBreakdown,
  actualTotal: number,
): ContextUsageBreakdown {
  const nonMessages =
    previewBreakdown.systemPrompt
    + previewBreakdown.skills
    + previewBreakdown.tools;
  return {
    systemPrompt: previewBreakdown.systemPrompt,
    skills: previewBreakdown.skills,
    tools: previewBreakdown.tools,
    messages: Math.max(0, actualTotal - nonMessages),
    // Per-entry arrays are fixed within a turn -- carry through
    // unchanged so the UI keeps showing per-skill / per-tool rows.
    skillsEntries: previewBreakdown.skillsEntries,
    toolsEntries: previewBreakdown.toolsEntries,
  };
}

/**
 * Compute the canonical context-token count from a provider usage
 * report. Matches pi-coding-agent's `calculateContextTokens` semantics:
 * prefer `totalTokens` when present, otherwise sum input + cache fields
 * (output tokens are *not* counted toward context fill).
 */
export function contextTokensFromUsage(usage: RunUsage | undefined): number {
  if (!usage) return 0;
  if (usage.totalTokens && usage.totalTokens > 0) return usage.totalTokens;
  return (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
}
