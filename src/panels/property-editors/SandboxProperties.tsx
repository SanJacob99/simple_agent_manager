import { useGraphStore } from '../../store/graph-store';
import type {
  SandboxNodeData,
  SandboxRuntime,
  SandboxEgressPolicy,
  SandboxViolationPolicy,
} from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const RUNTIMES: { id: SandboxRuntime; label: string }[] = [
  { id: 'local', label: 'Local (constrained host workdir)' },
  { id: 'container', label: 'Container (OCI image)' },
  { id: 'microvm', label: 'MicroVM (Firecracker-style)' },
  { id: 'gvisor', label: 'gVisor (userspace kernel)' },
];

const EGRESS: { id: SandboxEgressPolicy; label: string }[] = [
  { id: 'none', label: 'None (no outbound network)' },
  { id: 'allowlist', label: 'Allowlist (only listed hosts)' },
  { id: 'all', label: 'All (unrestricted)' },
];

const ON_VIOLATION: { id: SandboxViolationPolicy; label: string }[] = [
  { id: 'block', label: 'Block (refuse the operation)' },
  { id: 'warn', label: 'Warn (allow, flag it)' },
  { id: 'terminate', label: 'Terminate (kill the sandbox)' },
];

interface Props {
  nodeId: string;
  data: SandboxNodeData;
}

function NumberField({
  label,
  tooltip,
  value,
  onChange,
}: {
  label: string;
  tooltip: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <Field label={label} tooltip={tooltip}>
      <input
        type="number"
        min={0}
        className={inputClass}
        value={value}
        onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
      />
    </Field>
  );
}

export default function SandboxProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);

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
        tooltip="When off, the node is wired into the graph but no isolation, resource ceiling, or egress policy is enforced."
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
        label="Runtime"
        tooltip="Isolation backend the exec / code_execution tools run inside. Local is a constrained host directory; the rest isolate harder."
      >
        <select
          className={selectClass}
          value={data.runtime}
          onChange={(e) => update(nodeId, { runtime: e.target.value as SandboxRuntime })}
        >
          {RUNTIMES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </Field>

      {data.runtime !== 'local' && (
        <Field
          label="Image"
          tooltip="Container image or microVM template to boot (e.g. python:3.12-slim)."
        >
          <input
            className={inputClass}
            value={data.image}
            onChange={(e) => update(nodeId, { image: e.target.value })}
            placeholder="python:3.12-slim"
          />
        </Field>
      )}

      <Field
        label="Workdir"
        tooltip="Filesystem scope the sandbox may touch, absolute or relative to the workspace. Empty falls back to the agent's workspace path."
      >
        <input
          className={inputClass}
          value={data.workdir}
          onChange={(e) => update(nodeId, { workdir: e.target.value })}
          placeholder="(agent workspace)"
        />
      </Field>

      <Field
        label="Confine to workdir"
        tooltip="Reject any filesystem access that resolves outside the workdir (blocks ../ traversal escapes)."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.confineToWorkdir}
            onChange={(e) => update(nodeId, { confineToWorkdir: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Contain filesystem access</span>
        </label>
      </Field>

      <Field
        label="Read-only filesystem"
        tooltip="Mount the filesystem read-only; write attempts are treated as violations."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.readOnlyFilesystem}
            onChange={(e) => update(nodeId, { readOnlyFilesystem: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Disallow writes</span>
        </label>
      </Field>

      <Field
        label="Egress policy"
        tooltip="Outbound network posture for code running in the sandbox."
      >
        <select
          className={selectClass}
          value={data.egressPolicy}
          onChange={(e) => update(nodeId, { egressPolicy: e.target.value as SandboxEgressPolicy })}
        >
          {EGRESS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      {data.egressPolicy === 'allowlist' && (
        <Field
          label="Egress allowlist"
          tooltip="One host pattern per line. Supports exact hosts and a leading *. wildcard, e.g. *.pypi.org."
        >
          <textarea
            className={textareaClass}
            rows={3}
            value={data.egressAllowlist.join('\n')}
            onChange={(e) =>
              update(nodeId, {
                egressAllowlist: e.target.value
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder={'*.pypi.org\nregistry.npmjs.org'}
          />
        </Field>
      )}

      <NumberField
        label="Max CPU cores"
        tooltip="CPU core ceiling per execution. 0 means unlimited."
        value={data.maxCpuCores}
        onChange={(n) => update(nodeId, { maxCpuCores: n })}
      />

      <NumberField
        label="Max memory (MB)"
        tooltip="Memory ceiling per execution, in MB. 0 means unlimited."
        value={data.maxMemoryMB}
        onChange={(n) => update(nodeId, { maxMemoryMB: n })}
      />

      <NumberField
        label="Max wall-clock (s)"
        tooltip="Wall-clock ceiling per execution, in seconds. 0 means unlimited."
        value={data.maxWallClockSec}
        onChange={(n) => update(nodeId, { maxWallClockSec: n })}
      />

      <NumberField
        label="Max processes"
        tooltip="Process / thread ceiling. 0 means unlimited."
        value={data.maxProcesses}
        onChange={(n) => update(nodeId, { maxProcesses: n })}
      />

      <Field
        label="On violation"
        tooltip="What to do when an egress, resource, or path policy is violated."
      >
        <select
          className={selectClass}
          value={data.onViolation}
          onChange={(e) => update(nodeId, { onViolation: e.target.value as SandboxViolationPolicy })}
        >
          {ON_VIOLATION.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}
