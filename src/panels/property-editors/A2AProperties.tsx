import { Plus, Trash2 } from 'lucide-react';
import { useGraphStore } from '../../store/graph-store';
import type {
  A2ANodeData,
  A2ARemoteAgent,
  A2AAuthScheme,
} from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const AUTH_SCHEMES: { id: A2AAuthScheme; label: string }[] = [
  { id: 'none', label: 'None (local / dev)' },
  { id: 'bearer', label: 'Bearer token (OAuth2 / opaque)' },
  { id: 'apiKey', label: 'API key (header)' },
];

/** Parse a comma-separated mode list into a trimmed, de-duped string array. */
function parseModes(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const v = part.trim();
    if (v) seen.add(v);
  }
  return [...seen];
}

interface Props {
  nodeId: string;
  data: A2ANodeData;
}

export default function A2AProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);

  const updateRemote = (index: number, patch: Partial<A2ARemoteAgent>) => {
    const remoteAgents = data.remoteAgents.map((r, i) =>
      i === index ? { ...r, ...patch } : r,
    );
    update(nodeId, { remoteAgents });
  };

  const addRemote = () => {
    const next: A2ARemoteAgent = { name: '', cardUrl: '', description: '' };
    update(nodeId, { remoteAgents: [...data.remoteAgents, next] });
  };

  const removeRemote = (index: number) => {
    update(nodeId, {
      remoteAgents: data.remoteAgents.filter((_, i) => i !== index),
    });
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
        tooltip="When off, the node is wired into the graph but no A2A surface is served and no remote peers are registered."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => update(nodeId, { enabled: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Serve / consume A2A</span>
        </label>
      </Field>

      <div className="mt-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Server — expose this agent
      </div>

      <Field
        label="Expose as A2A server"
        tooltip="Publish an Agent Card and accept inbound tasks from remote A2A clients."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.exposeAsServer}
            onChange={(e) => update(nodeId, { exposeAsServer: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Publish an Agent Card</span>
        </label>
      </Field>

      <Field label="Agent name" tooltip="Name advertised in the Agent Card.">
        <input
          className={inputClass}
          value={data.agentName}
          onChange={(e) => update(nodeId, { agentName: e.target.value })}
          placeholder="Simple Agent"
        />
      </Field>

      <Field
        label="Agent description"
        tooltip="Description advertised in the Agent Card so peers know what this agent is for."
      >
        <textarea
          className={textareaClass}
          rows={2}
          value={data.agentDescription}
          onChange={(e) => update(nodeId, { agentDescription: e.target.value })}
          placeholder="What this agent does."
        />
      </Field>

      <Field
        label="Server path"
        tooltip="Mount path the A2A endpoint is served from (e.g. /a2a). The Agent Card is served at <path>/.well-known/agent-card.json."
      >
        <input
          className={inputClass}
          value={data.serverPath}
          onChange={(e) => update(nodeId, { serverPath: e.target.value })}
          placeholder="/a2a"
        />
      </Field>

      <Field label="Version" tooltip="Version string advertised in the Agent Card.">
        <input
          className={inputClass}
          value={data.version}
          onChange={(e) => update(nodeId, { version: e.target.value })}
          placeholder="0.1.0"
        />
      </Field>

      <Field
        label="Streaming"
        tooltip="Advertise streaming (SSE message/stream) support in the card's capabilities."
      >
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

      <Field
        label="Push notifications"
        tooltip="Advertise push-notification support (webhook callbacks for long-running tasks) in capabilities."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.pushNotifications}
            onChange={(e) =>
              update(nodeId, { pushNotifications: e.target.checked })
            }
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Advertise push notifications</span>
        </label>
      </Field>

      <Field
        label="State-transition history"
        tooltip="Advertise that the server retains task state-transition history in capabilities."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.stateTransitionHistory}
            onChange={(e) =>
              update(nodeId, { stateTransitionHistory: e.target.checked })
            }
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Advertise history</span>
        </label>
      </Field>

      <Field
        label="Default input modes"
        tooltip="Comma-separated MIME/mode strings the agent accepts (e.g. text/plain, application/json)."
      >
        <input
          className={inputClass}
          value={data.defaultInputModes.join(', ')}
          onChange={(e) =>
            update(nodeId, { defaultInputModes: parseModes(e.target.value) })
          }
          placeholder="text/plain"
        />
      </Field>

      <Field
        label="Default output modes"
        tooltip="Comma-separated MIME/mode strings the agent produces."
      >
        <input
          className={inputClass}
          value={data.defaultOutputModes.join(', ')}
          onChange={(e) =>
            update(nodeId, { defaultOutputModes: parseModes(e.target.value) })
          }
          placeholder="text/plain"
        />
      </Field>

      <Field
        label="Publish skills"
        tooltip="Expose this agent's connected Skills as A2A skills on the Agent Card."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.publishSkills}
            onChange={(e) => update(nodeId, { publishSkills: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Publish connected skills</span>
        </label>
      </Field>

      <Field
        label="Auth scheme"
        tooltip="How remote peers must authenticate to call this agent's server."
      >
        <select
          className={selectClass}
          value={data.authScheme}
          onChange={(e) =>
            update(nodeId, { authScheme: e.target.value as A2AAuthScheme })
          }
        >
          {AUTH_SCHEMES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>

      <div className="mt-4 mb-1 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Remote delegates ({data.remoteAgents.length})
        </span>
        <button
          type="button"
          onClick={addRemote}
          className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-700"
        >
          <Plus size={12} /> Add
        </button>
      </div>

      {data.remoteAgents.length === 0 && (
        <p className="mb-2 text-[11px] text-slate-500">
          No remote A2A peers. Add one to let this agent delegate tasks to an
          agent running on another framework.
        </p>
      )}

      {data.remoteAgents.map((r, i) => (
        <div
          key={i}
          className="mb-2 rounded-md border border-slate-700 bg-slate-800/40 p-2"
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-400">
              Peer {i + 1}
            </span>
            <button
              type="button"
              onClick={() => removeRemote(i)}
              className="text-slate-500 hover:text-red-400"
              aria-label="Remove peer"
            >
              <Trash2 size={13} />
            </button>
          </div>
          <input
            className={`${inputClass} mb-1`}
            value={r.name}
            onChange={(e) => updateRemote(i, { name: e.target.value })}
            placeholder="Alias (e.g. researcher)"
          />
          <input
            className={`${inputClass} mb-1`}
            value={r.cardUrl}
            onChange={(e) => updateRemote(i, { cardUrl: e.target.value })}
            placeholder="https://peer.example/.well-known/agent-card.json"
          />
          <input
            className={inputClass}
            value={r.description}
            onChange={(e) => updateRemote(i, { description: e.target.value })}
            placeholder="What this peer is for"
          />
        </div>
      ))}
    </div>
  );
}
