import { nanoid } from 'nanoid';
import { Plus, Trash2 } from 'lucide-react';
import { useGraphStore } from '../../store/graph-store';
import type {
  A2ANodeData,
  A2AMode,
  A2AErrorPolicy,
  A2ASkillAdvertisement,
  A2ARemoteAgent,
} from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const MODES: { id: A2AMode; label: string }[] = [
  { id: 'both', label: 'Both (serve + consume)' },
  { id: 'server', label: 'Server (expose this agent)' },
  { id: 'client', label: 'Client (consume remotes)' },
];

const ON_ERROR: { id: A2AErrorPolicy; label: string }[] = [
  { id: 'fail', label: 'Fail (abort the run)' },
  { id: 'warn', label: 'Warn (continue, flag it)' },
  { id: 'ignore', label: 'Ignore (skip silently)' },
];

interface Props {
  nodeId: string;
  data: A2ANodeData;
}

export default function A2AProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);

  const serves = data.mode === 'server' || data.mode === 'both';
  const consumes = data.mode === 'client' || data.mode === 'both';

  const updateSkill = (index: number, patch: Partial<A2ASkillAdvertisement>) => {
    const exposedSkills = data.exposedSkills.map((s, i) =>
      i === index ? { ...s, ...patch } : s,
    );
    update(nodeId, { exposedSkills });
  };
  const addSkill = () => {
    const next: A2ASkillAdvertisement = {
      id: nanoid(6),
      name: '',
      description: '',
      tags: [],
    };
    update(nodeId, { exposedSkills: [...data.exposedSkills, next] });
  };
  const removeSkill = (index: number) =>
    update(nodeId, { exposedSkills: data.exposedSkills.filter((_, i) => i !== index) });

  const updateRemote = (index: number, patch: Partial<A2ARemoteAgent>) => {
    const remoteAgents = data.remoteAgents.map((r, i) =>
      i === index ? { ...r, ...patch } : r,
    );
    update(nodeId, { remoteAgents });
  };
  const addRemote = () => {
    const next: A2ARemoteAgent = { id: nanoid(6), name: '', url: '', description: '' };
    update(nodeId, { remoteAgents: [...data.remoteAgents, next] });
  };
  const removeRemote = (index: number) =>
    update(nodeId, { remoteAgents: data.remoteAgents.filter((_, i) => i !== index) });

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
        tooltip="When off, the node is wired into the graph but neither the server nor the client side is active."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => update(nodeId, { enabled: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Expose / consume over A2A</span>
        </label>
      </Field>

      <Field label="Mode" tooltip="Which sides of the A2A protocol this node turns on.">
        <select
          className={selectClass}
          value={data.mode}
          onChange={(e) => update(nodeId, { mode: e.target.value as A2AMode })}
        >
          {MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </Field>

      {serves && (
        <>
          <div className="mt-4 mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Server — agent card
          </div>

          <Field
            label="Agent name"
            tooltip="Name published in the agent card. Empty falls back to the connected agent's name."
          >
            <input
              className={inputClass}
              value={data.agentName}
              onChange={(e) => update(nodeId, { agentName: e.target.value })}
              placeholder="(agent's name)"
            />
          </Field>

          <Field label="Agent description" tooltip="Description published in the agent card.">
            <textarea
              className={textareaClass}
              rows={2}
              value={data.agentDescription}
              onChange={(e) => update(nodeId, { agentDescription: e.target.value })}
              placeholder="(agent's description)"
            />
          </Field>

          <div className="flex gap-2">
            <Field label="Version" tooltip="Agent card version string.">
              <input
                className={inputClass}
                value={data.agentVersion}
                onChange={(e) => update(nodeId, { agentVersion: e.target.value })}
              />
            </Field>
            <Field label="Mount path" tooltip="Path the A2A endpoint is served under on the local backend.">
              <input
                className={inputClass}
                value={data.serverPath}
                onChange={(e) => update(nodeId, { serverPath: e.target.value })}
              />
            </Field>
          </div>

          <Field
            label="Advertise streaming"
            tooltip="Advertise message/stream (SSE task updates) in the agent card capabilities."
          >
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={data.advertiseStreaming}
                onChange={(e) => update(nodeId, { advertiseStreaming: e.target.checked })}
                className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
              />
              <span className="text-xs text-slate-300">Streaming task updates</span>
            </label>
          </Field>

          <Field
            label="Advertise push"
            tooltip="Advertise push-notification (webhook) task updates in the agent card capabilities."
          >
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={data.advertisePushNotifications}
                onChange={(e) =>
                  update(nodeId, { advertisePushNotifications: e.target.checked })
                }
                className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
              />
              <span className="text-xs text-slate-300">Push notifications</span>
            </label>
          </Field>

          <Field
            label="Require auth"
            tooltip="Require a bearer token on incoming task requests."
          >
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={data.requireAuth}
                onChange={(e) => update(nodeId, { requireAuth: e.target.checked })}
                className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
              />
              <span className="text-xs text-slate-300">Bearer token required</span>
            </label>
          </Field>

          <div className="mb-2 mt-3 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Exposed skills ({data.exposedSkills.length})
            </span>
            <button
              onClick={addSkill}
              className="flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
            >
              <Plus size={12} /> Add skill
            </button>
          </div>
          <div className="space-y-3">
            {data.exposedSkills.map((s, i) => (
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

      {consumes && (
        <>
          <div className="mt-4 mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Client — remote delegates
          </div>

          <div className="flex gap-2">
            <Field label="Timeout (ms)" tooltip="Default per-task timeout for remote A2A calls.">
              <input
                type="number"
                min={0}
                step={1000}
                className={inputClass}
                value={data.defaultTimeoutMs}
                onChange={(e) =>
                  update(nodeId, { defaultTimeoutMs: Math.max(0, Number(e.target.value) || 0) })
                }
              />
            </Field>
            <Field label="Max concurrent" tooltip="Max remote A2A tasks in flight at once.">
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
          </div>

          <Field label="On error" tooltip="What the client side does when a remote call fails or times out.">
            <select
              className={selectClass}
              value={data.onError}
              onChange={(e) => update(nodeId, { onError: e.target.value as A2AErrorPolicy })}
            >
              {ON_ERROR.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
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
                    title="Remove remote"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <input
                  className={`${inputClass} mb-2`}
                  placeholder="Remote agent name"
                  value={r.name}
                  onChange={(e) => updateRemote(i, { name: e.target.value })}
                />
                <input
                  className={`${inputClass} mb-2`}
                  placeholder="https://remote.example.com/a2a"
                  value={r.url}
                  onChange={(e) => updateRemote(i, { url: e.target.value })}
                />
                <textarea
                  className={textareaClass}
                  rows={2}
                  placeholder="When to delegate to this agent"
                  value={r.description}
                  onChange={(e) => updateRemote(i, { description: e.target.value })}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
