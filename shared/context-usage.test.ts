import { describe, expect, it } from 'vitest';
import {
  contextTokensFromUsage,
  foldActualIntoBreakdown,
  type ContextUsageBreakdown,
} from './context-usage';

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

describe('foldActualIntoBreakdown', () => {
  const preview: ContextUsageBreakdown = {
    systemPrompt: 300,
    skills: 200,
    tools: 500,
    messages: 100,
  };

  it('keeps non-messages sections and recomputes messages as remainder', () => {
    const folded = foldActualIntoBreakdown(preview, 1200);
    expect(folded).toEqual({
      systemPrompt: 300,
      skills: 200,
      tools: 500,
      messages: 200, // 1200 - (300 + 200 + 500)
    });
  });

  it('clamps messages to 0 when the estimate overshot reality', () => {
    const folded = foldActualIntoBreakdown(preview, 900);
    expect(folded.messages).toBe(0);
    // Fixed sections stay as-is even when the estimate overshot.
    expect(folded.systemPrompt).toBe(300);
    expect(folded.skills).toBe(200);
    expect(folded.tools).toBe(500);
  });

  it('sums to the actual total when not clamped', () => {
    const folded = foldActualIntoBreakdown(preview, 1200);
    const sum =
      folded.systemPrompt + folded.skills + folded.tools + folded.messages;
    expect(sum).toBe(1200);
  });

  it('carries per-entry arrays through unchanged (fixed within a turn)', () => {
    const previewWithEntries: ContextUsageBreakdown = {
      ...preview,
      skillsEntries: [
        { name: 'skill-a', tokens: 150 },
        { name: 'skill-b', tokens: 50 },
      ],
      toolsEntries: [
        { name: 'read_file', tokens: 300 },
        { name: 'exec', tokens: 200 },
      ],
    };
    const folded = foldActualIntoBreakdown(previewWithEntries, 1200);
    expect(folded.skillsEntries).toBe(previewWithEntries.skillsEntries);
    expect(folded.toolsEntries).toBe(previewWithEntries.toolsEntries);
  });
});
