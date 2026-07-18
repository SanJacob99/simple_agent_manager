import { describe, expect, it } from 'vitest';
import type { ResolvedSandboxConfig } from '../../shared/agent-config';
import {
  buildSandboxPromptSection,
  checkResourceUsage,
  decideViolation,
  hostMatches,
  isHostAllowed,
  isPathWithinScope,
  normalizePath,
  normalizeSandboxConfig,
  resolveWorkdir,
  toContainerLimits,
} from './sandbox-engine';

function makeConfig(
  overrides: Partial<ResolvedSandboxConfig> = {},
): ResolvedSandboxConfig {
  return {
    sandboxNodeId: 's1',
    label: 'Sandbox',
    enabled: true,
    isolation: 'container',
    image: 'python:3.12-slim',
    workdir: '/work',
    readOnlyRoot: false,
    maxCpuCores: 1,
    maxMemoryMb: 512,
    maxWallClockSec: 30,
    maxProcesses: 64,
    networkPolicy: 'none',
    allowedHosts: [],
    onViolation: 'block',
    blockMessage: '',
    ...overrides,
  };
}

describe('normalizeSandboxConfig', () => {
  it('clamps negative ceilings to 0 and floors process count', () => {
    const c = normalizeSandboxConfig(
      makeConfig({ maxCpuCores: -2, maxMemoryMb: -1, maxProcesses: 3.9 }),
    );
    expect(c.maxCpuCores).toBe(0);
    expect(c.maxMemoryMb).toBe(0);
    expect(c.maxProcesses).toBe(3);
  });

  it('trims, lowercases, and de-duplicates the host allowlist', () => {
    const c = normalizeSandboxConfig(
      makeConfig({ allowedHosts: [' PyPI.org ', 'pypi.org', '', 'files.pypi.org'] }),
    );
    expect(c.allowedHosts).toEqual(['pypi.org', 'files.pypi.org']);
  });

  it('is idempotent on already-clean config', () => {
    const clean = normalizeSandboxConfig(makeConfig());
    expect(normalizeSandboxConfig(clean)).toEqual(clean);
  });
});

describe('resolveWorkdir', () => {
  it('prefers the node workdir and strips trailing slashes', () => {
    expect(resolveWorkdir(makeConfig({ workdir: '/work/' }), '/fallback')).toBe('/work');
  });

  it('falls back when workdir is empty', () => {
    expect(resolveWorkdir(makeConfig({ workdir: '  ' }), '/fallback')).toBe('/fallback');
  });
});

describe('normalizePath', () => {
  it('resolves . and .. lexically for absolute paths', () => {
    expect(normalizePath('/work/./sub/../out')).toBe('/work/out');
    expect(normalizePath('/work/../../etc')).toBe('/etc');
  });

  it('keeps relative escapes for relative paths', () => {
    expect(normalizePath('../a/b')).toBe('../a/b');
    expect(normalizePath('a/./b/')).toBe('a/b');
  });
});

describe('isPathWithinScope', () => {
  it('accepts paths inside the scope and the scope root itself', () => {
    expect(isPathWithinScope('/work/sub/file.txt', '/work')).toBe(true);
    expect(isPathWithinScope('/work', '/work')).toBe(true);
  });

  it('rejects traversal escapes and sibling prefixes', () => {
    expect(isPathWithinScope('/work/../etc/passwd', '/work')).toBe(false);
    expect(isPathWithinScope('/workshop/file', '/work')).toBe(false);
  });

  it('treats an empty scope as no confinement', () => {
    expect(isPathWithinScope('/anywhere', '')).toBe(true);
  });
});

