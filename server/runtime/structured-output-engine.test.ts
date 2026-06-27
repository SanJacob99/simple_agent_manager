import { describe, expect, it } from 'vitest';
import type { ResolvedStructuredOutputConfig } from '../../shared/agent-config';
import {
  buildRepairPrompt,
  buildSchemaInstruction,
  extractJson,
  parseSchema,
  validateOutput,
} from './structured-output-engine';

const OBJECT_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    answer: { type: 'string', minLength: 1 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['answer'],
  additionalProperties: false,
});

function makeConfig(
  overrides: Partial<ResolvedStructuredOutputConfig> = {},
): ResolvedStructuredOutputConfig {
  return {
    structuredOutputNodeId: 'so1',
    label: 'Test Structured Output',
    enabled: true,
    schema: OBJECT_SCHEMA,
    schemaName: 'response',
    mode: 'strict',
    onValidationError: 'reprompt',
    maxRepairAttempts: 2,
    includeSchemaInPrompt: true,
    ...overrides,
  };
}

describe('parseSchema', () => {
  it('parses a valid object schema', () => {
    const { schema, error } = parseSchema(makeConfig());
    expect(error).toBeNull();
    expect(schema?.type).toBe('object');
  });

  it('reports a JSON parse error', () => {
    const { schema, error } = parseSchema(makeConfig({ schema: '{ not json' }));
    expect(schema).toBeNull();
    expect(error).toMatch(/not valid JSON/);
  });

  it('rejects a non-object schema', () => {
    const { schema, error } = parseSchema(makeConfig({ schema: '[1,2,3]' }));
    expect(schema).toBeNull();
    expect(error).toMatch(/must be a JSON object/);
  });

  it('reports an empty schema', () => {
    const { error } = parseSchema(makeConfig({ schema: '   ' }));
    expect(error).toMatch(/empty/);
  });
});

describe('extractJson', () => {
  it('parses a bare JSON object', () => {
    const { value, found } = extractJson('{"answer":"hi"}');
    expect(found).toBe(true);
    expect(value).toEqual({ answer: 'hi' });
  });

  it('parses JSON inside a fenced code block', () => {
    const text = 'Here is the result:\n```json\n{"answer":"hi"}\n```\nThanks!';
    const { value, found } = extractJson(text);
    expect(found).toBe(true);
    expect(value).toEqual({ answer: 'hi' });
  });

  it('extracts a balanced object embedded in prose', () => {
    const text = 'The answer is {"answer":"hi","confidence":0.5} as computed.';
    const { value, found } = extractJson(text);
    expect(found).toBe(true);
    expect(value).toEqual({ answer: 'hi', confidence: 0.5 });
  });

  it('does not confuse braces inside strings', () => {
    const { value, found } = extractJson('prefix {"answer":"a } b"} suffix');
    expect(found).toBe(true);
    expect(value).toEqual({ answer: 'a } b' });
  });

  it('returns not-found when there is no JSON', () => {
    expect(extractJson('just some prose').found).toBe(false);
  });
});

describe('validateOutput', () => {
  it('accepts a conforming response', () => {
    const r = validateOutput(makeConfig(), '{"answer":"42","confidence":0.9}');
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('flags a missing required field', () => {
    const r = validateOutput(makeConfig(), '{"confidence":0.9}');
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path === '/answer' && /required/.test(e.message))).toBe(true);
  });

  it('flags a type mismatch', () => {
    const r = validateOutput(makeConfig(), '{"answer":"x","confidence":"high"}');
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path === '/confidence')).toBe(true);
  });

  it('enforces numeric bounds', () => {
    const r = validateOutput(makeConfig(), '{"answer":"x","confidence":2}');
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /<= 1/.test(e.message))).toBe(true);
  });

  it('rejects extra properties in strict mode', () => {
    const r = validateOutput(makeConfig(), '{"answer":"x","extra":true}');
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path === '/extra' && /not an allowed/.test(e.message))).toBe(true);
  });

  it('permits extra properties in loose mode', () => {
    const r = validateOutput(makeConfig({ mode: 'loose' }), '{"answer":"x","extra":true}');
    expect(r.valid).toBe(true);
  });

  it('validates nested array items', () => {
    const r = validateOutput(makeConfig(), '{"answer":"x","tags":["a",2]}');
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path === '/tags/1')).toBe(true);
  });

  it('reports when no JSON is found', () => {
    const r = validateOutput(makeConfig(), 'I could not produce JSON.');
    expect(r.valid).toBe(false);
    expect(r.noJsonFound).toBe(true);
  });

  it('surfaces an unparseable schema as an error rather than throwing', () => {
    const r = validateOutput(makeConfig({ schema: '{bad' }), '{"answer":"x"}');
    expect(r.valid).toBe(false);
    expect(r.errors[0].message).toMatch(/not valid JSON/);
  });
});

describe('buildSchemaInstruction', () => {
  it('includes the schema and name when enabled', () => {
    const out = buildSchemaInstruction(makeConfig({ schemaName: 'result' }));
    expect(out).toContain('result');
    expect(out).toContain('"answer"');
    expect(out).toContain('JSON only');
  });

  it('returns null when disabled', () => {
    expect(buildSchemaInstruction(makeConfig({ enabled: false }))).toBeNull();
  });

  it('returns null when the flag is off', () => {
    expect(buildSchemaInstruction(makeConfig({ includeSchemaInPrompt: false }))).toBeNull();
  });

  it('returns null on an unparseable schema instead of corrupting the prompt', () => {
    expect(buildSchemaInstruction(makeConfig({ schema: '{bad' }))).toBeNull();
  });
});

describe('buildRepairPrompt', () => {
  it('lists each validation error', () => {
    const result = validateOutput(makeConfig(), '{"confidence":2}');
    const prompt = buildRepairPrompt(makeConfig(), result);
    expect(prompt).toContain('/answer');
    expect(prompt).toContain('corrected JSON');
  });

  it('explains a missing-JSON failure', () => {
    const result = validateOutput(makeConfig(), 'no json here');
    const prompt = buildRepairPrompt(makeConfig(), result);
    expect(prompt).toMatch(/No JSON value could be parsed/);
  });
});
