import { nanoid } from 'nanoid';
import { Plus, Trash2 } from 'lucide-react';
import { useGraphStore } from '../../store/graph-store';
import type { A2ANodeData, A2ARemoteAgent, A2AAuthScheme } from '../../types/nodes';
import { Field, inputClass, selectClass } from './shared';

const AUTH_SCHEMES: { id: A2AAuthScheme; label: string }[] = [
  { id: 'none', label: 'None (open endpoint)' },
  { id: 'bearer', label: 'Bearer token' },
  { id: 'apiKey', label: 'API key (X-API-Key)' },
];

interface Props {
  nodeId: string;
  data: A2ANodeData;
}

export default function A2AProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);

  const csv = (values: string[]) => values.join(', ');
  const parseCsv = (raw: string) =>
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  const updateRemote = (index: number, patch: Partial<A2ARemoteAgent>) => {
    const remotes = data.remotes.map((r, i) => (i === index ? { ...r, ...patch } : r));
    update(nodeId, { remotes });
  };

  const addRemote = () => {
    const next: A2ARemoteAgent = {
      id: nanoid(6),
      name: 'Remote Agent',
      cardUrl: '',
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
        tooltip="When off, the node is wired into the graph but no A2A server or delegate is active."
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

      <div className="mt-4 mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Server — expose this agent
      </div>

      <Field
        label="Expose as A2A server"
        tooltip="Publish an agent card and accept inbound tasks from remote agents over the A2A protocol."
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

      <Field label="Agent name" tooltip="Name advertised on the published agent card.">
        <input
          className={inputClass}
          value={data.agentName}
          onChange={(e) => update(nodeId, { agentName: e.target.value })}
        />
      </Field>

      <Field label="Description" tooltip="One-line description advertised on the agent card.">
        <input
          className={inputClass}
          value={data.agentDescription}
          onChange={(e) => update(nodeId, { agentDescription: e.target.value })}
        />
      </Field>

      <div className="flex gap-2">
        <Field label="Version">
          <input
            className={inputClass}
            value={data.version}
            onChange={(e) => update(nodeId, { version: e.target.value })}
          />
        </Field>
        <Field label="Server path" tooltip="Base path the A2A endpoint is mounted at.">
          <input
            className={inputClass}
            value={data.serverPath}
            onChange={(e) => update(nodeId, { serverPath: e.target.value })}
          />
        </Field>
      </div>

      <Field
        label="Streaming"
        tooltip="Advertise streaming (SSE) task updates in the agent card's capabilities."
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

      <Field label="Input modes" tooltip="Comma-separated default input content types (e.g. text).">
        <input
          className={inputClass}
          value={csv(data.defaultInputModes)}
          onChange={(e) => update(nodeId, { defaultInputModes: parseCsv(e.target.value) })}
          placeholder="text"
        />
      </Field>

      <Field label="Output modes" tooltip="Comma-separated default output content types (e.g. text).">
        <input
          className={inputClass}
          value={csv(data.defaultOutputModes)}
          onChange={(e) => update(nodeId, { defaultOutputModes: parseCsv(e.target.value) })}
          placeholder="text"
        />
      </Field>

      <div className="mt-4 mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Client — call remote agents
      </div>

      <Field label="Auth scheme" tooltip="How outbound calls to remote delegates authenticate.">
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

      <Field label="Task timeout (ms)" tooltip="Per-task wall-clock timeout for outbound delegate calls.">
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
                <span className="font-mono text-[10px] text-slate-500">{r.id}</span>
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
              placeholder="Name"
              value={r.name}
              onChange={(e) => updateRemote(i, { name: e.target.value })}
            />
            <input
              className={inputClass}
              placeholder="Agent card URL (…/.well-known/agent-card.json)"
              value={r.cardUrl}
              onChange={(e) => updateRemote(i, { cardUrl: e.target.value })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
