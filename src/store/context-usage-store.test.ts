import { beforeEach, describe, expect, it } from 'vitest';
import { useContextUsageStore } from './context-usage-store';
import type { ContextUsageBreakdown } from '../../shared/context-usage';

const sampleBreakdown: ContextUsageBreakdown = {
  systemPrompt: 500,
  skills: 200,
  tools: 800,
  messages: 0,
  skillsEntries: [{ name: 'sk1', tokens: 200 }],
  toolsEntries: [{ name: 't1', tokens: 800 }],
};

beforeEach(() => {
  useContextUsageStore.setState({ usageBySessionKey: {} });
});

describe('context-usage-store hydrate', () => {
  it('seeds a persisted snapshot including the breakdown', () => {
    useContextUsageStore.getState().hydrateFromSession({
      sessionKey: 's1',
      contextTokens: 1500,
      contextWindow: 128_000,
      breakdown: sampleBreakdown,
    });
    const snap = useContextUsageStore.getState().usageBySessionKey['s1'];
    expect(snap.source).toBe('persisted');
    expect(snap.contextTokens).toBe(1500);
    expect(snap.breakdown).toEqual(sampleBreakdown);
  });

  it('does not overwrite a live snapshot (actual/preview) with persisted data', () => {
    useContextUsageStore.getState().setUsage({
      sessionKey: 's1',
      at: Date.now(),
      contextTokens: 3000,
      contextWindow: 128_000,
      breakdown: { ...sampleBreakdown, messages: 500 },
      source: 'actual',
    });
    useContextUsageStore.getState().hydrateFromSession({
      sessionKey: 's1',
      contextTokens: 1500,
      contextWindow: 128_000,
      breakdown: sampleBreakdown,
    });
    const snap = useContextUsageStore.getState().usageBySessionKey['s1'];
    expect(snap.source).toBe('actual');
    expect(snap.contextTokens).toBe(3000);
  });

  it('overwrites an existing persisted snapshot with a new one (re-hydrate)', () => {
    useContextUsageStore.getState().hydrateFromSession({
      sessionKey: 's1',
      contextTokens: 1500,
      contextWindow: 128_000,
      breakdown: sampleBreakdown,
    });
    useContextUsageStore.getState().hydrateFromSession({
      sessionKey: 's1',
      contextTokens: 2500,
      contextWindow: 128_000,
      breakdown: { ...sampleBreakdown, systemPrompt: 1500 },
    });
    const snap = useContextUsageStore.getState().usageBySessionKey['s1'];
    expect(snap.contextTokens).toBe(2500);
    expect(snap.breakdown?.systemPrompt).toBe(1500);
  });

  it('setUsage from a WS event replaces a persisted snapshot', () => {
    useContextUsageStore.getState().hydrateFromSession({
      sessionKey: 's1',
      contextTokens: 1500,
      contextWindow: 128_000,
      breakdown: sampleBreakdown,
    });
    useContextUsageStore.getState().setUsage({
      sessionKey: 's1',
      at: Date.now(),
      contextTokens: 2000,
      contextWindow: 128_000,
      source: 'preview',
      breakdown: sampleBreakdown,
    });
    const snap = useContextUsageStore.getState().usageBySessionKey['s1'];
    expect(snap.source).toBe('preview');
    expect(snap.contextTokens).toBe(2000);
  });

  it('clearSession removes the snapshot', () => {
    useContextUsageStore.getState().hydrateFromSession({
      sessionKey: 's1',
      contextTokens: 1500,
      contextWindow: 128_000,
    });
    useContextUsageStore.getState().clearSession('s1');
    expect(useContextUsageStore.getState().usageBySessionKey['s1']).toBeUndefined();
  });
});
