import type { ResolvedStructuredOutputConfig } from '../../shared/agent-config';

/**
 * Structured-output engine.
 *
 * A structured-output node attached to an agent constrains its final response to
 * a JSON Schema. This module owns the three runtime concerns of that contract:
 *
 *  1. Parsing the raw schema text into a usable schema (`parseSchema`).
 *  2. Extracting candidate JSON from a model response and validating it against
 *     the schema (`validateOutput`).
 *  3. Producing the prompt fragments that drive the model toward the schema —
 *     a system-prompt instruction (`buildSchemaInstruction`) and a repair
 *     message when validation fails (`buildRepairPrompt`).
 *
 * It is intentionally dependency-free: no `ajv` / `@sinclair/typebox` runtime
 * dependency, keeping it inside the "runtime classes must not pull heavy/React
 * deps" convention. The validator implements the draft-07 subset that the node
 * editor exposes (type, required, properties, additionalProperties, items,
 * enum, const, min/max, length, pattern). Unknown keywords are ignored rather
 * than rejected, so a schema that uses an unsupported keyword still validates on
 * the keywords this engine understands.
 *
 * Wiring the validator into the run-coordinator's finalize step (validate the
 * assistant's final message, then apply `onValidationError`) is the remaining
 * integration step; the surface below is the stable target for that wiring.
 */

// --- Schema types (subset) ---

export type JsonSchemaType =
  | 'object'
  | 'array'
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'null';

export interface JsonSchema {
  type?: JsonSchemaType | JsonSchemaType[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  description?: string;
  [keyword: string]: unknown;
}

export interface SchemaParseResult {
  schema: JsonSchema | null;
  error: string | null;
}

export interface ValidationError {
  /** JSON Pointer-ish path to the offending value, e.g. `/items/0/name`. */
  path: string;
  message: string;
}

export interface ValidationResult {
  /** True when a JSON value was extracted and satisfied the schema. */
  valid: boolean;
  /** The parsed JSON value, when extraction succeeded (even if invalid). */
  value: unknown;
  errors: ValidationError[];
  /** True when no JSON object/array could be extracted from the response text. */
  noJsonFound: boolean;
}

// --- Schema parsing ---

/**
 * Parse the node's raw `schema` text into a `JsonSchema`. Returns a structured
 * error rather than throwing so callers (and the UI) can surface invalid schemas
 * without crashing a run.
 */
export function parseSchema(config: ResolvedStructuredOutputConfig): SchemaParseResult {
  const text = config.schema?.trim();
  if (!text) {
    return { schema: null, error: 'Schema is empty.' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { schema: null, error: `Schema is not valid JSON: ${(err as Error).message}` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { schema: null, error: 'Schema must be a JSON object.' };
  }
  return { schema: parsed as JsonSchema, error: null };
}

// --- Response JSON extraction ---

/**
 * Pull a JSON value out of a model response. Handles three common shapes:
 *  1. The whole response is JSON.
 *  2. The JSON sits inside a ```json fenced code block.
 *  3. The JSON is embedded in prose — the first balanced `{...}` or `[...]`.
 */
export function extractJson(text: string): { value: unknown; found: boolean } {
  const trimmed = text.trim();

  // 1. Whole-string JSON.
  const whole = tryParse(trimmed);
  if (whole.found) return whole;

  // 2. Fenced code block (```json ... ``` or ``` ... ```).
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) {
    const fenced = tryParse(fence[1].trim());
    if (fenced.found) return fenced;
  }

  // 3. First balanced object/array embedded in prose.
  const balanced = extractBalanced(text);
  if (balanced !== null) {
    const embedded = tryParse(balanced);
    if (embedded.found) return embedded;
  }

  return { value: undefined, found: false };
}

function tryParse(text: string): { value: unknown; found: boolean } {
  if (!text) return { value: undefined, found: false };
  try {
    return { value: JSON.parse(text), found: true };
  } catch {
    return { value: undefined, found: false };
  }
}

/** Scan for the first balanced `{...}` or `[...]`, respecting strings/escapes. */
function extractBalanced(text: string): string | null {
  const start = firstOf(text, ['{', '[']);
  if (start === -1) return null;
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function firstOf(text: string, chars: string[]): number {
  let best = -1;
  for (const c of chars) {
    const idx = text.indexOf(c);
    if (idx !== -1 && (best === -1 || idx < best)) best = idx;
  }
  return best;
}

// --- Validation ---

/**
 * Validate a model response against the node's schema. Extracts JSON from the
 * response text, then walks the schema collecting every violation. In `loose`
 * mode, `additionalProperties` is not enforced even when the schema sets it to
 * `false`.
 */
export function validateOutput(
  config: ResolvedStructuredOutputConfig,
  responseText: string,
): ValidationResult {
  const { schema, error } = parseSchema(config);
  if (!schema) {
    return {
      valid: false,
      value: undefined,
      errors: [{ path: '', message: error ?? 'Invalid schema.' }],
      noJsonFound: false,
    };
  }

  const { value, found } = extractJson(responseText);
  if (!found) {
    return {
      valid: false,
      value: undefined,
      errors: [{ path: '', message: 'No JSON value could be parsed from the response.' }],
      noJsonFound: true,
    };
  }

  const errors: ValidationError[] = [];
  validateValue(value, schema, '', config.mode, errors);
  return { valid: errors.length === 0, value, errors, noJsonFound: false };
}

function validateValue(
  value: unknown,
  schema: JsonSchema,
  path: string,
  mode: 'strict' | 'loose',
  errors: ValidationError[],
): void {
  // const
  if ('const' in schema && !deepEqual(value, schema.const)) {
    errors.push({ path, message: `must equal ${JSON.stringify(schema.const)}` });
  }

  // enum
  if (schema.enum && !schema.enum.some((e) => deepEqual(e, value))) {
    errors.push({ path, message: `must be one of ${JSON.stringify(schema.enum)}` });
  }

  // type
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      errors.push({ path, message: `must be of type ${types.join(' | ')}, got ${typeName(value)}` });
      // Type mismatch makes deeper checks meaningless; stop here.
      return;
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({ path, message: `must be >= ${schema.minimum}` });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push({ path, message: `must be <= ${schema.maximum}` });
    }
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push({ path, message: `must have length >= ${schema.minLength}` });
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push({ path, message: `must have length <= ${schema.maxLength}` });
    }
    if (schema.pattern !== undefined && !safeRegexTest(schema.pattern, value)) {
      errors.push({ path, message: `must match pattern /${schema.pattern}/` });
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push({ path, message: `must have >= ${schema.minItems} items` });
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push({ path, message: `must have <= ${schema.maxItems} items` });
    }
    if (schema.items) {
      value.forEach((item, i) => {
        validateValue(item, schema.items as JsonSchema, `${path}/${i}`, mode, errors);
      });
    }
  }

