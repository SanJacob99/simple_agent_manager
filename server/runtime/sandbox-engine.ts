import type {
  ResolvedSandboxConfig,
  SandboxViolationPolicy,
} from '../../shared/agent-config';

/**
 * Sandbox / compute policy engine.
 *
 * A sandbox node defines the execution environment an agent's code-running
 * tools (`exec`, `code_execution`) operate inside: an isolation level, resource
 * ceilings (CPU / memory / wall-clock), a network-egress policy, a filesystem
 * mount scope, and command allow/deny lists. This module is the dependency-free
 * decision substrate the runtime calls *before* each risky operation to decide
 * whether it is permitted — the third safety pillar alongside the Budget engine
 * (cost safety) and the Guardrails engine (content safety).
 *
 * Every check is a pure function of the resolved config and the request, so the
 * engine is deterministic and testable without a real container or clock. The
 * runtime is expected to call:
 *   - `evaluateCommand()` before spawning a shell command,
 *   - `evaluateEgress()` before opening a network connection,
 *   - `evaluatePath()` before reading/writing a file,
 *   - `evaluateResources()` after sampling a usage snapshot,
 * then apply the returned `SandboxDecision` per the node's `onViolation` policy
 * (hard-stop the operation on `block`, or let it proceed and surface a
 * `sandbox:violation` event on `warn`).
 *
 * Wiring these checks into `server/tools/tool-factory.ts` (gate the `exec` /
 * `code_execution` adapters) and provisioning the actual isolation boundary
 * (container / microVM / constrained workdir) in the tool runtime is the
 * remaining integration step; the API below is the stable surface that wiring
 * should target.
 */

export type SandboxCheck =
  | 'command_blocked'
  | 'command_not_allowed'
  | 'egress_blocked'
  | 'egress_host_not_allowed'
  | 'path_escapes_mount'
  | 'path_read_only'
  | 'cpu_ceiling'
  | 'memory_ceiling'
  | 'wall_clock_ceiling';

export interface SandboxViolation {
  sandboxNodeId: string;
  label: string;
  check: SandboxCheck;
  detail: string;
  policy: SandboxViolationPolicy;
}

export interface SandboxDecision {
  /** True when the request is permitted under the sandbox policy. */
  allowed: boolean;
  /** The action the runtime should take: allow the op, warn-and-allow, or block it. */
  action: 'allow' | 'warn' | 'block';
  /** Empty when `allowed`. Otherwise the violations that produced the decision. */
  violations: SandboxViolation[];
}

/** A sampled resource-usage snapshot for a running sandboxed operation. */
export interface ResourceSnapshot {
  cpuCores?: number;
  memoryMb?: number;
  wallClockMs?: number;
}

const ALLOW: SandboxDecision = { allowed: true, action: 'allow', violations: [] };

function decide(
  config: ResolvedSandboxConfig,
  violations: Omit<SandboxViolation, 'sandboxNodeId' | 'label' | 'policy'>[],
): SandboxDecision {
  if (violations.length === 0) return ALLOW;
  const full: SandboxViolation[] = violations.map((v) => ({
    sandboxNodeId: config.sandboxNodeId,
    label: config.label,
    policy: config.onViolation,
    ...v,
  }));
  return {
    allowed: config.onViolation !== 'block',
    action: config.onViolation === 'block' ? 'block' : 'warn',
    violations: full,
  };
}

/** The executable name from a shell command line (first bare token, path-stripped). */
export function commandName(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return '';
  // Split on whitespace; take the first token that is not an env assignment.
  const tokens = trimmed.split(/\s+/);
  let head = tokens[0];
  for (const t of tokens) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) continue; // FOO=bar prefix
    head = t;
    break;
  }
  // Strip any directory prefix: /usr/bin/git -> git, ./run.sh -> run.sh
  const slash = head.lastIndexOf('/');
  return slash >= 0 ? head.slice(slash + 1) : head;
}

/**
 * Decide whether a shell command may run. A non-empty `blockedCommands` entry
 * always denies (denylist wins); otherwise, when `allowedCommands` is non-empty,
 * only listed executables are permitted. Matching is on the executable name.
 */
export function evaluateCommand(
  config: ResolvedSandboxConfig,
  command: string,
): SandboxDecision {
  if (!config.enabled) return ALLOW;
  const name = commandName(command).toLowerCase();
  const blocked = config.blockedCommands
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  if (name && blocked.includes(name)) {
    return decide(config, [
      { check: 'command_blocked', detail: `Command "${name}" is on the sandbox denylist.` },
    ]);
  }
  const allowed = config.allowedCommands
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length > 0 && (!name || !allowed.includes(name))) {
    return decide(config, [
      {
        check: 'command_not_allowed',
        detail: `Command "${name || command.trim()}" is not on the sandbox allowlist.`,
      },
    ]);
  }
  return ALLOW;
}

/** Case-insensitive host match supporting a single leading `*.` wildcard label. */
export function hostMatches(pattern: string, host: string): boolean {
  const p = pattern.trim().toLowerCase();
  const h = host.trim().toLowerCase();
  if (!p || !h) return false;
  if (p === h) return true;
  if (p.startsWith('*.')) {
    const suffix = p.slice(1); // ".example.com"
    return h.endsWith(suffix) && h.length > suffix.length;
  }
  return false;
}

