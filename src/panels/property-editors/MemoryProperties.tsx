import { useGraphStore } from '../../store/graph-store';
import type { MemoryNodeData, MemoryBackend } from '../../types/nodes';
import { Field, inputClass, selectClass } from './shared';

const BACKENDS: MemoryBackend[] = ['builtin', 'external', 'cloud'];
const SEARCH_MODES = ['keyword', 'semantic', 'hybrid'] as const;
const COMPACTION_STRATEGIES = ['summary', 'sliding-window', 'hybrid'] as const;

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

      <Field label="Backend">
        <select
          className={selectClass}
          value={data.backend}
          onChange={(e) => update(nodeId, { backend: e.target.value as MemoryBackend })}
        >
          {BACKENDS.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
      </Field>

      <Field label="Max Session Messages">
        <input
          className={inputClass}
          type="number"
          min={1}
          value={data.maxSessionMessages}
          onChange={(e) =>
            update(nodeId, { maxSessionMessages: parseInt(e.target.value) || 100 })
          }
        />
      </Field>

      <Field label="Persistence">
        <Checkbox
          label="Persist across sessions"
          checked={data.persistAcrossSessions}
          onChange={(v) => update(nodeId, { persistAcrossSessions: v })}
        />
      </Field>

      <Field label="Search Mode">
        <select
          className={selectClass}
          value={data.searchMode}
          onChange={(e) => update(nodeId, { searchMode: e.target.value })}
        >
          {SEARCH_MODES.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </Field>

      {/* Compaction */}
      <Field label="Compaction">
        <div className="space-y-2">
          <Checkbox
            label="Enable compaction"
            checked={data.compactionEnabled}
            onChange={(v) => update(nodeId, { compactionEnabled: v })}
          />
          {data.compactionEnabled && (
            <>
              <select
                className={selectClass}
                value={data.compactionStrategy}
                onChange={(e) => update(nodeId, { compactionStrategy: e.target.value })}
              >
                {COMPACTION_STRATEGIES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <div>
                <label className="text-[10px] text-slate-500">Threshold (0-1)</label>
                <input
                  className={inputClass}
                  type="number"
                  min={0}
                  max={1}
                  step={0.1}
                  value={data.compactionThreshold}
                  onChange={(e) =>
                    update(nodeId, { compactionThreshold: parseFloat(e.target.value) || 0.8 })
                  }
                />
              </div>
            </>
          )}
        </div>
      </Field>

      {/* Memory Tools */}
      <Field label="Memory Tools">
        <div className="space-y-1.5">
          <Checkbox
            label="memory_search (hybrid search)"
            checked={data.exposeMemorySearch}
            onChange={(v) => update(nodeId, { exposeMemorySearch: v })}
          />
          <Checkbox
            label="memory_get (read entry)"
            checked={data.exposeMemoryGet}
            onChange={(v) => update(nodeId, { exposeMemoryGet: v })}
          />
          <Checkbox
            label="memory_save (write entry)"
            checked={data.exposeMemorySave}
            onChange={(v) => update(nodeId, { exposeMemorySave: v })}
          />
        </div>
      </Field>

      {/* External backend config */}
      {data.backend !== 'builtin' && (
        <>
          <Field label="External Endpoint">
            <input
              className={inputClass}
              value={data.externalEndpoint}
              onChange={(e) => update(nodeId, { externalEndpoint: e.target.value })}
              placeholder="https://api.example.com/memory"
            />
          </Field>
          <Field label="External API Key">
            <input
              className={inputClass}
              type="password"
              value={data.externalApiKey}
              onChange={(e) => update(nodeId, { externalApiKey: e.target.value })}
              placeholder="API key"
            />
          </Field>
        </>
      )}
    </div>
  );
}
