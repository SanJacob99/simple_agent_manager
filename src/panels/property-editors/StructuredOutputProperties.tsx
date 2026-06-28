import { useGraphStore } from '../../store/graph-store';
import type {
  StructuredOutputNodeData,
  StructuredOutputOnError,
} from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const ON_ERROR: { id: StructuredOutputOnError; label: string }[] = [
  { id: 'repair', label: 'Repair (re-prompt on failure)' },
  { id: 'warn', label: 'Warn (pass through, log)' },
  { id: 'block', label: 'Block (fail the run)' },
];

function schemaError(schema: string): string | null {
  if (!schema.trim()) return 'Schema is empty.';
  try {
    const parsed = JSON.parse(schema);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return 'Schema must be a JSON object.';
    }
    return null;
  } catch (e) {
    return `Invalid JSON: ${(e as Error).message}`;
  }
}

interface Props {
  nodeId: string;
  data: StructuredOutputNodeData;
}

export default function StructuredOutputProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);
  const error = schemaError(data.schema);

  return (
    <div className="space-y-1">
      <Field label="Label">
        <input
          className={inputClass}
          value={data.label}
          onChange={(e) => update(nodeId, { label: e.target.value })}
        />
      </Field>

      <Field
        label="Enabled"
        tooltip="When off, the node is wired into the graph but the reply is left unconstrained."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => update(nodeId, { enabled: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Constrain the final reply</span>
        </label>
      </Field>

      <Field
        label="Schema name"
        tooltip="Identifier sent to providers that support native structured outputs (response_format json_schema)."
      >
        <input
          className={inputClass}
          value={data.schemaName}
          onChange={(e) => update(nodeId, { schemaName: e.target.value })}
          placeholder="response"
        />
      </Field>

      <Field
        label="JSON Schema"
        tooltip="The schema the final reply must satisfy. Stored as text so the graph stays serializable."
      >
        <textarea
          className={textareaClass}
          rows={10}
          spellCheck={false}
          value={data.schema}
          onChange={(e) => update(nodeId, { schema: e.target.value })}
        />
        {error ? (
          <p className="mt-1 text-[10px] text-rose-400">{error}</p>
        ) : (
          <p className="mt-1 text-[10px] text-emerald-400">Valid JSON Schema object.</p>
        )}
      </Field>

      <Field
        label="Strict"
        tooltip="Forward the schema to providers with native structured-output support. Off relies on prompt guidance plus post-hoc validation only."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.strict}
            onChange={(e) => update(nodeId, { strict: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Use native provider enforcement when available</span>
        </label>
      </Field>

      <Field
        label="On validation error"
        tooltip="What happens when the reply does not match the schema."
      >
        <select
          className={selectClass}
          value={data.onValidationError}
          onChange={(e) =>
            update(nodeId, {
              onValidationError: e.target.value as StructuredOutputOnError,
            })
          }
        >
          {ON_ERROR.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      {data.onValidationError === 'repair' && (
        <Field
          label="Max repair attempts"
          tooltip="How many times to re-prompt the model with the validation errors before giving up."
        >
          <input
            type="number"
            min={0}
            max={5}
            className={inputClass}
            value={data.maxRepairAttempts}
            onChange={(e) =>
              update(nodeId, {
                maxRepairAttempts: Math.max(0, Math.floor(Number(e.target.value) || 0)),
              })
            }
          />
        </Field>
      )}

      <Field
        label="Inject schema into prompt"
        tooltip="Append the schema to the system prompt so models without native structured-output support still comply."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.injectSchemaIntoPrompt}
            onChange={(e) => update(nodeId, { injectSchemaIntoPrompt: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Describe the schema in the system prompt</span>
        </label>
      </Field>
    </div>
  );
}
