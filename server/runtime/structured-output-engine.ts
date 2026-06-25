import type { ResolvedStructuredOutputConfig } from '../../shared/agent-config';

/**
 * Structured-output engine.
 *
 * A `structuredOutput` node attached to an agent constrains the agent's final
 * response to a JSON Schema. This module is the runtime side of that contract:
 * it extracts a JSON value from the assistant's final message, validates it
 * against the resolved schema, and — when validation fails — builds a repair
 * instruction the run coordinator can feed back to the model.
 *
 * It is intentionally dependency-free (no `ajv` / `zod`) so it stays inside the
 * "runtime classes must not pull heavy/React deps" convention. The validator
 * implements the common JSON Schema (Draft 2020-12) keywords agents actually
 * emit: `type`, `properties`, `required`, `additionalProperties`, `items`,
 * `enum`, `const`, numeric bounds, string length/pattern, and array bounds.
 * Unknown keywords are ignored rather than rejected, so a richer schema still
 * validates on the subset it understands.
 *
 * Wiring `enforceFinalResponse` into the finalize step of
 * `server/agents/run-coordinator.ts` is the remaining integration step; the
 * helpers below are the stable surface that wiring should target.
 */

export interface ValidationError {
  /** JSON Pointer-ish path to the offending value, e.g. `/items/0/name`. */
  path: string;
  message: string;
}

export interface EnforcementResult {
  /** True when a JSON value was extracted and passed validation. */
  ok: boolean;
  /** The parsed value when extraction succeeded, else null. */
  value: unknown;
  /** Validation errors (empty when `ok`). */
  errors: ValidationError[];
  /** The JSON text that was extracted from the message (may differ from input). */
  extracted: string | null;
}

type JsonSchema = Record<string, unknown>;

/**
 * Extract a JSON value from a free-form assistant message. Models frequently
 * wrap JSON in ```json fences or surround it with prose, so we try, in order:
 *   1. the whole trimmed string,
 *   2. the contents of the first fenced code block,
 *   3. the first balanced `{...}` or `[...]` span.
 * Returns the raw JSON text (not yet parsed) or null if nothing parseable.
 */
export function extractJson(message: string): string | null {
  const trimmed = message.trim();
  if (!trimmed) return null;

  const candidates: string[] = [trimmed];

  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fence && fence[1]) candidates.push(fence[1].trim());

  const balanced = firstBalancedSpan(trimmed);
  if (balanced) candidates.push(balanced);

  for (const candidate of candidates) {
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/** Find the first balanced `{...}` or `[...]` span, respecting strings. */
function firstBalancedSpan(text: string): string | null {
  const open = text.search(/[{[]/);
  if (open === -1) return null;
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') {
      stack.pop();
      if (stack.length === 0) return text.slice(open, i + 1);
    }
  }
  return null;
}

function jsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

/** True when an actual JSON type satisfies a schema `type` declaration. */
function typeMatches(actual: string, expected: string): boolean {
  if (actual === expected) return true;
  // An integer is also a number; the reverse is handled by jsonType.
  if (expected === 'number' && actual === 'integer') return true;
  return false;
}

/**
 * Validate `value` against `schema`. `strict` implies `additionalProperties:
 * false` for object schemas that do not declare it. Errors accumulate with
 * paths so a repair prompt can point the model at each problem.
 */
export function validate(
  value: unknown,
  schema: JsonSchema,
  strict: boolean,
  path = '',
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (schema.enum && Array.isArray(schema.enum)) {
    const ok = schema.enum.some((e) => deepEqual(e, value));
    if (!ok) {
      errors.push({ path: path || '/', message: `value is not one of the allowed enum members` });
    }
  }

  if ('const' in schema && !deepEqual(schema.const, value)) {
    errors.push({ path: path || '/', message: `value must equal the schema const` });
  }

  const declaredType = schema.type;
  const actual = jsonType(value);
  if (typeof declaredType === 'string') {
    if (!typeMatches(actual, declaredType)) {
      errors.push({ path: path || '/', message: `expected type ${declaredType}, got ${actual}` });
      return errors; // type mismatch — deeper checks would be noise
    }
  } else if (Array.isArray(declaredType)) {
    if (!declaredType.some((t) => typeof t === 'string' && typeMatches(actual, t))) {
      errors.push({ path: path || '/', message: `expected one of [${declaredType.join(', ')}], got ${actual}` });
      return errors;
    }
  }

  if (actual === 'object') {
    errors.push(...validateObject(value as Record<string, unknown>, schema, strict, path));
  } else if (actual === 'array') {
    errors.push(...validateArray(value as unknown[], schema, strict, path));
  } else if (actual === 'string') {
    errors.push(...validateString(value as string, schema, path));
  } else if (actual === 'number' || actual === 'integer') {
    errors.push(...validateNumber(value as number, schema, path));
  }

  return errors;
}

function validateObject(
  value: Record<string, unknown>,
  schema: JsonSchema,
  strict: boolean,
  path: string,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const properties = (schema.properties as Record<string, JsonSchema>) ?? {};
  const required = (schema.required as string[]) ?? [];

  for (const key of required) {
    if (!(key in value)) {
      errors.push({ path: `${path}/${key}`, message: `missing required property "${key}"` });
    }
  }

  for (const [key, child] of Object.entries(value)) {
    const childSchema = properties[key];
    if (childSchema) {
      errors.push(...validate(child, childSchema, strict, `${path}/${key}`));
    } else {
      const additional = schema.additionalProperties;
      const allowExtra = additional === undefined ? !strict : additional !== false;
      if (!allowExtra) {
        errors.push({ path: `${path}/${key}`, message: `unexpected property "${key}" (additionalProperties is false)` });
      } else if (additional && typeof additional === 'object') {
        errors.push(...validate(child, additional as JsonSchema, strict, `${path}/${key}`));
      }
    }
  }

  return errors;
}

function validateArray(
  value: unknown[],
  schema: JsonSchema,
  strict: boolean,
  path: string,
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
    errors.push({ path: path || '/', message: `expected at least ${schema.minItems} items, got ${value.length}` });
  }
  if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
    errors.push({ path: path || '/', message: `expected at most ${schema.maxItems} items, got ${value.length}` });
  }
  const items = schema.items;
  if (items && typeof items === 'object' && !Array.isArray(items)) {
    value.forEach((el, i) => {
      errors.push(...validate(el, items as JsonSchema, strict, `${path}/${i}`));
    });
  }
  return errors;
}

