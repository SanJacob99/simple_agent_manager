import { useGraphStore } from '../../store/graph-store';
import type {
  SandboxNodeData,
  SandboxIsolationLevel,
  SandboxNetworkPolicy,
  SandboxFilesystemPolicy,
  SandboxViolationPolicy,
} from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const ISOLATION: { id: SandboxIsolationLevel; label: string }[] = [
  { id: 'none', label: 'None (in-process)' },
  { id: 'workdir', label: 'Constrained workdir' },
  { id: 'container', label: 'Container' },
  { id: 'microvm', label: 'microVM' },
];

const NETWORK: { id: SandboxNetworkPolicy; label: string }[] = [
  { id: 'none', label: 'None (block all egress)' },
  { id: 'allowlist', label: 'Allowlist' },
  { id: 'unrestricted', label: 'Unrestricted' },
];

const FILESYSTEM: { id: SandboxFilesystemPolicy; label: string }[] = [
  { id: 'read_only', label: 'Read-only (within mount)' },
  { id: 'scoped', label: 'Scoped to mount' },
  { id: 'unrestricted', label: 'Unrestricted' },
];

const ON_VIOLATION: { id: SandboxViolationPolicy; label: string }[] = [
  { id: 'block', label: 'Block (deny the operation)' },
  { id: 'warn', label: 'Warn (allow, flag violation)' },
];

/** Parse a newline/comma-delimited textarea into a trimmed, de-duplicated list. */
function parseList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[\n,]/)) {
    const v = part.trim();
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

interface Props {
  nodeId: string;
  data: SandboxNodeData;
}

export default function SandboxProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);
  const num = (v: string) => Math.max(0, Math.floor(Number(v) || 0));

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
        tooltip="When off, the node is wired into the graph but no execution policy is enforced."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => update(nodeId, { enabled: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Enforce the sandbox policy</span>
        </label>
      </Field>

      <Field
        label="Isolation"
        tooltip="The boundary the agent's code-running tools execute inside."
      >
        <select
          className={selectClass}
          value={data.isolation}
          onChange={(e) => update(nodeId, { isolation: e.target.value as SandboxIsolationLevel })}
        >
          {ISOLATION.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      </Field>

      <Field label="CPU limit (cores)" tooltip="Max CPU cores. 0 disables this ceiling.">
        <input
          type="number"
          min={0}
          className={inputClass}
          value={data.cpuLimit}
          onChange={(e) => update(nodeId, { cpuLimit: num(e.target.value) })}
        />
      </Field>

      <Field label="Memory limit (MB)" tooltip="Max resident memory in MB. 0 disables this ceiling.">
        <input
          type="number"
          min={0}
          className={inputClass}
          value={data.memoryLimitMb}
          onChange={(e) => update(nodeId, { memoryLimitMb: num(e.target.value) })}
        />
      </Field>

      <Field label="Wall-clock limit (ms)" tooltip="Max wall-clock per operation in ms. 0 disables this ceiling.">
        <input
          type="number"
          min={0}
          className={inputClass}
          value={data.wallClockLimitMs}
          onChange={(e) => update(nodeId, { wallClockLimitMs: num(e.target.value) })}
        />
      </Field>

      <Field label="Network egress" tooltip="Whether sandboxed operations may open outbound connections.">
        <select
          className={selectClass}
          value={data.networkPolicy}
          onChange={(e) => update(nodeId, { networkPolicy: e.target.value as SandboxNetworkPolicy })}
        >
          {NETWORK.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      </Field>

      {data.networkPolicy === 'allowlist' && (
        <Field
          label="Allowed hosts"
          tooltip="One host per line. Exact hosts, or a single leading wildcard label like *.example.com."
        >
          <textarea
            className={textareaClass}
            rows={3}
            value={data.allowedHosts.join('\n')}
            onChange={(e) => update(nodeId, { allowedHosts: parseList(e.target.value) })}
            placeholder={'api.anthropic.com\n*.openai.com'}
          />
        </Field>
      )}

      <Field label="Filesystem" tooltip="How sandboxed operations may touch the filesystem.">
        <select
          className={selectClass}
          value={data.filesystemPolicy}
          onChange={(e) => update(nodeId, { filesystemPolicy: e.target.value as SandboxFilesystemPolicy })}
        >
          {FILESYSTEM.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      </Field>

      {data.filesystemPolicy !== 'unrestricted' && (
        <Field
          label="Mount path"
          tooltip="Root the sandbox filesystem is scoped to. Leave empty to inherit the agent's working directory."
        >
          <input
            className={inputClass}
            value={data.mountPath}
            onChange={(e) => update(nodeId, { mountPath: e.target.value })}
            placeholder="/workspace"
          />
        </Field>
      )}

      <Field
        label="Allowed commands"
        tooltip="One executable per line. When set, only these commands may run. Empty permits any command not on the denylist."
      >
        <textarea
          className={textareaClass}
          rows={2}
          value={data.allowedCommands.join('\n')}
          onChange={(e) => update(nodeId, { allowedCommands: parseList(e.target.value) })}
          placeholder={'git\npython\nnode'}
        />
      </Field>

      <Field
        label="Blocked commands"
        tooltip="One executable per line. A match always denies, even if it is on the allowlist."
      >
        <textarea
          className={textareaClass}
          rows={2}
          value={data.blockedCommands.join('\n')}
          onChange={(e) => update(nodeId, { blockedCommands: parseList(e.target.value) })}
          placeholder={'rm\ncurl\nsudo'}
        />
      </Field>

      <Field label="On violation" tooltip="What the runtime does when an operation violates the policy.">
        <select
          className={selectClass}
          value={data.onViolation}
          onChange={(e) => update(nodeId, { onViolation: e.target.value as SandboxViolationPolicy })}
        >
          {ON_VIOLATION.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      </Field>
    </div>
  );
}
