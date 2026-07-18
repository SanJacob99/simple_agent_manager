import type { ResolvedSandboxConfig } from '../../shared/agent-config';

/**
 * Sandbox / compute engine.
 *
 * A sandbox node defines *where and how* an agent's code-running tools (`exec`,
 * `code_execution`) run: an isolation backend, a resource ceiling
 * (CPU / memory / wall-clock / process count), a filesystem scope, and a
 * network egress policy. This module is the dependency-free substrate the
 * runtime and tool layer call before (and after) they launch a command. It owns
 * the pure decisions — is this path inside the scope, is this host reachable,
 * does this observed usage bust a ceiling, and what should happen on a
 * violation — while the runtime / tool adapter owns actually spawning the
 * container / microVM and measuring real usage.
 *
 * The orchestration the exec / code_execution tools perform:
 *
 *   1. Resolve the effective workdir with `resolveWorkdir(config, fallback)`.
 *   2. Before a command runs, reject any requested path outside the scope with
 *      `isPathWithinScope(...)` and any disallowed egress target with
 *      `isHostAllowed(...)`.
 *   3. Translate the ceilings into launch flags with `toContainerLimits(...)`
 *      (e.g. Docker `--cpus` / `--memory` / `--pids-limit`).
 *   4. After the command finishes (or is sampled), feed observed usage to
 *      `checkResourceUsage(...)` and route the result through
 *      `decideViolation(...)` to apply the `block` / `warn` policy.
 *
 * Wiring this into `server/tools/builtins/` (the exec + code_execution tools)
 * and `server/agents/run-coordinator.ts` (emit a `sandbox:violation` event) is
 * the remaining integration step; the API below is the stable surface that
 * wiring targets.
 */

/** Observed (or sampled) resource usage of a sandboxed command. */
export interface SandboxUsage {
  /** Peak CPU cores consumed. */
  cpuCores?: number;
  /** Peak resident memory in megabytes. */
  memoryMb?: number;
  /** Wall-clock seconds the command ran (or has run so far). */
  wallClockSec?: number;
  /** Peak concurrent processes/PIDs. */
  processes?: number;
}

/** A single ceiling that was exceeded. */
export interface SandboxViolation {
  /** Which ceiling tripped. */
  kind: 'cpu' | 'memory' | 'wallClock' | 'processes' | 'filesystem' | 'network';
  /** The configured ceiling (or the scope/host for filesystem/network). */
  limit: number | string;
  /** The observed value that exceeded it. */
  actual: number | string;
  /** Human-readable summary. */
  message: string;
}

/**
 * Clamp a resolved config into a well-formed shape: negative ceilings collapse
 * to 0 (unlimited), fractional process counts round down, and the allowlist is
 * trimmed/de-duplicated. Idempotent — safe to call on already-clean config.
 */
export function normalizeSandboxConfig(config: ResolvedSandboxConfig): ResolvedSandboxConfig {
  const nonNeg = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
  const hosts = Array.from(
    new Set(
      config.allowedHosts
        .map((h) => h.trim().toLowerCase())
        .filter((h) => h.length > 0),
    ),
  );
  return {
    ...config,
    maxCpuCores: nonNeg(config.maxCpuCores),
    maxMemoryMb: nonNeg(config.maxMemoryMb),
    maxWallClockSec: nonNeg(config.maxWallClockSec),
    maxProcesses: Math.floor(nonNeg(config.maxProcesses)),
    allowedHosts: hosts,
  };
}

/**
 * The effective working directory: the node's `workdir` when set, otherwise the
 * caller's fallback (the agent's resolved `workspacePath`). Trailing slashes are
 * stripped so scope comparisons are stable.
 */
export function resolveWorkdir(config: ResolvedSandboxConfig, fallback: string): string {
  const dir = config.workdir.trim() || fallback.trim();
  return dir.replace(/\/+$/, '') || dir;
}

