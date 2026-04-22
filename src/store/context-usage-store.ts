import { create } from 'zustand';
import type { ContextUsage, ContextUsageBreakdown } from '../../shared/context-usage';

/**
 * Per-session cache of the latest context-usage snapshot the server has
 * emitted. The backend is the authoritative source for these values --
 * this store is a read-through cache shaped for React selectors.
 *
 * Lifecycle:
 * 1. On session open, `hydrateFromSession` seeds `contextTokens` from
 *    the persisted `SessionStoreEntry` so the panel shows the last
 *    known value without waiting for a new turn.
 * 2. During a run, the server emits `context:usage` events -- each one
 *    replaces the previous snapshot for that session.
 * 3. `preview` snapshots are transient: they may be overwritten by an
 *    `actual` snapshot a moment later. Consumers should treat the
 *    latest snapshot as the truth regardless of `source`.
 */
interface ContextUsageState {
  usageBySessionKey: Record<string, ContextUsage>;
  setUsage: (usage: ContextUsage) => void;
  hydrateFromSession: (input: {
    sessionKey: string;
    contextTokens: number;
    contextWindow: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheRead?: number;
    cacheWrite?: number;
    totalTokens?: number;
    breakdown?: ContextUsageBreakdown;
  }) => void;
  clearSession: (sessionKey: string) => void;
}

export const useContextUsageStore = create<ContextUsageState>((set) => ({
  usageBySessionKey: {},

  setUsage: (usage) =>
    set((state) => ({
      usageBySessionKey: {
        ...state.usageBySessionKey,
        [usage.sessionKey]: usage,
      },
    })),

  hydrateFromSession: ({
    sessionKey,
    contextTokens,
    contextWindow,
    inputTokens,
    outputTokens,
    cacheRead,
    cacheWrite,
    totalTokens,
    breakdown,
  }) =>
    set((state) => {
      const existing = state.usageBySessionKey[sessionKey];
      // Never overwrite a fresher in-memory snapshot with persisted
      // data -- a running turn's `actual` always beats the stored
      // last-known value.
      if (existing && existing.source !== 'persisted') return state;
      return {
        usageBySessionKey: {
          ...state.usageBySessionKey,
          [sessionKey]: {
            sessionKey,
            at: Date.now(),
            contextTokens,
            contextWindow,
            usage:
              inputTokens !== undefined
                ? {
                    input: inputTokens,
                    output: outputTokens ?? 0,
                    cacheRead: cacheRead ?? 0,
                    cacheWrite: cacheWrite ?? 0,
                    totalTokens: totalTokens ?? 0,
                  }
                : undefined,
            breakdown,
            source: 'persisted',
          },
        },
      };
    }),

  clearSession: (sessionKey) =>
    set((state) => {
      if (!state.usageBySessionKey[sessionKey]) return state;
      const next = { ...state.usageBySessionKey };
      delete next[sessionKey];
      return { usageBySessionKey: next };
    }),
}));

/** Selector: the latest snapshot for a session, or undefined. */
export function selectContextUsage(sessionKey: string | null | undefined) {
  return (state: ContextUsageState): ContextUsage | undefined =>
    sessionKey ? state.usageBySessionKey[sessionKey] : undefined;
}
