import { describe, expect, it } from 'vitest';
import type { ResolvedSandboxConfig } from '../../shared/agent-config';
import {
  checkEgress,
  checkPath,
  checkResourceRequest,
  describeSandbox,
  extractHost,
  isPathWithinScope,
  isSandboxActive,
  matchHostPattern,
  normalizePath,
} from './sandbox-engine';

function makeConfig(overrides: Partial<ResolvedSandboxConfig> = {}): ResolvedSandboxConfig {
  return {
    sandboxNodeId: 's1',
    label: 'Sandbox',
    enabled: true,
    runtime: 'container',
    image: 'python:3.12-slim',
    workdir: '/work',
    confineToWorkdir: true,
    readOnlyFilesystem: false,
    egressPolicy: 'none',
    egressAllowlist: [],
    maxCpuCores: 2,
    maxMemoryMB: 2048,
    maxWallClockSec: 120,
    maxProcesses: 64,
    onViolation: 'block',
    ...overrides,
  };
}

describe('isSandboxActive', () => {
  it('is false for null/undefined/disabled and true for enabled', () => {
    expect(isSandboxActive(null)).toBe(false);
    expect(isSandboxActive(undefined)).toBe(false);
    expect(isSandboxActive(makeConfig({ enabled: false }))).toBe(false);
    expect(isSandboxActive(makeConfig())).toBe(true);
  });
});

describe('extractHost', () => {
  it('strips scheme, path, query, fragment, userinfo, and port', () => {
    expect(extractHost('https://files.pypi.org/simple/x?y=1#z')).toBe('files.pypi.org');
    expect(extractHost('http://user:pass@example.com:8080/path')).toBe('example.com');
    expect(extractHost('EXAMPLE.com')).toBe('example.com');
  });

  it('passes bare hosts through', () => {
    expect(extractHost('registry.npmjs.org')).toBe('registry.npmjs.org');
    expect(extractHost('localhost:3000')).toBe('localhost');
  });
});

describe('matchHostPattern', () => {
  it('matches exact hosts', () => {
    expect(matchHostPattern('pypi.org', 'pypi.org')).toBe(true);
    expect(matchHostPattern('pypi.org', 'npmjs.org')).toBe(false);
  });

  it('matches leading *. against the domain and its subdomains', () => {
    expect(matchHostPattern('pypi.org', '*.pypi.org')).toBe(true);
    expect(matchHostPattern('files.pypi.org', '*.pypi.org')).toBe(true);
    expect(matchHostPattern('evilpypi.org', '*.pypi.org')).toBe(false);
    expect(matchHostPattern('pypi.org.evil.com', '*.pypi.org')).toBe(false);
  });

  it('matches bare * against anything and empty against nothing', () => {
    expect(matchHostPattern('anything.com', '*')).toBe(true);
    expect(matchHostPattern('anything.com', '')).toBe(false);
    expect(matchHostPattern('', 'pypi.org')).toBe(false);
  });
});

describe('checkEgress', () => {
  it('permits everything under policy "all"', () => {
    const d = checkEgress(makeConfig({ egressPolicy: 'all' }), 'https://evil.example');
    expect(d.allowed).toBe(true);
    expect(d.action).toBe('allow');
  });

  it('denies everything under policy "none"', () => {
    const d = checkEgress(makeConfig({ egressPolicy: 'none' }), 'https://pypi.org');
    expect(d.allowed).toBe(false);
    expect(d.action).toBe('block');
    expect(d.reason).toContain('network disabled');
  });

  it('permits only allowlisted hosts under policy "allowlist"', () => {
    const config = makeConfig({ egressPolicy: 'allowlist', egressAllowlist: ['*.pypi.org'] });
    expect(checkEgress(config, 'https://files.pypi.org/simple').allowed).toBe(true);
    const denied = checkEgress(config, 'https://registry.npmjs.org');
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toContain('not in allowlist');
  });

  it('imposes no policy when disabled', () => {
    const d = checkEgress(makeConfig({ enabled: false, egressPolicy: 'none' }), 'https://x.com');
    expect(d.allowed).toBe(true);
  });
});