/**
 * Decide whether an outbound connection to `host` is permitted. `none` denies
 * all egress, `unrestricted` permits all, `allowlist` permits only hosts that
 * match an `allowedHosts` entry.
 */
export function evaluateEgress(
  config: ResolvedSandboxConfig,
  host: string,
): SandboxDecision {
  if (!config.enabled) return ALLOW;
  if (config.networkPolicy === 'unrestricted') return ALLOW;
  if (config.networkPolicy === 'none') {
    return decide(config, [
      { check: 'egress_blocked', detail: `Network egress to "${host}" is disabled for this sandbox.` },
    ]);
  }
  // allowlist
  const ok = config.allowedHosts.some((pat) => hostMatches(pat, host));
  if (!ok) {
    return decide(config, [
      {
        check: 'egress_host_not_allowed',
        detail: `Host "${host}" is not on the sandbox egress allowlist.`,
      },
    ]);
  }
  return ALLOW;
}

/**
 * Normalize a POSIX-style path into a list of segments, resolving `.` and `..`
 * without touching the filesystem. A leading `/` marks an absolute path. `..`
 * that would escape an absolute root is dropped (clamped at root); for relative
 * paths it is preserved as an `..` segment so escapes remain detectable.
 */
export function normalizeSegments(input: string): { absolute: boolean; segments: string[] } {
  const absolute = input.startsWith('/');
  const out: string[] = [];
  for (const raw of input.split('/')) {
    if (raw === '' || raw === '.') continue;
    if (raw === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else if (!absolute) out.push('..');
      // absolute: clamp at root, drop the '..'
      continue;
    }
    out.push(raw);
  }
  return { absolute, segments: out };
}

/** True when `childPath` resolves to a location at or beneath `root`. */
export function pathWithin(root: string, childPath: string): boolean {
  const r = normalizeSegments(root);
  // A relative child is joined onto the root; an absolute child is checked as-is.
  const child = childPath.startsWith('/')
    ? normalizeSegments(childPath)
    : normalizeSegments(`${root}/${childPath}`);
  if (child.segments.some((s) => s === '..')) return false;
  if (child.segments.length < r.segments.length) return false;
  return r.segments.every((seg, i) => child.segments[i] === seg);
}

/**
 * Decide whether a filesystem access to `targetPath` is permitted. `unrestricted`
 * permits any path; `scoped` requires the path to stay within `mountPath`;
 * `read_only` additionally blocks writes (`write === true`).
 */
export function evaluatePath(
  config: ResolvedSandboxConfig,
  targetPath: string,
  write: boolean,
): SandboxDecision {
  if (!config.enabled) return ALLOW;
  const violations: Omit<SandboxViolation, 'sandboxNodeId' | 'label' | 'policy'>[] = [];
  if (config.filesystemPolicy === 'read_only' && write) {
    violations.push({
      check: 'path_read_only',
      detail: `Write to "${targetPath}" denied: sandbox filesystem is read-only.`,
    });
  }
  if (
    (config.filesystemPolicy === 'scoped' || config.filesystemPolicy === 'read_only')
    && config.mountPath.trim()
    && !pathWithin(config.mountPath.trim(), targetPath)
  ) {
    violations.push({
      check: 'path_escapes_mount',
      detail: `Path "${targetPath}" is outside the sandbox mount "${config.mountPath.trim()}".`,
    });
  }
  return decide(config, violations);
}

/** Decide whether a sampled resource snapshot breaches any configured ceiling. */
export function evaluateResources(
  config: ResolvedSandboxConfig,
  usage: ResourceSnapshot,
): SandboxDecision {
  if (!config.enabled) return ALLOW;
  const violations: Omit<SandboxViolation, 'sandboxNodeId' | 'label' | 'policy'>[] = [];
  if (config.cpuLimit > 0 && (usage.cpuCores ?? 0) > config.cpuLimit) {
    violations.push({
      check: 'cpu_ceiling',
      detail: `CPU usage ${usage.cpuCores} cores exceeds ceiling ${config.cpuLimit}.`,
    });
  }
  if (config.memoryLimitMb > 0 && (usage.memoryMb ?? 0) > config.memoryLimitMb) {
    violations.push({
      check: 'memory_ceiling',
      detail: `Memory usage ${usage.memoryMb}MB exceeds ceiling ${config.memoryLimitMb}MB.`,
    });
  }
  if (config.wallClockLimitMs > 0 && (usage.wallClockMs ?? 0) > config.wallClockLimitMs) {
    violations.push({
      check: 'wall_clock_ceiling',
      detail: `Wall-clock ${usage.wallClockMs}ms exceeds ceiling ${config.wallClockLimitMs}ms.`,
    });
  }
  return decide(config, violations);
}

/** True when at least one decision blocked the operation. */
export function anyBlocked(decisions: SandboxDecision[]): boolean {
  return decisions.some((d) => d.action === 'block');
}
