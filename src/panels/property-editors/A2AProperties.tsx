import { nanoid } from 'nanoid';
import { Plus, Trash2 } from 'lucide-react';
import { useGraphStore } from '../../store/graph-store';
import type {
  A2ANodeData,
  A2ARole,
  A2AAuthScheme,
  A2ASkillDescriptor,
  A2ARemoteAgent,
} from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const ROLES: { id: A2ARole; label: string }[] = [
  { id: 'server', label: 'Server (publish a card, accept tasks)' },
  { id: 'client', label: 'Client (delegate to remote agents)' },
  { id: 'both', label: 'Both' },
];

const AUTH_SCHEMES: { id: A2AAuthScheme; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'bearer', label: 'Bearer token' },
  { id: 'apiKey', label: 'API key header' },
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

  const updateSkill = (index: number, patch: Partial<A2ASkillDescriptor>) => {
    const skills = data.skills.map((s, i) => (i === index ? { ...s, ...patch } : s));
    update(nodeId, { skills });
  };
  const addSkill = () => {
    const next: A2ASkillDescriptor = { id: nanoid(6), name: '', description: '', tags: '' };
    update(nodeId, { skills: [...data.skills, next] });
  };
  const removeSkill = (index: number) =>
    update(nodeId, { skills: data.skills.filter((_, i) => i !== index) });

  const updateRemote = (index: number, patch: Partial<A2ARemoteAgent>) => {
    const remoteAgents = data.remoteAgents.map((r, i) => (i === index ? { ...r, ...patch } : r));
    update(nodeId, { remoteAgents });
  };
  const addRemote = () => {
    const next: A2ARemoteAgent = { id: nanoid(6), name: '', cardUrl: '', authScheme: 'none' };
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
        tooltip="When off, the node is wired into the graph but no card is served and no delegate is registered."
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

      <Field label="Role" tooltip="Whether this agent publishes an A2A card, delegates to remote agents, or both.">
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
          <div className="mb-1 mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Published card
          </div>

          <Field label="Agent name" tooltip="Name published in this agent's card.">
            <input
              className={inputClass}
              value={data.agentName}
              onChange={(e) => update(nodeId, { agentName: e.target.value })}
            />
          </Field>

          <Field label="Description" tooltip="Human-readable description published in the card.">
            <textarea
              className={textareaClass}
              rows={2}
              value={data.agentDescription}
              onChange={(e) => update(nodeId, { agentDescription: e.target.value })}
            />
          </Field>

          <Field label="Server path" tooltip="Mount path the A2A server is served from (e.g. /a2a).">
            <input
              className={inputClass}
              value={data.serverPath}
              onChange={(e) => update(nodeId, { serverPath: e.target.value })}
              placeholder="/a2a"
            />
          </Field>

          <Field label="Version" tooltip="Version string published in the card.">
            <input
              className={inputClass}
              value={data.version}
              onChange={(e) => update(nodeId, { version: e.target.value })}
              placeholder="0.1.0"
            />
          </Field>

          <Field label="Input modes" tooltip="Comma-separated MIME types accepted as input.">
            <input
              className={inputClass}
              value={data.inputModes}
              onChange={(e) => update(nodeId, { inputModes: e.target.value })}
              placeholder="text/plain"
            />
          </Field>

          <Field label="Output modes" tooltip="Comma-separated MIME types produced as output.">
            <input
              className={inputClass}
              value={data.outputModes}
              onChange={(e) => update(nodeId, { outputModes: e.target.value })}
              placeholder="text/plain"
            />
          </Field>

          <Field label="Auth scheme" tooltip="Security scheme advertised on the served endpoint.">
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

          <Field label="Advertise streaming" tooltip="Advertise SSE streaming (message/stream) capability in the card.">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={data.advertiseStreaming}
                onChange={(e) => update(nodeId, { advertiseStreaming: e.target.checked })}
                className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
              />
              <span className="text-xs text-slate-300">Streaming capable</span>
            </label>
          </Field>

          <Field
            label="Advertise push notifications"
            tooltip="Advertise push-notification capability in the card."
          >
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={data.advertisePushNotifications}
                onChange={(e) => update(nodeId, { advertisePushNotifications: e.target.checked })}
                className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
              />
              <span className="text-xs text-slate-300">Push-notification capable</span>
            </label>
          </Field>

          <div className="mb-2 mt-4 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Card skills ({data.skills.length})
            </span>
            <button
              onClick={addSkill}
              className="flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
            >
              <Plus size={12} /> Add skill
            </button>
          </div>

          <div className="space-y-3">
            {data.skills.map((s, i) => (
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
                  placeholder="Description"
                  value={s.description}
                  onChange={(e) => updateSkill(i, { description: e.target.value })}
                />
                <input
                  className={inputClass}
                  placeholder="Tags (comma-separated)"
                  value={s.tags}
                  onChange={(e) => updateSkill(i, { tags: e.target.value })}
                />
              </div>
            ))}
          </div>
        </>
      )}

      {isClient && (
        <>
          <div className="mb-1 mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Remote delegates
          </div>

          <Field
            label="Forward artifacts"
            tooltip="Forward artifacts returned by a remote agent back to the caller."
          >
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={data.forwardArtifacts}
                onChange={(e) => update(nodeId, { forwardArtifacts: e.target.checked })}
                className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
              />
              <span className="text-xs text-slate-300">Return remote artifacts</span>
            </label>
          </Field>

          <div className="mb-2 mt-2 flex items-center justify-between">
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
                  placeholder="Agent name"
                  value={r.name}
                  onChange={(e) => updateRemote(i, { name: e.target.value })}
                />
                <input
                  className={`${inputClass} mb-2`}
                  placeholder="Agent card URL (/.well-known/agent-card.json)"
                  value={r.cardUrl}
                  onChange={(e) => updateRemote(i, { cardUrl: e.target.value })}
                />
                <select
                  className={selectClass}
                  value={r.authScheme}
                  onChange={(e) => updateRemote(i, { authScheme: e.target.value as A2AAuthScheme })}
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
