import type { ResolvedSandboxConfig } from '../../shared/agent-config';

/**
 * Sandbox / compute engine.
 *
 * A sandbox node defines the single execution environment the `exec` /
 * `code_execution` tools run inside. This module is the dependency-free
 * substrate the runtime and tool factory call to answer three questions before
 * (and while) code runs:
 *
 *   1. May this process reach this host? — `checkEgress`
 *   2. Does this resource request fit the ceiling? — `checkResourceRequest`
 *   3. Is this path inside the allowed filesystem scope? — `checkPath`
 *
 * Each returns a `SandboxDecision` whose `action` already folds in the node's
 * `onViolation` policy, so callers can act on it uniformly (block the op, warn
 * and proceed, or tear the sandbox down). Actually provisioning the container /
 * microVM and enforcing the ceilings at the OS level is the runtime's job;
 * wiring these checks into `server/tools/tool-factory.ts` (gate the `exec` tool)
 * and `server/agents/run-coordinator.ts` (provision on run start, emit
 * `sandbox:violation` events) is the remaining integration step. The pure API
 * below is the stable surface that wiring targets.
 */

/** What the runtime should do with an operation the sandbox evaluated. */
export type SandboxAction = 'allow' | 'block' | 'warn' | 'terminate';

/** Verdict on one sandboxed operation (egress, resource request, or path access). */
export interface SandboxDecision {
  /** Whether the operation is permitted to proceed. */
  allowed: boolean;
  /** How the runtime should act: allow it, block just this op, warn+proceed, or kill the sandbox. */
  action: SandboxAction;
  /** Human-readable explanation, suitable for a `sandbox:violation` event or log line. */
  reason: string;
}

/** A requested resource envelope for a single execution, checked against the ceilings. */
export interface ResourceRequest {
  cpuCores?: number;
  memoryMB?: number;
  wallClockSec?: number;
  processes?: number;
}

function allow(reason: string): SandboxDecision {
  return { allowed: true, action: 'allow', reason };
}

/**
 * Turn a policy violation into a decision using the node's `onViolation` mode.
 * `warn` proceeds (allowed) but flags; `block` refuses this op; `terminate`
 * tears the sandbox down.
 */
function violation(config: ResolvedSandboxConfig, reason: string): SandboxDecision {
  switch (config.onViolation) {
    case 'warn':
      return { allowed: true, action: 'warn', reason };
    case 'terminate':
      return { allowed: false, action: 'terminate', reason };
    case 'block':
    default:
      return { allowed: false, action: 'block', reason };
  }
}

/** Whether the sandbox is present and switched on. A disabled node imposes no policy. */
export function isSandboxActive(config: ResolvedSandboxConfig | null | undefined): boolean {
  return !!config && config.enabled;
}

/**
 * Extract the bare host from a URL or `host[:port]` string. Strips scheme,
 * userinfo, path/query, and a trailing numeric port, and lowercases the result.
 * Bare hosts pass through unchanged.
 */
export function extractHost(target: string): string {
  let t = target.trim();
  const scheme = t.indexOf('://');
  if (scheme !== -1) t = t.slice(scheme + 3);
  const at = t.indexOf('@');
  if (at !== -1) t = t.slice(at + 1);
  t = t.split('/')[0].split('?')[0].split('#')[0];
  const colon = t.lastIndexOf(':');
  if (colon !== -1 && /^\d+$/.test(t.slice(colon + 1))) t = t.slice(0, colon);
  return t.toLowerCase();
}

/**
 * Match a host against an allowlist pattern. Supports an exact host, a leading
 * `*.` wildcard that matches the domain and any subdomain (`*.pypi.org` matches
 * `pypi.org` and `files.pypi.org`), and a bare `*` that matches anything.
 */
export function matchHostPattern(host: string, pattern: string): boolean {
  const h = host.trim().toLowerCase();
  const p = pattern.trim().toLowerCase();
  if (!p || !h) return false;
  if (p === '*') return true;
  if (p.startsWith('*.')) {
    const base = p.slice(2); // "example.com"
    return h === base || h.endsWith('.' + base);
  }
  return h === p;
}

/**
 * Decide whether the sandbox may reach `target` (a URL or host). `all` permits
 * everything, `none` denies everything, `allowlist` permits only hosts matching
 * `egressAllowlist`. A disabled sandbox imposes no egress policy.
 */
export function checkEgress(config: ResolvedSandboxConfig, target: string): SandboxDecision {
  if (!config.enabled) return allow('sandbox disabled');
  const host = extractHost(target);
  if (config.egressPolicy === 'all') {
    return allow(`egress to ${host} permitted (policy: all)`);
  }
  if (config.egressPolicy === 'none') {
    return violation(config, `egress to ${host} denied (network disabled)`);
  }
  const permitted = config.egressAllowlist.some((pat) => matchHostPattern(host, pat));
  return permitted
    ? allow(`egress to ${host} permitted (allowlisted)`)
    : violation(config, `egress to ${host} denied (not in allowlist)`);
}

