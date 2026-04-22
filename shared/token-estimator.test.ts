import { describe, expect, it } from 'vitest';
import {
  estimateStringChars,
  estimateTokens,
  estimateTokensFromChars,
  estimateMessagesTokens,
  CHARS_PER_TOKEN_ESTIMATE,
} from './token-estimator';

describe('estimateStringChars', () => {
  it('returns length unchanged for pure ASCII', () => {
    expect(estimateStringChars('hello world')).toBe(11);
  });

  it('returns 0 for empty string', () => {
    expect(estimateStringChars('')).toBe(0);
  });

  it('inflates CJK characters to chars-per-token weight', () => {
    // 3 CJK chars. Each weighs CHARS_PER_TOKEN_ESTIMATE (4).
    const text = '你好世'; // ni hao shi
    expect(estimateStringChars(text)).toBe(3 * CHARS_PER_TOKEN_ESTIMATE);
  });

  it('inflates mixed Latin+CJK correctly', () => {
    // "hello 世" -> 6 ASCII + 1 CJK. CJK contributes 4, ASCII each 1.
    expect(estimateStringChars('hello 世')).toBe(6 + 4);
  });

  it('counts Hangul as CJK-weight', () => {
    // Korean "hello" -> 2 Hangul syllables.
    expect(estimateStringChars('안녕')).toBe(2 * CHARS_PER_TOKEN_ESTIMATE);
  });
});

describe('estimateTokens', () => {
  it('divides Latin chars by CHARS_PER_TOKEN_ESTIMATE', () => {
    expect(estimateTokens('x'.repeat(16))).toBe(4);
  });

  it('gives ~1 token per CJK character', () => {
    const text = '你好世界'; // 4 CJK chars
    expect(estimateTokens(text)).toBe(4);
  });
});

describe('estimateTokensFromChars', () => {
  it('clamps negative values to zero', () => {
    expect(estimateTokensFromChars(-5)).toBe(0);
  });

  it('rounds up', () => {
    expect(estimateTokensFromChars(5)).toBe(2);
  });
});

describe('estimateMessagesTokens', () => {
  it('sums string content', () => {
    expect(
      estimateMessagesTokens([{ content: 'x'.repeat(8) }, { content: 'y'.repeat(4) }]),
    ).toBe(2 + 1);
  });

  it('walks array content for text blocks', () => {
    expect(
      estimateMessagesTokens([
        { content: [{ type: 'text', text: 'x'.repeat(16) }, { type: 'image' }] },
      ]),
    ).toBe(4);
  });
});
