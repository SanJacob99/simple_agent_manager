import type { ResolvedStructuredOutputConfig } from '../../shared/agent-config';

/**
 * Structured-output engine.
 *
 * A structured-output node constrains an agent's final reply to a JSON Schema.
 * This module is the dependency-free validation substrate the runtime calls in
 * its finalize step. It does three things:
 *
 *   1. `extractJson` pulls a JSON value out of an assistant reply, tolerating
 *      Markdown code fences and surrounding prose.
 *   2. `validateAgainstSchema` checks a parsed value against a (subset of)
 *      JSON Schema without pulling in `ajv` or any other validator, keeping the
 *      "runtime classes stay light" convention.
 *   3. `buildSchemaPromptSection` / `buildRepairPrompt` produce the system-prompt
 *      injection and the re-prompt text used when `onValidationError` is `repair`.
 *
 * Wiring `enforceStructuredOutput` into `server/agents/run-coordinator.ts`'s
 * finalize step (validate the streamed reply, repair/warn/block per policy) is
 * the remaining integration step; the API below is the stable surface that
 * wiring should target. Native provider enforcement (OpenAI `response_format`,
 * strict tool-call schemas) is layered in `server/runtime/model-resolver.ts`
 * when `config.strict` is set.
 */

export interface ValidationError {
  /** JSON Pointer-ish path to the offending value, e.g. `/items/0/name`. */
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/** A permissive structural view of a JSON Schema object. */
interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  additionalProperties?: boolean | JsonSchema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  [key: string]: unknown;
}

/** Parse the node's raw schema text. Returns null when it is not a usable object. */
export function parseSchema(raw: string): JsonSchema | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as JsonSchema;
  } catch {
    return null;
  }
}

/**
 * Extract a JSON value from an assistant reply. Handles three common shapes:
 *   - a bare JSON document,
 *   - a ```json fenced block,
 *   - JSON embedded in prose (first balanced object/array is used).
 * Returns `{ value }` on success or `{ error }` describing why parsing failed.
 */
export function extractJson(text: string): { value: unknown } | { error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { error: 'Reply was empty.' };

  // 1. Fenced ```json ... ``` block.
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidates: string[] = [];
  if (fence) candidates.push(fence[1].trim());
  candidates.push(trimmed);

  // 2. First balanced object/array substring.
  const balanced = firstBalancedJson(trimmed);
  if (balanced) candidates.push(balanced);

  for (const candidate of candidates) {
    try {
      return { value: JSON.parse(candidate) };
    } catch {
      // try the next candidate
    }
  }
  return { error: 'Reply did not contain parseable JSON.' };
}

