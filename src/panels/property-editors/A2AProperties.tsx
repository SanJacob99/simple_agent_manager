import { nanoid } from 'nanoid';
import { Plus, Trash2 } from 'lucide-react';
import { useGraphStore } from '../../store/graph-store';
import type {
  A2ANodeData,
  A2ARole,
  A2AAuthScheme,
  A2ASkill,
  A2ARemoteAgent,
} from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const ROLES: { id: A2ARole; label: string }[] = [
  { id: 'both', label: 'Both (publish + consume)' },
  { id: 'server', label: 'Server (publish this agent)' },
  { id: 'client', label: 'Client (consume remote agents)' },
];

const AUTH_SCHEMES: { id: A2AAuthScheme; label: string }[] = [
  { id: 'none', label: 'None (open)' },
  { id: 'bearer', label: 'Bearer token' },
  { id: 'apiKey', label: 'API key header' },
  { id: 'oauth2', label: 'OAuth 2.0' },
];

/** Parse a comma-separated MIME-mode list into a trimmed array. */
function parseModes(raw: string): string[] {
  return raw
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
}

interface Props {
  nodeId: string;
  data: A2ANodeData;
}

export default function A2AProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);

  const serverEnabled = data.role === 'server' || data.role === 'both';
  const clientEnabled = data.role === 'client' || data.role === 'both';

  const updateSkill = (index: number, patch: Partial<A2ASkill>) => {
    const publishedSkills = data.publishedSkills.map((s, i) =>
      i === index ? { ...s, ...patch } : s,
    );
    update(nodeId, { publishedSkills });
  };
  const addSkill = () => {
    const next: A2ASkill = { id: nanoid(6), name: '', description: '', tags: [] };
    update(nodeId, { publishedSkills: [...data.publishedSkills, next] });
  };
  const removeSkill = (index: number) => {
    update(nodeId, { publishedSkills: data.publishedSkills.filter((_, i) => i !== index) });
  };

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
      authEnvVar: '',
      toolName: '',
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
        tooltip="When off, the node is wired but no card is published and no delegate tools register."
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
        tooltip="Expose this agent over A2A (server), call remote A2A agents (client), or both."
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

      {serverEnabled && (
        <>
          <div className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Server — published card
          </div>

          <Field
            label="Card name"
            tooltip="Name published in the agent card. Empty falls back to the agent's own name."
          >
            <input
              className={inputClass}
              value={data.agentCardName}
              onChange={(e) => update(nodeId, { agentCardName: e.target.value })}
              placeholder="(agent's name)"
            />
          </Field>

          <Field
            label="Card description"
            tooltip="Description published in the agent card. Empty falls back to the agent's description."
          >
            <textarea
              className={textareaClass}
              rows={2}
              value={data.agentCardDescription}
              onChange={(e) => update(nodeId, { agentCardDescription: e.target.value })}
              placeholder="(agent's description)"
            />
          </Field>

          <Field
            label="Expose path"
            tooltip="Base path the A2A server mounts at; the card is served at <path>/.well-known/agent-card.json."
          >
            <input
              className={inputClass}
              value={data.exposePath}
              onChange={(e) => update(nodeId, { exposePath: e.target.value })}
              placeholder="/a2a"
            />
          </Field>

          <Field label="Server auth" tooltip="Authentication scheme callers must satisfy.">
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

          <Field label="Advertise streaming" tooltip="Declare SSE `message/stream` capability in the card.">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={data.advertiseStreaming}
                onChange={(e) => update(nodeId, { advertiseStreaming: e.target.checked })}
                className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
              />
              <span className="text-xs text-slate-300">Streaming updates</span>
            </label>
          </Field>

          <Field
            label="Advertise push notifications"
            tooltip="Declare push-notification capability in the card."
          >
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={data.advertisePushNotifications}
                onChange={(e) => update(nodeId, { advertisePushNotifications: e.target.checked })}
                className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
              />
              <span className="text-xs text-slate-300">Push notifications</span>
            </label>
          </Field>

          <div className="mb-2 mt-3 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Published skills ({data.publishedSkills.length})
            </span>
            <button
              onClick={addSkill}
              className="flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
            >
              <Plus size={12} /> Add skill
            </button>
          </div>

          <div className="space-y-3">
            {data.publishedSkills.map((s, i) => (
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
                  placeholder="Description"
                  value={s.description}
                  onChange={(e) => updateSkill(i, { description: e.target.value })}
                />
                <input
                  className={inputClass}
                  placeholder="Tags (comma-separated)"
                  value={s.tags.join(', ')}
                  onChange={(e) => updateSkill(i, { tags: parseModes(e.target.value) })}
                />
              </div>
            ))}
          </div>
        </>
      )}

      {clientEnabled && (
        <>
          <div className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Client — remote delegates
          </div>

          <Field
            label="Expose delegate tools"
            tooltip="Surface one `a2a_call_<agent>` tool per remote agent so this agent can delegate tasks to it."
          >
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={data.exposeDelegateTools}
                onChange={(e) => update(nodeId, { exposeDelegateTools: e.target.checked })}
                className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
              />
              <span className="text-xs text-slate-300">Register remote agents as tools</span>
            </label>
          </Field>

          <Field
            label="Task timeout (ms)"
            tooltip="How long a client-side remote task may run before it is abandoned."
          >
            <input
              type="number"
              min={0}
              step={1000}
              className={inputClass}
              value={data.taskTimeoutMs}
              onChange={(e) =>
                update(nodeId, { taskTimeoutMs: Math.max(0, Number(e.target.value) || 0) })
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
                  placeholder="Agent name"
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
                  placeholder="Tool name (optional; defaults to a2a_call_<name>)"
                  value={r.toolName}
                  onChange={(e) => updateRemote(i, { toolName: e.target.value })}
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
                    placeholder="Auth env var"
                    value={r.authEnvVar}
                    onChange={(e) => updateRemote(i, { authEnvVar: e.target.value })}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Modes
      </div>
      <Field label="Default input modes" tooltip="MIME modes accepted, comma-separated (e.g. text/plain, application/json).">
        <input
          className={inputClass}
          value={data.defaultInputModes.join(', ')}
          onChange={(e) => update(nodeId, { defaultInputModes: parseModes(e.target.value) })}
          placeholder="text/plain"
        />
      </Field>
      <Field label="Default output modes" tooltip="MIME modes produced, comma-separated.">
        <input
          className={inputClass}
          value={data.defaultOutputModes.join(', ')}
          onChange={(e) => update(nodeId, { defaultOutputModes: parseModes(e.target.value) })}
          placeholder="text/plain"
        />
      </Field>
    </div>
  );
}
