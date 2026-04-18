import { Fragment } from 'react';
import { Field, inputClass, selectClass, textareaClass } from '../shared';
import type {
  BooleanFieldSchema,
  FieldOverrides,
  FieldSchema,
  IntegerFieldSchema,
  ObjectSchema,
  SchemaSection,
  StringFieldSchema,
} from './types';

interface SchemaFormProps<T> {
  schema: ObjectSchema<T>;
  value: T;
  onChange: (patch: Partial<T>) => void;
  /**
   * Per-field runtime overrides — placeholder / description text, or
   * visibility — that depends on values outside the schema (inherited
   * working directory, conditional visibility, etc.).
   */
  fieldOverrides?: FieldOverrides;
}

/**
 * Renders a form for a flat object schema.
 *
 * Fields appear in `schema.properties` declaration order. When
 * `schema.sections` is present, a divider + heading is inserted
 * immediately above the field named in each section's `startAt` —
 * sections group fields visually without changing the flat data shape.
 */
export function SchemaForm<T>({
  schema,
  value,
  onChange,
  fieldOverrides,
}: SchemaFormProps<T>) {
  const entries = Object.entries(schema.properties).filter(
    ([, field]) => Boolean(field),
  ) as Array<[keyof T & string, FieldSchema]>;
  const sectionByStartAt = new Map<string, SchemaSection<T>>();
  for (const section of schema.sections ?? []) {
    sectionByStartAt.set(section.startAt, section);
  }
  return (
    <>
      {entries.map(([key, field]) => {
        const override = fieldOverrides?.[key];
        if (override?.hidden) return null;
        const section = sectionByStartAt.get(key);
        return (
          <Fragment key={key}>
            {section && <SectionHeader section={section} />}
            <FieldRow
              field={field}
              value={(value as Record<string, unknown>)[key]}
              onChange={(next) => onChange({ [key]: next } as Partial<T>)}
              override={override}
            />
          </Fragment>
        );
      })}
    </>
  );
}

function SectionHeader<T>({ section }: { section: SchemaSection<T> }) {
  return (
    <div className="mt-2 border-t border-slate-700/40 pt-2">
      <p className="text-[10px] font-semibold text-slate-400">{section.title}</p>
      {section.description && (
        <p className="text-[9px] text-slate-600">{section.description}</p>
      )}
    </div>
  );
}

interface FieldRowProps {
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
