import { useGraphStore } from '../../store/graph-store';
import type { MemoryNodeData } from '../../types/nodes';
import { Field, inputClass } from './shared';

interface Props {
  nodeId: string;
  data: MemoryNodeData;
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

      <Field label="Max Messages">
        <input
          className={inputClass}
          type="number"
          min={1}
          value={data.maxMessages}
          onChange={(e) =>
            update(nodeId, { maxMessages: parseInt(e.target.value) || 100 })
          }
        />
      </Field>

      <Field label="Persist Across Sessions">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.persistAcrossSessions}
            onChange={(e) =>
              update(nodeId, { persistAcrossSessions: e.target.checked })
            }
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Enable persistence</span>
        </label>
      </Field>
    </div>
  );
}
