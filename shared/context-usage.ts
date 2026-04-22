import type { RunUsage } from './run-types';

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
   * Where the number came from.
   * - `actual`: provider reported this turn's usage.
   * - `preview`: estimated from the assembled payload before dispatch.
   * - `persisted`: loaded from the session store on session open.
   */
  source: 'actual' | 'preview' | 'persisted';
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