  if (isPlainObject(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) {
        errors.push({ path: `${path}/${key}`, message: 'is required but missing' });
      }
    }
    const props = schema.properties ?? {};
    for (const [key, sub] of Object.entries(props)) {
      if (key in value) {
        validateValue(value[key], sub, `${path}/${key}`, mode, errors);
      }
    }
    if (mode === 'strict' && schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in props)) {
          errors.push({ path: `${path}/${key}`, message: 'is not an allowed property' });
        }
      }
    } else if (isPlainObject(schema.additionalProperties)) {
      for (const key of Object.keys(value)) {
        if (!(key in props)) {
          validateValue(
            value[key],
            schema.additionalProperties as JsonSchema,
            `${path}/${key}`,
            mode,
            errors,
          );
        }
      }
    }
  }
}

function matchesType(value: unknown, type: JsonSchemaType): boolean {
  switch (type) {
    case 'object':
      return isPlainObject(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && !Number.isNaN(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return false;
  }
}

function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    return ak.length === bk.length && ak.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

function safeRegexTest(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    // An invalid pattern can't fail the value; treat as a pass.
    return true;
  }
}

// --- Prompt fragments ---

/**
 * The instruction appended to the system prompt when `includeSchemaInPrompt` is
 * set. Returns null when the node is disabled, the flag is off, or the schema is
 * unparseable (a broken schema should not corrupt the system prompt).
 */
export function buildSchemaInstruction(
  config: ResolvedStructuredOutputConfig,
): string | null {
  if (!config.enabled || !config.includeSchemaInPrompt) return null;
  const { schema } = parseSchema(config);
  if (!schema) return null;
  const name = config.schemaName || 'response';
  const strictness =
    config.mode === 'strict'
      ? 'Include every required field and do not add properties beyond those defined in the schema.'
      : 'Include the required fields; additional properties are permitted.';
  return [
    `## Structured output: ${name}`,
    '',
    'Your final response MUST be a single JSON value that conforms to this JSON Schema.',
    `${strictness} Respond with JSON only — no prose, no code fences.`,
    '',
    '```json',
    JSON.stringify(schema, null, 2),
    '```',
  ].join('\n');
}

/**
 * The message fed back to the model when its response failed validation and the
 * policy is `reprompt`. Lists the violations so the model can correct them.
 */
export function buildRepairPrompt(
  config: ResolvedStructuredOutputConfig,
  result: ValidationResult,
): string {
  const name = config.schemaName || 'response';
  const lines = [
    `Your previous response did not satisfy the \`${name}\` schema.`,
    '',
    'Problems:',
  ];
  if (result.noJsonFound) {
    lines.push('- No JSON value could be parsed from your response.');
  } else {
    for (const e of result.errors) {
      const where = e.path ? `\`${e.path}\`` : '(root)';
      lines.push(`- ${where}: ${e.message}`);
    }
  }
  lines.push('', 'Respond again with corrected JSON only — no prose, no code fences.');
  return lines.join('\n');
}
