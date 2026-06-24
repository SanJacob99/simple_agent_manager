import { useGraphStore } from '../../store/graph-store';
import type {
  StructuredOutputNodeData,
  StructuredOutputStrategy,
  StructuredOutputRepair,
  StructuredOutputOnFailure,
} from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const STRATEGIES: { id: StructuredOutputStrategy; label: string }[] = [
  { id: 'tool', label: 'Forced tool call (portable)' },
  { id: 'responseFormat', label: 'Native response_format / json_schema' },
  { id: 'prompt', label: 'Prompt guidance only' },
];

const REPAIRS: { id: StructuredOutputRepair; label: string }[] = [
  { id: 'none', label: 'None (validate once)' },
  { id: 'reprompt', label: 'Re-prompt on failure' },
];

const ON_FAILURE: { id: StructuredOutputOnFailure; label: string }[] = [
  { id: 'error', label: 'Surface an error' },
  { id: 'passthrough', label: 'Pass raw text through' },
];

/** Lightweight parse check so the editor can flag an unparseable schema inline. */
function schemaStatus(schema: string): { ok: boolean; message: string } {
  const trimmed = schema.trim();
  if (!trimmed) return { ok: false, message: 'Schema is empty.' };
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, message: 'Top-level schema must be a JSON object.' };
    }
    return { ok: true, message: 'Valid JSON.' };
  } catch (e) {
    return { ok: false, message: `Invalid JSON: ${(e as Error).message}` };
  }
}

interface Props {
  nodeId: string;
  data: StructuredOutputNodeData;
}

export default function StructuredOutputProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);
  const status = schemaStatus(data.schema);

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
        tooltip="When off, the node is wired into the graph but the agent's response is left unconstrained."
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
        tooltip="Identifier attached to the schema. Used as the structured tool name or the response_format name."
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
        tooltip="A JSON Schema (draft 2020-12 subset) the final response must satisfy. Supports type, properties, required, items, enum, const, numeric and length bounds, additionalProperties, and anyOf/allOf/oneOf."
      >
        <textarea
          className={textareaClass}
          rows={12}
          spellCheck={false}
          value={data.schema}
          onChange={(e) => update(nodeId, { schema: e.target.value })}
          style={{ fontFamily: 'var(--font-mono, monospace)' }}
        />
        <p className={`mt-1 text-[10px] ${status.ok ? 'text-teal-400' : 'text-red-400'}`}>
          {status.message}
        </p>
      </Field>

      <Field
        label="Strategy"
        tooltip="How the schema is applied. Forced tool call works on any tool-calling model; native response_format uses provider constrained decoding; prompt guidance is a soft hint with validation only."
      >
        <select
          className={selectClass}
          value={data.strategy}
          onChange={(e) =>
            update(nodeId, { strategy: e.target.value as StructuredOutputStrategy })
          }
        >
          {STRATEGIES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Strict"
        tooltip="Strict rejects output that fails validation. Loose validates and warns but passes the output through."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.strict}
            onChange={(e) => update(nodeId, { strict: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-teal-500 focus:ring-teal-500/30"
          />
          <span className="text-xs text-slate-300">Reject invalid output</span>
        </label>
      </Field>

      <Field
        label="Repair policy"
        tooltip="What to do when the model returns output that fails validation."
      >
        <select
          className={selectClass}
          value={data.repair}
          onChange={(e) =>
            update(nodeId, { repair: e.target.value as StructuredOutputRepair })
          }
        >
          {REPAIRS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </Field>

      {data.repair === 'reprompt' && (
        <Field
          label="Max repair attempts"
          tooltip="How many times to re-prompt with the validation errors before giving up."
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
        label="On failure"
        tooltip="What happens once repair attempts are exhausted and the output still fails validation."
      >
        <select
          className={selectClass}
          value={data.onFailure}
          onChange={(e) =>
            update(nodeId, { onFailure: e.target.value as StructuredOutputOnFailure })
          }
        >
          {ON_FAILURE.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}
