import { Field, inputClass, selectClass, textareaClass } from '../shared';
import type {
  BooleanFieldSchema,
  FieldOverrides,
  FieldSchema,
  IntegerFieldSchema,
  ObjectSchema,
  StringFieldSchema,
} from './types';

interface SchemaFormProps<T> {
  schema: ObjectSchema<T>;
  value: T;
  onChange: (patch: Partial<T>) => void;
  /**
   * Per-field runtime overrides — placeholder / description text that
   * depends on values outside the schema (inherited working directory, a
   * connected provider's name, etc.).
   */
  fieldOverrides?: FieldOverrides;
}

/**
 * Renders a form for a flat object schema. Each key in `schema.properties`
 * becomes a row. Emits partial updates through `onChange` so the caller
 * merges into its own state.
 *
 * Deliberately narrow: this handles the single-section, flat-object case
 * used by simple tools (`exec`, `code_execution`, `web_search`, `canva`).
 * Multi-section tools (`text_to_speech`, `music_generate`, `image`) will
 * get a nested-schema variant once this baseline is validated in
 * production.
 */
export function SchemaForm<T>({
  schema,
  value,
  onChange,
  fieldOverrides,
}: SchemaFormProps<T>) {
  const entries = Object.entries(schema.properties) as Array<[keyof T & string, FieldSchema]>;
  return (
    <>
      {entries.map(([key, field]) => (
        <FieldRow
          key={key}
          name={key}
          field={field}
          value={(value as Record<string, unknown>)[key]}
          onChange={(next) => onChange({ [key]: next } as Partial<T>)}
          override={fieldOverrides?.[key]}
        />
      ))}
    </>
  );
}

interface FieldRowProps {
  name: string;
  field: FieldSchema;
  value: unknown;
  onChange: (next: unknown) => void;
  override?: { placeholder?: string; description?: string };
}

function FieldRow({ field, value, onChange, override }: FieldRowProps) {
  const description = override?.description ?? field.description;
  if (field.type === 'string') {
    return (
      <Field label={field.title}>
        <StringControl field={field} value={value as string | undefined} onChange={onChange} override={override} />
        {description && <p className="mt-0.5 text-[9px] text-slate-600">{description}</p>}
      </Field>
    );
  }
  if (field.type === 'integer') {
    return (
      <Field label={field.title}>
        <IntegerControl field={field} value={value as number | undefined} onChange={onChange} override={override} />
        {description && <p className="mt-0.5 text-[9px] text-slate-600">{description}</p>}
      </Field>
    );
  }
  return (
    <Field label={field.title}>
      <BooleanControl field={field} value={value as boolean | undefined} onChange={onChange} />
      {description && <p className="mt-0.5 text-[9px] text-slate-600">{description}</p>}
    </Field>
  );
}

function StringControl({
  field,
  value,
  onChange,
  override,
}: {
  field: StringFieldSchema;
  value: string | undefined;
  onChange: (next: string) => void;
  override?: { placeholder?: string };
}) {
  const current = value ?? '';
  const placeholder = override?.placeholder ?? field.placeholder;
  if (field.enum) {
    return (
      <select
        className={selectClass}
        value={current}
        onChange={(e) => onChange(e.target.value)}
      >
        {field.enum.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }
  if (field.format === 'textarea') {
    return (
      <textarea
        className={textareaClass}
        rows={field.textareaRows ?? 4}
        value={current}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    );
  }
  return (
    <input
      className={inputClass}
      type={field.format === 'password' ? 'password' : 'text'}
      value={current}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

function IntegerControl({
  field,
  value,
  onChange,
  override,
}: {
  field: IntegerFieldSchema;
  value: number | undefined;
  onChange: (next: number) => void;
  override?: { placeholder?: string };
}) {
  return (
    <input
      className={inputClass}
      type="number"
      min={field.minimum}
      max={field.maximum}
      value={value ?? ''}
      placeholder={override?.placeholder ?? field.placeholder}
      onChange={(e) => {
        const parsed = parseInt(e.target.value, 10);
        if (Number.isFinite(parsed)) onChange(parsed);
      }}
    />
  );
}

function BooleanControl({
  field,
  value,
  onChange,
}: {
  field: BooleanFieldSchema;
  value: boolean | undefined;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={value ?? false}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-slate-600 bg-slate-800 text-orange-500 focus:ring-orange-500/30"
      />
      <span className="text-xs text-slate-300">{field.checkboxLabel}</span>
    </label>
  );
}