describe('checkResourceRequest', () => {
  it('permits requests within every ceiling', () => {
    const d = checkResourceRequest(makeConfig(), { cpuCores: 2, memoryMB: 1024, wallClockSec: 60 });
    expect(d.allowed).toBe(true);
  });

  it('rejects the first exceeded ceiling', () => {
    const d = checkResourceRequest(makeConfig(), { memoryMB: 4096 });
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('memory (MB) 4096 exceeds ceiling 2048');
  });

  it('treats a ceiling of 0 as unlimited', () => {
    const config = makeConfig({ maxMemoryMB: 0 });
    expect(checkResourceRequest(config, { memoryMB: 999999 }).allowed).toBe(true);
  });

  it('ignores dimensions the request omits', () => {
    expect(checkResourceRequest(makeConfig(), {}).allowed).toBe(true);
  });
});

describe('normalizePath', () => {
  it('resolves . and .. in relative and absolute paths', () => {
    expect(normalizePath('/work/./sub/../out')).toBe('/work/out');
    expect(normalizePath('a/b/../c')).toBe('a/c');
  });

  it('cannot escape above an absolute root but keeps leading .. when relative', () => {
    expect(normalizePath('/work/../../etc')).toBe('/etc');
    expect(normalizePath('../../etc')).toBe('../../etc');
  });
});

describe('isPathWithinScope', () => {
  it('contains paths at or beneath the scope root', () => {
    expect(isPathWithinScope('/work', '/work')).toBe(true);
    expect(isPathWithinScope('/work', '/work/sub/file.txt')).toBe(true);
    expect(isPathWithinScope('/work', 'sub/file.txt')).toBe(true);
  });

  it('rejects traversal escapes and sibling prefixes', () => {
    expect(isPathWithinScope('/work', '/work/../etc/passwd')).toBe(false);
    expect(isPathWithinScope('/work', '../etc/passwd')).toBe(false);
    expect(isPathWithinScope('/work', '/workshop/x')).toBe(false);
  });

  it('imposes no containment for an empty or root scope', () => {
    expect(isPathWithinScope('', '/anywhere')).toBe(true);
    expect(isPathWithinScope('/', '/anywhere')).toBe(true);
  });
});

describe('checkPath', () => {
  it('rejects writes on a read-only filesystem but allows reads', () => {
    const config = makeConfig({ readOnlyFilesystem: true });
    expect(checkPath(config, '/work/out.txt', 'write').allowed).toBe(false);
    expect(checkPath(config, '/work/out.txt', 'read').allowed).toBe(true);
  });

  it('rejects paths that escape the confined workdir', () => {
    const d = checkPath(makeConfig(), '/work/../etc/passwd', 'read');
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('escapes sandbox workdir');
  });

  it('falls back to scopeRoot when workdir is empty', () => {
    const config = makeConfig({ workdir: '' });
    expect(checkPath(config, '/repo/src/x', 'read', '/repo').allowed).toBe(true);
    expect(checkPath(config, '/etc/passwd', 'read', '/repo').allowed).toBe(false);
  });

  it('does not confine when confineToWorkdir is off', () => {
    const config = makeConfig({ confineToWorkdir: false });
    expect(checkPath(config, '/etc/passwd', 'read').allowed).toBe(true);
  });
});

describe('violation policy', () => {
  it('warn proceeds but flags the action', () => {
    const d = checkEgress(makeConfig({ egressPolicy: 'none', onViolation: 'warn' }), 'https://x.com');
    expect(d.allowed).toBe(true);
    expect(d.action).toBe('warn');
  });

  it('terminate refuses and signals teardown', () => {
    const d = checkEgress(makeConfig({ egressPolicy: 'none', onViolation: 'terminate' }), 'https://x.com');
    expect(d.allowed).toBe(false);
    expect(d.action).toBe('terminate');
  });
});

describe('describeSandbox', () => {
  it('summarizes runtime, egress, ceilings, and flags', () => {
    const s = describeSandbox(makeConfig());
    expect(s).toContain('container (python:3.12-slim)');
    expect(s).toContain('egress: none');
    expect(s).toContain('2 cpu / 2048MB / 120s');
    expect(s).toContain('confined');
  });

  it('renders unlimited ceilings and the local runtime', () => {
    const s = describeSandbox(makeConfig({ runtime: 'local', maxCpuCores: 0, maxMemoryMB: 0 }));
    expect(s).toContain('local');
    expect(s).toContain('∞ cpu / ∞ mem');
  });
});
