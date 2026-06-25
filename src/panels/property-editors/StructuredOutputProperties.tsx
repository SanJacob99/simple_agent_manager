import { useGraphStore } from '../../store/graph-store';
import type {
  StructuredOutputNodeData,
  StructuredOutputFormat,
  StructuredOutputMode,
  StructuredOutputOnFailure,
} from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const FORMATS: { id: StructuredOutputFormat; label: string }[] = [
  { id: 'json_schema', label: 'JSON Schema (constrained)' },
  { id: 'json_object', label: 'JSON object (any valid JSON)' },
  { id: 'none', label: 'None (validate client-side only)' },
];

const MODES: { id: StructuredOutputMode; label: string }[] = [
  { id: 'strict', label: 'Strict (reject unknown keys)' },
  { id: 'lenient', label: 'Lenient (tolerate extra keys)' },
];

const ON_FAILURE: { id: StructuredOutputOnFailure; label: string }[] = [
  { id: 'repair', label: 'Repair (re-prompt the model)' },
  { id: 'error', label: 'Error (fail the run)' },
  { id: 'passthrough', label: 'Passthrough (keep raw text)' },
];

interface Props {
  nodeId: string;
  data: StructuredOutputNodeData;
}

/** Parse the schema text for inline validation feedback in the editor. */
function schemaError(source: string): string | null {
  if (!source.trim()) return 'Schema is empty.';
  try {
    const parsed = JSON.parse(source);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return 'Top-level schema must be a JSON object.';
    }
    return null;
  } catch (e) {
    return `Invalid JSON: ${(e as Error).message}`;
  }
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
        tooltip="When off, the node is wired into the graph but the final response is left unconstrained."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => update(nodeId, { enabled: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-teal-500 focus:ring-teal-500/30"
          />
          <span className="text-xs text-slate-300">Constrain final response</span>
        </label>
      </Field>

      <Field
        label="Schema name"
        tooltip="Surfaced to providers as the response-format name (e.g. OpenAI json_schema.name)."
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
        tooltip="The contract the agent's final message must satisfy. Standard JSON Schema (Draft 2020-12 subset)."
      >
        <textarea
          className={textareaClass}
          rows={10}
          spellCheck={false}
          value={data.schema}
          onChange={(e) => update(nodeId, { schema: e.target.value })}
        />
        {error ? (
          <p className="mt-1 text-xs text-red-400">{error}</p>
        ) : (
          <p className="mt-1 text-xs text-emerald-400">Schema parses.</p>
        )}
      </Field>

      <Field
        label="Response format"
        tooltip="Provider-side hint. json_schema asks the provider to enforce the schema where supported; the runtime always re-validates."
      >
        <select
          className={selectClass}
          value={data.format}
          onChange={(e) =>
            update(nodeId, { format: e.target.value as StructuredOutputFormat })
          }
        >
          {FORMATS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Strictness"
        tooltip="Strict implies additionalProperties:false where the schema does not say otherwise."
      >
        <select
          className={selectClass}
          value={data.mode}
          onChange={(e) =>
            update(nodeId, { mode: e.target.value as StructuredOutputMode })
          }
        >
          {MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="On validation failure"
        tooltip="What the runtime does when the final response does not match the schema."
      >
        <select
          className={selectClass}
          value={data.onFailure}
          onChange={(e) =>
            update(nodeId, { onFailure: e.target.value as StructuredOutputOnFailure })
          }
        >
          {ON_FAILURE.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      {data.onFailure === 'repair' && (
        <Field
          label="Max repair attempts"
          tooltip="How many times the model is re-prompted with the validation errors before giving up."
        >
          <input
            type="number"
            min={0}
            max={5}
            step={1}
            className={inputClass}
            value={data.maxRepairAttempts}
            onChange={(e) =>
              update(nodeId, {
                maxRepairAttempts: Math.min(5, Math.max(0, Math.floor(Number(e.target.value) || 0))),
              })
            }
          />
        </Field>
      )}

      <Field
        label="Schema in prompt"
        tooltip="Append a compact rendering of the schema to the system prompt. Helps models that lack native structured-output support."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.includeSchemaInPrompt}
            onChange={(e) => update(nodeId, { includeSchemaInPrompt: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-teal-500 focus:ring-teal-500/30"
          />
          <span className="text-xs text-slate-300">Include schema as prompt guidance</span>
        </label>
      </Field>
    </div>
  );
}
