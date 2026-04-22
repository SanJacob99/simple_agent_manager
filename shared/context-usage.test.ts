import { describe, expect, it } from 'vitest';
import { contextTokensFromUsage } from './context-usage';

describe('contextTokensFromUsage', () => {
  it('prefers totalTokens when present and positive', () => {
    expect(
      contextTokensFromUsage({
        input: 100,
        output: 50,
        cacheRead: 200,
        cacheWrite: 0,
        totalTokens: 999,
      }),
    ).toBe(999);
  });

  it('falls back to input + cache when totalTokens is 0', () => {
    expect(
      contextTokensFromUsage({
        input: 100,
        output: 50,
        cacheRead: 200,
        cacheWrite: 25,
        totalTokens: 0,
      }),
    ).toBe(325);
  });

  it('returns 0 for undefined usage', () => {
    expect(contextTokensFromUsage(undefined)).toBe(0);
  });

  it('ignores output tokens (they do not count toward context fill)', () => {
    expect(
      contextTokensFromUsage({
        input: 50,
        output: 9999,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
      }),
    ).toBe(50);
  });
});
