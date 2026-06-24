import type { ResolvedStructuredOutputConfig } from '../../shared/agent-config';

/**
 * Structured-output engine.
 *
 * A structured-output node attached to an agent constrains its final response to
 * a JSON Schema and validates (and optionally repairs) the model's output. This
 * brings the builder in line with provider structured-output features
 * (Anthropic/OpenAI constrained decoding, tool-call-as-schema) without taking a
 * dependency on a heavyweight JSON Schema library — runtime classes must stay
 * free of heavy/React deps per the project conventions.
 *
 * The validator implements the common draft 2020-12 subset that agents actually
 * use to shape outputs: `type`, `properties`, `required`, `items`, `enum`,
 * `const`, numeric bounds (`minimum`/`maximum`/`exclusive*`), length bounds
 * (`minLength`/`maxLength`, `minItems`/`maxItems`), `additionalProperties`, and
 * the `anyOf`/`allOf`/`oneOf` combinators. Unknown keywords are ignored rather
 * than erroring, so a richer schema still validates on the keywords we support.
 *
 * Wiring the enforcer into `server/agents/run-coordinator.ts` (apply the
 * strategy to the model request, then evaluate the final response and re-prompt
 * with `buildRepairPrompt` when `repair === 'reprompt'`) is the remaining
 * integration step; the API below is the stable surface that wiring targets.
 */

export type JsonSchema = Record<string, unknown>;

export interface ValidationError {
  /** JSON-pointer-ish path to the offending value, e.g. `/items/0/name`. */
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ParseResult {
  schema?: JsonSchema;
  error?: string;
}

/** Parse the raw schema text into an object schema, reporting JSON errors. */
export function parseSchema(text: string): ParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { error: 'Schema is empty.' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    return { error: `Invalid JSON: ${(e as Error).message}` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { error: 'Top-level schema must be a JSON object.' };
  }
  return { schema: parsed as JsonSchema };
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value as number)) return 'integer';
  return typeof value;
}

