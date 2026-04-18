/**
 * Lightweight JSON-Schema-shaped field descriptors used by SchemaForm.
 *
 * Intentionally narrower than full JSON Schema — only the subset we actually
 * render. Schemas are authored as plain objects and kept client-side for
 * now; the same shape is forwards-compatible with TypeBox (whose
 * `Type.Object(...)` output structurally matches these objects at the JSON
 * Schema level), so tool modules can later become the single source of
 * truth without reshaping these types.
 */

export interface StringFieldSchema {
  type: 'string';
  title: string;
  description?: string;
  placeholder?: string;
  /** `'password'` hides the value; `'textarea'` renders a multi-line box. */
  format?: 'password' | 'textarea';
  /** Rows for `format: 'textarea'`. Default 4. */
  textareaRows?: number;
  /** When present, renders a `<select>` instead of an `<input>`. */
  enum?: Array<{ value: string; label: string }>;
}

export interface IntegerFieldSchema {
  type: 'integer';
  title: string;
  description?: string;
  placeholder?: string;
  minimum?: number;
  maximum?: number;
}

export interface BooleanFieldSchema {
  type: 'boolean';
  title: string;
  description?: string;
  /** Inline label rendered next to the checkbox. */
  checkboxLabel: string;
}

export type FieldSchema = StringFieldSchema | IntegerFieldSchema | BooleanFieldSchema;

/**
 * Per-field overrides a caller can pass at render time. Used when a
 * placeholder, hint, or visibility decision depends on data that lives
 * outside the schema (the `exec` tool's placeholder shows the connected
 * agent's working directory; `sub_agents` hides `maxSubAgents` until
 * `subAgentSpawning` is enabled).
 */
export interface FieldOverride {
  placeholder?: string;
  description?: string;
  /** When true, the field is not rendered at all. */
  hidden?: boolean;
}

export type FieldOverrides = Record<string, FieldOverride>;

/**
 * Optional UI grouping. When the renderer reaches the field named in
 * `startAt` it emits a divider + heading + optional description above
 * that field. Section membership is NOT about data shape — fields still
 * live flat on the value object; sections only add visual separators.
 */
export interface SchemaSection<T = Record<string, unknown>> {
  title: string;
  description?: string;
  startAt: keyof T & string;
}

export interface ObjectSchema<T = Record<string, unknown>> {
  type: 'object';
  properties: Partial<Record<keyof T & string, FieldSchema>>;
  sections?: SchemaSection<T>[];
}
