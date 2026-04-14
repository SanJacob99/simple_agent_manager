import { describe, expect, it } from 'vitest';
import { autoClose } from './autoClose';

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
