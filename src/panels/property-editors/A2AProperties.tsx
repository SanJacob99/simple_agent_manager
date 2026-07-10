import { nanoid } from 'nanoid';
import { Plus, Trash2 } from 'lucide-react';
import { useGraphStore } from '../../store/graph-store';
import type {
  A2ANodeData,
  A2ARemoteAgent,
  A2AAuthScheme,
  A2ATransport,
} from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const TRANSPORTS: { id: A2ATransport; label: string }[] = [
  { id: 'jsonrpc', label: 'JSON-RPC 2.0' },
  { id: 'grpc', label: 'gRPC' },
  { id: 'rest', label: 'HTTP+JSON / REST' },
];

const AUTH_SCHEMES: { id: A2AAuthScheme; label: string }[] = [
  { id: 'none', label: 'None (open)' },
  { id: 'apiKey', label: 'API key' },
  { id: 'bearer', label: 'Bearer token' },
  { id: 'oauth2', label: 'OAuth 2.0' },
];

interface Props {
  nodeId: string;
  data: A2ANodeData;
}

/** Comma / newline separated content-type list ↔ string[] helpers. */
function joinModes(modes: string[]): string {
  return modes.join(', ');
}
function splitModes(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((m) => m.trim())
    .filter(Boolean);
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
      enabled: true,
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
        tooltip="When off, the node is wired into the graph but neither the A2A server nor the remote delegates are active."
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

      {/* --- Server exposure --- */}
      <div className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Server
      </div>

      <Field
        label="Expose as A2A server"
        tooltip="Publish an agent card and accept inbound A2A tasks so other frameworks can call this agent."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.exposeAsServer}
            onChange={(e) => update(nodeId, { exposeAsServer: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Publish an agent card</span>
        </label>
      </Field>

      {data.exposeAsServer && (
        <>
          <Field
            label="Agent name"
            tooltip="Name advertised on the agent card. Empty falls back to the agent's own name."
          >
            <input
              className={inputClass}
              value={data.agentName}
              onChange={(e) => update(nodeId, { agentName: e.target.value })}
              placeholder="(agent's name)"
            />
          </Field>

          <Field label="Description" tooltip="Card description shown to remote callers discovering this agent.">
            <textarea
              className={textareaClass}
              rows={2}
              value={data.agentDescription}
              onChange={(e) => update(nodeId, { agentDescription: e.target.value })}
              placeholder="What this agent does, for remote callers."
            />
          </Field>

          <Field label="Version" tooltip="The agent's own version string on the card (not the A2A protocol version).">
            <input
              className={inputClass}
              value={data.version}
              onChange={(e) => update(nodeId, { version: e.target.value })}
              placeholder="0.1.0"
            />
          </Field>

          <Field label="Server URL" tooltip="Base URL the card advertises for the A2A endpoint.">
            <input
              className={inputClass}
              value={data.serverUrl}
              onChange={(e) => update(nodeId, { serverUrl: e.target.value })}
              placeholder="http://localhost:3001/a2a"
            />
          </Field>

          <Field label="Transport" tooltip="Wire transport the A2A endpoint speaks.">
            <select
              className={selectClass}
              value={data.transport}
              onChange={(e) => update(nodeId, { transport: e.target.value as A2ATransport })}
            >
              {TRANSPORTS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Streaming"
            tooltip="Advertise SSE streaming (message/stream, tasks/resubscribe) on the card capabilities."
          >
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={data.streaming}
                onChange={(e) => update(nodeId, { streaming: e.target.checked })}
                className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
              />
              <span className="text-xs text-slate-300">Advertise streaming updates</span>
            </label>
          </Field>

          <Field
            label="Push notifications"
            tooltip="Advertise webhook-based task update notifications on the card capabilities."
          >
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={data.pushNotifications}
                onChange={(e) => update(nodeId, { pushNotifications: e.target.checked })}
                className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
              />
              <span className="text-xs text-slate-300">Advertise push notifications</span>
            </label>
          </Field>

          <Field label="Auth scheme" tooltip="Security scheme the card advertises for inbound calls.">
            <select
              className={selectClass}
              value={data.authScheme}
              onChange={(e) => update(nodeId, { authScheme: e.target.value as A2AAuthScheme })}
            >
              {AUTH_SCHEMES.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Input modes"
            tooltip="Accepted inbound content types (card defaultInputModes), comma-separated."
          >
            <input
              className={inputClass}
              value={joinModes(data.defaultInputModes)}
              onChange={(e) => update(nodeId, { defaultInputModes: splitModes(e.target.value) })}
              placeholder="text/plain, application/json"
            />
          </Field>

          <Field
            label="Output modes"
            tooltip="Produced outbound content types (card defaultOutputModes), comma-separated."
          >
            <input
              className={inputClass}
              value={joinModes(data.defaultOutputModes)}
              onChange={(e) => update(nodeId, { defaultOutputModes: splitModes(e.target.value) })}
              placeholder="text/plain, application/json"
            />
          </Field>
        </>
      )}

      {/* --- Remote delegates --- */}
      <div className="mb-2 mt-4 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Remote agents ({data.remoteAgents.length})
        </span>
        <button
          onClick={addRemote}
          className="flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
        >
          <Plus size={12} /> Add agent
        </button>
      </div>

      <div className="space-y-3">
        {data.remoteAgents.map((r, i) => (
          <div key={r.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
            <div className="mb-2 flex items-center justify-between">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={(e) => updateRemote(i, { enabled: e.target.checked })}
                  className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
                />
                <span className="font-mono text-[10px] text-slate-500">{r.id}</span>
              </label>
              <button
                onClick={() => removeRemote(i)}
                className="rounded p-1 text-slate-500 transition hover:bg-red-500/10 hover:text-red-400"
                title="Remove agent"
              >
                <Trash2 size={12} />
              </button>
            </div>
            <input
              className={`${inputClass} mb-2`}
              placeholder="Name"
              value={r.name}
              onChange={(e) => updateRemote(i, { name: e.target.value })}
            />
            <input
              className={inputClass}
              placeholder="https://host/.well-known/agent-card.json"
              value={r.cardUrl}
              onChange={(e) => updateRemote(i, { cardUrl: e.target.value })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
