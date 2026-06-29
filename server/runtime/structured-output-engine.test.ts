import { describe, expect, it } from 'vitest';
import type { ResolvedStructuredOutputConfig } from '../../shared/agent-config';
import {
  evaluateReply,
  extractJson,
  parseSchema,
  validateAgainstSchema,
} from './structured-output-engine';

function makeConfig(
  overrides: Partial<ResolvedStructuredOutputConfig> = {},
): ResolvedStructuredOutputConfig {
  return {
    structuredOutputNodeId: 's1',
    label: 'Structured Output',
    enabled: true,
    schemaName: 'response',
    schema: JSON.stringify({
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
      additionalProperties: false,
    }),
    strict: true,
    onValidationError: 'repair',
    maxRepairAttempts: 1,
    injectSchemaIntoPrompt: true,
    ...overrides,
  };
}

describe('parseSchema', () => {
  it('returns null for non-object schemas', () => {
    expect(parseSchema('not json')).toBeNull();
    expect(parseSchema('[]')).toBeNull();
    expect(parseSchema('42')).toBeNull();
  });

  it('parses a valid object schema', () => {
    expect(parseSchema('{"type":"object"}')).toEqual({ type: 'object' });
  });
});

describe('extractJson', () => {
  it('parses a bare JSON document', () => {
    expect(extractJson('{"answer":"hi"}')).toEqual({ value: { answer: 'hi' } });
  });

  it('parses a fenced json block', () => {
    const reply = 'Sure!\n```json\n{"answer":"hi"}\n```';
    expect(extractJson(reply)).toEqual({ value: { answer: 'hi' } });
  });

  it('extracts the first balanced object from prose', () => {
    const reply = 'Here you go: {"answer":"hi"} — done.';
    expect(extractJson(reply)).toEqual({ value: { answer: 'hi' } });
  });

  it('errors on empty or non-JSON replies', () => {
    expect(extractJson('   ')).toEqual({ error: 'Reply was empty.' });
    expect('error' in extractJson('no json here')).toBe(true);
  });
});

describe('validateAgainstSchema', () => {
  const schema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      age: { type: 'integer', minimum: 0 },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['name'],
    additionalProperties: false,
  };

  it('accepts a conforming object', () => {
    const result = validateAgainstSchema({ name: 'a', age: 3, tags: ['x'] }, schema);
    expect(result.valid).toBe(true);
  });

  it('flags a missing required property', () => {
    const result = validateAgainstSchema({ age: 3 }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === '/name')).toBe(true);
  });

  it('flags a wrong type and an out-of-range number', () => {
    const result = validateAgainstSchema({ name: 5, age: -1 }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects additional properties when disallowed', () => {
    const result = validateAgainstSchema({ name: 'a', extra: true }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === '/extra')).toBe(true);
  });

  it('validates enum membership', () => {
    const enumSchema = { enum: ['a', 'b'] };
    expect(validateAgainstSchema('a', enumSchema).valid).toBe(true);
    expect(validateAgainstSchema('c', enumSchema).valid).toBe(false);
  });
});

describe('evaluateReply', () => {
  it('passes through when disabled', () => {
    expect(evaluateReply(makeConfig({ enabled: false }), 'garbage').status).toBe('ok');
  });

  it('passes through when the schema is unparseable', () => {
    expect(evaluateReply(makeConfig({ schema: 'not json' }), 'garbage').status).toBe('ok');
  });

  it('returns ok for a conforming reply', () => {
    const outcome = evaluateReply(makeConfig(), '{"answer":"hello"}');
    expect(outcome.status).toBe('ok');
  });

  it('returns invalid with errors for a non-conforming reply', () => {
    const outcome = evaluateReply(makeConfig(), '{"wrong":"field"}');
    expect(outcome.status).toBe('invalid');
    if (outcome.status === 'invalid') {
      expect(outcome.errors.length).toBeGreaterThan(0);
    }
  });

  it('returns invalid when the reply has no JSON', () => {
    const outcome = evaluateReply(makeConfig(), 'I cannot do that.');
    expect(outcome.status).toBe('invalid');
  });
});