describe('hostMatches / isHostAllowed', () => {
  it('matches exact hosts and wildcard subdomains', () => {
    expect(hostMatches('pypi.org', 'pypi.org')).toBe(true);
    expect(hostMatches('files.pypi.org', '*.pypi.org')).toBe(true);
    expect(hostMatches('pypi.org', '*.pypi.org')).toBe(true);
    expect(hostMatches('evil.com', '*.pypi.org')).toBe(false);
  });

  it('none blocks all, full allows all', () => {
    expect(isHostAllowed(makeConfig({ networkPolicy: 'none' }), 'pypi.org')).toBe(false);
    expect(isHostAllowed(makeConfig({ networkPolicy: 'full' }), 'evil.com')).toBe(true);
  });

  it('allowlist honours the configured patterns', () => {
    const c = makeConfig({ networkPolicy: 'allowlist', allowedHosts: ['*.pypi.org'] });
    expect(isHostAllowed(c, 'files.pypi.org')).toBe(true);
    expect(isHostAllowed(c, 'github.com')).toBe(false);
  });
});

describe('checkResourceUsage', () => {
  it('flags each exceeded ceiling', () => {
    const v = checkResourceUsage(makeConfig(), {
      cpuCores: 2,
      memoryMb: 1024,
      wallClockSec: 45,
      processes: 100,
    });
    expect(v.map((x) => x.kind).sort()).toEqual(['cpu', 'memory', 'processes', 'wallClock']);
  });

  it('skips ceilings set to 0 (unlimited) and unmeasured fields', () => {
    const v = checkResourceUsage(
      makeConfig({ maxMemoryMb: 0 }),
      { memoryMb: 99999 },
    );
    expect(v).toEqual([]);
  });

  it('does not flag usage at or below the ceiling', () => {
    expect(checkResourceUsage(makeConfig(), { cpuCores: 1, memoryMb: 512 })).toEqual([]);
  });
});

describe('toContainerLimits', () => {
  it('maps ceilings to launch flags and omits unlimited ones', () => {
    const limits = toContainerLimits(
      makeConfig({ maxCpuCores: 0.5, maxMemoryMb: 256, maxProcesses: 0, readOnlyRoot: true }),
    );
    expect(limits).toEqual({
      network: 'none',
      readOnly: true,
      cpus: 0.5,
      memoryMb: 256,
      timeoutSec: 30,
    });
    expect(limits.pidsLimit).toBeUndefined();
  });

  it('allowlist and full map to a bridge network', () => {
    expect(toContainerLimits(makeConfig({ networkPolicy: 'allowlist' })).network).toBe('bridge');
    expect(toContainerLimits(makeConfig({ networkPolicy: 'full' })).network).toBe('bridge');
  });
});

describe('decideViolation', () => {
  it('allows when there are no violations', () => {
    expect(decideViolation(makeConfig(), []).action).toBe('allow');
  });

  it('blocks under a block policy and uses the custom message', () => {
    const d = decideViolation(
      makeConfig({ blockMessage: 'Denied.' }),
      checkResourceUsage(makeConfig(), { memoryMb: 4096 }),
    );
    expect(d.action).toBe('block');
    expect(d.message).toBe('Denied.');
  });

  it('warns under a warn policy without blocking', () => {
    const d = decideViolation(
      makeConfig({ onViolation: 'warn' }),
      checkResourceUsage(makeConfig(), { wallClockSec: 999 }),
    );
    expect(d.action).toBe('warn');
    expect(d.message).toContain('wallClock');
  });

  it('never blocks when the sandbox is disabled', () => {
    const d = decideViolation(
      makeConfig({ enabled: false }),
      checkResourceUsage(makeConfig(), { cpuCores: 8 }),
    );
    expect(d.action).toBe('warn');
  });
});

describe('buildSandboxPromptSection', () => {
  it('describes the workdir, offline egress, and time ceiling', () => {
    const section = buildSandboxPromptSection(makeConfig(), '/work');
    expect(section).toContain('/work');
    expect(section).toContain('No network access');
    expect(section).toContain('30s');
  });

  it('lists the allowlist when egress is restricted', () => {
    const section = buildSandboxPromptSection(
      makeConfig({ networkPolicy: 'allowlist', allowedHosts: ['*.pypi.org'] }),
      '/work',
    );
    expect(section).toContain('*.pypi.org');
  });
});
