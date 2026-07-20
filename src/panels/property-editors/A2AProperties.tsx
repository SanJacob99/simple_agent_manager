import { nanoid } from 'nanoid';
import { Plus, Trash2 } from 'lucide-react';
import { useGraphStore } from '../../store/graph-store';
import type {
  A2ANodeData,
  A2AMode,
  A2AAuthScheme,
  A2ATransport,
  A2ASkillCard,
  A2ARemoteAgent,
} from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const MODES: { id: A2AMode; label: string }[] = [
  { id: 'both', label: 'Both (expose + consume)' },
  { id: 'server', label: 'Server (expose this agent)' },
  { id: 'client', label: 'Client (consume remote agents)' },
];

const AUTH_SCHEMES: { id: A2AAuthScheme; label: string }[] = [
  { id: 'bearer', label: 'Bearer token' },
  { id: 'apiKey', label: 'API key header' },
  { id: 'none', label: 'None (open)' },
];

const TRANSPORTS: { id: A2ATransport; label: string }[] = [
  { id: 'jsonrpc', label: 'JSON-RPC' },
  { id: 'grpc', label: 'gRPC' },
  { id: 'rest', label: 'REST' },
];

interface Props {
  nodeId: string;
  data: A2ANodeData;
}

export default function A2AProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);

  const showServer = data.mode === 'server' || data.mode === 'both';
  const showClient = data.mode === 'client' || data.mode === 'both';

  const updateSkill = (index: number, patch: Partial<A2ASkillCard>) => {
    const skills = data.skills.map((s, i) => (i === index ? { ...s, ...patch } : s));
    update(nodeId, { skills });
  };
  const addSkill = () => {
    const next: A2ASkillCard = { id: nanoid(6), name: '', description: '', tags: [] };
    update(nodeId, { skills: [...data.skills, next] });
  };
  const removeSkill = (index: number) => {
    update(nodeId, { skills: data.skills.filter((_, i) => i !== index) });
  };

  const updateRemote = (index: number, patch: Partial<A2ARemoteAgent>) => {
    const remoteAgents = data.remoteAgents.map((r, i) => (i === index ? { ...r, ...patch } : r));
    update(nodeId, { remoteAgents });
  };
  const addRemote = () => {
    const next: A2ARemoteAgent = {
      id: nanoid(6),
      name: '',
      cardUrl: '',
      transport: 'jsonrpc',
      authRef: '',
      exposeAsTool: true,
    };
    update(nodeId, { remoteAgents: [...data.remoteAgents, next] });
  };
  const removeRemote = (index: number) => {
    update(nodeId, { remoteAgents: data.remoteAgents.filter((_, i) => i !== index) });
  };

  const editCsv = (value: string): string[] =>
    value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);

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
        tooltip="When off, the node is wired into the graph but no A2A surface is served and no delegates are exposed."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => update(nodeId, { enabled: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Serve / consume over A2A</span>
        </label>
      </Field>

      <Field
        label="Mode"
        tooltip="Expose this agent as an A2A server, consume remote A2A agents as a client, or both."
      >
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

      {showServer && (
        <>
          <div className="mt-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
            Server — expose this agent
          </div>

          <Field label="Card name" tooltip="Name published in this agent's A2A agent card.">
            <input
              className={inputClass}
              value={data.cardName}
              onChange={(e) => update(nodeId, { cardName: e.target.value })}
            />
          </Field>

          <Field
            label="Card description"
            tooltip="Human-readable description published in the agent card, used by callers to decide whether to route work here."
          >
            <textarea
              className={textareaClass}
              rows={2}
              value={data.cardDescription}
              onChange={(e) => update(nodeId, { cardDescription: e.target.value })}
            />
          </Field>

          <Field label="Server path" tooltip="Mount path for the A2A server and its agent card.">
            <input
              className={inputClass}
              value={data.serverPath}
              onChange={(e) => update(nodeId, { serverPath: e.target.value })}
              placeholder="/a2a"
            />
          </Field>

          <Field label="Auth scheme" tooltip="Auth required to call this agent's A2A endpoint.">
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

          <Field label="Capabilities" tooltip="Optional A2A capabilities advertised in the card.">
            <div className="space-y-1.5">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={data.streaming}
                  onChange={(e) => update(nodeId, { streaming: e.target.checked })}
                  className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
                />
                <span className="text-xs text-slate-300">Streaming (message/stream)</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={data.pushNotifications}
                  onChange={(e) => update(nodeId, { pushNotifications: e.target.checked })}
                  className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
                />
                <span className="text-xs text-slate-300">Push notifications (webhooks)</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={data.stateTransitionHistory}
                  onChange={(e) => update(nodeId, { stateTransitionHistory: e.target.checked })}
                  className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
                />
                <span className="text-xs text-slate-300">State-transition history</span>
              </label>
            </div>
          </Field>

          <Field
            label="Input modes"
            tooltip="Comma-separated MIME types accepted as task input (advertised in the card)."
          >
            <input
              className={inputClass}
              value={data.defaultInputModes.join(', ')}
              onChange={(e) => update(nodeId, { defaultInputModes: editCsv(e.target.value) })}
              placeholder="text/plain, application/json"
            />
          </Field>

          <Field
            label="Output modes"
            tooltip="Comma-separated MIME types produced as task output (advertised in the card)."
          >
            <input
              className={inputClass}
              value={data.defaultOutputModes.join(', ')}
              onChange={(e) => update(nodeId, { defaultOutputModes: editCsv(e.target.value) })}
              placeholder="text/plain, application/json"
            />
          </Field>

          <Field
            label="Skill cards"
            tooltip="Task-oriented skills advertised to callers so they can decide whether this agent can handle a task."
          >
            <div className="space-y-2">
              {data.skills.map((skill, i) => (
                <div key={skill.id} className="rounded-md border border-slate-700 bg-slate-800/50 p-2">
                  <div className="mb-1 flex items-center gap-2">
                    <input
                      className={inputClass}
                      value={skill.name}
                      onChange={(e) => updateSkill(i, { name: e.target.value })}
                      placeholder="Skill name"
                    />
                    <button
                      type="button"
                      onClick={() => removeSkill(i)}
                      className="shrink-0 rounded p-1 text-slate-500 hover:bg-slate-700 hover:text-red-400"
                      aria-label="Remove skill"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <input
                    className={`${inputClass} mb-1`}
                    value={skill.description}
                    onChange={(e) => updateSkill(i, { description: e.target.value })}
                    placeholder="What this skill does"
                  />
                  <input
                    className={inputClass}
                    value={skill.tags.join(', ')}
                    onChange={(e) => updateSkill(i, { tags: editCsv(e.target.value) })}
                    placeholder="tags (comma-separated)"
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={addSkill}
                className="flex items-center gap-1 rounded-md border border-dashed border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-slate-500 hover:text-slate-200"
              >
                <Plus size={14} /> Add skill card
              </button>
            </div>
          </Field>
        </>
      )}

      {showClient && (
        <>
          <div className="mt-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
            Client — remote agents
          </div>

          <Field
            label="Remote agents"
            tooltip="Remote A2A agents this agent can delegate tasks to. Those flagged as a tool are exposed to the agent as callable delegates."
          >
            <div className="space-y-2">
              {data.remoteAgents.map((remote, i) => (
                <div key={remote.id} className="rounded-md border border-slate-700 bg-slate-800/50 p-2">
                  <div className="mb-1 flex items-center gap-2">
                    <input
                      className={inputClass}
                      value={remote.name}
                      onChange={(e) => updateRemote(i, { name: e.target.value })}
                      placeholder="Agent name"
                    />
                    <button
                      type="button"
                      onClick={() => removeRemote(i)}
                      className="shrink-0 rounded p-1 text-slate-500 hover:bg-slate-700 hover:text-red-400"
                      aria-label="Remove remote agent"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <input
                    className={`${inputClass} mb-1`}
                    value={remote.cardUrl}
                    onChange={(e) => updateRemote(i, { cardUrl: e.target.value })}
                    placeholder="https://host/.well-known/agent-card.json"
                  />
                  <div className="mb-1 flex gap-2">
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
                    <input
                      className={inputClass}
                      value={remote.authRef}
                      onChange={(e) => updateRemote(i, { authRef: e.target.value })}
                      placeholder="Credential ref (env/key id)"
                    />
                  </div>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={remote.exposeAsTool}
                      onChange={(e) => updateRemote(i, { exposeAsTool: e.target.checked })}
                      className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
                    />
                    <span className="text-xs text-slate-300">Expose as a delegate tool</span>
                  </label>
                </div>
              ))}
              <button
                type="button"
                onClick={addRemote}
                className="flex items-center gap-1 rounded-md border border-dashed border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-slate-500 hover:text-slate-200"
              >
                <Plus size={14} /> Add remote agent
              </button>
            </div>
          </Field>
        </>
      )}

      <div className="mt-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
        Limits
      </div>

      <Field label="Task timeout (ms)" tooltip="Per-task wall-clock ceiling. 0 means no limit.">
        <input
          type="number"
          min={0}
          className={inputClass}
          value={data.taskTimeoutMs}
          onChange={(e) => update(nodeId, { taskTimeoutMs: Math.max(0, Number(e.target.value) || 0) })}
        />
      </Field>

      <Field
        label="Max concurrent tasks"
        tooltip="Ceiling on concurrent inbound + outbound A2A tasks."
      >
        <input
          type="number"
          min={1}
          className={inputClass}
          value={data.maxConcurrentTasks}
          onChange={(e) =>
            update(nodeId, { maxConcurrentTasks: Math.max(1, Math.floor(Number(e.target.value) || 1)) })
          }
        />
      </Field>
    </div>
  );
}
