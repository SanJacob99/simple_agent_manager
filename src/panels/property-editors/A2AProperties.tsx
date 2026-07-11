import { nanoid } from 'nanoid';
import { Plus, Trash2 } from 'lucide-react';
import { useGraphStore } from '../../store/graph-store';
import type {
  A2ANodeData,
  A2AMode,
  A2AAuthScheme,
  A2ARemoteErrorPolicy,
  A2ASkillEntry,
  A2ARemoteEntry,
} from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const MODES: { id: A2AMode; label: string }[] = [
  { id: 'both', label: 'Both (publish card + delegate)' },
  { id: 'server', label: 'Server (publish card only)' },
  { id: 'client', label: 'Client (delegate only)' },
];

const AUTH_SCHEMES: { id: A2AAuthScheme; label: string }[] = [
  { id: 'none', label: 'None (open)' },
  { id: 'bearer', label: 'Bearer token' },
  { id: 'apiKey', label: 'API key header' },
];

const ON_REMOTE_ERROR: { id: A2ARemoteErrorPolicy; label: string }[] = [
  { id: 'fail', label: 'Fail (abort the turn)' },
  { id: 'warn', label: 'Warn (continue without result)' },
  { id: 'ignore', label: 'Ignore (silently continue)' },
];

interface Props {
  nodeId: string;
  data: A2ANodeData;
}

