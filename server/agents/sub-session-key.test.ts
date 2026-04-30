import { describe, it, expect } from 'vitest';
import { parseSubSessionKey } from './sub-session-key';

describe('parseSubSessionKey', () => {
  it('parses a raw sub:* key whose parent is agent:<id>:main', () => {
    const result = parseSubSessionKey('sub:agent:a1:main:researcher:abc123');
    expect(result).toEqual({
      parentSessionKey: 'agent:a1:main',
      subAgentName: 'researcher',
      shortUuid: 'abc123',
      isSubSession: true,
    });
  });

  it('parses a wrapped agent:<id>:sub:* key', () => {
    const result = parseSubSessionKey('agent:a1:sub:agent:a1:main:researcher:abc123');
    expect(result).toEqual({
      parentSessionKey: 'agent:a1:main',
      subAgentName: 'researcher',
      shortUuid: 'abc123',
      isSubSession: true,
    });
  });

  it('returns null for non-sub keys', () => {
    expect(parseSubSessionKey('agent:a1:main')).toBeNull();
    expect(parseSubSessionKey('cron:job-1')).toBeNull();
    expect(parseSubSessionKey('hook:hook-1')).toBeNull();
  });

  it('returns null when name segment fails the regex', () => {
    // "Researcher" capitalized -> invalid
    expect(parseSubSessionKey('sub:agent:a1:main:Researcher:abc123')).toBeNull();
  });

  it('returns null when shortUuid segment is missing', () => {
    expect(parseSubSessionKey('sub:agent:a1:main:researcher')).toBeNull();
  });
});
