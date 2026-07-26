import { nanoid } from 'nanoid';
import { Plus, Trash2 } from 'lucide-react';
import { useGraphStore } from '../../store/graph-store';
import type {
  A2ANodeData,
  A2ARemoteAgent,
  A2AExposureMode,
  A2AAuthScheme,
} from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const EXPOSURE_MODES: { id: A2AExposureMode; label: string }[] = [
  { id: 'both', label: 'Both (server + client)' },
  { id: 'server', label: 'Server (expose this agent)' },
  { id: 'client', label: 'Client (call remote agents)' },
];

const AUTH_SCHEMES: { id: A2AAuthScheme; label: string }[] = [
  { id: 'none', label: 'None (anonymous)' },
  { id: 'apiKey', label: 'API key (header)' },
  { id: 'bearer', label: 'Bearer token' },
  { id: 'oauth2', label: 'OAuth 2.0' },
];

/** A comma/newline-separated list <-> string[] for the skills inputs. */
function toList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

interface Props {
  nodeId: string;
  data: A2ANodeData;
}

export default function A2AProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);

  const showServer = data.exposureMode === 'server' || data.exposureMode === 'both';
  const showClient = data.exposureMode === 'client' || data.exposureMode === 'both';

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
      url: '',
      cardUrl: '',
      skills: [],
      auth: 'none',
      credentialEnvVar: '',
      enabled: true,
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
        tooltip="When off, the node is wired but no card is served and no remote delegate is callable."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => update(nodeId, { enabled: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Participate in A2A interop</span>
        </label>
      </Field>

      <Field
        label="Exposure mode"
        tooltip="Server publishes an agent card and accepts remote tasks; client calls registered remote agents; both does each."
      >
        <select
          className={selectClass}
          value={data.exposureMode}
          onChange={(e) => update(nodeId, { exposureMode: e.target.value as A2AExposureMode })}
        >
          {EXPOSURE_MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </Field>

      {showServer && (
        <>
          <div className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Server — published agent card
          </div>

          <Field
            label="Card name"
            tooltip="`name` on the published agent card. Empty falls back to the agent's name."
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
            tooltip="`description` on the published agent card. Empty falls back to the agent's description."
          >
            <textarea
              className={textareaClass}
              rows={2}
              value={data.serverDescription}
              onChange={(e) => update(nodeId, { serverDescription: e.target.value })}
              placeholder="(agent's description)"
            />
          </Field>

          <Field
            label="Advertised URL"
            tooltip="Base URL the card advertises, where remote agents reach this agent's A2A endpoint."
          >
            <input
              className={inputClass}
              value={data.serverUrl}
              onChange={(e) => update(nodeId, { serverUrl: e.target.value })}
              placeholder="https://my-agent.example.com/a2a"
            />
          </Field>

          <Field
            label="Advertised skills"
            tooltip="Skill ids/names published on the card, comma or newline separated. Empty derives them from the agent's tools and skills."
          >
            <textarea
              className={textareaClass}
              rows={2}
              value={data.advertisedSkills.join(', ')}
              onChange={(e) => update(nodeId, { advertisedSkills: toList(e.target.value) })}
              placeholder="summarize, translate, code-review"
            />
          </Field>

          <Field
            label="Streaming"
            tooltip="Advertise `message/stream` (SSE task updates) support on the card."
          >
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={data.supportsStreaming}
                onChange={(e) => update(nodeId, { supportsStreaming: e.target.checked })}
                className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
              />
              <span className="text-xs text-slate-300">Advertise streaming task updates</span>
            </label>
          </Field>

          <Field
            label="Required auth"
            tooltip="Security scheme the card requires callers to satisfy."
          >
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
        </>
      )}

      {showClient && (
        <>
          <Field
            label="Expose delegate tool"
            tooltip="Give the agent an `a2a_delegate` tool so it can hand a task to a registered remote agent."
          >
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={data.exposeDelegateTool}
                onChange={(e) => update(nodeId, { exposeDelegateTool: e.target.checked })}
                className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
              />
              <span className="text-xs text-slate-300">Expose a2a_delegate tool</span>
            </label>
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

          <div className="mb-2 mt-4 flex items-center justify-between">
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
            {data.remoteAgents.map((r, i) => (
              <div key={r.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-[10px] text-slate-500">{r.id}</span>
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
                  placeholder="Name"
                  value={r.name}
                  onChange={(e) => updateRemote(i, { name: e.target.value })}
                />
                <input
                  className={`${inputClass} mb-2`}
                  placeholder="Base URL (https://remote.example.com)"
                  value={r.url}
                  onChange={(e) => updateRemote(i, { url: e.target.value })}
                />
                <input
                  className={`${inputClass} mb-2`}
                  placeholder="Card URL override (optional)"
                  value={r.cardUrl}
                  onChange={(e) => updateRemote(i, { cardUrl: e.target.value })}
                />
                <textarea
                  className={`${textareaClass} mb-2`}
                  rows={2}
                  placeholder="Skills (comma separated)"
                  value={r.skills.join(', ')}
                  onChange={(e) => updateRemote(i, { skills: toList(e.target.value) })}
                />
                <div className="mb-2 flex gap-2">
                  <select
                    className={selectClass}
                    value={r.auth}
                    onChange={(e) => updateRemote(i, { auth: e.target.value as A2AAuthScheme })}
                  >
                    {AUTH_SCHEMES.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className={inputClass}
                    placeholder="Credential env var"
                    value={r.credentialEnvVar}
                    onChange={(e) => updateRemote(i, { credentialEnvVar: e.target.value })}
                  />
                </div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={(e) => updateRemote(i, { enabled: e.target.checked })}
                    className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
                  />
                  <span className="text-xs text-slate-300">Enabled (eligible for delegation)</span>
                </label>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
