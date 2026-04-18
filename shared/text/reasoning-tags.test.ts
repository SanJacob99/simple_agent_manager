import { describe, expect, it } from 'vitest';
import { stripReasoningTagsFromText } from './reasoning-tags';

describe('stripReasoningTagsFromText', () => {
  it('strips <thinking>...</thinking> and its content', () => {
    expect(stripReasoningTagsFromText('<thinking>internal</thinking>Hello'))
      .toBe('Hello');
  });

  it('strips <think>...</think>', () => {
    expect(stripReasoningTagsFromText('<think>hmm</think>Answer'))
      .toBe('Answer');
  });

  it('strips <thought>...</thought>', () => {
    expect(stripReasoningTagsFromText('<thought>reasoning</thought>Result'))
      .toBe('Result');
  });

  it('strips <antthinking>...</antthinking>', () => {
    expect(stripReasoningTagsFromText('<antthinking>plan</antthinking>Output'))
      .toBe('Output');
  });

  it('strips <final> tags', () => {
    expect(stripReasoningTagsFromText('before <final> after'))
      .toBe('before  after');
  });

  it('preserves tags inside inline code', () => {
    expect(stripReasoningTagsFromText('use `<thinking>` tag'))
      .toBe('use `<thinking>` tag');
  });

  it('preserves tags inside fenced code blocks', () => {
    const input = 'text\n```\n<thinking>code</thinking>\n```\nmore';
    expect(stripReasoningTagsFromText(input)).toContain('<thinking>');
  });

  it('handles multiple thinking blocks', () => {
    const input = '<think>a</think>Hello<think>b</think> World';
    expect(stripReasoningTagsFromText(input)).toBe('Hello World');
  });

  it('strips unclosed thinking tags to end of string', () => {
    expect(stripReasoningTagsFromText('<thinking>this never closes'))
      .toBe('');
  });

  it('returns unchanged text when no tags present', () => {
    expect(stripReasoningTagsFromText('normal text')).toBe('normal text');
  });

  it('handles empty string', () => {
    expect(stripReasoningTagsFromText('')).toBe('');
  });
});
