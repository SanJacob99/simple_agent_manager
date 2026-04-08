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

      <div className="mt-3 border-t border-slate-800/80 pt-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Session Resets
        </div>

        <Field label="Daily Reset">
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={data.dailyResetEnabled}
              onChange={(e) => update(nodeId, { dailyResetEnabled: e.target.checked })}
            />
            Start a fresh session after the daily cutoff
          </label>
        </Field>

        {data.dailyResetEnabled && (
          <Field label="Daily Reset Hour">
            <input
              className={inputClass}
              type="number"
              min={0}
              max={23}
              value={data.dailyResetHour}
              onChange={(e) =>
                update(nodeId, {
                  dailyResetHour: Math.min(23, Math.max(0, parseInt(e.target.value, 10) || 0)),
                })
              }
            />
          </Field>
        )}

        <Field label="Idle Reset">
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={data.idleResetEnabled}
              onChange={(e) => update(nodeId, { idleResetEnabled: e.target.checked })}
            />
            Reset after a period of inactivity
          </label>
        </Field>

        {data.idleResetEnabled && (
          <Field label="Idle Reset Minutes">
            <input
              className={inputClass}
              type="number"
              min={1}
              value={data.idleResetMinutes}
              onChange={(e) =>
                update(nodeId, { idleResetMinutes: parseInt(e.target.value, 10) || 60 })
              }
            />
          </Field>
        )}

        <Field label="Parent Fork Token Limit">
          <input
            className={inputClass}
            type="number"
            min={0}
            value={data.parentForkMaxTokens}
            onChange={(e) =>
              update(nodeId, { parentForkMaxTokens: parseInt(e.target.value, 10) || 0 })
            }
          />
        </Field>
      </div>

      <div className="mt-3 border-t border-slate-800/80 pt-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Maintenance
        </div>

        <Field label="Mode">
          <select
            className={selectClass}
            value={data.maintenanceMode}
            onChange={(e) =>
              update(nodeId, { maintenanceMode: e.target.value as 'warn' | 'enforce' })
            }
          >
            <option value="warn">Warn (dry run)</option>
            <option value="enforce">Enforce (auto cleanup)</option>
          </select>
        </Field>

        <Field label="Prune After (days)">
          <input
            className={inputClass}
            type="number"
            min={1}
            value={data.pruneAfterDays}
            onChange={(e) =>
              update(nodeId, { pruneAfterDays: parseInt(e.target.value, 10) || 30 })
            }
          />
        </Field>

        <Field label="Max Entries">
          <input
            className={inputClass}
            type="number"
            min={1}
            value={data.maxEntries}
            onChange={(e) =>
              update(nodeId, { maxEntries: parseInt(e.target.value, 10) || 500 })
            }
          />
        </Field>

        <Field label="Rotate Store (bytes)">
          <input
            className={inputClass}
            type="number"
            min={0}
            value={data.rotateBytes}
            onChange={(e) =>
              update(nodeId, { rotateBytes: parseInt(e.target.value, 10) || 10_485_760 })
            }
          />
        </Field>

        <Field label="Archive Retention (days)">
          <input
            className={inputClass}
            type="number"
            min={0}
            value={data.resetArchiveRetentionDays}
            onChange={(e) =>
              update(nodeId, { resetArchiveRetentionDays: parseInt(e.target.value, 10) || 30 })
            }
          />
        </Field>

        <Field label="Max Disk (bytes, 0=disabled)">
          <input
            className={inputClass}
            type="number"
            min={0}
            value={data.maxDiskBytes}
            onChange={(e) =>
              update(nodeId, { maxDiskBytes: parseInt(e.target.value, 10) || 0 })
            }
          />
        </Field>

        {data.maxDiskBytes > 0 && (
          <Field label="High Water (%)">
            <input
              className={inputClass}
              type="number"
              min={1}
              max={100}
              value={data.highWaterPercent}
              onChange={(e) =>
                update(nodeId, {
                  highWaterPercent: Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 80)),
                })
              }
            />
          </Field>
        )}

        <Field label="Interval (minutes)">
          <input
            className={inputClass}
            type="number"
            min={1}
            value={data.maintenanceIntervalMinutes}
            onChange={(e) =>
              update(nodeId, { maintenanceIntervalMinutes: parseInt(e.target.value, 10) || 60 })
            }
          />
        </Field>
      </div>
    </div>
  );
}