/**
 * Verify a requested resource envelope fits every configured ceiling. A ceiling
 * of `0` means unlimited and is never a violation. The first exceeded ceiling
 * decides the result. A disabled sandbox imposes no ceilings.
 */
export function checkResourceRequest(
  config: ResolvedSandboxConfig,
  req: ResourceRequest,
): SandboxDecision {
  if (!config.enabled) return allow('sandbox disabled');
  const checks: Array<[number | undefined, number, string]> = [
    [req.cpuCores, config.maxCpuCores, 'CPU cores'],
    [req.memoryMB, config.maxMemoryMB, 'memory (MB)'],
    [req.wallClockSec, config.maxWallClockSec, 'wall-clock (s)'],
    [req.processes, config.maxProcesses, 'processes'],
  ];
  for (const [requested, ceiling, name] of checks) {
    if (typeof requested === 'number' && ceiling > 0 && requested > ceiling) {
      return violation(config, `requested ${name} ${requested} exceeds ceiling ${ceiling}`);
    }
  }
  return allow('resource request within ceilings');
}

/**
 * Normalize a POSIX-style path by resolving `.` and `..` segments without
 * touching the filesystem. Absolute paths cannot escape above `/`; relative
 * paths keep leading `..` segments. Pure and platform-independent so it is safe
 * to unit test and to run identically on any host.
 */
export function normalizePath(p: string): string {
  const isAbs = p.startsWith('/');
  const stack: string[] = [];
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (stack.length && stack[stack.length - 1] !== '..') stack.pop();
      else if (!isAbs) stack.push('..');
      // absolute: a `..` at root is a no-op — cannot escape above `/`.
    } else {
      stack.push(part);
    }
  }
  return (isAbs ? '/' : '') + stack.join('/');
}

/**
 * Whether `requested` resolves to a location at or beneath `scopeRoot`. A
 * relative `requested` is resolved against `scopeRoot` first. An empty scope
 * (no `workdir`) imposes no containment and returns true.
 */
export function isPathWithinScope(scopeRoot: string, requested: string): boolean {
  const root = normalizePath(scopeRoot);
  if (root === '' || root === '/') return true;
  const abs = requested.startsWith('/')
    ? normalizePath(requested)
    : normalizePath(root + '/' + requested);
  return abs === root || abs.startsWith(root + '/');
}

/**
 * Decide whether the sandbox may access `requested` for `mode`. Read-only
 * filesystems reject writes; `confineToWorkdir` rejects any path that escapes
 * the sandbox `workdir` (falling back to `scopeRoot`, typically the agent's
 * `workspacePath`). A disabled sandbox imposes no path policy.
 */
export function checkPath(
  config: ResolvedSandboxConfig,
  requested: string,
  mode: 'read' | 'write',
  scopeRoot = '',
): SandboxDecision {
  if (!config.enabled) return allow('sandbox disabled');
  if (config.readOnlyFilesystem && mode === 'write') {
    return violation(config, `write to ${requested} denied (read-only filesystem)`);
  }
  if (config.confineToWorkdir) {
    const root = config.workdir || scopeRoot;
    if (root && !isPathWithinScope(root, requested)) {
      return violation(config, `path ${requested} escapes sandbox workdir ${root}`);
    }
  }
  return allow(`path ${requested} permitted (${mode})`);
}

/**
 * One-line human summary of the sandbox posture, for logs and the node's live
 * status hint. Example: `container (python:3.12-slim) · egress: none · 2 cpu /
 * 2048MB / 120s · confined`.
 */
export function describeSandbox(config: ResolvedSandboxConfig): string {
  const parts: string[] = [];
  parts.push(config.runtime === 'local' ? 'local' : `${config.runtime} (${config.image || 'no image'})`);
  parts.push(`egress: ${config.egressPolicy}`);
  const cpu = config.maxCpuCores > 0 ? `${config.maxCpuCores} cpu` : '∞ cpu';
  const mem = config.maxMemoryMB > 0 ? `${config.maxMemoryMB}MB` : '∞ mem';
  const wall = config.maxWallClockSec > 0 ? `${config.maxWallClockSec}s` : '∞ time';
  parts.push(`${cpu} / ${mem} / ${wall}`);
  if (config.confineToWorkdir) parts.push('confined');
  if (config.readOnlyFilesystem) parts.push('read-only');
  return parts.join(' · ');
}
