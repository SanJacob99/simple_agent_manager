import { nanoid } from 'nanoid';
import { Plus, Trash2 } from 'lucide-react';
import { useGraphStore } from '../../store/graph-store';
import type {
  A2ANodeData,
  A2ARole,
  A2ATransport,
  A2AAuthScheme,
  A2ARemoteAgent,
} from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const ROLES: { id: A2ARole; label: string }[] = [
  { id: 'server', label: 'Server (publish this agent)' },
  { id: 'client', label: 'Client (call remote agents)' },
  { id: 'both', label: 'Both (publish + delegate)' },
];

const TRANSPORTS: { id: A2ATransport; label: string }[] = [
  { id: 'jsonrpc', label: 'JSON-RPC 2.0' },
  { id: 'grpc', label: 'gRPC' },
  { id: 'rest', label: 'REST (HTTP+JSON)' },
];

const AUTH_SCHEMES: { id: A2AAuthScheme; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'apiKey', label: 'API key (header)' },
  { id: 'bearer', label: 'Bearer token' },
  { id: 'oauth2', label: 'OAuth 2.0' },
];

interface Props {
  nodeId: string;
  data: A2ANodeData;
}

/** Edit a comma-separated MIME-mode list as an array. */
function ModeList({
  label,
  tooltip,
  value,
  onChange,
}: {
  label: string;
  tooltip: string;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <Field label={label} tooltip={tooltip}>
      <input
        className={inputClass}
        value={value.join(', ')}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(',')
              .map((m) => m.trim())
              .filter(Boolean),
          )
        }
        placeholder="text/plain"
      />
    </Field>
  );
}

export default function A2AProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);

  const isServer = data.role !== 'client';
  const isClient = data.role !== 'server';

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
      transport: data.transport,
      enabledAsTool: true,
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
        tooltip="When off, the node is wired into the graph but no A2A surface is served and no remote delegates are exposed."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => update(nodeId, { enabled: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Serve / consume A2A interop</span>
        </label>
      </Field>

      <Field
        label="Role"
        tooltip="Whether this agent is exposed to remote A2A clients, calls remote A2A agents, or both."
      >
        <select
          className={selectClass}
          value={data.role}
          onChange={(e) => update(nodeId, { role: e.target.value as A2ARole })}
        >
          {ROLES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Transport" tooltip="Default transport binding advertised / used for A2A traffic.">
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

      <Field label="Protocol version" tooltip="A2A protocol version advertised / negotiated.">
        <input
          className={inputClass}
          value={data.protocolVersion}
          onChange={(e) => update(nodeId, { protocolVersion: e.target.value })}
          placeholder="0.3.0"
        />
      </Field>

      {isServer && (
        <>
          <div className="mt-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Server — Agent Card
          </div>

          <Field
            label="Expose Agent Card"
            tooltip="Publish this agent's Agent Card at the well-known path so remote clients can discover it."
          >
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={data.exposeAgentCard}
                onChange={(e) => update(nodeId, { exposeAgentCard: e.target.checked })}
                className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
              />
              <span className="text-xs text-slate-300">Serve the Agent Card</span>
            </label>
          </Field>

          <Field label="Card name" tooltip="Name advertised on the card. Empty falls back to the agent's own name.">
            <input
              className={inputClass}
              value={data.cardName}
              onChange={(e) => update(nodeId, { cardName: e.target.value })}
              placeholder="(agent's name)"
            />
          </Field>

          <Field label="Card description" tooltip="Description advertised on the card for discovery.">
            <textarea
              className={textareaClass}
              rows={2}
              value={data.cardDescription}
              onChange={(e) => update(nodeId, { cardDescription: e.target.value })}
            />
          </Field>

          <Field label="Public URL" tooltip="Public base URL the agent is reachable at (origin of the card `url`).">
            <input
              className={inputClass}
              value={data.serverUrl}
              onChange={(e) => update(nodeId, { serverUrl: e.target.value })}
              placeholder="https://agent.example.com"
            />
          </Field>

          <Field label="Well-known path" tooltip="Path the Agent Card is served from.">
            <input
              className={inputClass}
              value={data.wellKnownPath}
              onChange={(e) => update(nodeId, { wellKnownPath: e.target.value })}
              placeholder="/.well-known/agent-card.json"
            />
          </Field>

          <Field label="Streaming" tooltip="Advertise Server-Sent-Events streaming (message/stream) capability.">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={data.streaming}
                onChange={(e) => update(nodeId, { streaming: e.target.checked })}
                className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
              />
              <span className="text-xs text-slate-300">Advertise SSE streaming</span>
            </label>
          </Field>

          <Field
            label="Push notifications"
            tooltip="Advertise push-notification (webhook) capability for task updates."
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

          <Field label="Auth scheme" tooltip="Security scheme advertised on the card.">
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

          <ModeList
            label="Input modes"
            tooltip="Comma-separated default input MIME modes advertised on the card."
            value={data.inputModes}
            onChange={(inputModes) => update(nodeId, { inputModes })}
          />
          <ModeList
            label="Output modes"
            tooltip="Comma-separated default output MIME modes advertised on the card."
            value={data.outputModes}
            onChange={(outputModes) => update(nodeId, { outputModes })}
          />
        </>
      )}

      {isClient && (
        <>
          <div className="mt-3 mb-1 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Client — Remote Agents
            </span>
            <button
              type="button"
              onClick={addRemote}
              className="flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-800"
            >
              <Plus size={12} /> Add
            </button>
          </div>

          {data.remoteAgents.length === 0 && (
            <p className="text-[11px] text-slate-500">
              No remote agents registered. Add one to expose it as a callable delegate tool.
            </p>
          )}

          {data.remoteAgents.map((remote, i) => (
            <div key={remote.id} className="mb-3 rounded-md border border-slate-700 p-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-slate-500">
                  Agent {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removeRemote(i)}
                  className="text-slate-500 hover:text-red-400"
                  aria-label="Remove remote agent"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <input
                className={`${inputClass} mb-1`}
                value={remote.name}
                onChange={(e) => updateRemote(i, { name: e.target.value })}
                placeholder="Name (e.g. Weather Bot)"
              />
              <input
                className={`${inputClass} mb-1`}
                value={remote.cardUrl}
                onChange={(e) => updateRemote(i, { cardUrl: e.target.value })}
                placeholder="https://remote.dev/.well-known/agent-card.json"
              />
              <select
                className={`${selectClass} mb-1`}
                value={remote.transport}
                onChange={(e) => updateRemote(i, { transport: e.target.value as A2ATransport })}
              >
                {TRANSPORTS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={remote.enabledAsTool}
                  onChange={(e) => updateRemote(i, { enabledAsTool: e.target.checked })}
                  className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
                />
                <span className="text-xs text-slate-300">Expose as delegate tool</span>
              </label>
            </div>
          ))}

          <Field
            label="Task timeout (s)"
            tooltip="Per-task timeout in seconds when delegating to a remote agent."
          >
            <input
              type="number"
              min={1}
              step={1}
              className={inputClass}
              value={data.taskTimeoutSec}
              onChange={(e) =>
                update(nodeId, { taskTimeoutSec: Math.max(1, Number(e.target.value) || 1) })
              }
            />
          </Field>
        </>
      )}
    </div>
  );
}
