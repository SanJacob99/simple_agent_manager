import { describe, it, expect } from 'vitest';
import { canonicalChannelKey, parseChannelKey, isChannelKey } from './channel-key';

describe('channel-key', () => {
  it('canonicalizes regardless of arg order', () => {
    expect(canonicalChannelKey('beta', 'alpha')).toBe('channel:alpha:beta');
    expect(canonicalChannelKey('alpha', 'beta')).toBe('channel:alpha:beta');
  });
  it('parseChannelKey returns sorted pair', () => {
    expect(parseChannelKey('channel:alpha:beta')).toEqual(['alpha', 'beta']);
  });
  it('rejects non-channel keys', () => {
    expect(isChannelKey('user:alpha')).toBe(false);
    expect(isChannelKey('channel:alpha:beta')).toBe(true);
  });
  it('throws on identical agent IDs', () => {
    expect(() => canonicalChannelKey('alpha', 'alpha')).toThrow();
  });
  it('throws on a malformed channel key passed to parseChannelKey', () => {
    expect(() => parseChannelKey('user:alpha')).toThrow();
    expect(() => parseChannelKey('channel:alpha')).toThrow();
  });
});