/**
 * Normalize a POSIX-style path by resolving `.`/`..` segments *lexically*
 * (no filesystem access, so this is safe on both client and server and for
 * paths that do not exist yet). A leading `/` is preserved; the result never
 * has a trailing slash except for the root.
 */
export function normalizePath(input: string): string {
  const isAbsolute = input.startsWith('/');
  const out: string[] = [];
  for (const seg of input.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (!isAbsolute) out.push('..');
      // For absolute paths, `..` above root is a no-op (stays at root).
    } else {
      out.push(seg);
    }
  }
  const joined = out.join('/');
  return isAbsolute ? '/' + joined : joined || '.';
}

/**
 * Whether `candidate` stays inside `scopeRoot` after lexical normalization.
 * Guards against `../` escapes the way the exec tool's `sandboxWorkdir` flag
 * intends, but as a reusable pure function. A candidate equal to the scope root
 * is inside it. An empty scope root means "no filesystem confinement" and
 * always returns true.
 */
export function isPathWithinScope(candidate: string, scopeRoot: string): boolean {
  const root = normalizePath(scopeRoot);
  if (root === '' || root === '.') return true;
  const path = normalizePath(candidate);
  if (path === root) return true;
  const rootWithSep = root === '/' ? '/' : root + '/';
  return path.startsWith(rootWithSep);
}

/**
 * Whether a single host is matched by one allowlist pattern. A leading `*.`
 * matches any subdomain (`*.pypi.org` matches `files.pypi.org` and `pypi.org`
 * itself); otherwise the match is exact. Case-insensitive.
 */
export function hostMatches(host: string, pattern: string): boolean {
  const h = host.trim().toLowerCase();
  const p = pattern.trim().toLowerCase();
  if (!h || !p) return false;
  if (p.startsWith('*.')) {
    const base = p.slice(2);
    return h === base || h.endsWith('.' + base);
  }
  return h === p;
}

/**
 * Egress decision for a target host under the config's network policy.
 * - `none`: never reachable.
 * - `full`: always reachable.
 * - `allowlist`: reachable only when it matches an `allowedHosts` pattern.
 */
export function isHostAllowed(config: ResolvedSandboxConfig, host: string): boolean {
  switch (config.networkPolicy) {
    case 'full':
      return true;
    case 'none':
      return false;
    case 'allowlist':
      return config.allowedHosts.some((p) => hostMatches(host, p));
    default:
      return false;
  }
}

/**
 * Compare observed usage against the configured ceilings and return every
 * ceiling that was exceeded. A ceiling of 0 means "unlimited" and is skipped.
 * Missing usage fields are treated as "not measured" and skipped.
 */
export function checkResourceUsage(
  config: ResolvedSandboxConfig,
  usage: SandboxUsage,
): SandboxViolation[] {
  const violations: SandboxViolation[] = [];
  const over = (
    kind: SandboxViolation['kind'],
    limit: number,
    actual: number | undefined,
    unit: string,
  ) => {
    if (limit > 0 && typeof actual === 'number' && actual > limit) {
      violations.push({
        kind,
        limit,
        actual,
        message: `${kind} usage ${actual}${unit} exceeded the ${limit}${unit} ceiling`,
      });
    }
  };
  over('cpu', config.maxCpuCores, usage.cpuCores, ' cores');
  over('memory', config.maxMemoryMb, usage.memoryMb, 'MB');
  over('wallClock', config.maxWallClockSec, usage.wallClockSec, 's');
  over('processes', config.maxProcesses, usage.processes, ' procs');
  return violations;
}

/** Launch flags derived from the ceilings, keyed for a Docker/Podman-style run. */
export interface ContainerLimits {
  /** `--cpus` value, omitted when unlimited. */
  cpus?: number;
  /** `--memory` value in megabytes, omitted when unlimited. */
  memoryMb?: number;
  /** `--pids-limit` value, omitted when unlimited. */
  pidsLimit?: number;
  /** Timeout in seconds the caller should enforce around the process, omitted when unlimited. */
  timeoutSec?: number;
  /** `--network` mode implied by the egress policy. */
  network: 'none' | 'bridge';
  /** `--read-only` flag. */
  readOnly: boolean;
}

