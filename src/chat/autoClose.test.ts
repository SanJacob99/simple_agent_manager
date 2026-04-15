import { describe, expect, it } from 'vitest';
import { autoClose, findSafeRevealCount } from './autoClose';

describe('autoClose', () => {
  it('returns already-closed input unchanged', () => {
    expect(autoClose('hello world', 'paragraph')).toBe('hello world');
    expect(autoClose('**done**', 'paragraph')).toBe('**done**');
  });

  it('closes an unclosed bold token', () => {
    expect(autoClose('a **bol', 'paragraph')).toBe('a **bol**');
  });

  it('closes an unclosed italic token', () => {
    expect(autoClose('an *it', 'paragraph')).toBe('an *it*');
  });

  it('closes unclosed underscore italic and bold', () => {
    expect(autoClose('_it', 'paragraph')).toBe('_it_');
    expect(autoClose('__bo', 'paragraph')).toBe('__bo__');
  });

  it('closes an unclosed inline code span', () => {
    expect(autoClose('use `foo', 'paragraph')).toBe('use `foo`');
  });

  it('closes an unclosed strikethrough', () => {
    expect(autoClose('~~gon', 'paragraph')).toBe('~~gon~~');
  });

  it('closes an unclosed link text bracket', () => {
    expect(autoClose('see [click', 'paragraph')).toBe('see [click]()');
  });

  it('does not double-close already closed tokens inside partial text', () => {
    expect(autoClose('**done** and *par', 'paragraph')).toBe('**done** and *par*');
  });

  it('closes nested tokens in LIFO order', () => {
    expect(autoClose('**bold and *italic', 'paragraph')).toBe('**bold and *italic***');
  });

  it('appends a closing fence when code_fence source is not terminated', () => {
    expect(autoClose('```ts\nconst x = 1', 'code_fence')).toBe('```ts\nconst x = 1\n```');
  });

  it('does not add a second closing fence when already present', () => {
    const src = '```ts\nconst x = 1\n```';
    expect(autoClose(src, 'code_fence')).toBe(src);
  });

  it('does not treat tokens inside inline code as open', () => {
    expect(autoClose('code `**not-bold', 'paragraph')).toBe('code `**not-bold`');
  });
});

describe('findSafeRevealCount', () => {
  it('returns cursor when no inline tokens are open', () => {
    expect(findSafeRevealCount('hello world', 5, 'paragraph')).toBe(5);
    expect(findSafeRevealCount('**bold** text', 8, 'paragraph')).toBe(8);
  });

  it('rolls back to the position of an open italic opener', () => {
    // `*hel` — cursor inside italic, no closer yet
    expect(findSafeRevealCount('*hello*', 4, 'paragraph')).toBe(0);
  });

  it('rolls back to the position of an open bold opener', () => {
    // `**hel` — cursor inside bold, no closer yet
    expect(findSafeRevealCount('**hello**', 5, 'paragraph')).toBe(0);
  });

  it('advances past a closed token', () => {
    // `*hello*` fully revealed — safe == cursor
    expect(findSafeRevealCount('*hello*', 7, 'paragraph')).toBe(7);
  });

  it('holds at the earliest unclosed token (nested)', () => {
    // `**bold and *ital` — `**` still open, roll back to position 0
    expect(findSafeRevealCount('**bold and *italic***', 16, 'paragraph')).toBe(0);
  });

  it('advances safely after an earlier closed pair', () => {
    // `**done** and *par` — `**done**` closed, `*par` open → safe at position 13
    const text = '**done** and *partial*';
    expect(findSafeRevealCount(text, 17, 'paragraph')).toBe(13);
  });

  it('holds at an open inline code span', () => {
    expect(findSafeRevealCount('use `foo', 8, 'paragraph')).toBe(4);
  });

  it('treats code_fence blocks as fully revealable', () => {
    // Inline asterisks inside code should not hold the reveal.
    expect(findSafeRevealCount('const x = "*hi"', 12, 'code_fence')).toBe(12);
  });

  it('holds at an open link bracket', () => {
    expect(findSafeRevealCount('see [click', 10, 'paragraph')).toBe(4);
  });

  it('handles cursor beyond text length by clamping to length', () => {
    expect(findSafeRevealCount('hello', 100, 'paragraph')).toBe(5);
  });

  it('advances at a strikethrough closing pair', () => {
    expect(findSafeRevealCount('~~gone~~ text', 13, 'paragraph')).toBe(13);
  });
});
