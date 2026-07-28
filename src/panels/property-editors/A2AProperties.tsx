import { nanoid } from 'nanoid';
import { Plus, Trash2 } from 'lucide-react';
import { useGraphStore } from '../../store/graph-store';
import type {
  A2ANodeData,
  A2ARole,
  A2ATransport,
  A2AAuthScheme,
  A2ASkillAdvertisement,
  A2ARemoteAgent,
} from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const ROLES: { id: A2ARole; label: string }[] = [
  { id: 'server', label: 'Server (publish an agent card)' },
  { id: 'client', label: 'Client (delegate to remote agents)' },
  { id: 'both', label: 'Both' },
];

const TRANSPORTS: { id: A2ATransport; label: string }[] = [
  { id: 'jsonrpc', label: 'JSON-RPC' },
  { id: 'grpc', label: 'gRPC' },
  { id: 'http+json', label: 'HTTP + JSON' },
];

const AUTH_SCHEMES: { id: A2AAuthScheme; label: string }[] = [
  { id: 'none', label: 'None (public)' },
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

  const servesCard = data.role === 'server' || data.role === 'both';
  const delegates = data.role === 'client' || data.role === 'both';

  // --- Advertised skills (server role) ---
  const updateSkill = (index: number, patch: Partial<A2ASkillAdvertisement>) => {
    const advertisedSkills = data.advertisedSkills.map((s, i) =>
      i === index ? { ...s, ...patch } : s,
    );
    update(nodeId, { advertisedSkills });
  };
  const addSkill = () => {
    const next: A2ASkillAdvertisement = { id: nanoid(6), name: '', description: '', tags: [] };
    update(nodeId, { advertisedSkills: [...data.advertisedSkills, next] });
  };
  const removeSkill = (index: number) => {
    update(nodeId, { advertisedSkills: data.advertisedSkills.filter((_, i) => i !== index) });
  };

  // --- Remote agents (client role) ---
  const updateRemote = (index: number, patch: Partial<A2ARemoteAgent>) => {
    const remoteAgents = data.remoteAgents.map((r, i) => (i === index ? { ...r, ...patch } : r));
    update(nodeId, { remoteAgents });
  };
  const addRemote = () => {
    const next: A2ARemoteAgent = {
      id: nanoid(6),
      name: '',
      cardUrl: '',
      transport: data.defaultTransport,
      authScheme: 'none',
      authRef: '',
      exposeAsTool: true,
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
        tooltip="When off, the node is wired into the graph but neither the server card nor the remote delegates are active."
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

      <Field
        label="Role"
        tooltip="Server publishes an agent card and accepts remote tasks; client registers remote A2A agents as delegates; both does each from one node."
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

      {servesCard && (
        <>
          <div className="mt-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Server — agent card
          </div>

          <Field
            label="Agent name"
            tooltip="The card's advertised name. Leave empty to fall back to the agent's own name at serve time."
          >
            <input
              className={inputClass}
              value={data.agentName}
              onChange={(e) => update(nodeId, { agentName: e.target.value })}
              placeholder="(agent's name)"
            />
          </Field>

          <Field label="Description" tooltip="Card description shown to remote clients discovering this agent.">
            <textarea
              className={textareaClass}
              rows={2}
              value={data.agentDescription}
              onChange={(e) => update(nodeId, { agentDescription: e.target.value })}
              placeholder="What this agent does, for remote callers."
            />
          </Field>

          <Field
            label="Server URL"
            tooltip="Base URL the agent card and task endpoint are served from. The card is published at <url>/.well-known/agent-card.json."
          >
            <input
              className={inputClass}
              value={data.serverUrl}
              onChange={(e) => update(nodeId, { serverUrl: e.target.value })}
              placeholder="https://host.example"
            />
          </Field>

          <Field label="Card version" tooltip="Version string advertised on the agent card.">
            <input
              className={inputClass}
              value={data.cardVersion}
              onChange={(e) => update(nodeId, { cardVersion: e.target.value })}
              placeholder="1.0.0"
            />
          </Field>

          <Field
            label="Auth scheme"
            tooltip="How remote callers authenticate to this agent's A2A endpoint."
          >
            <select
              className={selectClass}
              value={data.serverAuthScheme}
              onChange={(e) => update(nodeId, { serverAuthScheme: e.target.value as A2AAuthScheme })}
            >
              {AUTH_SCHEMES.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Streaming" tooltip="Advertise Server-Sent-Events streaming support on the card.">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={data.streaming}
                onChange={(e) => update(nodeId, { streaming: e.target.checked })}
                className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
              />
              <span className="text-xs text-slate-300">Advertise streaming</span>
            </label>
          </Field>

          <Field
            label="Push notifications"
            tooltip="Advertise push-notification (webhook) support on the card, for long-running tasks."
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

          <Field
            label="Advertised skills"
            tooltip="Capabilities published on the card so remote clients can match tasks to this agent."
          >
            <div className="space-y-2">
              {data.advertisedSkills.map((skill, i) => (
                <div key={skill.id} className="rounded-md border border-slate-700 bg-slate-800/50 p-2">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wider text-slate-500">
                      Skill {i + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeSkill(i)}
                      className="text-slate-500 hover:text-red-400"
                      aria-label="Remove skill"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <input
                    className={`${inputClass} mb-1`}
                    value={skill.name}
                    onChange={(e) => updateSkill(i, { name: e.target.value })}
                    placeholder="Skill name"
                  />
                  <input
                    className={`${inputClass} mb-1`}
                    value={skill.description}
                    onChange={(e) => updateSkill(i, { description: e.target.value })}
                    placeholder="What the skill does"
                  />
                  <input
                    className={inputClass}
                    value={skill.tags.join(', ')}
                    onChange={(e) =>
                      updateSkill(i, {
                        tags: e.target.value
                          .split(',')
                          .map((t) => t.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="tags, comma-separated"
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={addSkill}
                className="flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
              >
                <Plus size={13} /> Add skill
              </button>
            </div>
          </Field>
        </>
      )}

      {delegates && (
        <>
          <div className="mt-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Client — remote agents
          </div>

          <Field
            label="Default transport"
            tooltip="Transport used to call remote agents that do not pin their own."
          >
            <select
              className={selectClass}
              value={data.defaultTransport}
              onChange={(e) => update(nodeId, { defaultTransport: e.target.value as A2ATransport })}
            >
              {TRANSPORTS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Remote agents"
            tooltip="A2A agents this agent can delegate subtasks to. Each is resolved from its agent card URL."
          >
            <div className="space-y-2">
              {data.remoteAgents.map((remote, i) => (
                <div key={remote.id} className="rounded-md border border-slate-700 bg-slate-800/50 p-2">
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
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <input
                    className={`${inputClass} mb-1`}
                    value={remote.name}
                    onChange={(e) => updateRemote(i, { name: e.target.value })}
                    placeholder="Remote agent name"
                  />
                  <input
                    className={`${inputClass} mb-1`}
                    value={remote.cardUrl}
                    onChange={(e) => updateRemote(i, { cardUrl: e.target.value })}
                    placeholder="https://remote.example/.well-known/agent-card.json"
                  />
                  <div className="mb-1 flex gap-1">
                    <select
                      className={selectClass}
                      value={remote.transport}
                      onChange={(e) => updateRemote(i, { transport: e.target.value as A2ATransport })}
                    >
                      {TRANSPORTS.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
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
                  </div>
                  {remote.authScheme !== 'none' && (
                    <input
                      className={`${inputClass} mb-1`}
                      value={remote.authRef}
                      onChange={(e) => updateRemote(i, { authRef: e.target.value })}
                      placeholder="Credential reference (secret name, not the value)"
                    />
                  )}
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={remote.exposeAsTool}
                      onChange={(e) => updateRemote(i, { exposeAsTool: e.target.checked })}
                      className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
                    />
                    <span className="text-xs text-slate-300">Expose to the model as a delegate tool</span>
                  </label>
                </div>
              ))}
              <button
                type="button"
                onClick={addRemote}
                className="flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
              >
                <Plus size={13} /> Add remote agent
              </button>
            </div>
          </Field>
        </>
      )}
    </div>
  );
}
