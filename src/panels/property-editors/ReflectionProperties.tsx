import { useGraphStore } from '../../store/graph-store';
import type {
  ReflectionNodeData,
  ReflectionExhaustionPolicy,
} from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const ON_EXHAUSTION: { id: ReflectionExhaustionPolicy; label: string }[] = [
  { id: 'use_best', label: 'Use best (highest-scored draft)' },
  { id: 'use_last', label: 'Use last (final revision)' },
  { id: 'warn', label: 'Warn (use last, flag below threshold)' },
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
        tooltip="When off, the node is wired into the graph but the reply is finalized without a critique/revise pass."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => update(nodeId, { enabled: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Critique and revise the reply</span>
        </label>
      </Field>

      <Field
        label="Rubric"
        tooltip="The criteria the critic scores each draft against, in plain language."
      >
        <textarea
          className={textareaClass}
          rows={4}
          value={data.rubric}
          onChange={(e) => update(nodeId, { rubric: e.target.value })}
          placeholder="The answer is correct, complete, and clearly written."
        />
      </Field>

      <Field
        label="Score threshold"
        tooltip="Minimum critic score (0–1) the draft must reach to be accepted without further revision."
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
        label="Max revisions"
        tooltip="How many revise rounds to spend after the initial draft. 0 critiques once but never revises."
      >
        <input
          type="number"
          min={0}
          max={5}
          className={inputClass}
          value={data.maxRevisions}
          onChange={(e) =>
            update(nodeId, {
              maxRevisions: Math.max(0, Math.floor(Number(e.target.value) || 0)),
            })
          }
        />
      </Field>

      <Field
        label="Critic model"
        tooltip="Model id used for the critique pass. Leave empty to reuse the agent's own model. A cheaper model often suffices."
      >
        <input
          className={inputClass}
          value={data.criticModelId}
          onChange={(e) => update(nodeId, { criticModelId: e.target.value })}
          placeholder="(agent's model)"
        />
      </Field>

      <Field
        label="Critique guidance"
        tooltip="Extra guidance appended to the critic's scoring instruction (e.g. weight factual accuracy over style)."
      >
        <textarea
          className={textareaClass}
          rows={3}
          value={data.critiquePrompt}
          onChange={(e) => update(nodeId, { critiquePrompt: e.target.value })}
          placeholder="Optional: extra scoring guidance for the critic."
        />
      </Field>

      <Field
        label="On exhaustion"
        tooltip="What to finalize when revisions run out without the draft crossing the threshold."
      >
        <select
          className={selectClass}
          value={data.onExhaustion}
          onChange={(e) =>
            update(nodeId, {
              onExhaustion: e.target.value as ReflectionExhaustionPolicy,
            })
          }
        >
          {ON_EXHAUSTION.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Inject rubric into prompt"
        tooltip="Append the rubric to the agent's system prompt so its first draft already targets the quality bar."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.injectRubricIntoPrompt}
            onChange={(e) => update(nodeId, { injectRubricIntoPrompt: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Prime the first draft with the rubric</span>
        </label>
      </Field>
    </div>
  );
}