/** True if `value` satisfies a JSON Schema `type` token (integer ⊂ number). */
function matchesType(value: unknown, type: string): boolean {
  const actual = typeOf(value);
  if (type === 'number') return actual === 'number' || actual === 'integer';
  return actual === type;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (a && b && typeof a === 'object') {
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    if (ak.length !== bk.length) return false;
    return ak.every((k) =>
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}

/**
 * Validate `value` against `schema`, accumulating every error rather than
 * stopping at the first. Returns `{ valid, errors }`.
 */
export function validateAgainstSchema(value: unknown, schema: JsonSchema): ValidationResult {
  const errors: ValidationError[] = [];
  walk(value, schema, '', errors);
  return { valid: errors.length === 0, errors };
}

function walk(value: unknown, schema: JsonSchema, path: string, errors: ValidationError[]): void {
  // Combinators
  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf as JsonSchema[]) walk(value, sub, path, errors);
  }
  if (Array.isArray(schema.anyOf)) {
    const branches = schema.anyOf as JsonSchema[];
    const anyValid = branches.some((sub) => validateAgainstSchema(value, sub).valid);
    if (!anyValid) errors.push({ path: path || '/', message: 'does not match any of anyOf schemas' });
  }
  if (Array.isArray(schema.oneOf)) {
    const branches = schema.oneOf as JsonSchema[];
    const matches = branches.filter((sub) => validateAgainstSchema(value, sub).valid).length;
    if (matches !== 1) {
      errors.push({ path: path || '/', message: `must match exactly one of oneOf schemas (matched ${matches})` });
    }
  }

  // const / enum
  if ('const' in schema && !deepEqual(value, schema.const)) {
    errors.push({ path: path || '/', message: `must equal ${JSON.stringify(schema.const)}` });
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((opt) => deepEqual(value, opt))) {
    errors.push({ path: path || '/', message: `must be one of ${JSON.stringify(schema.enum)}` });
  }

  // type
  const type = schema.type;
  if (typeof type === 'string' && !matchesType(value, type)) {
    errors.push({ path: path || '/', message: `expected ${type}, got ${typeOf(value)}` });
    return; // further keyword checks assume the type matched
  }
  if (Array.isArray(type) && !(type as string[]).some((t) => matchesType(value, t))) {
    errors.push({ path: path || '/', message: `expected one of ${type.join('|')}, got ${typeOf(value)}` });
    return;
  }

  const kind = typeOf(value);

  if (kind === 'string') {
    const s = value as string;
    if (typeof schema.minLength === 'number' && s.length < schema.minLength) {
      errors.push({ path: path || '/', message: `string shorter than minLength ${schema.minLength}` });
    }
    if (typeof schema.maxLength === 'number' && s.length > schema.maxLength) {
      errors.push({ path: path || '/', message: `string longer than maxLength ${schema.maxLength}` });
    }
    if (typeof schema.pattern === 'string') {
      try {
        if (!new RegExp(schema.pattern).test(s)) {
          errors.push({ path: path || '/', message: `string does not match pattern ${schema.pattern}` });
        }
      } catch {
        // An invalid pattern in the schema is ignored rather than failing the value.
      }
    }
  }

  if (kind === 'number' || kind === 'integer') {
    const n = value as number;
    if (typeof schema.minimum === 'number' && n < schema.minimum) {
      errors.push({ path: path || '/', message: `number below minimum ${schema.minimum}` });
    }
    if (typeof schema.maximum === 'number' && n > schema.maximum) {
      errors.push({ path: path || '/', message: `number above maximum ${schema.maximum}` });
    }
    if (typeof schema.exclusiveMinimum === 'number' && n <= schema.exclusiveMinimum) {
      errors.push({ path: path || '/', message: `number not above exclusiveMinimum ${schema.exclusiveMinimum}` });
    }
    if (typeof schema.exclusiveMaximum === 'number' && n >= schema.exclusiveMaximum) {
      errors.push({ path: path || '/', message: `number not below exclusiveMaximum ${schema.exclusiveMaximum}` });
    }
  }

  if (kind === 'array') {
    const arr = value as unknown[];
    if (typeof schema.minItems === 'number' && arr.length < schema.minItems) {
      errors.push({ path: path || '/', message: `array shorter than minItems ${schema.minItems}` });
    }
    if (typeof schema.maxItems === 'number' && arr.length > schema.maxItems) {
      errors.push({ path: path || '/', message: `array longer than maxItems ${schema.maxItems}` });
    }
    if (schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)) {
      arr.forEach((item, i) => walk(item, schema.items as JsonSchema, `${path}/${i}`, errors));
    }
  }

  if (kind === 'object') {
    const obj = value as Record<string, unknown>;
    const props = (schema.properties as Record<string, JsonSchema>) ?? {};
    if (Array.isArray(schema.required)) {
      for (const key of schema.required as string[]) {
        if (!(key in obj)) errors.push({ path: `${path}/${key}`, message: `missing required property "${key}"` });
      }
    }
    for (const [key, sub] of Object.entries(props)) {
      if (key in obj) walk(obj[key], sub, `${path}/${key}`, errors);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in props)) errors.push({ path: `${path}/${key}`, message: `unexpected additional property "${key}"` });
      }
    } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      const extra = schema.additionalProperties as JsonSchema;
      for (const key of Object.keys(obj)) {
        if (!(key in props)) walk(obj[key], extra, `${path}/${key}`, errors);
      }
    }
  }
}

/**
 * Pull the first JSON value out of a model response. Handles bare JSON,
 * ```json fenced blocks, and prose-wrapped JSON by scanning for the first
 * balanced object/array. Returns the parsed value or an error string.
 */
export function extractJson(text: string): { value?: unknown; error?: string } {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates: string[] = [];
  if (fence) candidates.push(fence[1].trim());
  candidates.push(text.trim());

  for (const candidate of candidates) {
    const direct = tryParse(candidate);
    if (direct !== undefined) return { value: direct };
    const sliced = sliceBalanced(candidate);
    if (sliced !== undefined) {
      const parsed = tryParse(sliced);
      if (parsed !== undefined) return { value: parsed };
    }
  }
  return { error: 'No parseable JSON found in response.' };
}

