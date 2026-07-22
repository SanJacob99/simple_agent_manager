import { useGraphStore } from '../../store/graph-store';
import type {
  TriggerNodeData,
  TriggerSource,
  TriggerFileEvent,
  TriggerWebhookMethod,
} from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const SOURCES: { id: TriggerSource; label: string }[] = [
  { id: 'webhook', label: 'Webhook (inbound HTTP)' },
  { id: 'fileWatch', label: 'File watch (filesystem change)' },
  { id: 'queue', label: 'Queue / stream message' },
  { id: 'emailInbound', label: 'Inbound email' },
  { id: 'manual', label: 'Manual (API/UI dispatch)' },
];

const WEBHOOK_METHODS: TriggerWebhookMethod[] = ['POST', 'GET', 'PUT'];
const FILE_EVENTS: TriggerFileEvent[] = ['create', 'modify', 'delete'];

interface Props {
  nodeId: string;
  data: TriggerNodeData;
}

export default function TriggerProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);

  const toggleFileEvent = (ev: TriggerFileEvent) => {
    const next = data.watchEvents.includes(ev)
      ? data.watchEvents.filter((e) => e !== ev)
      : [...data.watchEvents, ev];
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
        tooltip="When off, the trigger is wired into the graph but never fires."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => update(nodeId, { enabled: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Fire runs on matching events</span>
        </label>
      </Field>

      <Field label="Source" tooltip="Which event source drives this trigger.">
        <select
          className={selectClass}
          value={data.source}
          onChange={(e) => update(nodeId, { source: e.target.value as TriggerSource })}
        >
          {SOURCES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Prompt"
        tooltip="Prompt fired when the trigger matches. Use {{event}} for the whole payload or {{event.field}} for one field."
      >
        <textarea
          className={textareaClass}
          rows={4}
          value={data.prompt}
          onChange={(e) => update(nodeId, { prompt: e.target.value })}
          placeholder="Handle the {{event.action}} event and summarize what changed."
        />
      </Field>

      {/* --- Source-specific configuration --- */}
      {data.source === 'webhook' && (
        <>
          <Field label="Webhook path" tooltip="URL path the webhook listener mounts at (must start with '/').">
            <input
              className={inputClass}
              value={data.webhookPath}
              onChange={(e) => update(nodeId, { webhookPath: e.target.value })}
              placeholder="/hooks/deploy"
            />
          </Field>
          <Field label="Method">
            <select
              className={selectClass}
              value={data.webhookMethod}
              onChange={(e) =>
                update(nodeId, { webhookMethod: e.target.value as TriggerWebhookMethod })
              }
            >
              {WEBHOOK_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Signature secret env var"
            tooltip="Env var holding the HMAC secret used to verify inbound signatures. Leave empty for an unauthenticated webhook."
          >
            <input
              className={inputClass}
              value={data.webhookSecretEnvVar}
              onChange={(e) => update(nodeId, { webhookSecretEnvVar: e.target.value })}
              placeholder="(unauthenticated)"
            />
          </Field>
        </>
      )}

      {data.source === 'fileWatch' && (
        <>
          <Field label="Watch path" tooltip="Directory or file to watch for changes.">
            <input
              className={inputClass}
              value={data.watchPath}
              onChange={(e) => update(nodeId, { watchPath: e.target.value })}
              placeholder="./inbox"
            />
          </Field>
          <Field label="Glob filter" tooltip="Glob applied to changed paths. Empty matches everything. Use ** to cross directories.">
            <input
              className={inputClass}
              value={data.watchGlob}
              onChange={(e) => update(nodeId, { watchGlob: e.target.value })}
              placeholder="**/*.json"
            />
          </Field>
          <Field label="Events" tooltip="Which filesystem events fire the trigger.">
            <div className="flex flex-wrap gap-3">
              {FILE_EVENTS.map((ev) => (
                <label key={ev} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={data.watchEvents.includes(ev)}
                    onChange={() => toggleFileEvent(ev)}
                    className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
                  />
                  <span className="text-xs text-slate-300">{ev}</span>
                </label>
              ))}
            </div>
          </Field>
        </>
      )}

      {data.source === 'queue' && (
        <>
          <Field label="Queue target" tooltip="Queue, stream, or topic to subscribe to (e.g. an SQS URL or Redis stream key).">
            <input
              className={inputClass}
              value={data.queueTarget}
              onChange={(e) => update(nodeId, { queueTarget: e.target.value })}
              placeholder="redis://stream/agent-jobs"
            />
          </Field>
          <Field label="Connection env var" tooltip="Env var holding the queue connection string / credentials.">
            <input
              className={inputClass}
              value={data.queueConnectionEnvVar}
              onChange={(e) => update(nodeId, { queueConnectionEnvVar: e.target.value })}
              placeholder="QUEUE_URL"
            />
          </Field>
        </>
      )}

      {data.source === 'emailInbound' && (
        <Field label="Inbound address" tooltip="Address or mailbox the trigger listens on.">
          <input
            className={inputClass}
            value={data.emailAddress}
            onChange={(e) => update(nodeId, { emailAddress: e.target.value })}
            placeholder="agent@inbound.example.com"
          />
        </Field>
      )}

      {/* --- Common gating --- */}
      <Field
        label="Filter"
        tooltip='Optional boolean filter over the event payload, e.g. event.action == "opened". Empty fires on every event.'
      >
        <input
          className={inputClass}
          value={data.filter}
          onChange={(e) => update(nodeId, { filter: e.target.value })}
          placeholder='event.action == "opened"'
        />
      </Field>

      <Field
        label="Debounce (ms)"
        tooltip="Coalesce a burst of events within this window into one run. 0 disables debouncing."
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
        label="Max concurrent"
        tooltip="Max runs this trigger may have in flight at once. Further events queue."
      >
        <input
          type="number"
          min={1}
          className={inputClass}
          value={data.maxConcurrent}
          onChange={(e) =>
            update(nodeId, { maxConcurrent: Math.max(1, Math.floor(Number(e.target.value) || 1)) })
          }
        />
      </Field>

      <Field label="Session mode" tooltip="Whether each run reuses the agent's persistent session or a fresh ephemeral one.">
        <select
          className={selectClass}
          value={data.sessionMode}
          onChange={(e) =>
            update(nodeId, { sessionMode: e.target.value as 'persistent' | 'ephemeral' })
          }
        >
          <option value="ephemeral">Ephemeral (fresh session per event)</option>
          <option value="persistent">Persistent (shared agent session)</option>
        </select>
      </Field>

      <Field label="Retention (days)" tooltip="How long to keep run records produced by this trigger.">
        <input
          type="number"
          min={0}
          className={inputClass}
          value={data.retentionDays}
          onChange={(e) =>
            update(nodeId, { retentionDays: Math.max(0, Math.floor(Number(e.target.value) || 0)) })
          }
        />
      </Field>
    </div>
  );
}
