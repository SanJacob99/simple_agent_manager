import { describe, expect, it } from 'vitest';
import { findCodeRegions, isInsideCode } from './code-regions';

describe('findCodeRegions', () => {
  it('finds fenced code blocks', () => {
    const text = 'before\n```\ncode here\n```\nafter';
    const regions = findCodeRegions(text);
    expect(regions.length).toBe(1);
    expect(text.slice(regions[0].start, regions[0].end)).toContain('code here');
  });

  it('finds inline code spans', () => {
    const text = 'use `<|token|>` in code';
    const regions = findCodeRegions(text);
    expect(regions.length).toBe(1);
    expect(text.slice(regions[0].start, regions[0].end)).toBe('`<|token|>`');
  });

  it('returns empty for plain text', () => {
    expect(findCodeRegions('no code here')).toEqual([]);
  });
});

describe('isInsideCode', () => {
  it('returns true for position inside a region', () => {
    const regions = [{ start: 5, end: 15 }];
    expect(isInsideCode(10, regions)).toBe(true);
  });

  it('returns false for position outside all regions', () => {
    const regions = [{ start: 5, end: 15 }];
    expect(isInsideCode(3, regions)).toBe(false);
    expect(isInsideCode(15, regions)).toBe(false);
  });
});
