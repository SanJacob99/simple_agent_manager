import { describe, expect, it } from 'vitest';
import type { ResolvedStructuredOutputConfig } from '../../shared/agent-config';
import {
  StructuredOutputEnforcer,
  createEnforcer,
  parseSchema,
  validateAgainstSchema,
  extractJson,
  buildRepairPrompt,
  type JsonSchema,
} from './structured-output-engine';

const PERSON_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1 },
    age: { type: 'integer', minimum: 0 },
    role: { enum: ['admin', 'user'] },
  },
  required: ['name', 'age'],
  additionalProperties: false,
};

function makeConfig(overrides: Partial<ResolvedStructuredOutputConfig> = {}): ResolvedStructuredOutputConfig {
  return {
    structuredOutputNodeId: 's1',
    label: 'Test Output',
    enabled: true,
    schemaName: 'person',
    schema: JSON.stringify(PERSON_SCHEMA),
    strict: true,
    strategy: 'tool',
    repair: 'reprompt',
    maxRepairAttempts: 1,
    onFailure: 'error',
    ...overrides,
  };
}

describe('parseSchema', () => {
  it('rejects empty and non-object schemas', () => {
    expect(parseSchema('').error).toMatch(/empty/i);
    expect(parseSchema('[]').error).toMatch(/object/i);
    expect(parseSchema('{ bad json').error).toMatch(/invalid json/i);
  });
  it('parses a valid object schema', () => {
    expect(parseSchema(JSON.stringify(PERSON_SCHEMA)).schema).toMatchObject({ type: 'object' });
  });
});

describe('validateAgainstSchema', () => {
  it('accepts a conforming value', () => {
    expect(validateAgainstSchema({ name: 'Ada', age: 36, role: 'admin' }, PERSON_SCHEMA).valid).toBe(true);
  });
  it('reports missing required, wrong type, enum, and additional props', () => {
    const r = validateAgainstSchema({ age: 'old', role: 'root', extra: 1 }, PERSON_SCHEMA);
    expect(r.valid).toBe(false);
    const msgs = r.errors.map((e) => e.message).join(' | ');
    expect(msgs).toMatch(/missing required property "name"/);
    expect(msgs).toMatch(/expected integer/);
    expect(msgs).toMatch(/must be one of/);
    expect(msgs).toMatch(/additional property "extra"/);
  });
  it('enforces numeric and length bounds', () => {
    expect(validateAgainstSchema({ name: '', age: -1 }, PERSON_SCHEMA).valid).toBe(false);
  });
  it('handles nested arrays and anyOf', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' }, minItems: 1 },
        id: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
      },
      required: ['tags'],
    };
    expect(validateAgainstSchema({ tags: ['a'], id: 7 }, schema).valid).toBe(true);
    expect(validateAgainstSchema({ tags: [], id: true }, schema).valid).toBe(false);
  });
});

describe('extractJson', () => {
  it('parses bare JSON', () => {
    expect(extractJson('{"a":1}').value).toEqual({ a: 1 });
  });
  it('parses fenced JSON', () => {
    expect(extractJson('Here:\n```json\n{"a":1}\n```\nDone').value).toEqual({ a: 1 });
  });
  it('parses prose-wrapped balanced JSON', () => {
    expect(extractJson('The answer is {"a": {"b": 2}} ok').value).toEqual({ a: { b: 2 } });
  });
  it('reports when no JSON is present', () => {
    expect(extractJson('no json here').error).toBeDefined();
  });
});

describe('StructuredOutputEnforcer', () => {
  it('is a no-op pass-through when disabled', () => {
    const e = createEnforcer(makeConfig({ enabled: false }));
    expect(e.active).toBe(false);
    expect(e.evaluate('anything').ok).toBe(true);
  });

  it('accepts valid output on the first try', () => {
    const e = new StructuredOutputEnforcer(makeConfig());
    const d = e.evaluate('{"name":"Ada","age":36}');
    expect(d.ok).toBe(true);
    expect(d.shouldRepair).toBe(false);
    expect(d.value).toEqual({ name: 'Ada', age: 36 });
  });

  it('requests a repair on invalid output, then exhausts to an error', () => {
    const e = new StructuredOutputEnforcer(makeConfig({ maxRepairAttempts: 1, onFailure: 'error' }));
    const first = e.evaluate('{"age":36}');
    expect(first.ok).toBe(false);
    expect(first.shouldRepair).toBe(true);
    expect(first.repairPrompt).toMatch(/did not satisfy/);

    const second = e.evaluate('{"age":36}'); // still invalid, no attempts left
    expect(second.ok).toBe(false);
    expect(second.shouldRepair).toBe(false);
    expect(second.exhausted).toBe(true);
  });

  it('passes raw output through when onFailure is passthrough', () => {
    const e = new StructuredOutputEnforcer(makeConfig({ repair: 'none', onFailure: 'passthrough' }));
    const d = e.evaluate('{"age":36}');
    expect(d.ok).toBe(true);
    expect(d.errors.length).toBeGreaterThan(0);
  });

  it('loose mode never blocks but still reports errors', () => {
    const e = new StructuredOutputEnforcer(makeConfig({ strict: false }));
    const d = e.evaluate('{"age":36}');
    expect(d.ok).toBe(true);
    expect(d.shouldRepair).toBe(false);
    expect(d.errors.length).toBeGreaterThan(0);
  });

  it('refuses (strict) when the schema itself is unparseable', () => {
    const e = new StructuredOutputEnforcer(makeConfig({ schema: '{ not json' }));
    expect(e.schemaError).toBeDefined();
    expect(e.evaluate('{"name":"Ada","age":1}').ok).toBe(false);
  });
});

describe('buildRepairPrompt', () => {
  it('lists errors and embeds the schema', () => {
    const prompt = buildRepairPrompt('person', [{ path: '/name', message: 'missing' }], '{"type":"object"}');
    expect(prompt).toMatch(/person/);
    expect(prompt).toMatch(/\/name: missing/);
    expect(prompt).toMatch(/```json/);
  });
});
