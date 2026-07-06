import { nanoid } from 'nanoid';
import { Plus, Trash2 } from 'lucide-react';
import { useGraphStore } from '../../store/graph-store';
import type {
  A2ANodeData,
  A2AAuthScheme,
  A2ARemoteErrorPolicy,
  A2ARemoteAgent,
  A2ASkillDescriptor,
} from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const AUTH_SCHEMES: { id: A2AAuthScheme; label: string }[] = [
  { id: 'none', label: 'None (open endpoint)' },
  { id: 'apiKey', label: 'API key (header)' },
  { id: 'bearer', label: 'Bearer token' },
];

const ERROR_POLICIES: { id: A2ARemoteErrorPolicy; label: string }[] = [
  { id: 'fail', label: 'Fail (abort the delegating call)' },
  { id: 'warn', label: 'Warn (return error to model)' },
  { id: 'ignore', label: 'Ignore (empty result)' },
];

interface Props {
  nodeId: string;
  data: A2ANodeData;
}

export default function A2AProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);

  // --- Skills (advertised on this agent's card) ---
  const updateSkill = (index: number, patch: Partial<A2ASkillDescriptor>) => {
    const skills = data.skills.map((s, i) => (i === index ? { ...s, ...patch } : s));
    update(nodeId, { skills });
  };
  const addSkill = () => {
    const next: A2ASkillDescriptor = { id: nanoid(6), name: '', description: '', tags: [], examples: [] };
    update(nodeId, { skills: [...data.skills, next] });
  };
  const removeSkill = (index: number) => {
    update(nodeId, { skills: data.skills.filter((_, i) => i !== index) });
  };

  // --- Remote agents (this agent delegates to) ---
  const updateRemote = (index: number, patch: Partial<A2ARemoteAgent>) => {
    const remoteAgents = data.remoteAgents.map((a, i) => (i === index ? { ...a, ...patch } : a));
    update(nodeId, { remoteAgents });
  };
  const addRemote = () => {
    const next: A2ARemoteAgent = {
      id: nanoid(6),
      name: '',
      cardUrl: '',
      enabled: true,
      exposeAsTool: true,
      timeoutMs: 0,
      authScheme: 'none',
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
        tooltip="When off, the node is wired but the agent is neither served over A2A nor able to call remote A2A agents."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => update(nodeId, { enabled: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">A2A interop active</span>
        </label>
      </Field>

      {/* --- Server surface --- */}
      <div className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Expose this agent (server)
      </div>

      <Field
        label="Expose as A2A server"
        tooltip="Publish an agent card at /.well-known/agent-card.json and accept inbound A2A task/message requests."
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

      <Field label="Agent name (card)" tooltip="Name advertised on the agent card. Empty falls back to the agent's own name.">
        <input
          className={inputClass}
          value={data.agentName}
          onChange={(e) => update(nodeId, { agentName: e.target.value })}
          placeholder="(agent's name)"
        />
      </Field>

      <Field label="Agent description (card)" tooltip="Human-readable description advertised on the agent card.">
        <textarea
          className={textareaClass}
          rows={2}
          value={data.agentDescription}
          onChange={(e) => update(nodeId, { agentDescription: e.target.value })}
          placeholder="What this agent can do, for remote callers."
        />
      </Field>

      <Field label="Server path" tooltip="Path prefix the A2A server mounts under (e.g. /a2a).">
        <input
          className={inputClass}
          value={data.serverPath}
          onChange={(e) => update(nodeId, { serverPath: e.target.value })}
          placeholder="/a2a"
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Streaming" tooltip="Advertise SSE (message/stream) task updates on the card.">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={data.streaming}
              onChange={(e) => update(nodeId, { streaming: e.target.checked })}
              className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
            />
            <span className="text-xs text-slate-300">SSE</span>
          </label>
        </Field>
        <Field label="Push" tooltip="Advertise push-notification (webhook) task updates on the card.">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={data.pushNotifications}
              onChange={(e) => update(nodeId, { pushNotifications: e.target.checked })}
              className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
            />
            <span className="text-xs text-slate-300">Webhook</span>
          </label>
        </Field>
      </div>

      <Field label="Inbound auth" tooltip="Auth scheme advertised in the card's securitySchemes.">
        <select
          className={selectClass}
          value={data.authScheme}
          onChange={(e) => update(nodeId, { authScheme: e.target.value as A2AAuthScheme })}
        >
          {AUTH_SCHEMES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>

      {data.authScheme === 'apiKey' && (
        <Field label="Auth header name" tooltip="Header the API key is expected in (e.g. X-API-Key).">
          <input
            className={inputClass}
            value={data.authHeaderName}
            onChange={(e) => update(nodeId, { authHeaderName: e.target.value })}
            placeholder="X-API-Key"
          />
        </Field>
      )}

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
              placeholder="What the skill does"
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

      {/* --- Client surface --- */}
      <div className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Delegate to remote agents (client)
      </div>

      <Field label="Default timeout (ms)" tooltip="Per-request timeout for remote agents that don't set their own.">
        <input
          type="number"
          min={0}
          step={1000}
          className={inputClass}
          value={data.defaultTimeoutMs}
          onChange={(e) => update(nodeId, { defaultTimeoutMs: Math.max(0, Number(e.target.value) || 0) })}
        />
      </Field>

      <Field label="On remote error" tooltip="What the runtime does when a call to a remote A2A agent fails.">
        <select
          className={selectClass}
          value={data.onRemoteError}
          onChange={(e) => update(nodeId, { onRemoteError: e.target.value as A2ARemoteErrorPolicy })}
        >
          {ERROR_POLICIES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>

      <div className="mb-2 mt-3 flex items-center justify-between">
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
        {data.remoteAgents.map((a, i) => (
          <div key={a.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[10px] text-slate-500">{a.id}</span>
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
              placeholder="Display name"
              value={a.name}
              onChange={(e) => updateRemote(i, { name: e.target.value })}
            />
            <input
              className={`${inputClass} mb-2`}
              placeholder="https://host/.well-known/agent-card.json"
              value={a.cardUrl}
              onChange={(e) => updateRemote(i, { cardUrl: e.target.value })}
            />
            <div className="mb-2 flex gap-2">
              <select
                className={selectClass}
                value={a.authScheme}
                onChange={(e) => updateRemote(i, { authScheme: e.target.value as A2AAuthScheme })}
              >
                {AUTH_SCHEMES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={0}
                step={1000}
                className={`${inputClass} w-24`}
                title="Timeout (ms), 0 = default"
                value={a.timeoutMs}
                onChange={(e) => updateRemote(i, { timeoutMs: Math.max(0, Number(e.target.value) || 0) })}
              />
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={a.enabled}
                  onChange={(e) => updateRemote(i, { enabled: e.target.checked })}
                  className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
                />
                <span className="text-[11px] text-slate-300">Enabled</span>
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={a.exposeAsTool}
                  onChange={(e) => updateRemote(i, { exposeAsTool: e.target.checked })}
                  className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
                />
                <span className="text-[11px] text-slate-300">Callable as tool</span>
              </label>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
