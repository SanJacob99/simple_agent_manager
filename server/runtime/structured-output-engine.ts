import type {
  ResolvedStructuredOutputConfig,
  OutputRepairPolicy,
} from '../../shared/agent-config';

/**
 * Structured-output engine.
 *
 * A structured-output node constrains an agent's final response to a JSON
 * Schema. This module validates a response against that schema and decides what
 * to do on failure (re-prompt, pass through, or error) per the resolved
 * `repairPolicy`. Wiring the enforcer into `server/agents/run-coordinator.ts`
 * (validate the final assistant message, and on failure either re-run the
 * prompt with the repair message or surface the errors) is the remaining
 * integration step; the `StructuredOutputEnforcer` API below is the stable
 * surface that wiring should target.
 *
 * The validator is intentionally dependency-free (no `ajv`) so it stays inside
 * the "runtime classes must not pull heavy deps" convention. It implements a
 * practical subset of JSON Schema (draft 2020-12 keywords) sufficient for
 * constraining LLM responses: `type`, `enum`, `const`, `properties`,
 * `required`, `additionalProperties`, `items`, object/array/string/number
 * bounds, and `pattern`. Unknown keywords are ignored rather than rejected.
 */

export type JsonSchema = Record<string, unknown>;

export interface ValidationError {
  /** JSON Pointer-ish path to the offending value, e.g. `/items/0/name`. */
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

type JsonType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';

function typeOf(value: unknown): JsonType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (t === 'boolean') return 'boolean';
  if (t === 'object') return 'object';
  return 'string';
}

/** Whether `actual` satisfies a declared schema `type` (integer ⊂ number). */
function matchesType(actual: JsonType, declared: string): boolean {
  if (declared === 'number') return actual === 'number' || actual === 'integer';
  return actual === declared;
}

/**
 * Validate `value` against `schema`. `strict` forbids properties not described
 * by the schema even when `additionalProperties` is unset (loose mode tolerates
 * a superset). Returns the full list of errors rather than failing fast so a
 * repair prompt can address every problem at once.
 */
export function validateAgainstSchema(
  value: unknown,
  schema: JsonSchema,
  strict: boolean,
): ValidationResult {
  const errors: ValidationError[] = [];
  walk(value, schema, '', strict, errors);
  return { valid: errors.length === 0, errors };
}

function walk(
  value: unknown,
  schema: JsonSchema,
  path: string,
  strict: boolean,
  errors: ValidationError[],
): void {
  if (!schema || typeof schema !== 'object') return;

  // const / enum
  if ('const' in schema && !deepEqual(value, schema.const)) {
    errors.push({ path: path || '/', message: `must equal ${JSON.stringify(schema.const)}` });
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => deepEqual(e, value))) {
    errors.push({ path: path || '/', message: `must be one of ${JSON.stringify(schema.enum)}` });
  }

  // type
  const declaredTypes = normalizeTypes(schema.type);
  const actual = typeOf(value);
  if (declaredTypes.length > 0 && !declaredTypes.some((t) => matchesType(actual, t))) {
    errors.push({
      path: path || '/',
      message: `expected type ${declaredTypes.join(' | ')}, got ${actual}`,
    });
    return; // further checks assume the right type
  }

  if (actual === 'object') {
    validateObject(value as Record<string, unknown>, schema, path, strict, errors);
  } else if (actual === 'array') {
    validateArray(value as unknown[], schema, path, strict, errors);
  } else if (actual === 'string') {
    validateString(value as string, schema, path, errors);
  } else if (actual === 'number' || actual === 'integer') {
    validateNumber(value as number, schema, path, errors);
  }
}

function validateObject(
  value: Record<string, unknown>,
  schema: JsonSchema,
  path: string,
  strict: boolean,
  errors: ValidationError[],
): void {
  const properties = (schema.properties as Record<string, JsonSchema>) ?? {};
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];

  for (const key of required) {
    if (!(key in value)) {
      errors.push({ path: `${path}/${key}`, message: 'is required' });
    }
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}/${key}`;
    if (properties[key]) {
      walk(child, properties[key], childPath, strict, errors);
    } else if (schema.additionalProperties === false || (strict && !('additionalProperties' in schema))) {
      errors.push({ path: childPath, message: 'is not an allowed property' });
    } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      walk(child, schema.additionalProperties as JsonSchema, childPath, strict, errors);
    }
  }
}

function validateArray(
  value: unknown[],
  schema: JsonSchema,
  path: string,
  strict: boolean,
  errors: ValidationError[],
): void {
  if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
    errors.push({ path: path || '/', message: `must have at least ${schema.minItems} items` });
  }
  if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
    errors.push({ path: path || '/', message: `must have at most ${schema.maxItems} items` });
  }
  const items = schema.items;
  if (items && typeof items === 'object' && !Array.isArray(items)) {
    value.forEach((el, i) => walk(el, items as JsonSchema, `${path}/${i}`, strict, errors));
  }
}

function validateString(value: string, schema: JsonSchema, path: string, errors: ValidationError[]): void {
  if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
    errors.push({ path: path || '/', message: `must be at least ${schema.minLength} chars` });
  }
  if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
    errors.push({ path: path || '/', message: `must be at most ${schema.maxLength} chars` });
  }
  if (typeof schema.pattern === 'string') {
    try {
      if (!new RegExp(schema.pattern).test(value)) {
        errors.push({ path: path || '/', message: `must match /${schema.pattern}/` });
      }
    } catch {
      // An invalid pattern in the schema is not the response's fault — skip it.
    }
  }
}

function validateNumber(value: number, schema: JsonSchema, path: string, errors: ValidationError[]): void {
  if (typeof schema.minimum === 'number' && value < schema.minimum) {
    errors.push({ path: path || '/', message: `must be >= ${schema.minimum}` });
  }
  if (typeof schema.maximum === 'number' && value > schema.maximum) {
    errors.push({ path: path || '/', message: `must be <= ${schema.maximum}` });
  }
}

function normalizeTypes(type: unknown): string[] {
  if (typeof type === 'string') return [type];
  if (Array.isArray(type)) return type.filter((t): t is string => typeof t === 'string');
  return [];
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((el, i) => deepEqual(el, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    return (
      ak.length === bk.length &&
      ak.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
    );
  }
  return false;
}

/**
 * Pull a JSON value out of a model's final response. Handles three common
 * shapes: a bare JSON document, a ```json fenced block, and JSON embedded in
 * surrounding prose (first balanced `{...}` / `[...]`). Returns `undefined`
 * when nothing parseable is found.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();

  const direct = tryParse(trimmed);
  if (direct !== undefined) return direct;

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    const parsed = tryParse(fence[1].trim());
    if (parsed !== undefined) return parsed;
  }

  const span = firstBalancedSpan(trimmed);
  if (span !== null) {
    const parsed = tryParse(span);
    if (parsed !== undefined) return parsed;
  }

  return undefined;
}

