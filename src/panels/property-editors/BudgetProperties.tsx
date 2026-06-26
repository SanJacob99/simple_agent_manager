import { useGraphStore } from '../../store/graph-store';
import type { BudgetNodeData, BudgetEnforcement } from '../../types/nodes';
import { Field, inputClass, selectClass } from './shared';

const ENFORCEMENTS: { id: BudgetEnforcement; label: string }[] = [
  { id: 'warn', label: 'Warn (log and continue)' },
  { id: 'downshift', label: 'Downshift (fall back to cheaper model)' },
  { id: 'block', label: 'Block (hard-stop the run)' },
];

const CEILINGS: {
  key: keyof Pick<
    BudgetNodeData,
    'maxUsdPerSession' | 'maxUsdPerDay' | 'maxTokensPerRun' | 'maxToolCallsPerRun'
  >;
  label: string;
  tooltip: string;
  step: number;
}[] = [
  {
    key: 'maxUsdPerSession',
    label: 'Max USD / session',
    tooltip: 'Spend ceiling for a single session. 0 disables this ceiling.',
    step: 0.1,
  },
  {
    key: 'maxUsdPerDay',
    label: 'Max USD / day',
    tooltip: 'Spend ceiling per UTC day across sessions. 0 disables this ceiling.',
    step: 1,
  },
  {
    key: 'maxTokensPerRun',
    label: 'Max tokens / run',
    tooltip: 'Total prompt + completion tokens allowed in one run. 0 disables.',
    step: 1000,
  },
  {
    key: 'maxToolCallsPerRun',
    label: 'Max tool calls / run',
    tooltip: 'Maximum tool invocations allowed in one run. 0 disables.',
    step: 1,
  },
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
            className="rounded border-slate-600 bg-slate-800 text-amber-500 focus:ring-amber-500/30"
          />
          <span className="text-xs text-slate-300">Enforce ceilings</span>
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
        label="Enforcement"
        tooltip="Action taken when a ceiling is reached."
      >
        <select
          className={selectClass}
          value={data.enforcement}
          onChange={(e) =>
            update(nodeId, { enforcement: e.target.value as BudgetEnforcement })
          }
        >
          {ENFORCEMENTS.map((en) => (
            <option key={en.id} value={en.id}>
              {en.label}
            </option>
          ))}
        </select>
      </Field>

      {data.enforcement === 'downshift' && (
        <Field
          label="Fallback model"
          tooltip="Cheaper model the run switches to once a ceiling is hit."
        >
          <input
            className={inputClass}
            value={data.fallbackModelId}
            onChange={(e) => update(nodeId, { fallbackModelId: e.target.value })}
            placeholder="anthropic/claude-haiku-4-5"
          />
        </Field>
      )}

      <Field
        label="Warn threshold"
        tooltip="Emit a warning once spend crosses this fraction (0–1) of any ceiling."
      >
        <input
          type="number"
          min={0}
          max={1}
          step={0.05}
          className={inputClass}
          value={data.warnThreshold}
          onChange={(e) =>
            update(nodeId, {
              warnThreshold: Math.min(1, Math.max(0, Number(e.target.value) || 0)),
            })
          }
        />
      </Field>
    </div>
  );
}
