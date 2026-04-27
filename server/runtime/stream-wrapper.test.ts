import { describe, expect, it } from 'vitest';
import { extractFinishReason, mapUnknownFinishReason } from './stream-wrapper';

describe('extractFinishReason', () => {
  it('extracts the raw reason from a pi-ai errorMessage', () => {
    expect(extractFinishReason('Provider finish_reason: MAX_TOKENS')).toBe('MAX_TOKENS');
  });

  it('returns null for unrelated error messages', () => {
    expect(extractFinishReason('429 rate limit')).toBeNull();
    expect(extractFinishReason(undefined)).toBeNull();
    expect(extractFinishReason(null)).toBeNull();
  });
});

describe('mapUnknownFinishReason', () => {
  it('maps MAX_TOKENS to length', () => {
    expect(mapUnknownFinishReason('MAX_TOKENS', false)).toBe('length');
  });

  it('maps benign Gemini reasons to toolUse when the message has tool calls', () => {
    expect(mapUnknownFinishReason('MALFORMED_FUNCTION_CALL', true)).toBe('toolUse');
    expect(mapUnknownFinishReason('OTHER', true)).toBe('toolUse');
    expect(mapUnknownFinishReason('FINISH_REASON_UNSPECIFIED', true)).toBe('toolUse');
  });

  it('maps benign reasons to stop when no tool calls are present', () => {
    expect(mapUnknownFinishReason('MALFORMED_FUNCTION_CALL', false)).toBe('stop');
    expect(mapUnknownFinishReason('OTHER', false)).toBe('stop');
  });

  it('maps tool-call-style reasons to toolUse regardless', () => {
    expect(mapUnknownFinishReason('TOOL_CALLS', false)).toBe('toolUse');
    expect(mapUnknownFinishReason('FUNCTION_CALL', false)).toBe('toolUse');
  });

  it('leaves safety-style blocks as errors by returning null', () => {
    expect(mapUnknownFinishReason('SAFETY', false)).toBeNull();
    expect(mapUnknownFinishReason('RECITATION', false)).toBeNull();
    expect(mapUnknownFinishReason('BLOCKED', false)).toBeNull();
  });

  it('returns null for truly unknown reasons so they surface as errors', () => {
    expect(mapUnknownFinishReason('WHO_KNOWS', false)).toBeNull();
  });
});