export default function A2AProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);

  const isServer = data.mode === 'server' || data.mode === 'both';
  const isClient = data.mode === 'client' || data.mode === 'both';

  // --- Skills (advertised on the published card) ---
  const updateSkill = (index: number, patch: Partial<A2ASkillEntry>) => {
    const skills = data.skills.map((s, i) => (i === index ? { ...s, ...patch } : s));
    update(nodeId, { skills });
  };
  const addSkill = () => {
    const next: A2ASkillEntry = { id: nanoid(6), name: '', description: '', tags: [] };
    update(nodeId, { skills: [...data.skills, next] });
  };
  const removeSkill = (index: number) => {
    update(nodeId, { skills: data.skills.filter((_, i) => i !== index) });
  };

  // --- Remotes (registered delegates) ---
  const updateRemote = (index: number, patch: Partial<A2ARemoteEntry>) => {
    const remotes = data.remotes.map((r, i) => (i === index ? { ...r, ...patch } : r));
    update(nodeId, { remotes });
  };
  const addRemote = () => {
    const next: A2ARemoteEntry = {
      id: nanoid(6),
      name: '',
      cardUrl: '',
      authScheme: 'none',
      authTokenRef: '',
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
        tooltip="When off, the node is wired but no Agent Card is served and no remote is called."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => update(nodeId, { enabled: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Participate in the A2A network</span>
        </label>
      </Field>

      <Field label="Mode" tooltip="Whether this agent publishes a card, consumes remotes, or both.">
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

      {isServer && (
        <>
          <div className="mt-3 mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Published card
          </div>

          <Field label="Agent name" tooltip="How this agent identifies itself to remote callers (card `name`).">
            <input
              className={inputClass}
              value={data.agentName}
              onChange={(e) => update(nodeId, { agentName: e.target.value })}
              placeholder="(falls back to the label)"
            />
          </Field>

          <Field label="Description" tooltip="One line on what this agent does (card `description`).">
            <textarea
              className={textareaClass}
              rows={2}
              value={data.agentDescription}
              onChange={(e) => update(nodeId, { agentDescription: e.target.value })}
            />
          </Field>

          <Field label="Served URL" tooltip="Base URL this agent is served from (the card's `url`).">
            <input
              className={inputClass}
              value={data.agentUrl}
              onChange={(e) => update(nodeId, { agentUrl: e.target.value })}
              placeholder="http://localhost:8787"
            />
          </Field>

          <Field label="Version" tooltip="Semantic version of this agent's published interface (card `version`).">
            <input
              className={inputClass}
              value={data.version}
              onChange={(e) => update(nodeId, { version: e.target.value })}
              placeholder="0.1.0"
            />
          </Field>

          <Field label="Streaming" tooltip="Advertise streaming task updates (capabilities.streaming).">
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
            tooltip="Advertise push-notification task updates (capabilities.pushNotifications)."
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

          <Field label="Security" tooltip="Auth scheme advertised on the card that callers must satisfy.">
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

          <Field label="Skills" tooltip="Capabilities advertised on the card so remotes know what this agent can do.">
            <div className="space-y-2">
              {data.skills.map((skill, i) => (
                <div key={skill.id} className="rounded border border-slate-700 p-2 space-y-1">
                  <div className="flex items-center gap-2">
                    <input
                      className={inputClass}
                      value={skill.name}
                      onChange={(e) => updateSkill(i, { name: e.target.value })}
                      placeholder="Skill name"
                    />
                    <button
                      type="button"
                      onClick={() => removeSkill(i)}
                      className="text-slate-400 hover:text-red-400"
                      aria-label="Remove skill"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <input
                    className={inputClass}
                    value={skill.description}
                    onChange={(e) => updateSkill(i, { description: e.target.value })}
                    placeholder="What this skill does"
                  />
                  <input
                    className={inputClass}
                    value={skill.tags.join(', ')}
                    onChange={(e) =>
                      updateSkill(i, {
                        tags: e.target.value
                          .split(',')
                          .map((t) => t.trim())
                          .filter((t) => t.length > 0),
                      })
                    }
                    placeholder="tags, comma, separated"
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={addSkill}
                className="flex items-center gap-1 text-xs text-slate-300 hover:text-blue-400"
              >
                <Plus size={14} /> Add skill
              </button>
            </div>
          </Field>
        </>
      )}

      {isClient && (
        <>
          <div className="mt-3 mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Remote delegates
          </div>

          <Field label="Remotes" tooltip="Remote A2A agents this agent can delegate tasks to.">
            <div className="space-y-2">
              {data.remotes.map((remote, i) => (
                <div key={remote.id} className="rounded border border-slate-700 p-2 space-y-1">
                  <div className="flex items-center gap-2">
                    <input
                      className={inputClass}
                      value={remote.name}
                      onChange={(e) => updateRemote(i, { name: e.target.value })}
                      placeholder="Remote name"
                    />
                    <button
                      type="button"
                      onClick={() => removeRemote(i)}
                      className="text-slate-400 hover:text-red-400"
                      aria-label="Remove remote"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <input
                    className={inputClass}
                    value={remote.cardUrl}
                    onChange={(e) => updateRemote(i, { cardUrl: e.target.value })}
                    placeholder="https://remote/.well-known/agent-card.json"
                  />
                  <div className="flex items-center gap-2">
                    <select
                      className={selectClass}
                      value={remote.authScheme}
                      onChange={(e) => updateRemote(i, { authScheme: e.target.value as A2AAuthScheme })}
                    >
                      {AUTH_SCHEMES.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                    {remote.authScheme !== 'none' && (
                      <input
                        className={inputClass}
                        value={remote.authTokenRef}
                        onChange={(e) => updateRemote(i, { authTokenRef: e.target.value })}
                        placeholder="ENV_VAR_NAME"
                      />
                    )}
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={addRemote}
                className="flex items-center gap-1 text-xs text-slate-300 hover:text-blue-400"
              >
                <Plus size={14} /> Add remote
              </button>
            </div>
          </Field>

          <Field label="Task timeout (ms)" tooltip="How long to await a remote's terminal state before giving up.">
            <input
              type="number"
              min={1000}
              step={1000}
              className={inputClass}
              value={data.taskTimeoutMs}
              onChange={(e) =>
                update(nodeId, { taskTimeoutMs: Math.max(0, Math.floor(Number(e.target.value) || 0)) })
              }
            />
          </Field>

          <Field label="Max concurrent tasks" tooltip="Cap on concurrently in-flight delegated tasks.">
            <input
              type="number"
              min={1}
              max={64}
              className={inputClass}
              value={data.maxConcurrentTasks}
              onChange={(e) =>
                update(nodeId, { maxConcurrentTasks: Math.max(1, Math.floor(Number(e.target.value) || 1)) })
              }
            />
          </Field>

          <Field label="On remote error" tooltip="What to do when a delegated remote task fails or times out.">
            <select
              className={selectClass}
              value={data.onRemoteError}
              onChange={(e) => update(nodeId, { onRemoteError: e.target.value as A2ARemoteErrorPolicy })}
            >
              {ON_REMOTE_ERROR.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
    </div>
  );
}
