import { describe, expect, it } from 'vitest';
import { findToolNameConflicts, normalizeToolName } from './tool-name-policy';

describe('normalizeToolName', () => {
  it('lowercases and trims', () => {
    expect(normalizeToolName('  Calculator  ')).toBe('calculator');
  });

  it('collapses case differences', () => {
    expect(normalizeToolName('Web_Fetch')).toBe(normalizeToolName('web_fetch'));
  });
});

describe('findToolNameConflicts', () => {
  it('returns empty array when no duplicates', () => {
    expect(findToolNameConflicts(['calculator', 'web_fetch', 'bash'])).toEqual([]);
  });

  it('detects case-insensitive duplicates', () => {
    const out = findToolNameConflicts(['calculator', 'Calculator']);
    expect(out).toHaveLength(2);
    expect(out).toContain('calculator');
    expect(out).toContain('Calculator');
  });

  it('ignores empty and whitespace-only names', () => {
    expect(findToolNameConflicts(['', '  ', 'tool'])).toEqual([]);
  });

  it('groups multiple distinct conflicts', () => {
    const out = findToolNameConflicts(['a', 'A', 'b', 'b']);
    expect(new Set(out)).toEqual(new Set(['a', 'A', 'b']));
  });
});
