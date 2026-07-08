import { nanoid } from 'nanoid';
import { Plus, Trash2 } from 'lucide-react';
import { useGraphStore } from '../../store/graph-store';
import type {
  A2ANodeData,
  A2ARemoteAgent,
  A2AAuthScheme,
} from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const AUTH_SCHEMES: { id: A2AAuthScheme; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'bearer', label: 'Bearer token' },
  { id: 'apiKey', label: 'API key header' },
];

interface Props {
  nodeId: string;
  data: A2ANodeData;
}

export default function A2AProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);

  const updateRemote = (index: number, patch: Partial<A2ARemoteAgent>) => {
    const remoteAgents = data.remoteAgents.map((r, i) =>
      i === index ? { ...r, ...patch } : r,
    );
    update(nodeId, { remoteAgents });
  };

  const addRemote = () => {
    const next: A2ARemoteAgent = {
      id: nanoid(6),
      name: '',
      cardUrl: '',
      authScheme: 'none',
      authToken: '',
    };
    update(nodeId, { remoteAgents: [...data.remoteAgents, next] });
  };

  const removeRemote = (index: number) => {
    update(nodeId, { remoteAgents: data.remoteAgents.filter((_, i) => i !== index) });
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
        tooltip="When off, the node is wired into the graph but neither the A2A server nor the delegate tool is active."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => update(nodeId, { enabled: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Enable A2A interop</span>
        </label>
      </Field>

      <div className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Server — expose this agent
      </div>

      <Field
        label="Expose A2A server"
        tooltip="Publish an agent card and accept inbound A2A tasks so other frameworks can call this agent."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.exposeServer}
            onChange={(e) => update(nodeId, { exposeServer: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Serve an agent card + task endpoint</span>
        </label>
      </Field>

      {data.exposeServer && (
        <>
          <Field
            label="Card name"
            tooltip="Name advertised in this agent's published card. Empty falls back to the agent's name."
          >
            <input
              className={inputClass}
              value={data.agentName}
              onChange={(e) => update(nodeId, { agentName: e.target.value })}
              placeholder="(agent's name)"
            />
          </Field>

          <Field
            label="Card description"
            tooltip="Description advertised in the card. Empty falls back to the agent's description."
          >
            <textarea
              className={textareaClass}
              rows={2}
              value={data.agentDescription}
              onChange={(e) => update(nodeId, { agentDescription: e.target.value })}
              placeholder="(agent's description)"
            />
          </Field>

          <Field
            label="Server path"
            tooltip="Mount path for the A2A endpoint on the local server (the agent card is served at <path>/.well-known/agent-card.json)."
          >
            <input
              className={inputClass}
              value={data.serverPath}
              onChange={(e) => update(nodeId, { serverPath: e.target.value })}
              placeholder="/a2a"
            />
          </Field>

          <Field
            label="Advertise streaming"
            tooltip="Advertise capabilities.streaming (SSE message/stream) in the agent card."
          >
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={data.advertiseStreaming}
                onChange={(e) => update(nodeId, { advertiseStreaming: e.target.checked })}
                className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
              />
              <span className="text-xs text-slate-300">capabilities.streaming</span>
            </label>
          </Field>

          <Field
            label="Advertise push notifications"
            tooltip="Advertise capabilities.pushNotifications in the agent card."
          >
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={data.advertisePushNotifications}
                onChange={(e) =>
                  update(nodeId, { advertisePushNotifications: e.target.checked })
                }
                className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
              />
              <span className="text-xs text-slate-300">capabilities.pushNotifications</span>
            </label>
          </Field>

          <Field
            label="Server auth"
            tooltip="Auth scheme remote clients must satisfy to reach the exposed server."
          >
            <select
              className={selectClass}
              value={data.serverAuthScheme}
              onChange={(e) =>
                update(nodeId, { serverAuthScheme: e.target.value as A2AAuthScheme })
              }
            >
              {AUTH_SCHEMES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}

      <div className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Client — delegate to remote agents
      </div>

      <Field
        label="Expose delegate tool"
        tooltip="Expose a delegate_to_agent tool the agent can call to hand a task to one of the registered remote agents."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.exposeDelegateTool}
            onChange={(e) => update(nodeId, { exposeDelegateTool: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Add delegate_to_agent tool</span>
        </label>
      </Field>

      <Field
        label="Max delegation depth"
        tooltip="How many nested delegation hops are allowed before a delegate call is refused. Loop control."
      >
        <input
          type="number"
          min={0}
          max={10}
          className={inputClass}
          value={data.maxDelegationDepth}
          onChange={(e) =>
            update(nodeId, {
              maxDelegationDepth: Math.max(0, Math.floor(Number(e.target.value) || 0)),
            })
          }
        />
      </Field>

      <Field
        label="Task timeout (ms)"
        tooltip="How long to wait for a remote task to complete before giving up."
      >
        <input
          type="number"
          min={1000}
          step={1000}
          className={inputClass}
          value={data.taskTimeoutMs}
          onChange={(e) =>
            update(nodeId, {
              taskTimeoutMs: Math.max(1000, Math.floor(Number(e.target.value) || 1000)),
            })
          }
        />
      </Field>

      <div className="mb-2 mt-4 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Remote agents ({data.remoteAgents.length})
        </span>
        <button
          onClick={addRemote}
          className="flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
        >
          <Plus size={12} /> Add remote
        </button>
      </div>

      <div className="space-y-3">
        {data.remoteAgents.map((r, i) => (
          <div key={r.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[10px] text-slate-500">{r.id}</span>
              <button
                onClick={() => removeRemote(i)}
                className="rounded p-1 text-slate-500 transition hover:bg-red-500/10 hover:text-red-400"
                title="Remove remote agent"
              >
                <Trash2 size={12} />
              </button>
            </div>
            <input
              className={`${inputClass} mb-2`}
              placeholder="Display name"
              value={r.name}
              onChange={(e) => updateRemote(i, { name: e.target.value })}
            />
            <input
              className={`${inputClass} mb-2`}
              placeholder="Agent card URL (…/.well-known/agent-card.json)"
              value={r.cardUrl}
              onChange={(e) => updateRemote(i, { cardUrl: e.target.value })}
            />
            <div className="flex gap-2">
              <select
                className={selectClass}
                value={r.authScheme}
                onChange={(e) =>
                  updateRemote(i, { authScheme: e.target.value as A2AAuthScheme })
                }
              >
                {AUTH_SCHEMES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              {r.authScheme !== 'none' && (
                <input
                  className={`${inputClass} flex-1`}
                  placeholder="Token env var"
                  title="Environment variable holding the token/key"
                  value={r.authToken}
                  onChange={(e) => updateRemote(i, { authToken: e.target.value })}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
