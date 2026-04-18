import { describe, expect, it } from 'vitest';
import { cleanSchemaForGemini } from './clean-for-gemini';

describe('cleanSchemaForGemini', () => {
  it('strips unsupported keywords', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[a-z]+$' },
        age: { type: 'number', minimum: 0, maximum: 150, format: 'int32' },
      },
    };
    const cleaned = cleanSchemaForGemini(schema) as Record<string, any>;
    const nameSchema = cleaned.properties.name;
    const ageSchema = cleaned.properties.age;
    expect(nameSchema).toEqual({ type: 'string' });
    expect(ageSchema).toEqual({ type: 'number' });
  });

  it('omits empty required arrays', () => {
    const schema = { type: 'object', properties: { a: { type: 'string' } }, required: [] };
    const cleaned = cleanSchemaForGemini(schema) as Record<string, any>;
    expect(cleaned.required).toBeUndefined();
  });

  it('filters required entries not in properties', () => {
    const schema = {
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a', 'b', 'c'],
    };
    const cleaned = cleanSchemaForGemini(schema) as Record<string, any>;
    expect(cleaned.required).toEqual(['a']);
  });

  it('flattens anyOf with literal const values to enum', () => {
    const schema = {
      anyOf: [
        { const: 'red', type: 'string' },
        { const: 'blue', type: 'string' },
        { const: 'green', type: 'string' },
      ],
    };
    const cleaned = cleanSchemaForGemini(schema) as Record<string, any>;
    expect(cleaned.type).toBe('string');
    expect(cleaned.enum).toEqual(['red', 'blue', 'green']);
  });

  it('simplifies anyOf with null + one real type (TypeBox Optional pattern)', () => {
    const schema = {
      anyOf: [
        { type: 'string' },
        { type: 'null' },
      ],
    };
    const cleaned = cleanSchemaForGemini(schema) as Record<string, any>;
    expect(cleaned.type).toBe('string');
    expect(cleaned.anyOf).toBeUndefined();
  });

  it('collapses type arrays with null', () => {
    const schema = { type: ['string', 'null'] };
    const cleaned = cleanSchemaForGemini(schema) as Record<string, any>;
    expect(cleaned.type).toBe('string');
  });

  it('resolves $ref to $defs', () => {
    const schema = {
      type: 'object',
      $defs: { Name: { type: 'string', description: 'A name' } },
      properties: {
        name: { $ref: '#/$defs/Name' },
      },
    };
    const cleaned = cleanSchemaForGemini(schema) as Record<string, any>;
    expect(cleaned.properties.name.type).toBe('string');
    expect(cleaned.properties.name.description).toBe('A name');
    expect(cleaned.$defs).toBeUndefined();
  });

  it('handles circular $ref without infinite loop', () => {
    const schema = {
      type: 'object',
      $defs: { Node: { type: 'object', properties: { child: { $ref: '#/$defs/Node' } } } },
      properties: { root: { $ref: '#/$defs/Node' } },
    };
    // Should not throw or hang
    const cleaned = cleanSchemaForGemini(schema);
    expect(cleaned).toBeDefined();
  });

  it('converts const to enum', () => {
    const schema = { const: 'fixed', type: 'string' };
    const cleaned = cleanSchemaForGemini(schema) as Record<string, any>;
    expect(cleaned.enum).toEqual(['fixed']);
    expect(cleaned.const).toBeUndefined();
  });

  it('strips $schema, $id, additionalProperties', () => {
    const schema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      $id: 'test',
      type: 'object',
      additionalProperties: false,
      properties: { a: { type: 'string' } },
    };
    const cleaned = cleanSchemaForGemini(schema) as Record<string, any>;
    expect(cleaned.$schema).toBeUndefined();
    expect(cleaned.$id).toBeUndefined();
    expect(cleaned.additionalProperties).toBeUndefined();
    expect(cleaned.type).toBe('object');
  });

  it('passes through clean schemas unchanged', () => {
    const schema = {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command' },
      },
      required: ['command'],
    };
    const cleaned = cleanSchemaForGemini(schema);
    expect(cleaned).toEqual(schema);
  });
});
