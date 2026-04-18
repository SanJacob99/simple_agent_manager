import { describe, expect, it } from 'vitest';
import { formatToolParamPreview, redactToolDetail, sanitizeForConsole } from './tool-redact';

describe('redactToolDetail', () => {
  it('masks bearer tokens', () => {
    const out = redactToolDetail('Authorization: Bearer abcdef1234567890ghij');
    expect(out).not.toContain('abcdef1234567890ghij');
    expect(out).toContain('…');
  });

  it('masks OpenAI sk- keys', () => {
    const out = redactToolDetail('key=sk-proj-ABCDEFGHIJ1234567890KLMNOP');
    expect(out).not.toContain('sk-proj-ABCDEFGHIJ1234567890KLMNOP');
  });

  it('masks GitHub personal access tokens', () => {
    const out = redactToolDetail('token=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234');
    expect(out).not.toContain('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234');
  });

  it('masks PEM private key blocks', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----';
    const out = redactToolDetail(pem);
    expect(out).not.toContain('MIIEv');
  });

  it('masks long generic tokens with first6…last4 format', () => {
    const token = 'a'.repeat(40);
    const out = redactToolDetail(`value=${token}`);
    expect(out).toMatch(/value=aaaaaa…aaaa/);
  });

  it('leaves short innocuous strings alone', () => {
    expect(redactToolDetail('hello world')).toBe('hello world');
  });
});

describe('sanitizeForConsole', () => {
  it('strips control characters', () => {
    expect(sanitizeForConsole('hi\u0000\u0007there')).toBe('hithere');
  });

  it('collapses whitespace', () => {
    expect(sanitizeForConsole('a\n\t  b')).toBe('a b');
  });

  it('truncates to maxChars with ellipsis', () => {
    const out = sanitizeForConsole('x'.repeat(50), 10);
    expect(out).toHaveLength(10);
    expect(out.endsWith('…')).toBe(true);
  });

  it('returns empty string for undefined', () => {
    expect(sanitizeForConsole(undefined)).toBe('');
  });
});

describe('formatToolParamPreview', () => {
  it('serializes plain objects as JSON', () => {
    expect(formatToolParamPreview('raw', { a: 1 })).toBe('raw={"a":1}');
  });

  it('handles undefined explicitly', () => {
    expect(formatToolParamPreview('p', undefined)).toBe('p=<undefined>');
  });

  it('handles circular references without throwing', () => {
    const obj: Record<string, unknown> = { name: 'x' };
    obj.self = obj;
    const out = formatToolParamPreview('p', obj);
    expect(out.startsWith('p=')).toBe(true);
  });

  it('redacts secrets inside serialized params', () => {
    const key = 'sk-proj-ABCDEFGHIJ1234567890KLMNOP';
    const out = formatToolParamPreview('p', { apiKey: key });
    expect(out).not.toContain(key);
  });
});
