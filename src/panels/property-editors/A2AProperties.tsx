import { nanoid } from 'nanoid';
import { Plus, Trash2 } from 'lucide-react';
import { useGraphStore } from '../../store/graph-store';
import type {
  A2ANodeData,
  A2ARemoteAgent,
  A2ARole,
  A2AAuthScheme,
} from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const ROLES: { id: A2ARole; label: string }[] = [
  { id: 'server', label: 'Server (expose this agent)' },
  { id: 'client', label: 'Client (call remote agents)' },
  { id: 'both', label: 'Both' },
];

const AUTH_SCHEMES: { id: A2AAuthScheme; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'bearer', label: 'Bearer token' },
  { id: 'apiKey', label: 'API key' },
  { id: 'oauth2', label: 'OAuth2' },
];

interface Props {
  nodeId: string;
  data: A2ANodeData;
}

/** Edit a comma-separated MIME-mode list as a string[]. */
function modesToText(modes: string[]): string {
  return modes.join(', ');
}
function textToModes(text: string): string[] {
  return text
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
}

export default function A2AProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);

  const isServer = data.role === 'server' || data.role === 'both';
  const isClient = data.role === 'client' || data.role === 'both';

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
      authValue: '',
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
        tooltip="When off, the node is wired into the graph but nothing is served or called."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => update(nodeId, { enabled: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Participate in A2A interop</span>
        </label>
      </Field>

      <Field
        label="Role"
        tooltip="Whether this node serves this agent as an A2A endpoint, registers remote agents as delegates, or both."
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

      {isServer && (
        <>
          <div className="mt-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Server — published agent card
          </div>

          <Field
            label="Card name"
            tooltip="The `name` field on the published agent card. Leave empty to use the agent's own name."
          >
            <input
              className={inputClass}
              value={data.serverName}
              onChange={(e) => update(nodeId, { serverName: e.target.value })}
              placeholder="(agent's name)"
            />
          </Field>

          <Field
            label="Card description"
            tooltip="Human-readable description advertised on the card so remote clients know what this agent does."
          >
            <textarea
              className={textareaClass}
              rows={2}
              value={data.serverDescription}
              onChange={(e) => update(nodeId, { serverDescription: e.target.value })}
              placeholder="What this agent can do for remote callers."
            />
          </Field>

          <Field
            label="Discovery path"
            tooltip="Path the agent card is served from. The A2A well-known default is /.well-known/agent.json."
          >
            <input
              className={inputClass}
              value={data.discoveryPath}
              onChange={(e) => update(nodeId, { discoveryPath: e.target.value })}
              placeholder="/.well-known/agent.json"
            />
          </Field>

          <Field label="Version" tooltip="Version string advertised on the agent card.">
            <input
              className={inputClass}
              value={data.version}
              onChange={(e) => update(nodeId, { version: e.target.value })}
              placeholder="0.1.0"
            />
          </Field>

          <Field
            label="Capabilities"
            tooltip="Advertised capabilities on the card: incremental streaming and push notifications."
          >
            <div className="space-y-1.5">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={data.streaming}
                  onChange={(e) => update(nodeId, { streaming: e.target.checked })}
                  className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
                />
                <span className="text-xs text-slate-300">Streaming</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={data.pushNotifications}
                  onChange={(e) => update(nodeId, { pushNotifications: e.target.checked })}
                  className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
                />
                <span className="text-xs text-slate-300">Push notifications</span>
              </label>
            </div>
          </Field>

          <Field
            label="Server auth scheme"
            tooltip="Auth remote callers must satisfy to reach this server. Advertised in the card's securitySchemes."
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

          <Field
            label="Default input modes"
            tooltip="Comma-separated MIME types the agent accepts as input (e.g. text/plain, application/json)."
          >
            <input
              className={inputClass}
              value={modesToText(data.defaultInputModes)}
              onChange={(e) => update(nodeId, { defaultInputModes: textToModes(e.target.value) })}
              placeholder="text/plain"
            />
          </Field>

          <Field
            label="Default output modes"
            tooltip="Comma-separated MIME types the agent can produce as output."
          >
            <input
              className={inputClass}
              value={modesToText(data.defaultOutputModes)}
              onChange={(e) => update(nodeId, { defaultOutputModes: textToModes(e.target.value) })}
              placeholder="text/plain"
            />
          </Field>
        </>
      )}

      {isClient && (
        <>
          <div className="mt-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Client — remote delegates
          </div>

          <Field
            label="Expose as tools"
            tooltip="Register each remote agent as an a2a_send_* delegate tool the model can call."
          >
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={data.exposeAsTools}
                onChange={(e) => update(nodeId, { exposeAsTools: e.target.checked })}
                className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
              />
              <span className="text-xs text-slate-300">Delegate tools for remote agents</span>
            </label>
          </Field>

          <Field
            label="Max concurrent tasks"
            tooltip="Ceiling on remote tasks in flight at once across all delegates."
          >
            <input
              type="number"
              min={1}
              max={64}
              className={inputClass}
              value={data.maxConcurrentTasks}
              onChange={(e) =>
                update(nodeId, {
                  maxConcurrentTasks: Math.max(1, Math.floor(Number(e.target.value) || 1)),
                })
              }
            />
          </Field>

          <Field
            label="Task timeout (ms)"
            tooltip="Per-task wall-clock ceiling before a remote delegate call is abandoned."
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

          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Remote agents ({data.remoteAgents.length})
            </span>
            <button
              type="button"
              onClick={addRemote}
              className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-700"
            >
              <Plus size={12} /> Add agent
            </button>
          </div>

          {data.remoteAgents.map((r, i) => (
            <div key={r.id} className="mt-2 rounded-md border border-slate-700 bg-slate-900/50 p-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] text-slate-500">#{i + 1}</span>
                <button
                  type="button"
                  onClick={() => removeRemote(i)}
                  className="text-slate-500 hover:text-red-400"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <input
                className={`${inputClass} mb-1.5`}
                value={r.name}
                onChange={(e) => updateRemote(i, { name: e.target.value })}
                placeholder="Name (basis for the delegate tool name)"
              />
              <input
                className={`${inputClass} mb-1.5`}
                value={r.cardUrl}
                onChange={(e) => updateRemote(i, { cardUrl: e.target.value })}
                placeholder="Card URL or base origin"
              />
              <div className="flex gap-1.5">
                <select
                  className={selectClass}
                  value={r.authScheme}
                  onChange={(e) => updateRemote(i, { authScheme: e.target.value as A2AAuthScheme })}
                >
                  {AUTH_SCHEMES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
                {r.authScheme !== 'none' && (
                  <input
                    className={inputClass}
                    value={r.authValue}
                    onChange={(e) => updateRemote(i, { authValue: e.target.value })}
                    placeholder="Token or env var"
                  />
                )}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
