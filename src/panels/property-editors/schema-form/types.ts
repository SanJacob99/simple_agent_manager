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
 * placeholder or hint depends on data that lives outside the schema (for
 * example, the `exec` tool's placeholder shows the connected agent's
 * working directory, which the schema cannot know about).
 */
export interface FieldOverride {
  placeholder?: string;
  description?: string;
}

export type FieldOverrides = Record<string, FieldOverride>;

export interface ObjectSchema<T = Record<string, unknown>> {
  type: 'object';
  properties: { [K in keyof T]: FieldSchema };
}