function tryParse(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Return the substring spanning the first balanced {...} or [...]. */
function sliceBalanced(text: string): string | undefined {
  const start = text.search(/[{[]/);
  if (start === -1) return undefined;
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
  return undefined;
}

/** Build a corrective re-prompt naming the validation errors. */
export function buildRepairPrompt(schemaName: string, errors: ValidationError[], schemaText: string): string {
  const lines = errors.map((e) => `- ${e.path || '/'}: ${e.message}`).join('\n');
  return [
    `Your previous response did not satisfy the required "${schemaName}" JSON schema.`,
    '',
    'Validation errors:',
    lines,
    '',
    'Required schema:',
    '```json',
    schemaText.trim(),
    '```',
    '',
    'Respond again with ONLY a single JSON value that satisfies the schema. No prose, no code fences.',
  ].join('\n');
}

export interface EnforcementDecision {
  /** Whether the run may finalize with this output. */
  ok: boolean;
  /** Parsed value when extraction succeeded (even if invalid). */
  value?: unknown;
  errors: ValidationError[];
  /** True when the caller should re-prompt the model with `repairPrompt`. */
  shouldRepair: boolean;
  repairPrompt?: string;
  /** True once repair attempts are exhausted. */
  exhausted: boolean;
}

/**
 * Stateful enforcer for one run. `evaluate(text)` is called with each candidate
 * final response; it tracks repair attempts internally so the caller just loops
 * while `decision.shouldRepair` is true. A no-op (`active === false`) enforcer
 * is returned when the config is disabled, so callers can instrument
 * unconditionally.
 */
export class StructuredOutputEnforcer {
  readonly active: boolean;
  private readonly config: ResolvedStructuredOutputConfig;
  private readonly parsed: ParseResult;
  private attempts = 0;

  constructor(config: ResolvedStructuredOutputConfig) {
    this.config = config;
    this.active = config.enabled;
    this.parsed = config.enabled ? parseSchema(config.schema) : {};
  }

  /** Surface a schema parse error so the caller can refuse to start the run. */
  get schemaError(): string | undefined {
    return this.parsed.error;
  }

  evaluate(text: string): EnforcementDecision {
    if (!this.active) return { ok: true, errors: [], shouldRepair: false, exhausted: false };
    if (this.parsed.error || !this.parsed.schema) {
      // Unparseable schema: nothing to validate against. Strict refuses; loose passes.
      return {
        ok: !this.config.strict,
        errors: [{ path: '/', message: this.parsed.error ?? 'schema unavailable' }],
        shouldRepair: false,
        exhausted: true,
      };
    }

    const extracted = extractJson(text);
    const errors: ValidationError[] = [];
    if (extracted.error) {
      errors.push({ path: '/', message: extracted.error });
    } else {
      errors.push(...validateAgainstSchema(extracted.value, this.parsed.schema).errors);
    }

    if (errors.length === 0) {
      return { ok: true, value: extracted.value, errors: [], shouldRepair: false, exhausted: false };
    }

    // Loose mode: validation is advisory, never blocks finalization.
    if (!this.config.strict) {
      return { ok: true, value: extracted.value, errors, shouldRepair: false, exhausted: true };
    }

    const canRepair =
      this.config.repair === 'reprompt' && this.attempts < this.config.maxRepairAttempts;
    if (canRepair) {
      this.attempts++;
      return {
        ok: false,
        value: extracted.value,
        errors,
        shouldRepair: true,
        repairPrompt: buildRepairPrompt(this.config.schemaName, errors, this.config.schema),
        exhausted: false,
      };
    }

    // Repair exhausted (or disabled). onFailure decides the terminal outcome.
    return {
      ok: this.config.onFailure === 'passthrough',
      value: extracted.value,
      errors,
      shouldRepair: false,
      exhausted: true,
    };
  }
}

export function createEnforcer(config: ResolvedStructuredOutputConfig): StructuredOutputEnforcer {
  return new StructuredOutputEnforcer(config);
}
