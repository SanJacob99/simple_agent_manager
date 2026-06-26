import { useMemo } from 'react';
import { useGraphStore } from '../../store/graph-store';
import type { StructuredOutputNodeData, OutputRepairPolicy } from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const REPAIR_POLICIES: { id: OutputRepairPolicy; label: string }[] = [
  { id: 'repair', label: 'Repair (re-prompt on failure)' },
  { id: 'passthrough', label: 'Passthrough (keep text, attach errors)' },
  { id: 'error', label: 'Error (fail the run)' },
];

interface Props {
  nodeId: string;
  data: StructuredOutputNodeData;
}

export default function StructuredOutputProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);

  // Live validity hint for the schema textarea — mirrors the resolve-time parse
  // in graph-to-agent.ts so the user sees the same verdict the runtime will.
  const schemaError = useMemo(() => {
    try {
      const parsed = JSON.parse(data.schemaText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return 'Schema must be a JSON object.';
      }
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Invalid JSON.';
    }
  }, [data.schemaText]);

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
        tooltip="When off, the node is wired into the graph but the response is left unconstrained."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => update(nodeId, { enabled: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-emerald-500 focus:ring-emerald-500/30"
          />
          <span className="text-xs text-slate-300">Constrain final response</span>
        </label>
      </Field>

      <Field label="Schema name" tooltip="Surfaced to the model and used as the tool/span name.">
        <input
          className={inputClass}
          value={data.schemaName}
          onChange={(e) => update(nodeId, { schemaName: e.target.value })}
          placeholder="response"
        />
      </Field>

      <Field
        label="JSON Schema"
        tooltip="The schema the final response must satisfy. Parsed when the graph resolves; invalid JSON disables enforcement."
      >
        <textarea
          className={textareaClass}
          rows={10}
          spellCheck={false}
          value={data.schemaText}
          onChange={(e) => update(nodeId, { schemaText: e.target.value })}
        />
        {schemaError ? (
          <p className="mt-1 text-[10px] text-red-400">⚠ {schemaError}</p>
        ) : (
          <p className="mt-1 text-[10px] text-emerald-400">✓ Valid JSON schema</p>
        )}
      </Field>

      <Field
        label="Strict mode"
        tooltip="Require an exact match — e.g. forbid extra properties when the schema sets additionalProperties:false. Loose mode tolerates a superset."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.strict}
            onChange={(e) => update(nodeId, { strict: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-emerald-500 focus:ring-emerald-500/30"
          />
          <span className="text-xs text-slate-300">Reject extra / mismatched fields</span>
        </label>
      </Field>

      <Field
        label="On validation failure"
        tooltip="What the runtime does when the response fails to validate."
      >
        <select
          className={selectClass}
          value={data.repairPolicy}
          onChange={(e) =>
            update(nodeId, { repairPolicy: e.target.value as OutputRepairPolicy })
          }
        >
          {REPAIR_POLICIES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>

      {data.repairPolicy === 'repair' && (
        <Field
          label="Max repair attempts"
          tooltip="How many times to re-prompt the model with the validation errors before giving up."
        >
          <input
            type="number"
            min={1}
            max={5}
            step={1}
            className={inputClass}
            value={data.maxRepairAttempts}
            onChange={(e) =>
              update(nodeId, {
                maxRepairAttempts: Math.min(5, Math.max(1, Math.round(Number(e.target.value) || 1))),
              })
            }
          />
        </Field>
      )}

      <Field
        label="Inject schema in prompt"
        tooltip="Add the schema to the system prompt so the model targets the shape up front, reducing repair round-trips."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.includeSchemaInPrompt}
            onChange={(e) => update(nodeId, { includeSchemaInPrompt: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-emerald-500 focus:ring-emerald-500/30"
          />
          <span className="text-xs text-slate-300">Guide the model with the schema</span>
        </label>
      </Field>
    </div>
  );
}
