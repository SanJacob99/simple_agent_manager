import { useGraphStore } from '../../store/graph-store';
import type {
  ReflectionNodeData,
  ReflectionExhaustionPolicy,
} from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const POLICIES: { id: ReflectionExhaustionPolicy; label: string }[] = [
  { id: 'accept_best', label: 'Accept best (highest-scoring attempt)' },
  { id: 'accept_last', label: 'Accept last (final revision)' },
  { id: 'warn', label: 'Warn (accept best, flag below threshold)' },
];

interface Props {
  nodeId: string;
  data: ReflectionNodeData;
}

export default function ReflectionProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);

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
        tooltip="When off, the node is wired into the graph but the finalize step is unchanged."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => update(nodeId, { enabled: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">
            Run a critique / revise loop before finalizing
          </span>
        </label>
      </Field>

      <Field
        label="Rubric"
        tooltip="Criteria the critic scores the reply against. Empty falls back to a general quality rubric. The same rubric can grade an Evals suite."
      >
        <textarea
          className={textareaClass}
          rows={4}
          value={data.rubric}
          onChange={(e) => update(nodeId, { rubric: e.target.value })}
          placeholder="Is the answer correct, complete, and directly responsive?"
        />
      </Field>

      <Field
        label="Max revisions"
        tooltip="Revise passes after the initial draft. 0 makes the loop critique-only (no rewrite)."
      >
        <input
          type="number"
          min={0}
          step={1}
          className={inputClass}
          value={data.maxRevisions}
          onChange={(e) =>
            update(nodeId, { maxRevisions: Math.max(0, Math.floor(Number(e.target.value) || 0)) })
          }
        />
      </Field>

      <Field
        label="Score threshold"
        tooltip="Accept once an attempt's score (0..1) reaches this. 1 forces every allowed revision."
      >
        <input
          type="number"
          min={0}
          max={1}
          step={0.05}
          className={inputClass}
          value={data.scoreThreshold}
          onChange={(e) =>
            update(nodeId, {
              scoreThreshold: Math.min(1, Math.max(0, Number(e.target.value) || 0)),
            })
          }
        />
      </Field>

      <Field
        label="Critic model"
        tooltip="Model used for the critique / revise passes. Empty falls back to the agent's model. A cheaper model here keeps reflection affordable."
      >
        <input
          className={inputClass}
          value={data.criticModelId}
          onChange={(e) => update(nodeId, { criticModelId: e.target.value })}
          placeholder="anthropic/claude-haiku-4-5-20251001"
        />
      </Field>

      <Field
        label="On max revisions"
        tooltip="What to return when the revision budget is exhausted without meeting the threshold."
      >
        <select
          className={selectClass}
          value={data.onMaxRevisions}
          onChange={(e) =>
            update(nodeId, {
              onMaxRevisions: e.target.value as ReflectionExhaustionPolicy,
            })
          }
        >
          {POLICIES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Keep critique in transcript"
        tooltip="When on, the critique text is kept in the session transcript instead of being dropped after the loop."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.includeCritiqueInTranscript}
            onChange={(e) =>
              update(nodeId, { includeCritiqueInTranscript: e.target.checked })
            }
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Retain critique messages</span>
        </label>
      </Field>
    </div>
  );
}
