import { useGraphStore } from '../../store/graph-store';
import type {
  MemoryNodeData,
  MemorySearchMode,
  MemoryCompactionStrategy,
} from '../../types/nodes';
import { Field, inputClass, selectClass } from './shared';

const SEARCH_MODES: MemorySearchMode[] = ['keyword', 'hybrid'];
const COMPACTION_STRATEGIES: MemoryCompactionStrategy[] = ['summary', 'sliding-window'];

interface Props {
  nodeId: string;
  data: MemoryNodeData;
}

function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
      />
      <span className="text-xs text-slate-300">{label}</span>
    </label>
  );
}

export default function MemoryProperties({ nodeId, data }: Props) {
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

      <p className="px-1 py-2 text-[10px] leading-snug text-slate-500">
        Long-term memory lives in <code>MEMORY.md</code> (durable facts the
        agent should always remember). Short-term memory is per-day in{' '}
        <code>memory/YYYY-MM-DD.md</code> and is the place to log what
        happened during a session. Requires a connected Storage node.
      </p>

      {/* Long-term (MEMORY.md) */}
      <Field label="Long-term (MEMORY.md)">
        <div className="space-y-2">
          <Checkbox
            label="Auto-load at session start"
            checked={data.autoLoadLongTerm}
            onChange={(v) => update(nodeId, { autoLoadLongTerm: v })}
          />
          <div>
            <label className="text-[10px] text-slate-500">Max bytes injected (0 = no cap)</label>
            <input
              className={inputClass}
              type="number"
              min={0}
              value={data.longTermMaxBytes}
              onChange={(e) =>
                update(nodeId, { longTermMaxBytes: parseInt(e.target.value) || 0 })
              }
            />
          </div>
        </div>
      </Field>

      {/* Short-term (daily logs) */}
      <Field label="Short-term (daily logs)">
        <div>
          <label className="text-[10px] text-slate-500">Auto-load recent days (today = 1)</label>
          <input
            className={inputClass}
            type="number"
            min={0}
            value={data.autoLoadShortTermDays}
            onChange={(e) =>
              update(nodeId, { autoLoadShortTermDays: parseInt(e.target.value) || 0 })
            }
          />
        </div>
      </Field>

      {/* Search */}
      <Field label="Search Mode">
        <select
          className={selectClass}
          value={data.searchMode}
          onChange={(e) => update(nodeId, { searchMode: e.target.value as MemorySearchMode })}
        >
          {SEARCH_MODES.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </Field>

      {/* Compaction */}
      <Field label="Compaction (short-term only)">
        <div className="space-y-2">
          <Checkbox
            label="Enable compaction"
            checked={data.compactionEnabled}
            onChange={(v) => update(nodeId, { compactionEnabled: v })}
          />
          {data.compactionEnabled && (
            <>
              <div>
                <label className="text-[10px] text-slate-500">Compact daily logs older than (days)</label>
                <input
                  className={inputClass}
                  type="number"
                  min={1}
                  value={data.compactionAfterDays}
                  onChange={(e) =>
                    update(nodeId, { compactionAfterDays: parseInt(e.target.value) || 7 })
                  }
                />
              </div>
              <select
                className={selectClass}
                value={data.compactionStrategy}
                onChange={(e) =>
                  update(nodeId, { compactionStrategy: e.target.value as MemoryCompactionStrategy })
                }
              >
                {COMPACTION_STRATEGIES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </>
          )}
        </div>
      </Field>

      {/* Memory Tools */}
      <Field label="Memory Tools">
        <div className="space-y-1.5">
          <Checkbox
            label="memory_save (write to long-term or short-term)"
            checked={data.exposeMemorySave}
            onChange={(v) => update(nodeId, { exposeMemorySave: v })}
          />
          <Checkbox
            label="memory_get (read MEMORY.md or a daily log)"
            checked={data.exposeMemoryGet}
            onChange={(v) => update(nodeId, { exposeMemoryGet: v })}
          />
          <Checkbox
            label="memory_search (search all memory files)"
            checked={data.exposeMemorySearch}
            onChange={(v) => update(nodeId, { exposeMemorySearch: v })}
          />
        </div>
      </Field>
    </div>
  );
}