/**
 * Translate the ceilings + policy into container launch flags. Unlimited
 * ceilings (0) are omitted so the caller can leave the corresponding flag off.
 * `allowlist` maps to `bridge` here — per-host filtering is applied separately
 * via `isHostAllowed` (e.g. an egress proxy), since Docker's `--network` alone
 * cannot express a host allowlist.
 */
export function toContainerLimits(config: ResolvedSandboxConfig): ContainerLimits {
  const limits: ContainerLimits = {
    network: config.networkPolicy === 'none' ? 'none' : 'bridge',
    readOnly: config.readOnlyRoot,
  };
  if (config.maxCpuCores > 0) limits.cpus = config.maxCpuCores;
  if (config.maxMemoryMb > 0) limits.memoryMb = config.maxMemoryMb;
  if (config.maxProcesses > 0) limits.pidsLimit = config.maxProcesses;
  if (config.maxWallClockSec > 0) limits.timeoutSec = config.maxWallClockSec;
  return limits;
}

export interface SandboxDecision {
  /** What the caller should do with the command. */
  action: 'allow' | 'warn' | 'block';
  /** The violations that drove the decision (empty when allowed). */
  violations: SandboxViolation[];
  /** Message to surface when blocking/warning. Empty when allowed. */
  message: string;
}

/**
 * Apply the `onViolation` policy to a set of violations and return what the
 * caller should do. No violations → `allow`. Otherwise `block` refuses/kills the
 * command (with `blockMessage` or a generated summary) and `warn` lets it
 * proceed while signalling the caller to emit a `sandbox:violation` event.
 * A disabled sandbox never blocks.
 */
export function decideViolation(
  config: ResolvedSandboxConfig,
  violations: SandboxViolation[],
): SandboxDecision {
  if (violations.length === 0) {
    return { action: 'allow', violations: [], message: '' };
  }
  const summary = violations.map((v) => v.message).join('; ');
  if (!config.enabled || config.onViolation === 'warn') {
    return { action: 'warn', violations, message: summary };
  }
  return {
    action: 'block',
    violations,
    message: config.blockMessage.trim() || `Sandbox policy violation: ${summary}`,
  };
}

/**
 * System-prompt section describing the execution constraints so the agent
 * writes code that fits them (offline when egress is off, mindful of the
 * wall-clock ceiling, writing under the workdir). Optional — the runtime
 * appends it when a sandbox is active.
 */
export function buildSandboxPromptSection(
  config: ResolvedSandboxConfig,
  effectiveWorkdir: string,
): string {
  const lines = ['## Execution environment', ''];
  lines.push(
    `Your code and shell commands run in a ${describeIsolation(config.isolation)}.`,
  );
  if (effectiveWorkdir) {
    lines.push(`- Write files under \`${effectiveWorkdir}\`; paths outside it are refused.`);
  }
  if (config.networkPolicy === 'none') {
    lines.push('- No network access is available. Do not attempt outbound requests.');
  } else if (config.networkPolicy === 'allowlist') {
    const hosts = config.allowedHosts.length
      ? config.allowedHosts.join(', ')
      : '(none configured)';
    lines.push(`- Network egress is limited to: ${hosts}.`);
  }
  if (config.maxWallClockSec > 0) {
    lines.push(`- Each command must finish within ${config.maxWallClockSec}s.`);
  }
  if (config.maxMemoryMb > 0) {
    lines.push(`- Memory is capped at ${config.maxMemoryMb}MB.`);
  }
  return lines.join('\n');
}

function describeIsolation(isolation: ResolvedSandboxConfig['isolation']): string {
  switch (isolation) {
    case 'container':
      return 'sandboxed container';
    case 'microvm':
      return 'sandboxed microVM';
    case 'workdir':
      return 'restricted working directory';
    case 'none':
    default:
      return 'shared host environment';
  }
}
