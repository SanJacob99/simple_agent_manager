import { useGraphStore } from '../../store/graph-store';
import type {
  StructuredOutputNodeData,
  StructuredOutputMode,
  StructuredOutputOnError,
} from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const MODES: { id: StructuredOutputMode; label: string }[] = [
  { id: 'strict', label: 'Strict (reject extra / require fields)' },
  { id: 'loose', label: 'Loose (validate present keys only)' },
];

const ON_ERROR: { id: StructuredOutputOnError; label: string }[] = [
  { id: 'reprompt', label: 'Re-prompt to repair' },
  { id: 'passthrough', label: 'Pass through (flag unvalidated)' },
  { id: 'error', label: 'Fail the run' },
];

function schemaError(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return 'Schema is empty.';
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return 'Schema must be a JSON object.';
    }
    return null;
  } catch (err) {
    return (err as Error).message;
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
        tooltip="When off, the node is wired into the graph but the schema is not enforced."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => update(nodeId, { enabled: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Enforce schema on final response</span>
        </label>
      </Field>

      <Field
        label="Schema name"
        tooltip="Advertised to the model and used as the schema-as-tool name."
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
        tooltip="Draft-07 subset: type, required, properties, additionalProperties, items, enum, const, min/max, length, pattern."
      >
        <textarea
          className={textareaClass}
          rows={10}
          spellCheck={false}
          value={data.schema}
          onChange={(e) => update(nodeId, { schema: e.target.value })}
          placeholder='{ "type": "object", "properties": { ... }, "required": [ ... ] }'
        />
        {error ? (
          <p className="mt-1 text-[10px] text-red-400">Invalid schema: {error}</p>
        ) : (
          <p className="mt-1 text-[10px] text-emerald-400">Schema is valid JSON.</p>
        )}
      </Field>

      <Field
        label="Mode"
        tooltip="Strict requires declared fields and rejects undeclared properties (when additionalProperties is false). Loose validates only the keys present."
      >
        <select
          className={selectClass}
          value={data.mode}
          onChange={(e) => update(nodeId, { mode: e.target.value as StructuredOutputMode })}
        >
          {MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="On validation error"
        tooltip="What the runtime does when the final response fails validation."
      >
        <select
          className={selectClass}
          value={data.onValidationError}
          onChange={(e) =>
            update(nodeId, { onValidationError: e.target.value as StructuredOutputOnError })
          }
        >
          {ON_ERROR.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      {data.onValidationError === 'reprompt' && (
        <Field
          label="Max repair attempts"
          tooltip="How many times to re-prompt the model with the validation errors before giving up."
        >
          <input
            type="number"
            min={0}
            max={10}
            step={1}
            className={inputClass}
            value={data.maxRepairAttempts}
            onChange={(e) =>
              update(nodeId, {
                maxRepairAttempts: Math.min(10, Math.max(0, Math.floor(Number(e.target.value) || 0))),
              })
            }
          />
        </Field>
      )}

      <Field
        label="Include schema in prompt"
        tooltip="Append the schema and a 'respond with JSON matching this schema' instruction to the system prompt so the model targets it."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.includeSchemaInPrompt}
            onChange={(e) => update(nodeId, { includeSchemaInPrompt: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Add schema instruction to system prompt</span>
        </label>
      </Field>
    </div>
  );
}
