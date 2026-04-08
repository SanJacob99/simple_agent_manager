import { useGraphStore } from '../../store/graph-store';
import type { CronNodeData } from '../../types/nodes';
import { Field, inputClass, selectClass } from './shared';

interface Props {
  nodeId: string;
  data: CronNodeData;
}

export default function CronProperties({ nodeId, data }: Props) {
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

      <Field label="Schedule (cron)">
        <input
          className={inputClass}
          value={data.schedule}
          onChange={(e) => update(nodeId, { schedule: e.target.value })}
          placeholder="0 9 * * *"
        />
      </Field>

      <Field label="Prompt">
        <textarea
          className={`${inputClass} min-h-[80px] resize-y`}
          value={data.prompt}
          onChange={(e) => update(nodeId, { prompt: e.target.value })}
          placeholder="Message to send on each cron tick"
        />
      </Field>

      <Field label="Enabled">
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => update(nodeId, { enabled: e.target.checked })}
          />
          Schedule is active
        </label>
      </Field>

      <Field label="Session Mode">
        <select
          className={selectClass}
          value={data.sessionMode}
          onChange={(e) =>
            update(nodeId, { sessionMode: e.target.value as 'persistent' | 'ephemeral' })
          }
        >
          <option value="persistent">Persistent (accumulate history)</option>
          <option value="ephemeral">Ephemeral (fresh each run)</option>
        </select>
      </Field>

      <Field label="Timezone">
        <input
          className={inputClass}
          value={data.timezone}
          onChange={(e) => update(nodeId, { timezone: e.target.value })}
          placeholder="local"
        />
      </Field>

      <Field label="Max Run Duration (ms)">
        <input
          className={inputClass}
          type="number"
          min={0}
          value={data.maxRunDurationMs}
          onChange={(e) =>
            update(nodeId, { maxRunDurationMs: parseInt(e.target.value, 10) || 300000 })
          }
        />
      </Field>

      {data.sessionMode === 'ephemeral' && (
        <Field label="Retention (days)">
          <input
            className={inputClass}
            type="number"
            min={1}
            value={data.retentionDays}
            onChange={(e) =>
              update(nodeId, { retentionDays: parseInt(e.target.value, 10) || 7 })
            }
          />
        </Field>
      )}
    </div>
  );
}
