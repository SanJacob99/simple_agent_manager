import { useGraphStore } from '../../store/graph-store';
import type { A2ANodeData, A2ARole, A2ARemoteAgent } from '../../types/nodes';
import { Field, inputClass, selectClass } from './shared';

const ROLES: { id: A2ARole; label: string }[] = [
  { id: 'both', label: 'Both (expose + delegate)' },
  { id: 'server', label: 'Server (expose this agent)' },
  { id: 'client', label: 'Client (call remote agents)' },
];

interface Props {
  nodeId: string;
  data: A2ANodeData;
}

/** Render a string[] as a comma-separated text input. */
function csvToList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function A2AProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);

  const showServer = data.role === 'server' || data.role === 'both';
  const showClient = data.role === 'client' || data.role === 'both';

  const updateDelegate = (index: number, patch: Partial<A2ARemoteAgent>) => {
    const delegates = data.delegates.map((d, i) => (i === index ? { ...d, ...patch } : d));
    update(nodeId, { delegates });
  };

  const addDelegate = () => {
    const delegate: A2ARemoteAgent = {
      id: `d${data.delegates.length + 1}-${Date.now().toString(36)}`,
      name: '',
      cardUrl: '',
      description: '',
      enabled: true,
    };
    update(nodeId, { delegates: [...data.delegates, delegate] });
  };

  const removeDelegate = (index: number) => {
    update(nodeId, { delegates: data.delegates.filter((_, i) => i !== index) });
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
        label="Role"
        tooltip="Server exposes this agent via an A2A card; client registers remote A2A agents as callable delegates; both does each."
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

      {showServer && (
        <>
          <div className="mt-2 mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Server — expose this agent
          </div>

          <Field
            label="Card name"
            tooltip="Name published on the agent card. Leave empty to inherit the agent's own name."
          >
            <input
              className={inputClass}
              value={data.serverName}
              onChange={(e) => update(nodeId, { serverName: e.target.value })}
              placeholder="(agent's name)"
            />
          </Field>

          <Field
            label="Card description"
            tooltip="Description published on the agent card. Leave empty to inherit the agent's own description."
          >
            <input
              className={inputClass}
              value={data.serverDescription}
              onChange={(e) => update(nodeId, { serverDescription: e.target.value })}
              placeholder="(agent's description)"
            />
          </Field>

          <Field
            label="Card path"
            tooltip="The path the agent card is served from. The A2A well-known location is /.well-known/agent-card.json."
          >
            <input
              className={inputClass}
              value={data.cardPath}
              onChange={(e) => update(nodeId, { cardPath: e.target.value })}
            />
          </Field>

          <Field
            label="Input modes"
            tooltip="Comma-separated MIME types the agent accepts as input (e.g. text/plain, application/json)."
          >
            <input
              className={inputClass}
              value={data.defaultInputModes.join(', ')}
              onChange={(e) => update(nodeId, { defaultInputModes: csvToList(e.target.value) })}
              placeholder="text/plain"
            />
          </Field>

          <Field
            label="Output modes"
            tooltip="Comma-separated MIME types the agent emits as output."
          >
            <input
              className={inputClass}
              value={data.defaultOutputModes.join(', ')}
              onChange={(e) => update(nodeId, { defaultOutputModes: csvToList(e.target.value) })}
              placeholder="text/plain"
            />
          </Field>

          <Field label="Capabilities">
            <div className="space-y-1.5">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={data.streaming}
                  onChange={(e) => update(nodeId, { streaming: e.target.checked })}
                  className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
                />
                <span className="text-xs text-slate-300">Streaming task updates (SSE)</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={data.pushNotifications}
                  onChange={(e) => update(nodeId, { pushNotifications: e.target.checked })}
                  className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
                />
                <span className="text-xs text-slate-300">Push notifications</span>
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
            label="Require auth"
            tooltip="Require inbound tasks to carry a bearer token. The token itself is read from an environment variable, never stored in the graph."
          >
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={data.requireAuth}
                onChange={(e) => update(nodeId, { requireAuth: e.target.checked })}
                className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
              />
              <span className="text-xs text-slate-300">Reject unauthenticated inbound tasks</span>
            </label>
          </Field>

          {data.requireAuth && (
            <Field
              label="Auth token env var"
              tooltip="Name of the environment variable holding the accepted bearer token. The runtime reads the secret at request time."
            >
              <input
                className={inputClass}
                value={data.authTokenEnvVar}
                onChange={(e) => update(nodeId, { authTokenEnvVar: e.target.value })}
                placeholder="A2A_INBOUND_TOKEN"
              />
            </Field>
          )}
        </>
      )}

      {showClient && (
        <>
          <div className="mt-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Client — remote delegates
          </div>

          <Field
            label="Delegate tool prefix"
            tooltip="Prefix for the tool names generated from each remote agent (e.g. a2a_ → a2a_weather)."
          >
            <input
              className={inputClass}
              value={data.delegateToolPrefix}
              onChange={(e) => update(nodeId, { delegateToolPrefix: e.target.value })}
              placeholder="a2a_"
            />
          </Field>

          <Field
            label="Task timeout (ms)"
            tooltip="How long to wait for a delegated task to complete before giving up."
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

          <div className="space-y-2">
            {data.delegates.map((d, i) => (
              <div key={d.id} className="rounded-md border border-slate-700 bg-slate-800/40 p-2">
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={d.enabled}
                      onChange={(e) => updateDelegate(i, { enabled: e.target.checked })}
                      className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
                    />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      Delegate {i + 1}
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => removeDelegate(i)}
                    className="text-[10px] text-slate-500 hover:text-red-400"
                  >
                    Remove
                  </button>
                </div>
                <input
                  className={`${inputClass} mb-1.5`}
                  value={d.name}
                  onChange={(e) => updateDelegate(i, { name: e.target.value })}
                  placeholder="Name (e.g. Weather Agent)"
                />
                <input
                  className={`${inputClass} mb-1.5`}
                  value={d.cardUrl}
                  onChange={(e) => updateDelegate(i, { cardUrl: e.target.value })}
                  placeholder="https://host/.well-known/agent-card.json"
                />
                <input
                  className={inputClass}
                  value={d.description}
                  onChange={(e) => updateDelegate(i, { description: e.target.value })}
                  placeholder="When to delegate to this agent"
                />
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addDelegate}
            className="mt-2 w-full rounded-md border border-dashed border-slate-600 px-2.5 py-1.5 text-xs text-slate-400 hover:border-slate-500 hover:text-slate-300"
          >
            + Add delegate
          </button>
        </>
      )}
    </div>
  );
}
