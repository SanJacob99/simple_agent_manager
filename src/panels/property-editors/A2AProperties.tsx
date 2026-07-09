import { nanoid } from 'nanoid';
import { Plus, Trash2 } from 'lucide-react';
import { useGraphStore } from '../../store/graph-store';
import type {
  A2ANodeData,
  A2ARole,
  A2AAuthScheme,
  RemoteA2AAgent,
} from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const ROLES: { id: A2ARole; label: string }[] = [
  { id: 'both', label: 'Both (serve card + call delegates)' },
  { id: 'server', label: 'Server (publish an agent card)' },
  { id: 'client', label: 'Client (call remote delegates)' },
];

const AUTH_SCHEMES: { id: A2AAuthScheme; label: string }[] = [
  { id: 'bearer', label: 'Bearer token' },
  { id: 'apiKey', label: 'API key' },
  { id: 'none', label: 'None (trusted network only)' },
];

interface Props {
  nodeId: string;
  data: A2ANodeData;
}

export default function A2AProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);

  const serves = data.role === 'server' || data.role === 'both';
  const calls = data.role === 'client' || data.role === 'both';

  const updateRemote = (index: number, patch: Partial<RemoteA2AAgent>) => {
    const remoteAgents = data.remoteAgents.map((r, i) =>
      i === index ? { ...r, ...patch } : r,
    );
    update(nodeId, { remoteAgents });
  };

  const addRemote = () => {
    const next: RemoteA2AAgent = { id: nanoid(6), name: '', url: '', description: '' };
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
        tooltip="When off, the node is wired into the graph but no A2A card is served and no delegates are registered."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => update(nodeId, { enabled: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Expose / consume A2A</span>
        </label>
      </Field>

      <Field
        label="Role"
        tooltip="Server publishes this agent's card and accepts remote tasks; client registers remote agents as callable delegates."
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

      <Field
        label="Auth scheme"
        tooltip="Advertised on the agent card and used when calling delegates."
      >
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

      <Field
        label="Default timeout (ms)"
        tooltip="Per-task timeout for delegated calls to remote agents."
      >
        <input
          type="number"
          min={1000}
          step={1000}
          className={inputClass}
          value={data.defaultTimeoutMs}
          onChange={(e) =>
            update(nodeId, { defaultTimeoutMs: Math.max(1000, Number(e.target.value) || 1000) })
          }
        />
      </Field>

      <Field
        label="Max concurrent tasks"
        tooltip="Inbound + delegated tasks allowed to run at once before new ones queue."
      >
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

      {serves && (
        <>
          <div className="mb-1 mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Agent card (server)
          </div>
          <Field
            label="Card name"
            tooltip="Name published on this agent's card. Empty falls back to the agent's own name."
          >
            <input
              className={inputClass}
              value={data.agentName}
              onChange={(e) => update(nodeId, { agentName: e.target.value })}
              placeholder="(agent's name)"
            />
          </Field>
          <Field label="Card description" tooltip="Description published on the agent card.">
            <textarea
              className={textareaClass}
              rows={2}
              value={data.agentDescription}
              onChange={(e) => update(nodeId, { agentDescription: e.target.value })}
              placeholder="What this agent does, for remote callers."
            />
          </Field>
          <Field label="Server path" tooltip="HTTP path the A2A server mounts under.">
            <input
              className={inputClass}
              value={data.serverPath}
              onChange={(e) => update(nodeId, { serverPath: e.target.value })}
              placeholder="/a2a"
            />
          </Field>
          <Field
            label="Streaming"
            tooltip="Advertise streaming task updates (SSE) in the card's capabilities."
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
            label="Publish skills"
            tooltip="Advertise this agent's resolved tools/skills as A2A skills on the card."
          >
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={data.publishSkills}
                onChange={(e) => update(nodeId, { publishSkills: e.target.checked })}
                className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
              />
              <span className="text-xs text-slate-300">Expose skills on the card</span>
            </label>
          </Field>
        </>
      )}

      {calls && (
        <>
          <div className="mb-2 mt-4 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Remote delegates ({data.remoteAgents.length})
            </span>
            <button
              onClick={addRemote}
              className="flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
            >
              <Plus size={12} /> Add agent
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
                    title="Remove delegate"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <input
                  className={`${inputClass} mb-2`}
                  placeholder="Name"
                  value={r.name}
                  onChange={(e) => updateRemote(i, { name: e.target.value })}
                />
                <input
                  className={`${inputClass} mb-2`}
                  placeholder="https://agents.example.com/a2a"
                  value={r.url}
                  onChange={(e) => updateRemote(i, { url: e.target.value })}
                />
                <input
                  className={inputClass}
                  placeholder="Description (optional)"
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
