import { describe, expect, it } from 'vitest';
import type { ResolvedStructuredOutputConfig } from '../../shared/agent-config';
import {
  extractJson,
  validate,
  enforceFinalResponse,
  buildRepairInstruction,
  buildSchemaPromptGuidance,
  responseFormatPayload,
} from './structured-output-engine';

const SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    tags: { type: 'array', items: { type: 'string' }, maxItems: 3 },
  },
  required: ['answer'],
  additionalProperties: false,
};

function makeConfig(
  overrides: Partial<ResolvedStructuredOutputConfig> = {},
): ResolvedStructuredOutputConfig {
  return {
    structuredOutputNodeId: 's1',
    label: 'Test Structured Output',
    enabled: true,
    schemaName: 'response',
    schema: JSON.stringify(SCHEMA),
    schemaJson: SCHEMA,
    format: 'json_schema',
    mode: 'strict',
    onFailure: 'repair',
    maxRepairAttempts: 2,
    includeSchemaInPrompt: true,
    ...overrides,
  };
}

describe('extractJson', () => {
  it('parses a bare JSON object', () => {
    expect(extractJson('{"answer":"hi"}')).toBe('{"answer":"hi"}');
  });

  it('extracts JSON from a fenced code block', () => {
    const msg = 'Here you go:\n```json\n{"answer":"hi"}\n```\nThanks!';
    expect(extractJson(msg)).toBe('{"answer":"hi"}');
  });

  it('extracts a balanced object span surrounded by prose', () => {
    const msg = 'Sure — {"answer":"hi","confidence":0.5} — done.';
    expect(extractJson(msg)).toBe('{"answer":"hi","confidence":0.5}');
  });

  it('handles braces inside strings', () => {
    const msg = '{"answer":"a } b","confidence":1}';
    expect(extractJson(msg)).toBe(msg);
  });

  it('returns null when nothing parses', () => {
    expect(extractJson('no json here')).toBeNull();
    expect(extractJson('   ')).toBeNull();
  });
});

describe('validate', () => {
  it('accepts a conforming object', () => {
    expect(validate({ answer: 'hi', confidence: 0.5 }, SCHEMA, true)).toEqual([]);
  });

  it('flags missing required properties', () => {
    const errs = validate({ confidence: 0.5 }, SCHEMA, true);
    expect(errs.some((e) => e.message.includes('required'))).toBe(true);
  });

  it('flags wrong types', () => {
    const errs = validate({ answer: 42 }, SCHEMA, true);
    expect(errs.some((e) => e.path === '/answer' && e.message.includes('type'))).toBe(true);
  });

  it('rejects unknown keys in strict mode', () => {
    const errs = validate({ answer: 'hi', extra: 1 }, SCHEMA, true);
    expect(errs.some((e) => e.path === '/extra')).toBe(true);
  });

  it('tolerates unknown keys in lenient mode', () => {
    const lenient = { ...SCHEMA };
    delete (lenient as Record<string, unknown>).additionalProperties;
    expect(validate({ answer: 'hi', extra: 1 }, lenient, false)).toEqual([]);
  });

  it('enforces numeric bounds', () => {
    const errs = validate({ answer: 'hi', confidence: 2 }, SCHEMA, true);
    expect(errs.some((e) => e.path === '/confidence' && e.message.includes('maximum'))).toBe(true);
  });

  it('enforces array item types and bounds', () => {
    const errs = validate({ answer: 'hi', tags: ['a', 2, 'c', 'd'] }, SCHEMA, true);
    expect(errs.some((e) => e.path === '/tags/1')).toBe(true);
    expect(errs.some((e) => e.message.includes('at most'))).toBe(true);
  });

  it('validates enum membership', () => {
    const schema = { enum: ['a', 'b'] };
    expect(validate('a', schema, true)).toEqual([]);
    expect(validate('c', schema, true).length).toBe(1);
  });
});

describe('enforceFinalResponse', () => {
  it('passes a conforming fenced response', () => {
    const result = enforceFinalResponse('```json\n{"answer":"hi"}\n```', makeConfig());
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ answer: 'hi' });
  });

  it('fails when JSON is absent', () => {
    const result = enforceFinalResponse('just prose', makeConfig());
    expect(result.ok).toBe(false);
    expect(result.errors[0].message).toContain('parseable JSON');
  });

  it('reports schema violations', () => {
    const result = enforceFinalResponse('{"confidence":0.5}', makeConfig());
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('is a no-op when disabled', () => {
    const result = enforceFinalResponse('not json', makeConfig({ enabled: false }));
    expect(result.ok).toBe(true);
  });

  it('is a no-op when the schema did not parse', () => {
    const result = enforceFinalResponse('not json', makeConfig({ schemaJson: null }));
    expect(result.ok).toBe(true);
  });
});

describe('prompt + provider helpers', () => {
  it('builds a repair instruction listing each error', () => {
    const result = enforceFinalResponse('{"confidence":0.5}', makeConfig());
    const instruction = buildRepairInstruction(result.errors, makeConfig());
    expect(instruction).toContain('did not satisfy');
    expect(instruction).toContain('/answer');
  });

  it('includes the schema in prompt guidance when enabled', () => {
    const guidance = buildSchemaPromptGuidance(makeConfig());
    expect(guidance).toContain('Response format');
    expect(guidance).toContain('"answer"');
  });

  it('omits prompt guidance when disabled', () => {
    expect(buildSchemaPromptGuidance(makeConfig({ includeSchemaInPrompt: false }))).toBe('');
  });

  it('builds an OpenAI-style json_schema payload', () => {
    const payload = responseFormatPayload(makeConfig());
    expect(payload?.type).toBe('json_schema');
    expect((payload?.json_schema as Record<string, unknown>).strict).toBe(true);
  });

  it('returns a json_object payload for that format', () => {
    expect(responseFormatPayload(makeConfig({ format: 'json_object' }))).toEqual({ type: 'json_object' });
  });

  it('returns null for format none or disabled node', () => {
    expect(responseFormatPayload(makeConfig({ format: 'none' }))).toBeNull();
    expect(responseFormatPayload(makeConfig({ enabled: false }))).toBeNull();
  });
});
