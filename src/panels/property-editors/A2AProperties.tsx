import { nanoid } from 'nanoid';
import { Plus, Trash2 } from 'lucide-react';
import { useGraphStore } from '../../store/graph-store';
import type { A2ANodeData, A2ARemoteAgent, A2ARole } from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const ROLES: { id: A2ARole; label: string }[] = [
  { id: 'server', label: 'Server (expose this agent)' },
  { id: 'client', label: 'Client (call remote agents)' },
  { id: 'both', label: 'Both (expose and call)' },
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
    const remotes = data.remotes.map((r, i) => (i === index ? { ...r, ...patch } : r));
    update(nodeId, { remotes });
  };

  const addRemote = () => {
    const next: A2ARemoteAgent = {
      id: nanoid(6),
      name: '',
      cardUrl: '',
      authTokenEnv: '',
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
        tooltip="When off, the node is wired into the graph but neither the A2A server nor any remote delegate is active."
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

      <Field
        label="Role"
        tooltip="Whether this agent publishes an A2A server surface, consumes remote A2A agents as delegates, or both."
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
            Server — published agent card
          </div>

          <Field
            label="Agent name"
            tooltip="The `name` field of the published agent card. Empty falls back to the agent's own name."
          >
            <input
              className={inputClass}
              value={data.agentName}
              onChange={(e) => update(nodeId, { agentName: e.target.value })}
              placeholder="(agent's name)"
            />
          </Field>

          <Field label="Agent description" tooltip="The `description` field of the published agent card.">
            <textarea
              className={textareaClass}
              rows={2}
              value={data.agentDescription}
              onChange={(e) => update(nodeId, { agentDescription: e.target.value })}
            />
          </Field>

          <Field label="Version" tooltip="Semantic version string advertised in the agent card.">
            <input
              className={inputClass}
              value={data.agentVersion}
              onChange={(e) => update(nodeId, { agentVersion: e.target.value })}
              placeholder="1.0.0"
            />
          </Field>

          <Field label="Server path" tooltip="HTTP path the A2A server mounts at, e.g. /a2a.">
            <input
              className={inputClass}
              value={data.serverPath}
              onChange={(e) => update(nodeId, { serverPath: e.target.value })}
              placeholder="/a2a"
            />
          </Field>

          <Field
            label="Advertised skills"
            tooltip="Comma-separated skill tags surfaced in the agent card's skills array so remote clients can discover what this agent can do."
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
              placeholder="research, summarize, code-review"
            />
          </Field>

          <Field
            label="Streaming"
            tooltip="Advertise the streaming capability (SSE task updates) in the agent card."
          >
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={data.streaming}
                onChange={(e) => update(nodeId, { streaming: e.target.checked })}
                className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
              />
              <span className="text-xs text-slate-300">Advertise SSE streaming</span>
            </label>
          </Field>

          <Field
            label="Push notifications"
            tooltip="Advertise the pushNotifications capability (webhook task updates) in the agent card."
          >
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={data.pushNotifications}
                onChange={(e) => update(nodeId, { pushNotifications: e.target.checked })}
                className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
              />
              <span className="text-xs text-slate-300">Advertise webhook updates</span>
            </label>
          </Field>

          <Field
            label="Require auth"
            tooltip="Require a bearer token on inbound tasks. When off, the server accepts unauthenticated tasks."
          >
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={data.requireAuth}
                onChange={(e) => update(nodeId, { requireAuth: e.target.checked })}
                className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
              />
              <span className="text-xs text-slate-300">Require bearer token</span>
            </label>
          </Field>

          {data.requireAuth && (
            <Field
              label="Inbound token env"
              tooltip="Name of the environment variable holding the accepted inbound bearer token."
            >
              <input
                className={inputClass}
                value={data.inboundTokenEnv}
                onChange={(e) => update(nodeId, { inboundTokenEnv: e.target.value })}
                placeholder="A2A_INBOUND_TOKEN"
              />
            </Field>
          )}
        </>
      )}

      {isClient && (
        <>
          <div className="mb-2 mt-4 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Remote delegates ({data.remotes.length})
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
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      onChange={(e) => updateRemote(i, { enabled: e.target.checked })}
                      className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
                    />
                    <span className="text-[10px] uppercase tracking-wider text-slate-500">
                      Enabled
                    </span>
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
                  placeholder="Name (e.g. research-agent)"
                  value={r.name}
                  onChange={(e) => updateRemote(i, { name: e.target.value })}
                />
                <input
                  className={`${inputClass} mb-2`}
                  placeholder="https://host/.well-known/agent-card.json"
                  value={r.cardUrl}
                  onChange={(e) => updateRemote(i, { cardUrl: e.target.value })}
                />
                <input
                  className={inputClass}
                  placeholder="Auth token env (optional)"
                  value={r.authTokenEnv}
                  onChange={(e) => updateRemote(i, { authTokenEnv: e.target.value })}
                />
              </div>
            ))}
          </div>
        </>
      )}

      <div className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Safety
      </div>

      <Field
        label="Max concurrent tasks"
        tooltip="Ceiling on simultaneous inbound + outbound A2A tasks. 0 disables the ceiling."
      >
        <input
          type="number"
          min={0}
          step={1}
          className={inputClass}
          value={data.maxConcurrentTasks}
          onChange={(e) =>
            update(nodeId, { maxConcurrentTasks: Math.max(0, Math.floor(Number(e.target.value) || 0)) })
          }
        />
      </Field>

      <Field
        label="Task timeout (ms)"
        tooltip="Per-task wall-clock timeout in milliseconds. 0 disables the ceiling."
      >
        <input
          type="number"
          min={0}
          step={1000}
          className={inputClass}
          value={data.taskTimeoutMs}
          onChange={(e) =>
            update(nodeId, { taskTimeoutMs: Math.max(0, Math.floor(Number(e.target.value) || 0)) })
          }
        />
      </Field>
    </div>
  );
}
