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
  { id: 'both', label: 'Both (publish card + delegate)' },
  { id: 'server', label: 'Server (publish agent card)' },
  { id: 'client', label: 'Client (delegate to remotes)' },
];

const AUTH_SCHEMES: { id: A2AAuthScheme; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'bearer', label: 'Bearer token' },
  { id: 'apiKey', label: 'API key' },
  { id: 'oauth2', label: 'OAuth 2.0' },
];

interface Props {
  nodeId: string;
  data: A2ANodeData;
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
      url: '',
      authScheme: 'bearer',
      authValue: '',
    };
    update(nodeId, { remoteAgents: [...data.remoteAgents, next] });
  };

  const removeRemote = (index: number) => {
    update(nodeId, {
      remoteAgents: data.remoteAgents.filter((_, i) => i !== index),
    });
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
        tooltip="When off, the node is wired into the graph but neither the agent card nor any delegate is active."
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
        tooltip="Whether this agent publishes an agent card (server), delegates to remote agents (client), or both."
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
            Published agent card
          </div>

          <Field
            label="Agent name"
            tooltip="The card's name field. Empty falls back to the connected agent's name."
          >
            <input
              className={inputClass}
              value={data.agentName}
              onChange={(e) => update(nodeId, { agentName: e.target.value })}
              placeholder="(agent's name)"
            />
          </Field>

          <Field
            label="Description"
            tooltip="The card's description — how other agents decide whether to delegate to this one."
          >
            <textarea
              className={textareaClass}
              rows={3}
              value={data.agentDescription}
              onChange={(e) => update(nodeId, { agentDescription: e.target.value })}
              placeholder="What this agent does and when to call it."
            />
          </Field>

          <Field label="Version" tooltip="Semver advertised in the agent card.">
            <input
              className={inputClass}
              value={data.agentVersion}
              onChange={(e) => update(nodeId, { agentVersion: e.target.value })}
              placeholder="1.0.0"
            />
          </Field>

          <Field
            label="Public URL"
            tooltip="Base URL other agents reach this one at. Empty = derived from the server host."
          >
            <input
              className={inputClass}
              value={data.publicUrl}
              onChange={(e) => update(nodeId, { publicUrl: e.target.value })}
              placeholder="https://my-agent.example.com"
            />
          </Field>

          <Field
            label="Advertised skills"
            tooltip="Comma-separated skill ids/names surfaced in the card's skills[] array."
          >
            <input
              className={inputClass}
              value={data.advertisedSkills.join(', ')}
              onChange={(e) =>
                update(nodeId, {
                  advertisedSkills: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              placeholder="summarize, research, code-review"
            />
          </Field>

          <Field
            label="Streaming"
            tooltip="Advertise incremental streaming task updates (capabilities.streaming) on the card."
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
            label="Inbound auth"
            tooltip="Authentication scheme required of remote agents that call this one."
          >
            <select
              className={selectClass}
              value={data.inboundAuthScheme}
              onChange={(e) =>
                update(nodeId, {
                  inboundAuthScheme: e.target.value as A2AAuthScheme,
                })
              }
            >
              {AUTH_SCHEMES.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}

      {isClient && (
        <>
          <div className="mt-3 mb-1 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Remote agents ({data.remoteAgents.length})
            </span>
            <button
              onClick={addRemote}
              className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-700"
            >
              <Plus size={12} /> Add
            </button>
          </div>

          {data.remoteAgents.map((remote, i) => (
            <div
              key={remote.id}
              className="mb-2 rounded-md border border-slate-700 bg-slate-800/40 p-2"
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] text-slate-500">#{i + 1}</span>
                <button
                  onClick={() => removeRemote(i)}
                  className="text-slate-500 hover:text-red-400"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <input
                className={`${inputClass} mb-1`}
                value={remote.name}
                onChange={(e) => updateRemote(i, { name: e.target.value })}
                placeholder="Name (delegate tool suffix)"
              />
              <input
                className={`${inputClass} mb-1`}
                value={remote.url}
                onChange={(e) => updateRemote(i, { url: e.target.value })}
                placeholder="https://remote-agent.example.com"
              />
              <div className="flex gap-1">
                <select
                  className={selectClass}
                  value={remote.authScheme}
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
                  className={inputClass}
                  value={remote.authValue}
                  onChange={(e) => updateRemote(i, { authValue: e.target.value })}
                  placeholder="ENV_VAR or token"
                  disabled={remote.authScheme === 'none'}
                />
              </div>
            </div>
          ))}

          <Field
            label="Expose as tools"
            tooltip="Register each remote agent as a callable delegate tool the model can invoke."
          >
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={data.exposeAsTools}
                onChange={(e) => update(nodeId, { exposeAsTools: e.target.checked })}
                className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
              />
              <span className="text-xs text-slate-300">Callable delegate tools</span>
            </label>
          </Field>

          <Field
            label="Task timeout (ms)"
            tooltip="How long to wait for a delegated task to complete before giving up."
          >
            <input
              type="number"
              min={0}
              step={1000}
              className={inputClass}
              value={data.taskTimeoutMs}
              onChange={(e) =>
                update(nodeId, {
                  taskTimeoutMs: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                })
              }
            />
          </Field>

          <Field
            label="Max delegations / run"
            tooltip="Loop and cost guard: how many tasks may be delegated within a single run. 0 disables the ceiling."
          >
            <input
              type="number"
              min={0}
              className={inputClass}
              value={data.maxDelegationsPerRun}
              onChange={(e) =>
                update(nodeId, {
                  maxDelegationsPerRun: Math.max(
                    0,
                    Math.floor(Number(e.target.value) || 0),
                  ),
                })
              }
            />
          </Field>
        </>
      )}
    </div>
  );
}
