import { nanoid } from 'nanoid';
import { Plus, Trash2 } from 'lucide-react';
import { useGraphStore } from '../../store/graph-store';
import type {
  A2ANodeData,
  A2ARole,
  A2ATransport,
  A2AAuthScheme,
  A2ARemoteAgent,
  A2ASkillAdvertisement,
} from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const ROLES: { id: A2ARole; label: string }[] = [
  { id: 'client', label: 'Client (call remote agents)' },
  { id: 'server', label: 'Server (expose this agent)' },
  { id: 'both', label: 'Both' },
];

const TRANSPORTS: { id: A2ATransport; label: string }[] = [
  { id: 'jsonrpc', label: 'JSON-RPC 2.0' },
  { id: 'grpc', label: 'gRPC' },
  { id: 'rest', label: 'REST / HTTP+JSON' },
];

const AUTH_SCHEMES: { id: A2AAuthScheme; label: string }[] = [
  { id: 'none', label: 'None' },
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

  const showServer = data.role === 'server' || data.role === 'both';
  const showClient = data.role === 'client' || data.role === 'both';

  // --- Remote agents (client) ---
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
      endpoint: '',
      authScheme: 'none',
      credentialEnvVar: '',
      enabled: true,
    };
    update(nodeId, { remoteAgents: [...data.remoteAgents, next] });
  };
  const removeRemote = (index: number) => {
    update(nodeId, { remoteAgents: data.remoteAgents.filter((_, i) => i !== index) });
  };

  // --- Advertised skills (server) ---
  const updateSkill = (index: number, patch: Partial<A2ASkillAdvertisement>) => {
    const skills = data.skills.map((s, i) => (i === index ? { ...s, ...patch } : s));
    update(nodeId, { skills });
  };
  const addSkill = () => {
    const next: A2ASkillAdvertisement = {
      id: nanoid(6),
      name: '',
      description: '',
      tags: [],
    };
    update(nodeId, { skills: [...data.skills, next] });
  };
  const removeSkill = (index: number) => {
    update(nodeId, { skills: data.skills.filter((_, i) => i !== index) });
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
        label="Role"
        tooltip="Whether this node exposes the agent as an A2A server, registers remote A2A agents as callable delegates, or both."
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

      {/* --- Server side --- */}
      {showServer && (
        <>
          <div className="mt-4 mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Server — expose this agent
          </div>

          <Field
            label="Server enabled"
            tooltip="Publish the agent card and accept inbound remote tasks. When off, the server side is configured but not served."
          >
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={data.serverEnabled}
                onChange={(e) => update(nodeId, { serverEnabled: e.target.checked })}
                className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
              />
              <span className="text-xs text-slate-300">Serve an A2A endpoint + agent card</span>
            </label>
          </Field>

          <Field label="Agent name" tooltip="Name advertised in the agent card. Empty falls back to the agent's own name.">
            <input
              className={inputClass}
              value={data.agentName}
              onChange={(e) => update(nodeId, { agentName: e.target.value })}
              placeholder="(agent's name)"
            />
          </Field>

          <Field label="Agent description" tooltip="Human-readable description advertised in the agent card.">
            <textarea
              className={textareaClass}
              rows={2}
              value={data.agentDescription}
              onChange={(e) => update(nodeId, { agentDescription: e.target.value })}
            />
          </Field>

          <div className="flex gap-2">
            <Field label="Version" tooltip="Version string advertised in the agent card.">
              <input
                className={inputClass}
                value={data.agentVersion}
                onChange={(e) => update(nodeId, { agentVersion: e.target.value })}
                placeholder="1.0.0"
              />
            </Field>
            <Field label="Transport" tooltip="Wire protocol the endpoint speaks.">
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
          </div>

          <Field label="Public URL" tooltip="Base URL other agents reach this server at. Advertised in the agent card.">
            <input
              className={inputClass}
              value={data.publicUrl}
              onChange={(e) => update(nodeId, { publicUrl: e.target.value })}
              placeholder="https://my-agent.example.com"
            />
          </Field>

          <Field label="Card path" tooltip="Path the agent card JSON is served from.">
            <input
              className={inputClass}
              value={data.cardPath}
              onChange={(e) => update(nodeId, { cardPath: e.target.value })}
              placeholder="/.well-known/agent-card.json"
            />
          </Field>

          <div className="flex gap-4">
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

          <div className="flex gap-2">
            <Field label="Auth scheme" tooltip="How inbound tasks authenticate to this server.">
              <select
                className={selectClass}
                value={data.serverAuthScheme}
                onChange={(e) =>
                  update(nodeId, { serverAuthScheme: e.target.value as A2AAuthScheme })
                }
              >
                {AUTH_SCHEMES.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </Field>
            {data.serverAuthScheme !== 'none' && (
              <Field label="Credential env var" tooltip="Env var holding the token/key that authenticates inbound tasks.">
                <input
                  className={inputClass}
                  value={data.serverCredentialEnvVar}
                  onChange={(e) => update(nodeId, { serverCredentialEnvVar: e.target.value })}
                  placeholder="A2A_SERVER_TOKEN"
                />
              </Field>
            )}
          </div>

          <div className="mb-2 mt-3 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Advertised skills ({data.skills.length})
            </span>
            <button
              onClick={addSkill}
              className="flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
            >
              <Plus size={12} /> Add skill
            </button>
          </div>
          <div className="space-y-3">
            {data.skills.map((s, i) => (
              <div key={s.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-[10px] text-slate-500">{s.id}</span>
                  <button
                    onClick={() => removeSkill(i)}
                    className="rounded p-1 text-slate-500 transition hover:bg-red-500/10 hover:text-red-400"
                    title="Remove skill"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <input
                  className={`${inputClass} mb-2`}
                  placeholder="Skill name"
                  value={s.name}
                  onChange={(e) => updateSkill(i, { name: e.target.value })}
                />
                <textarea
                  className={`${textareaClass} mb-2`}
                  rows={2}
                  placeholder="What this skill does"
                  value={s.description}
                  onChange={(e) => updateSkill(i, { description: e.target.value })}
                />
                <input
                  className={inputClass}
                  placeholder="Tags (comma-separated)"
                  value={s.tags.join(', ')}
                  onChange={(e) =>
                    updateSkill(i, {
                      tags: e.target.value
                        .split(',')
                        .map((t) => t.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </div>
            ))}
          </div>
        </>
      )}

      {/* --- Client side --- */}
      {showClient && (
        <>
          <div className="mt-4 mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Client — call remote agents
          </div>

          <Field
            label="Task timeout (ms)"
            tooltip="Wall-clock ceiling for a single delegated remote task."
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

          <div className="mb-2 mt-3 flex items-center justify-between">
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
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      onChange={(e) => updateRemote(i, { enabled: e.target.checked })}
                      className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
                    />
                    <span className="text-[11px] text-slate-400">Enabled</span>
                  </label>
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
                  placeholder="Name (derives tool a2a_<name>)"
                  value={r.name}
                  onChange={(e) => updateRemote(i, { name: e.target.value })}
                />
                <input
                  className={`${inputClass} mb-2`}
                  placeholder="Agent card URL (…/.well-known/agent-card.json)"
                  value={r.cardUrl}
                  onChange={(e) => updateRemote(i, { cardUrl: e.target.value })}
                />
                <input
                  className={`${inputClass} mb-2`}
                  placeholder="Endpoint override (optional)"
                  value={r.endpoint}
                  onChange={(e) => updateRemote(i, { endpoint: e.target.value })}
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
                  {r.authScheme !== 'none' && (
                    <input
                      className={inputClass}
                      placeholder="Credential env var"
                      value={r.credentialEnvVar}
                      onChange={(e) => updateRemote(i, { credentialEnvVar: e.target.value })}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
