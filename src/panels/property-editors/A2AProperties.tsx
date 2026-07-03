import { nanoid } from 'nanoid';
import { Plus, Trash2 } from 'lucide-react';
import { useGraphStore } from '../../store/graph-store';
import type {
  A2ANodeData,
  A2ARemoteAgent,
  A2ARole,
  A2ATransport,
  A2AAuthScheme,
} from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const ROLES: { id: A2ARole; label: string }[] = [
  { id: 'server', label: 'Server (expose this agent)' },
  { id: 'client', label: 'Client (call remote agents)' },
  { id: 'both', label: 'Both' },
];

const TRANSPORTS: { id: A2ATransport; label: string }[] = [
  { id: 'jsonrpc', label: 'JSON-RPC 2.0 (HTTP)' },
  { id: 'grpc', label: 'gRPC' },
  { id: 'rest', label: 'HTTP+JSON (REST)' },
];

const AUTH_SCHEMES: { id: A2AAuthScheme; label: string }[] = [
  { id: 'none', label: 'None (trusted network only)' },
  { id: 'apiKey', label: 'API key' },
  { id: 'bearer', label: 'Bearer token' },
  { id: 'oauth2', label: 'OAuth 2.0' },
];

interface Props {
  nodeId: string;
  data: A2ANodeData;
}

export default function A2AProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);

  const serves = data.role === 'server' || data.role === 'both';
  const delegates = data.role === 'client' || data.role === 'both';

  const updateRemote = (index: number, patch: Partial<A2ARemoteAgent>) => {
    const remotes = data.remotes.map((r, i) => (i === index ? { ...r, ...patch } : r));
    update(nodeId, { remotes });
  };

  const addRemote = () => {
    const next: A2ARemoteAgent = {
      id: nanoid(6),
      name: '',
      cardUrl: '',
      authScheme: 'bearer',
      credentialEnvVar: '',
    };
    update(nodeId, { remotes: [...data.remotes, next] });
  };

  const removeRemote = (index: number) => {
    update(nodeId, { remotes: data.remotes.filter((_, i) => i !== index) });
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
        tooltip="When off, the node is wired but no Agent Card is served and no remote is callable."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => update(nodeId, { enabled: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Participate in the A2A protocol</span>
        </label>
      </Field>

      <Field label="Role" tooltip="Which side(s) of the protocol this node activates.">
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

      {serves && (
        <>
          <div className="mb-1 mt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Server — Agent Card
          </div>

          <Field
            label="Agent name"
            tooltip="Name published in the Agent Card. Empty falls back to the agent's own name."
          >
            <input
              className={inputClass}
              value={data.agentName}
              onChange={(e) => update(nodeId, { agentName: e.target.value })}
              placeholder="(agent's name)"
            />
          </Field>

          <Field
            label="Agent description"
            tooltip="Description published in the Agent Card. Empty falls back to the agent's description."
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
            label="Mount path"
            tooltip="Path the A2A server mounts at. The Agent Card is served at <base>/.well-known/agent-card.json."
          >
            <input
              className={inputClass}
              value={data.basePath}
              onChange={(e) => update(nodeId, { basePath: e.target.value })}
              placeholder="/a2a"
            />
          </Field>

          <Field label="Transport" tooltip="Preferred transport advertised in the card.">
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

          <Field label="Server auth" tooltip="Auth scheme the served endpoint requires from callers.">
            <select
              className={selectClass}
              value={data.serverAuth}
              onChange={(e) => update(nodeId, { serverAuth: e.target.value as A2AAuthScheme })}
            >
              {AUTH_SCHEMES.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Publish skills"
            tooltip="Advertise the agent's resolved skills as A2A skills in the card."
          >
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={data.publishSkills}
                onChange={(e) => update(nodeId, { publishSkills: e.target.checked })}
                className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
              />
              <span className="text-xs text-slate-300">List skills in the Agent Card</span>
            </label>
          </Field>

          <Field label="Streaming" tooltip="Advertise SSE message/stream capability.">
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
            tooltip="Advertise tasks/pushNotificationConfig capability for long-running tasks."
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
        </>
      )}

      {delegates && (
        <>
          <Field
            label="Task timeout (ms)"
            tooltip="Max wait for a remote task to reach a terminal state before giving up."
          >
            <input
              type="number"
              min={1000}
              step={1000}
              className={inputClass}
              value={data.taskTimeoutMs}
              onChange={(e) =>
                update(nodeId, { taskTimeoutMs: Math.max(1000, Number(e.target.value) || 1000) })
              }
            />
          </Field>

          <Field
            label="Max concurrent tasks"
            tooltip="How many remote tasks this agent runs at once."
          >
            <input
              type="number"
              min={1}
              step={1}
              className={inputClass}
              value={data.maxConcurrentTasks}
              onChange={(e) =>
                update(nodeId, { maxConcurrentTasks: Math.max(1, Number(e.target.value) || 1) })
              }
            />
          </Field>

          <div className="mb-2 mt-4 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Remote agents ({data.remotes.length})
            </span>
            <button
              onClick={addRemote}
              className="flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
            >
              <Plus size={12} /> Add remote
            </button>
          </div>

          <div className="space-y-3">
            {data.remotes.map((r, i) => (
              <div key={r.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-[10px] text-slate-500">{r.id}</span>
                  <button
                    onClick={() => removeRemote(i)}
                    className="rounded p-1 text-slate-500 transition hover:bg-red-500/10 hover:text-red-400"
                    title="Remove remote"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <input
                  className={`${inputClass} mb-2`}
                  placeholder="Name (optional — falls back to card name)"
                  value={r.name}
                  onChange={(e) => updateRemote(i, { name: e.target.value })}
                />
                <input
                  className={`${inputClass} mb-2`}
                  placeholder="Agent Card URL (e.g. https://host/a2a)"
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
                    {AUTH_SCHEMES.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className={`${inputClass} flex-1`}
                    placeholder="Credential env var"
                    value={r.credentialEnvVar}
                    disabled={r.authScheme === 'none'}
                    onChange={(e) => updateRemote(i, { credentialEnvVar: e.target.value })}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