function validateString(value: string, schema: JsonSchema, path: string): ValidationError[] {
  const errors: ValidationError[] = [];
  if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
    errors.push({ path: path || '/', message: `string shorter than minLength ${schema.minLength}` });
  }
  if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
    errors.push({ path: path || '/', message: `string longer than maxLength ${schema.maxLength}` });
  }
  if (typeof schema.pattern === 'string') {
    try {
      if (!new RegExp(schema.pattern).test(value)) {
        errors.push({ path: path || '/', message: `string does not match pattern ${schema.pattern}` });
      }
    } catch {
      // invalid pattern in schema — ignore rather than fail validation
    }
  }
  return errors;
}

function validateNumber(value: number, schema: JsonSchema, path: string): ValidationError[] {
  const errors: ValidationError[] = [];
  if (typeof schema.minimum === 'number' && value < schema.minimum) {
    errors.push({ path: path || '/', message: `value below minimum ${schema.minimum}` });
  }
  if (typeof schema.maximum === 'number' && value > schema.maximum) {
    errors.push({ path: path || '/', message: `value above maximum ${schema.maximum}` });
  }
  if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) {
    errors.push({ path: path || '/', message: `value not greater than exclusiveMinimum ${schema.exclusiveMinimum}` });
  }
  if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) {
    errors.push({ path: path || '/', message: `value not less than exclusiveMaximum ${schema.exclusiveMaximum}` });
  }
  return errors;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

/**
 * Run the full enforcement pass over an assistant's final message text:
 * extract JSON, then validate against the resolved schema. When the node is
 * disabled or has no parseable schema, enforcement is skipped and the result is
 * reported as `ok` with the raw text untouched.
 */
export function enforceFinalResponse(
  message: string,
  config: ResolvedStructuredOutputConfig,
): EnforcementResult {
  if (!config.enabled || !config.schemaJson) {
    return { ok: true, value: null, errors: [], extracted: null };
  }
  const extracted = extractJson(message);
  if (extracted === null) {
    return {
      ok: false,
      value: null,
      errors: [{ path: '/', message: 'final response did not contain parseable JSON' }],
      extracted: null,
    };
  }
  const value = JSON.parse(extracted);
  const errors = validate(value, config.schemaJson, config.mode === 'strict');
  return { ok: errors.length === 0, value, errors, extracted };
}

/**
 * Build a re-prompt instruction for the `repair` failure policy. The run
 * coordinator appends this as a user turn so the model can correct its output.
 */
export function buildRepairInstruction(
  errors: ValidationError[],
  config: ResolvedStructuredOutputConfig,
): string {
  const lines = errors.map((e) => `- ${e.path}: ${e.message}`).join('\n');
  return [
    'Your previous response did not satisfy the required JSON schema.',
    'Validation errors:',
    lines,
    '',
    `Respond again with ONLY a valid JSON value matching the "${config.schemaName}" schema.`,
    'Do not include explanations, markdown, or code fences — output raw JSON only.',
  ].join('\n');
}

/**
 * Compact system-prompt addendum describing the contract, used when
 * `includeSchemaInPrompt` is set. Helps models without native structured-output
 * support produce conforming JSON on the first try.
 */
export function buildSchemaPromptGuidance(
  config: ResolvedStructuredOutputConfig,
): string {
  if (!config.includeSchemaInPrompt || !config.schemaJson) return '';
  return [
    '## Response format',
    `Your final response MUST be a single JSON value that validates against this "${config.schemaName}" JSON Schema:`,
    '```json',
    JSON.stringify(config.schemaJson, null, 2),
    '```',
    config.mode === 'strict'
      ? 'Do not include properties that are not declared in the schema.'
      : 'Extra properties are tolerated but discouraged.',
    'Output raw JSON only — no surrounding prose or code fences.',
  ].join('\n');
}

/**
 * Provider response-format payload (OpenAI-compatible shape). Returns null when
 * the node requests no provider-side constraint (`format: 'none'`).
 */
export function responseFormatPayload(
  config: ResolvedStructuredOutputConfig,
): Record<string, unknown> | null {
  if (!config.enabled) return null;
  if (config.format === 'none') return null;
  if (config.format === 'json_object') {
    return { type: 'json_object' };
  }
  if (!config.schemaJson) return null;
  return {
    type: 'json_schema',
    json_schema: {
      name: config.schemaName || 'response',
      strict: config.mode === 'strict',
      schema: config.schemaJson,
    },
  };
}
