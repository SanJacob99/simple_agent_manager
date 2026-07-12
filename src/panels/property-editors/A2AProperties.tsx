import { nanoid } from 'nanoid';
import { Plus, Trash2 } from 'lucide-react';
import { useGraphStore } from '../../store/graph-store';
import type {
  A2ANodeData,
  A2ARole,
  A2AAuthScheme,
  A2ASkillAdvert,
  A2ARemoteAgent,
} from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const ROLES: { id: A2ARole; label: string }[] = [
  { id: 'both', label: 'Both (publish + delegate)' },
  { id: 'server', label: 'Server (publish this agent)' },
  { id: 'client', label: 'Client (delegate to remotes)' },
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

export default function A2AProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);

  const isServer = data.role === 'server' || data.role === 'both';
  const isClient = data.role === 'client' || data.role === 'both';

  const updateSkill = (index: number, patch: Partial<A2ASkillAdvert>) => {
    const advertisedSkills = data.advertisedSkills.map((s, i) =>
      i === index ? { ...s, ...patch } : s,
    );
    update(nodeId, { advertisedSkills });
  };
  const addSkill = () => {
    const next: A2ASkillAdvert = { id: nanoid(6), name: '', description: '' };
    update(nodeId, { advertisedSkills: [...data.advertisedSkills, next] });
  };
  const removeSkill = (index: number) => {
    update(nodeId, {
      advertisedSkills: data.advertisedSkills.filter((_, i) => i !== index),
    });
  };

  const updateRemote = (index: number, patch: Partial<A2ARemoteAgent>) => {
    const remotes = data.remotes.map((r, i) => (i === index ? { ...r, ...patch } : r));
    update(nodeId, { remotes });
  };
  const addRemote = () => {
    const next: A2ARemoteAgent = {
      id: nanoid(6),
      name: '',
      url: '',
      authScheme: 'none',
      enabled: true,
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
        tooltip="When off, the node is wired but no agent card is served and no remote delegate is registered."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => update(nodeId, { enabled: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Participate in A2A</span>
        </label>
      </Field>

      <Field
        label="Role"
        tooltip="Server publishes this agent's card and accepts remote tasks; Client registers remote agents as callable delegates; Both does both."
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
          <div className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Published card
          </div>

          <Field
            label="Agent name"
            tooltip="Name advertised on the agent card. Empty falls back to the node label."
          >
            <input
              className={inputClass}
              value={data.agentName}
              onChange={(e) => update(nodeId, { agentName: e.target.value })}
              placeholder="(node label)"
            />
          </Field>

          <Field label="Description" tooltip="What this agent does, shown to remote callers discovering it.">
            <textarea
              className={textareaClass}
              rows={2}
              value={data.agentDescription}
              onChange={(e) => update(nodeId, { agentDescription: e.target.value })}
            />
          </Field>

          <Field label="Version" tooltip="Version string published on the card (semver-ish).">
            <input
              className={inputClass}
              value={data.agentVersion}
              onChange={(e) => update(nodeId, { agentVersion: e.target.value })}
              placeholder="0.1.0"
            />
          </Field>

          <Field label="Streaming" tooltip="Advertise Server-Sent-Events streaming (message/stream) support.">
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

          <Field label="Push notifications" tooltip="Advertise webhook push-notification support for long-running tasks.">
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

          <Field label="Inbound auth" tooltip="Authentication scheme advertised on the card for remote callers.">
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

          <div className="mb-2 mt-3 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Advertised skills ({data.advertisedSkills.length})
            </span>
            <button
              onClick={addSkill}
              className="flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
            >
              <Plus size={12} /> Add skill
            </button>
          </div>
          <div className="space-y-3">
            {data.advertisedSkills.map((s, i) => (
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
                  className={textareaClass}
                  rows={2}
                  placeholder="What the skill does"
                  value={s.description}
                  onChange={(e) => updateSkill(i, { description: e.target.value })}
                />
              </div>
            ))}
          </div>
        </>
      )}

      {isClient && (
        <>
          <div className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Remote delegates
          </div>

          <Field label="Task timeout (ms)" tooltip="How long to wait for a delegated remote task before abandoning it.">
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

          <Field label="Max concurrent tasks" tooltip="Cap on remote tasks running at once across all delegates.">
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

          <div className="mb-2 mt-3 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Remotes ({data.remotes.length})
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
                  <span className="font-mono text-[10px] text-slate-500">a2a_{r.id}</span>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-[10px] text-slate-400">
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        onChange={(e) => updateRemote(i, { enabled: e.target.checked })}
                        className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
                      />
                      on
                    </label>
                    <button
                      onClick={() => removeRemote(i)}
                      className="rounded p-1 text-slate-500 transition hover:bg-red-500/10 hover:text-red-400"
                      title="Remove remote"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                <input
                  className={`${inputClass} mb-2`}
                  placeholder="Display name"
                  value={r.name}
                  onChange={(e) => updateRemote(i, { name: e.target.value })}
                />
                <input
                  className={`${inputClass} mb-2`}
                  placeholder="https://remote.example (base URL)"
                  value={r.url}
                  onChange={(e) => updateRemote(i, { url: e.target.value })}
                />
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
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
