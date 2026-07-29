import { useGraphStore } from '../../store/graph-store';
import type {
  TriggerNodeData,
  TriggerSourceKind,
  TriggerFileEvent,
} from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const KINDS: { id: TriggerSourceKind; label: string }[] = [
  { id: 'webhook', label: 'Webhook (inbound HTTP)' },
  { id: 'fileWatch', label: 'File watch (filesystem change)' },
  { id: 'queue', label: 'Queue (in-process message)' },
  { id: 'manual', label: 'Manual (explicit run-now)' },
];

const SESSION_MODES: { id: 'persistent' | 'ephemeral'; label: string }[] = [
  { id: 'ephemeral', label: 'Ephemeral (fresh session per fire)' },
  { id: 'persistent', label: 'Persistent (reuse one session)' },
];

const FILE_EVENTS: { id: TriggerFileEvent; label: string }[] = [
  { id: 'add', label: 'add' },
  { id: 'change', label: 'change' },
  { id: 'unlink', label: 'unlink' },
];

interface Props {
  nodeId: string;
  data: TriggerNodeData;
}

export default function TriggerProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);

  const toggleEvent = (id: TriggerFileEvent) => {
    const next = data.watchEvents.includes(id)
      ? data.watchEvents.filter((e) => e !== id)
      : [...data.watchEvents, id];
    update(nodeId, { watchEvents: next });
  };

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
        tooltip="When off, the source is registered into the graph but never fires."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => update(nodeId, { enabled: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Register and fire this source</span>
        </label>
      </Field>

      <Field
        label="Source kind"
        tooltip="Which kind of event fires this trigger. Cron covers time; these cover webhooks, file changes, queue messages, and manual fires."
      >
        <select
          className={selectClass}
          value={data.kind}
          onChange={(e) => update(nodeId, { kind: e.target.value as TriggerSourceKind })}
        >
          {KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Prompt"
        tooltip="Prompt fed to the headless run when the trigger fires. The event payload is appended to it."
      >
        <textarea
          className={textareaClass}
          rows={3}
          value={data.prompt}
          onChange={(e) => update(nodeId, { prompt: e.target.value })}
          placeholder="A trigger fired. Handle the event described below."
        />
      </Field>

      {data.kind === 'webhook' && (
        <>
          <Field
            label="Webhook path"
            tooltip="Path suffix the server mounts the receiver at, e.g. /deploy. Combined with the agent's webhook base."
          >
            <input
              className={inputClass}
              value={data.webhookPath}
              onChange={(e) => update(nodeId, { webhookPath: e.target.value })}
              placeholder="/hook"
            />
          </Field>
          <Field
            label="Webhook secret"
            tooltip="Shared secret required in the X-Signature header. Leave empty to accept unsigned requests."
          >
            <input
              className={inputClass}
              value={data.webhookSecret}
              onChange={(e) => update(nodeId, { webhookSecret: e.target.value })}
              placeholder="(no signature check)"
            />
          </Field>
        </>
      )}

      {data.kind === 'fileWatch' && (
        <>
          <Field
            label="Watch paths"
            tooltip="Comma-separated globs under the workspace to watch, e.g. src/**/*.ts, docs/**."
          >
            <input
              className={inputClass}
              value={data.watchPaths}
              onChange={(e) => update(nodeId, { watchPaths: e.target.value })}
              placeholder="src/**/*.ts"
            />
          </Field>
          <Field
            label="Watch events"
            tooltip="Which filesystem events fire the trigger."
          >
            <div className="flex flex-wrap gap-3">
              {FILE_EVENTS.map((ev) => (
                <label key={ev.id} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={data.watchEvents.includes(ev.id)}
                    onChange={() => toggleEvent(ev.id)}
                    className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
                  />
                  <span className="text-xs text-slate-300">{ev.label}</span>
                </label>
              ))}
            </div>
          </Field>
        </>
      )}

      {data.kind === 'queue' && (
        <Field
          label="Queue name"
          tooltip="Name of the in-process queue this trigger drains. Messages posted to it fire the run."
        >
          <input
            className={inputClass}
            value={data.queueName}
            onChange={(e) => update(nodeId, { queueName: e.target.value })}
            placeholder="jobs"
          />
        </Field>
      )}

      <Field
        label="Session mode"
        tooltip="Whether a fire reuses a persistent session or spins an ephemeral one. Mirrors the cron node."
      >
        <select
          className={selectClass}
          value={data.sessionMode}
          onChange={(e) =>
            update(nodeId, {
              sessionMode: e.target.value as 'persistent' | 'ephemeral',
            })
          }
        >
          {SESSION_MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Debounce (ms)"
        tooltip="Minimum time between fires; bursts inside the window collapse into a single run. 0 disables debounce."
      >
        <input
          type="number"
          min={0}
          step={100}
          className={inputClass}
          value={data.debounceMs}
          onChange={(e) =>
            update(nodeId, { debounceMs: Math.max(0, Math.floor(Number(e.target.value) || 0)) })
          }
        />
      </Field>

      <Field
        label="Max run duration (ms)"
        tooltip="Hard ceiling on a single triggered run's wall-clock."
      >
        <input
          type="number"
          min={0}
          step={1000}
          className={inputClass}
          value={data.maxRunDurationMs}
          onChange={(e) =>
            update(nodeId, {
              maxRunDurationMs: Math.max(0, Math.floor(Number(e.target.value) || 0)),
            })
          }
        />
      </Field>

      <Field
        label="Retention (days)"
        tooltip="How many days of fire history to retain."
      >
        <input
          type="number"
          min={0}
          className={inputClass}
          value={data.retentionDays}
          onChange={(e) =>
            update(nodeId, {
              retentionDays: Math.max(0, Math.floor(Number(e.target.value) || 0)),
            })
          }
        />
      </Field>
    </div>
  );
}
