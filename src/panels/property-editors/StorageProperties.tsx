import { useGraphStore } from '../../store/graph-store';
import type { StorageNodeData } from '../../types/nodes';
import { Field, inputClass, selectClass } from './shared';

interface Props {
  nodeId: string;
  data: StorageNodeData;
}

export default function StorageProperties({ nodeId, data }: Props) {
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
          value={data.backendType}
          onChange={(e) =>
            update(nodeId, {
              backendType: e.target.value as StorageNodeData['backendType'],
            })
          }
        >
          <option value="filesystem">Filesystem</option>
        </select>
      </Field>

      <Field label="Storage Path">
        <input
          className={inputClass}
          value={data.storagePath}
          onChange={(e) => update(nodeId, { storagePath: e.target.value })}
          placeholder="~/.simple-agent-manager/storage"
        />
      </Field>

      <Field label="Session Retention">
        <input
          className={inputClass}
          type="number"
          min={1}
          value={data.sessionRetention}
          onChange={(e) =>
            update(nodeId, { sessionRetention: parseInt(e.target.value, 10) || 50 })
          }
        />
      </Field>

      <Field label="Memory">
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={data.memoryEnabled}
            onChange={(e) => update(nodeId, { memoryEnabled: e.target.checked })}
          />
          Enable memory files
        </label>
      </Field>

      {data.memoryEnabled && (
        <Field label="Daily Memory">
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={data.dailyMemoryEnabled}
              onChange={(e) =>
                update(nodeId, { dailyMemoryEnabled: e.target.checked })
              }
            />
            Maintain daily logs
          </label>
        </Field>
      )}
    </div>
  );
}
