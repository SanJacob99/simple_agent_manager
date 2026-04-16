/**
 * Scrub/normalize tool schemas for Gemini's restricted JSON Schema subset.
 * Gemini rejects anyOf, oneOf, allOf, format, pattern, $ref, and many
 * other standard JSON Schema keywords. This module strips or simplifies
 * them so tool declarations are accepted.
 *
 * Ported from openclaw's src/agents/schema/clean-for-gemini.ts.
 */

const UNSUPPORTED_KEYWORDS = new Set([
  'patternProperties',
  'additionalProperties',
  '$schema',
  '$id',
  '$ref',
  '$defs',
  'definitions',
  'examples',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'multipleOf',
  'pattern',
  'format',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
  'not',
]);

const META_KEYS = ['description', 'title', 'default'] as const;

function copyMeta(from: Record<string, unknown>, to: Record<string, unknown>): void {
  for (const key of META_KEYS) {
    if (key in from && from[key] !== undefined) {
      to[key] = from[key];
    }
  }
}

// ---------------------------------------------------------------------------
// anyOf/oneOf simplification
// ---------------------------------------------------------------------------

function isNullSchema(v: unknown): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  if ('const' in r && r.const === null) return true;
  if (Array.isArray(r.enum) && r.enum.length === 1 && r.enum[0] === null) return true;
  if (r.type === 'null') return true;
  if (Array.isArray(r.type) && r.type.length === 1 && r.type[0] === 'null') return true;
  return false;
}

function tryFlattenLiteralUnion(variants: unknown[]): { type: string; enum: unknown[] } | null {
  if (variants.length === 0) return null;
  const values: unknown[] = [];
  let commonType: string | null = null;

  for (const v of variants) {
    if (!v || typeof v !== 'object') return null;
    const r = v as Record<string, unknown>;
    let literal: unknown;
    if ('const' in r) literal = r.const;
    else if (Array.isArray(r.enum) && r.enum.length === 1) literal = r.enum[0];
    else return null;

    const t = typeof r.type === 'string' ? r.type : null;
    if (!t) return null;
    if (commonType === null) commonType = t;
    else if (commonType !== t) return null;
    values.push(literal);
  }

  return commonType && values.length > 0 ? { type: commonType, enum: values } : null;
}

function simplifyUnion(
  obj: Record<string, unknown>,
  variants: unknown[],
): { variants: unknown[]; simplified?: unknown } {
  const nonNull = variants.filter((v) => !isNullSchema(v));
  const stripped = nonNull.length !== variants.length;

  const flattened = tryFlattenLiteralUnion(nonNull);
  if (flattened) {
    const result: Record<string, unknown> = { type: flattened.type, enum: flattened.enum };
    copyMeta(obj, result);
    return { variants: nonNull, simplified: result };
  }

  if (stripped && nonNull.length === 1) {
    const lone = nonNull[0];
    if (lone && typeof lone === 'object' && !Array.isArray(lone)) {
      const result: Record<string, unknown> = { ...(lone as Record<string, unknown>) };
      copyMeta(obj, result);
      return { variants: nonNull, simplified: result };
    }
    return { variants: nonNull, simplified: lone };
  }

  return { variants: stripped ? nonNull : variants };
}

/**
 * Last-resort: pick a representative type so the schema is accepted.
 */
function flattenUnionFallback(
  obj: Record<string, unknown>,
  variants: unknown[],
): Record<string, unknown> | undefined {
  const objects = variants.filter(
    (v): v is Record<string, unknown> => !!v && typeof v === 'object',
  );
  if (objects.length === 0) return undefined;

  const types = new Set(objects.map((v) => v.type).filter(Boolean));
  if (objects.length === 1) {
    const merged: Record<string, unknown> = { ...objects[0] };
    copyMeta(obj, merged);
    return merged;
  }
  if (types.size === 1) {
    const merged: Record<string, unknown> = { type: Array.from(types)[0] };
    copyMeta(obj, merged);
    return merged;
  }
  const first = objects[0];
  if (first?.type) {
    const merged: Record<string, unknown> = { type: first.type };
    copyMeta(obj, merged);
    return merged;
  }
  const merged: Record<string, unknown> = {};
  copyMeta(obj, merged);
  return merged;
}

// ---------------------------------------------------------------------------
// $ref resolution
// ---------------------------------------------------------------------------

type SchemaDefs = Map<string, unknown>;

function collectDefs(
  defs: SchemaDefs | undefined,
  schema: Record<string, unknown>,
): SchemaDefs | undefined {
  const sources = [schema.$defs, schema.definitions].filter(
    (d): d is Record<string, unknown> => !!d && typeof d === 'object' && !Array.isArray(d),
  );
  if (sources.length === 0) return defs;

  const next = defs ? new Map(defs) : new Map<string, unknown>();
  for (const src of sources) {
    for (const [k, v] of Object.entries(src)) next.set(k, v);
  }
  return next;
}

