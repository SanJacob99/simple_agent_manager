import { describe, expect, it } from 'vitest';
import type { ResolvedStructuredOutputConfig } from '../../shared/agent-config';
import {
  validateAgainstSchema,
  extractJson,
  createEnforcer,
  structuredOutputPromptFragment,
  type JsonSchema,
} from './structured-output-engine';

const PERSON_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1 },
    age: { type: 'integer', minimum: 0, maximum: 150 },
    tags: { type: 'array', items: { type: 'string' }, maxItems: 3 },
    role: { enum: ['admin', 'user'] },
  },
  required: ['name', 'age'],
  additionalProperties: false,
};

function makeConfig(
  overrides: Partial<ResolvedStructuredOutputConfig> = {},
): ResolvedStructuredOutputConfig {
  return {
    structuredOutputNodeId: 's1',
    label: 'Test Output',
    enabled: true,
    schemaName: 'person',
    schema: PERSON_SCHEMA,
    schemaText: JSON.stringify(PERSON_SCHEMA, null, 2),
    schemaValid: true,
    strict: true,
    repairPolicy: 'repair',
    maxRepairAttempts: 2,
    includeSchemaInPrompt: true,
    ...overrides,
  };
}

describe('validateAgainstSchema', () => {
  it('accepts a conforming object', () => {
    const r = validateAgainstSchema(
      { name: 'Ada', age: 36, role: 'admin' },
      PERSON_SCHEMA,
      true,
    );
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('reports missing required fields', () => {
    const r = validateAgainstSchema({ name: 'Ada' }, PERSON_SCHEMA, true);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path === '/age' && /required/.test(e.message))).toBe(true);
  });

  it('reports type mismatches', () => {
    const r = validateAgainstSchema({ name: 'Ada', age: 'old' }, PERSON_SCHEMA, true);
    expect(r.errors.some((e) => e.path === '/age' && /expected type/.test(e.message))).toBe(true);
  });

  it('enforces numeric bounds and enum', () => {
    const r = validateAgainstSchema({ name: 'Ada', age: 999, role: 'root' }, PERSON_SCHEMA, true);
    expect(r.errors.some((e) => e.path === '/age' && /<= 150/.test(e.message))).toBe(true);
    expect(r.errors.some((e) => e.path === '/role')).toBe(true);
  });

  it('rejects extra properties when additionalProperties is false', () => {
    const r = validateAgainstSchema({ name: 'Ada', age: 1, extra: true }, PERSON_SCHEMA, true);
    expect(r.errors.some((e) => e.path === '/extra')).toBe(true);
  });

  it('tolerates a superset in loose mode when the schema is open', () => {
    const open: JsonSchema = { type: 'object', properties: { a: { type: 'string' } } };
    const r = validateAgainstSchema({ a: 'x', b: 2 }, open, false);
    expect(r.valid).toBe(true);
  });

  it('validates array item schemas and bounds', () => {
    const r = validateAgainstSchema(
      { name: 'Ada', age: 1, tags: ['a', 2, 'c', 'd'] },
      PERSON_SCHEMA,
      true,
    );
    expect(r.errors.some((e) => e.path === '/tags/1')).toBe(true); // 2 is not a string
    expect(r.errors.some((e) => e.path === '/tags' && /at most 3/.test(e.message))).toBe(true);
  });
});

describe('extractJson', () => {
  it('parses a bare JSON document', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses a fenced ```json block', () => {
    expect(extractJson('Here you go:\n```json\n{"a":1}\n```\nThanks')).toEqual({ a: 1 });
  });

  it('parses JSON embedded in prose', () => {
    expect(extractJson('The answer is {"a": 1, "b": [2,3]} ok?')).toEqual({ a: 1, b: [2, 3] });
  });

  it('ignores braces inside strings', () => {
    expect(extractJson('{"a": "}{"}')).toEqual({ a: '}{' });
  });

  it('returns undefined when nothing parses', () => {
    expect(extractJson('no json here')).toBeUndefined();
  });
});

describe('StructuredOutputEnforcer', () => {
  it('is inactive when disabled or schema is invalid', () => {
    expect(createEnforcer(makeConfig({ enabled: false })).active).toBe(false);
    expect(createEnforcer(makeConfig({ schemaValid: false, schema: null })).active).toBe(false);
  });

  it('accepts a valid response', () => {
    const e = createEnforcer(makeConfig());
    const r = e.enforce('```json\n{"name":"Ada","age":36}\n```');
    expect(r.ok).toBe(true);
    expect(r.action).toBe('accept');
    expect(r.value).toEqual({ name: 'Ada', age: 36 });
  });

  it('requests repair on failure while attempts remain', () => {
    const e = createEnforcer(makeConfig({ maxRepairAttempts: 1 }));
    const r = e.enforce('{"name":"Ada"}');
    expect(r.ok).toBe(false);
    expect(r.action).toBe('repair');
    expect(r.repairPrompt).toMatch(/age/);
    expect(e.repairAttempts).toBe(1);
    expect(e.canRepair).toBe(false);
  });

  it('falls back to the terminal policy once attempts are exhausted', () => {
    const e = createEnforcer(makeConfig({ maxRepairAttempts: 1, repairPolicy: 'repair' }));
    e.enforce('{"name":"Ada"}'); // consumes the one repair attempt
    const r2 = e.enforce('{"name":"Ada"}');
    expect(r2.action).toBe('passthrough');
  });

  it('errors immediately under the error policy', () => {
    const e = createEnforcer(makeConfig({ repairPolicy: 'error' }));
    const r = e.enforce('not json');
    expect(r.action).toBe('error');
  });

  it('passes through under the passthrough policy', () => {
    const e = createEnforcer(makeConfig({ repairPolicy: 'passthrough' }));
    const r = e.enforce('{"name":"Ada"}');
    expect(r.action).toBe('passthrough');
    expect(r.value).toEqual({ name: 'Ada' });
  });
});

describe('structuredOutputPromptFragment', () => {
  it('emits a schema block when injection is enabled', () => {
    const frag = structuredOutputPromptFragment(makeConfig());
    expect(frag).toMatch(/Output format: person/);
    expect(frag).toMatch(/```json/);
  });

  it('emits nothing when injection is disabled or schema is invalid', () => {
    expect(structuredOutputPromptFragment(makeConfig({ includeSchemaInPrompt: false }))).toBe('');
    expect(structuredOutputPromptFragment(makeConfig({ schemaValid: false }))).toBe('');
  });
});