function tryParse(s: string): unknown {
  if (!s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/** Find the first balanced `{...}` or `[...]` region, ignoring braces in strings. */
function firstBalancedSpan(text: string): string | null {
  const start = text.search(/[[{]/);
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

export interface EnforcementResult {
  /** True when the response satisfied the schema (or enforcement was inactive). */
  ok: boolean;
  /** The parsed, schema-conformant value when `ok`; otherwise the best-effort parse or undefined. */
  value: unknown;
  errors: ValidationError[];
  /** What the caller should do next, derived from the node's repair policy. */
  action: 'accept' | 'repair' | 'error' | 'passthrough';
  /** When `action === 'repair'`, a message to feed back to the model. */
  repairPrompt?: string;
}

/**
 * Enforces one resolved structured-output config against a run's final
 * response. Created via `createEnforcer`. The enforcer is a no-op (`active ===
 * false`) when the node is disabled or its schema did not parse, so callers can
 * enforce unconditionally.
 */
export class StructuredOutputEnforcer {
  readonly active: boolean;
  private readonly config: ResolvedStructuredOutputConfig;
  private attempts = 0;

  constructor(config: ResolvedStructuredOutputConfig) {
    this.config = config;
    this.active = config.enabled && config.schemaValid && config.schema !== null;
  }

  /** Repair attempts already consumed for this run. */
  get repairAttempts(): number {
    return this.attempts;
  }

  /** Whether another repair round is permitted under the configured policy. */
  get canRepair(): boolean {
    return this.config.repairPolicy === 'repair' && this.attempts < this.config.maxRepairAttempts;
  }

  /**
   * Validate a model response. When it fails, the returned `action` reflects the
   * policy: `repair` (with a `repairPrompt`) while attempts remain, otherwise
   * the terminal policy (`error` or `passthrough`). Calling `enforce` with
   * `action === 'repair'` consumes one repair attempt.
   */
  enforce(responseText: string): EnforcementResult {
    if (!this.active) {
      return { ok: true, value: undefined, errors: [], action: 'accept' };
    }

    const parsed = extractJson(responseText);
    if (parsed === undefined) {
      return this.fail(responseText, [
        { path: '/', message: 'response did not contain parseable JSON' },
      ]);
    }

    const result = validateAgainstSchema(parsed, this.config.schema as JsonSchema, this.config.strict);
    if (result.valid) {
      return { ok: true, value: parsed, errors: [], action: 'accept' };
    }
    return this.fail(parsed, result.errors);
  }

  private fail(value: unknown, errors: ValidationError[]): EnforcementResult {
    if (this.canRepair) {
      this.attempts++;
      return {
        ok: false,
        value,
        errors,
        action: 'repair',
        repairPrompt: this.buildRepairPrompt(errors),
      };
    }
    const terminal: OutputRepairPolicy =
      this.config.repairPolicy === 'error' ? 'error' : 'passthrough';
    return {
      ok: false,
      value,
      errors,
      action: terminal === 'error' ? 'error' : 'passthrough',
    };
  }

  /** A concise re-prompt enumerating the validation errors for the model to fix. */
  buildRepairPrompt(errors: ValidationError[]): string {
    const list = errors.map((e) => `- ${e.path}: ${e.message}`).join('\n');
    const schemaBlock = this.config.schemaText.trim();
    return [
      `Your previous response did not satisfy the required \`${this.config.schemaName}\` JSON schema.`,
      '',
      'Validation errors:',
      list,
      '',
      'Reply with ONLY a JSON document that satisfies this schema (no prose, no code fences):',
      schemaBlock,
    ].join('\n');
  }
}

export function createEnforcer(config: ResolvedStructuredOutputConfig): StructuredOutputEnforcer {
  return new StructuredOutputEnforcer(config);
}

/**
 * System-prompt fragment for a structured-output config, when
 * `includeSchemaInPrompt` is set. Returns `''` when injection is disabled or the
 * schema is unusable, so callers can concatenate unconditionally.
 */
export function structuredOutputPromptFragment(config: ResolvedStructuredOutputConfig): string {
  if (!config.enabled || !config.schemaValid || !config.includeSchemaInPrompt) return '';
  return [
    `## Output format: ${config.schemaName}`,
    '',
    'Your final response MUST be a single JSON document conforming to this schema:',
    '',
    '```json',
    config.schemaText.trim(),
    '```',
  ].join('\n');
}