function firstBalancedJson(text: string): string | null {
  const start = text.search(/[{[]/);
  if (start === -1) return null;
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
  const actual = typeOf(value);
  if (type === 'number') return actual === 'number' || actual === 'integer';
  if (type === 'integer') return actual === 'integer';
  return actual === type;
}

/**
 * Validate `value` against a subset of JSON Schema: type, properties, required,
 * items, enum, additionalProperties, numeric/length/array bounds, and
 * anyOf/oneOf. Unknown keywords are ignored rather than rejected, so an
 * over-rich schema validates leniently instead of throwing.
 */
export function validateAgainstSchema(value: unknown, schema: JsonSchema): ValidationResult {
  const errors: ValidationError[] = [];
  walk(value, schema, '', errors);
  return { valid: errors.length === 0, errors };
}

function walk(value: unknown, schema: JsonSchema, path: string, errors: ValidationError[]): void {
  if (schema.enum && !schema.enum.some((e) => deepEqual(e, value))) {
    errors.push({ path: path || '/', message: `value not in enum ${JSON.stringify(schema.enum)}` });
  }

  if (schema.anyOf) {
    if (!schema.anyOf.some((s) => validateAgainstSchema(value, s).valid)) {
      errors.push({ path: path || '/', message: 'value did not match any anyOf branch' });
    }
    return;
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((s) => validateAgainstSchema(value, s).valid).length;
    if (matches !== 1) {
      errors.push({ path: path || '/', message: `value matched ${matches} oneOf branches, expected exactly 1` });
    }
    return;
  }

  const types = schema.type == null ? null : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types && !types.some((t) => matchesType(value, t))) {
    errors.push({ path: path || '/', message: `expected type ${types.join('|')}, got ${typeOf(value)}` });
    return;
  }

  if (typeOf(value) === 'object' && (schema.properties || schema.required || schema.additionalProperties !== undefined)) {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in obj)) errors.push({ path: `${path}/${key}`, message: 'missing required property' });
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (key in obj) walk(obj[key], child, `${path}/${key}`, errors);
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(obj)) {
        if (!allowed.has(key)) errors.push({ path: `${path}/${key}`, message: 'additional property not allowed' });
      }
    } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(obj)) {
        if (!allowed.has(key)) walk(obj[key], schema.additionalProperties, `${path}/${key}`, errors);
      }
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) {
      errors.push({ path: path || '/', message: `expected at least ${schema.minItems} items` });
    }
    if (schema.maxItems != null && value.length > schema.maxItems) {
      errors.push({ path: path || '/', message: `expected at most ${schema.maxItems} items` });
    }
    if (schema.items) {
      value.forEach((item, i) => walk(item, schema.items as JsonSchema, `${path}/${i}`, errors));
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) {
      errors.push({ path: path || '/', message: `value below minimum ${schema.minimum}` });
    }
    if (schema.maximum != null && value > schema.maximum) {
      errors.push({ path: path || '/', message: `value above maximum ${schema.maximum}` });
    }
  }

  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) {
      errors.push({ path: path || '/', message: `string shorter than minLength ${schema.minLength}` });
    }
    if (schema.maxLength != null && value.length > schema.maxLength) {
      errors.push({ path: path || '/', message: `string longer than maxLength ${schema.maxLength}` });
    }
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/** System-prompt section describing the required schema, for non-native models. */
export function buildSchemaPromptSection(config: ResolvedStructuredOutputConfig): string {
  return [
    `## Output format: ${config.schemaName}`,
    '',
    'Your final reply MUST be a single JSON value that validates against this JSON Schema.',
    'Return only the JSON — no prose, no Markdown fences.',
    '',
    '```json',
    config.schema.trim(),
    '```',
  ].join('\n');
}

/** Re-prompt text handed to the model when a reply fails validation. */
export function buildRepairPrompt(
  config: ResolvedStructuredOutputConfig,
  errors: ValidationError[],
): string {
  const lines = errors.map((e) => `- ${e.path}: ${e.message}`).join('\n');
  return [
    'Your previous reply did not satisfy the required JSON Schema. Validation errors:',
    lines || '- reply was not valid JSON',
    '',
    `Return a corrected reply that validates against the "${config.schemaName}" schema. Output only the JSON value.`,
  ].join('\n');
}

export type StructuredOutputOutcome =
  | { status: 'ok'; value: unknown }
  | { status: 'invalid'; errors: ValidationError[]; reason: string };

/**
 * Validate one assistant reply against the resolved config. The runtime calls
 * this in finalize; the returned outcome drives the repair/warn/block policy.
 * A disabled config or an unparseable schema yields `ok` (no enforcement).
 */
export function evaluateReply(
  config: ResolvedStructuredOutputConfig,
  reply: string,
): StructuredOutputOutcome {
  if (!config.enabled) return { status: 'ok', value: undefined };
  const schema = parseSchema(config.schema);
  if (!schema) return { status: 'ok', value: undefined };

  const extracted = extractJson(reply);
  if ('error' in extracted) {
    return { status: 'invalid', errors: [{ path: '/', message: extracted.error }], reason: extracted.error };
  }
  const result = validateAgainstSchema(extracted.value, schema);
  if (result.valid) return { status: 'ok', value: extracted.value };
  return {
    status: 'invalid',
    errors: result.errors,
    reason: `reply failed schema validation (${result.errors.length} error${result.errors.length === 1 ? '' : 's'})`,
  };
}
