import { useState } from 'react';
import { useGraphStore } from '../../store/graph-store';
import type {
  SandboxNodeData,
  SandboxIsolation,
  SandboxNetworkPolicy,
  SandboxViolationPolicy,
} from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const ISOLATION: { id: SandboxIsolation; label: string }[] = [
  { id: 'none', label: 'None (host process)' },
  { id: 'workdir', label: 'Workdir (confined path)' },
  { id: 'container', label: 'Container (ephemeral OCI)' },
  { id: 'microvm', label: 'MicroVM (Firecracker)' },
];

const NETWORK_POLICY: { id: SandboxNetworkPolicy; label: string }[] = [
  { id: 'none', label: 'None (offline)' },
  { id: 'allowlist', label: 'Allowlist (named hosts only)' },
  { id: 'full', label: 'Full (unrestricted)' },
];

const ON_VIOLATION: { id: SandboxViolationPolicy; label: string }[] = [
  { id: 'block', label: 'Block (refuse/kill the command)' },
  { id: 'warn', label: 'Warn (allow, emit event)' },
];

interface Props {
  nodeId: string;
  data: SandboxNodeData;
}

export default function SandboxProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);
  const [newHost, setNewHost] = useState('');

  const num = (v: string, min = 0) => Math.max(min, Number(v) || 0);

  const addHost = () => {
    const value = newHost.trim().toLowerCase();
    if (!value || data.allowedHosts.includes(value)) return;
    update(nodeId, { allowedHosts: [...data.allowedHosts, value] });
    setNewHost('');
  };

  const removeHost = (host: string) => {
    update(nodeId, { allowedHosts: data.allowedHosts.filter((h) => h !== host) });
  };

  const usesImage = data.isolation === 'container' || data.isolation === 'microvm';

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
        tooltip="When off, the node is wired but code-running tools fall back to the raw workspace path with no sandbox."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => update(nodeId, { enabled: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Sandbox code-running tools</span>
        </label>
      </Field>

      <Field
        label="Isolation"
        tooltip="Where exec / code_execution commands run. Stronger isolation costs more startup time."
      >
        <select
          className={selectClass}
          value={data.isolation}
          onChange={(e) => update(nodeId, { isolation: e.target.value as SandboxIsolation })}
        >
          {ISOLATION.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      {usesImage && (
        <Field
          label="Image"
          tooltip="OCI image or microVM rootfs the sandbox is built from, e.g. python:3.12-slim."
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
        label="Working directory"
        tooltip="Filesystem scope the sandbox mounts. Empty falls back to the agent's resolved workspace path."
      >
        <input
          className={inputClass}
          value={data.workdir}
          onChange={(e) => update(nodeId, { workdir: e.target.value })}
          placeholder="(agent workspace)"
        />
      </Field>

      <Field
        label="Read-only root"
        tooltip="Mount the root filesystem read-only; writes are confined to the workdir and /tmp."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.readOnlyRoot}
            onChange={(e) => update(nodeId, { readOnlyRoot: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Confine writes to workdir + /tmp</span>
        </label>
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Max CPU cores" tooltip="CPU ceiling in cores (fractional allowed). 0 = unlimited.">
          <input
            type="number"
            min={0}
            step={0.5}
            className={inputClass}
            value={data.maxCpuCores}
            onChange={(e) => update(nodeId, { maxCpuCores: num(e.target.value) })}
          />
        </Field>
        <Field label="Max memory (MB)" tooltip="Memory ceiling in megabytes. 0 = unlimited.">
          <input
            type="number"
            min={0}
            className={inputClass}
            value={data.maxMemoryMb}
            onChange={(e) => update(nodeId, { maxMemoryMb: Math.floor(num(e.target.value)) })}
          />
        </Field>
        <Field label="Max wall-clock (s)" tooltip="Per-command wall-clock ceiling in seconds. 0 = unlimited.">
          <input
            type="number"
            min={0}
            className={inputClass}
            value={data.maxWallClockSec}
            onChange={(e) => update(nodeId, { maxWallClockSec: Math.floor(num(e.target.value)) })}
          />
        </Field>
        <Field label="Max processes" tooltip="Max concurrent processes/PIDs in the sandbox. 0 = unlimited.">
          <input
            type="number"
            min={0}
            className={inputClass}
            value={data.maxProcesses}
            onChange={(e) => update(nodeId, { maxProcesses: Math.floor(num(e.target.value)) })}
          />
        </Field>
      </div>

      <Field
        label="Network policy"
        tooltip="Outbound egress allowed to sandboxed commands. None is safest for untrusted code."
      >
        <select
          className={selectClass}
          value={data.networkPolicy}
          onChange={(e) => update(nodeId, { networkPolicy: e.target.value as SandboxNetworkPolicy })}
        >
          {NETWORK_POLICY.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      {data.networkPolicy === 'allowlist' && (
        <Field
          label="Allowed hosts"
          tooltip="Hosts reachable under the allowlist policy. A leading *. matches any subdomain (e.g. *.pypi.org)."
        >
          <div className="flex gap-1.5">
            <input
              className={inputClass}
              value={newHost}
              onChange={(e) => setNewHost(e.target.value)}
              placeholder="*.pypi.org"
              onKeyDown={(e) => e.key === 'Enter' && addHost()}
            />
            <button
              onClick={addHost}
              className="shrink-0 rounded-md bg-slate-700 px-2.5 text-xs text-slate-300 transition hover:bg-slate-600"
            >
              Add
            </button>
          </div>
          {data.allowedHosts.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {data.allowedHosts.map((host) => (
                <span
                  key={host}
                  className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300"
                >
                  {host}
                  <button
                    type="button"
                    onClick={() => removeHost(host)}
                    className="text-slate-500 hover:text-red-400"
                    aria-label={`Remove ${host}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </Field>
      )}

      <Field
        label="On violation"
        tooltip="What to do when a ceiling, filesystem scope, or egress rule is tripped."
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

      <Field
        label="Block message"
        tooltip="Surfaced when a block policy stops a command. Empty falls back to a generic notice."
      >
        <textarea
          className={textareaClass}
          rows={2}
          value={data.blockMessage}
          onChange={(e) => update(nodeId, { blockMessage: e.target.value })}
          placeholder="Optional: message shown when a command is blocked."
        />
      </Field>
    </div>
  );
}