function resolveRef(ref: string, defs: SchemaDefs | undefined): unknown {
  if (!defs) return undefined;
  const m = ref.match(/^#\/(?:\$defs|definitions)\/(.+)$/);
  if (!m) return undefined;
  const name = (m[1] ?? '').replaceAll('~1', '/').replaceAll('~0', '~');
  return name ? defs.get(name) : undefined;
}

// ---------------------------------------------------------------------------
// required field sanitization
// ---------------------------------------------------------------------------

function sanitizeRequired(schema: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(schema.required)) return schema;
  if (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) {
    if (schema.type === 'object') delete schema.required;
    return schema;
  }
  const props = schema.properties as Record<string, unknown>;
  const required = schema.required.filter(
    (k): k is string => typeof k === 'string' && Object.hasOwn(props, k),
  );
  if (required.length > 0) schema.required = required;
  else delete schema.required;
  return schema;
}

// ---------------------------------------------------------------------------
// Recursive cleaner
// ---------------------------------------------------------------------------

function cleanRecursive(
  schema: unknown,
  defs: SchemaDefs | undefined,
  refStack: Set<string> | undefined,
): unknown {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map((item) => cleanRecursive(item, defs, refStack));

  const obj = schema as Record<string, unknown>;
  const nextDefs = collectDefs(defs, obj);

  // Resolve $ref
  const ref = typeof obj.$ref === 'string' ? obj.$ref : undefined;
  if (ref) {
    if (refStack?.has(ref)) return {};
    const resolved = resolveRef(ref, nextDefs);
    if (resolved) {
      const nextRefStack = refStack ? new Set(refStack) : new Set<string>();
      nextRefStack.add(ref);
      const cleaned = cleanRecursive(resolved, nextDefs, nextRefStack);
      if (!cleaned || typeof cleaned !== 'object' || Array.isArray(cleaned)) return cleaned;
      const result: Record<string, unknown> = { ...(cleaned as Record<string, unknown>) };
      copyMeta(obj, result);
      return result;
    }
    const result: Record<string, unknown> = {};
    copyMeta(obj, result);
    return result;
  }

  // Simplify anyOf/oneOf before iterating
  const hasAnyOf = 'anyOf' in obj && Array.isArray(obj.anyOf);
  const hasOneOf = 'oneOf' in obj && Array.isArray(obj.oneOf);

  let cleanedAnyOf = hasAnyOf
    ? (obj.anyOf as unknown[]).map((v) => cleanRecursive(v, nextDefs, refStack))
    : undefined;
  let cleanedOneOf = hasOneOf
    ? (obj.oneOf as unknown[]).map((v) => cleanRecursive(v, nextDefs, refStack))
    : undefined;

  if (hasAnyOf) {
    const s = simplifyUnion(obj, cleanedAnyOf!);
    cleanedAnyOf = s.variants;
    if ('simplified' in s) return s.simplified;
  }
  if (hasOneOf) {
    const s = simplifyUnion(obj, cleanedOneOf!);
    cleanedOneOf = s.variants;
    if ('simplified' in s) return s.simplified;
  }

  const cleaned: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) continue;

    if (key === 'const') { cleaned.enum = [value]; continue; }
    if (key === 'required' && Array.isArray(value) && value.length === 0) continue;
    if (key === 'type' && (hasAnyOf || hasOneOf)) continue;

    if (key === 'type' && Array.isArray(value) && value.every((e) => typeof e === 'string')) {
      const types = value.filter((e) => e !== 'null');
      cleaned.type = types.length === 1 ? types[0] : types;
      continue;
    }

    if (key === 'properties') {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const props = value as Record<string, unknown>;
        cleaned[key] = Object.fromEntries(
          Object.entries(props).map(([k, v]) => [k, cleanRecursive(v, nextDefs, refStack)]),
        );
      } else {
        cleaned[key] = {};
      }
    } else if (key === 'items' && value) {
      cleaned[key] = Array.isArray(value)
        ? value.map((e) => cleanRecursive(e, nextDefs, refStack))
        : typeof value === 'object'
          ? cleanRecursive(value, nextDefs, refStack)
          : value;
    } else if (key === 'anyOf' && Array.isArray(value)) {
      cleaned[key] = cleanedAnyOf ?? value.map((v) => cleanRecursive(v, nextDefs, refStack));
    } else if (key === 'oneOf' && Array.isArray(value)) {
      cleaned[key] = cleanedOneOf ?? value.map((v) => cleanRecursive(v, nextDefs, refStack));
    } else if (key === 'allOf' && Array.isArray(value)) {
      cleaned[key] = value.map((v) => cleanRecursive(v, nextDefs, refStack));
    } else {
      cleaned[key] = value;
    }
  }

  // Final fallback: flatten remaining anyOf/oneOf that couldn't be simplified
  if (cleaned.anyOf && Array.isArray(cleaned.anyOf)) {
    const f = flattenUnionFallback(cleaned, cleaned.anyOf);
    if (f) return sanitizeRequired(f);
  }
  if (cleaned.oneOf && Array.isArray(cleaned.oneOf)) {
    const f = flattenUnionFallback(cleaned, cleaned.oneOf);
    if (f) return sanitizeRequired(f);
  }

  return sanitizeRequired(cleaned);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Clean a tool parameter schema for Gemini compatibility.
 * Strips unsupported JSON Schema keywords, resolves $ref, simplifies
 * anyOf/oneOf unions, sanitizes required fields, and flattens remaining
 * unions as a last resort.
 */
export function cleanSchemaForGemini(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(cleanSchemaForGemini);
  const defs = collectDefs(undefined, schema as Record<string, unknown>);
  return cleanRecursive(schema, defs, undefined);
}
