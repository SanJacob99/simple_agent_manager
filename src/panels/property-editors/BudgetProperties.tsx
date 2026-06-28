import { useGraphStore } from '../../store/graph-store';
import type { BudgetNodeData, BudgetDegradePolicy } from '../../types/nodes';
import { Field, inputClass, selectClass } from './shared';

const POLICIES: { id: BudgetDegradePolicy; label: string }[] = [
  { id: 'warn', label: 'Warn (log and continue)' },
  { id: 'downshift', label: 'Downshift (switch to cheaper model)' },
  { id: 'block', label: 'Block (stop the run)' },
];

const CEILINGS: {
  key: keyof Pick<
    BudgetNodeData,
    | 'maxUsdPerRun'
    | 'maxUsdPerDay'
    | 'maxTokensPerRun'
    | 'maxToolCallsPerRun'
    | 'maxRunsPerMinute'
  >;
  label: string;
  step: number;
  tooltip: string;
}[] = [
  { key: 'maxUsdPerRun', label: 'Max USD / run', step: 0.01, tooltip: 'Estimated USD spend ceiling for a single run. 0 disables.' },
  { key: 'maxUsdPerDay', label: 'Max USD / day', step: 0.5, tooltip: 'Estimated USD spend ceiling per rolling 24h window. 0 disables.' },
  { key: 'maxTokensPerRun', label: 'Max tokens / run', step: 1000, tooltip: 'Prompt + completion token ceiling for a single run. 0 disables.' },
  { key: 'maxToolCallsPerRun', label: 'Max tool calls / run', step: 1, tooltip: 'Tool invocation ceiling for a single run. 0 disables.' },
  { key: 'maxRunsPerMinute', label: 'Max runs / minute', step: 1, tooltip: 'Run start-rate ceiling per rolling minute. 0 disables.' },
];

interface Props {
  nodeId: string;
  data: BudgetNodeData;
}

export default function BudgetProperties({ nodeId, data }: Props) {
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
        tooltip="When off, the node is wired into the graph but no ceilings are enforced."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => update(nodeId, { enabled: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Enforce spend and rate ceilings</span>
        </label>
      </Field>

      {CEILINGS.map((c) => (
        <Field key={c.key} label={c.label} tooltip={c.tooltip}>
          <input
            type="number"
            min={0}
            step={c.step}
            className={inputClass}
            value={data[c.key]}
            onChange={(e) =>
              update(nodeId, { [c.key]: Math.max(0, Number(e.target.value) || 0) })
            }
          />
        </Field>
      ))}

      <Field
        label="Degrade policy"
        tooltip="What happens when any ceiling is reached."
      >
        <select
          className={selectClass}
          value={data.degradePolicy}
          onChange={(e) =>
            update(nodeId, { degradePolicy: e.target.value as BudgetDegradePolicy })
          }
        >
          {POLICIES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>

      {data.degradePolicy === 'downshift' && (
        <Field
          label="Downshift model"
          tooltip="Cheaper model the run switches to once a ceiling is reached. Empty falls back to warn."
        >
          <input
            className={inputClass}
            value={data.downshiftModelId}
            onChange={(e) => update(nodeId, { downshiftModelId: e.target.value })}
            placeholder="anthropic/claude-haiku-4-5-20251001"
          />
        </Field>
      )}

      {data.degradePolicy === 'block' && (
        <Field
          label="Block message"
          tooltip="Shown to the user when a budget block stops a run. Empty falls back to a generic notice."
        >
          <input
            className={inputClass}
            value={data.blockMessage}
            onChange={(e) => update(nodeId, { blockMessage: e.target.value })}
            placeholder="This agent has reached its spending limit."
          />
        </Field>
      )}
    </div>
  );
}
