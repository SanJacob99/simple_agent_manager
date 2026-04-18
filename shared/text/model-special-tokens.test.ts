import { describe, expect, it } from 'vitest';
import { stripModelSpecialTokens } from './model-special-tokens';

describe('stripModelSpecialTokens', () => {
  it('strips ASCII pipe delimiters', () => {
    expect(stripModelSpecialTokens('hello <|assistant|> world')).toBe('hello  world');
  });

  it('strips full-width pipe delimiters', () => {
    expect(stripModelSpecialTokens('text <｜begin｜> more')).toBe('text  more');
  });

  it('strips multiple tokens', () => {
    const input = '<|start|>Hello<|end|>';
    const out = stripModelSpecialTokens(input);
    expect(out).toBe('Hello');
  });

  it('inserts space between adjacent words when token is removed', () => {
    expect(stripModelSpecialTokens('word1<|sep|>word2')).toBe('word1 word2');
  });

  it('preserves tokens inside inline code', () => {
    const input = 'use `<|token|>` syntax';
    expect(stripModelSpecialTokens(input)).toBe('use `<|token|>` syntax');
  });

  it('preserves tokens inside fenced code blocks', () => {
    const input = 'text\n```\n<|assistant|>\n```\nmore';
    expect(stripModelSpecialTokens(input)).toContain('<|assistant|>');
  });

  it('returns unchanged text when no tokens present', () => {
    const input = 'just normal text';
    expect(stripModelSpecialTokens(input)).toBe(input);
  });

  it('handles empty string', () => {
    expect(stripModelSpecialTokens('')).toBe('');
  });
});
