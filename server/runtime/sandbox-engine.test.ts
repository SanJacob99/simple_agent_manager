import { describe, expect, it } from 'vitest';
import type { ResolvedSandboxConfig } from '../../shared/agent-config';
import {
  anyBlocked,
  commandName,
  evaluateCommand,
  evaluateEgress,
  evaluatePath,
  evaluateResources,
  hostMatches,
  normalizeSegments,
  pathWithin,
} from './sandbox-engine';

function makeSandbox(overrides: Partial<ResolvedSandboxConfig> = {}): ResolvedSandboxConfig {
  return {
    sandboxNodeId: 's1',
    label: 'Sandbox',
    enabled: true,
    isolation: 'workdir',
    cpuLimit: 0,
    memoryLimitMb: 0,
    wallClockLimitMs: 0,
    networkPolicy: 'none',
    allowedHosts: [],
    filesystemPolicy: 'scoped',
    mountPath: '/workspace',
    allowedCommands: [],
    blockedCommands: [],
    onViolation: 'block',
    ...overrides,
  };
}

describe('commandName', () => {
  it('extracts the executable, stripping paths and env prefixes', () => {
    expect(commandName('git status')).toBe('git');
    expect(commandName('/usr/bin/git status')).toBe('git');
    expect(commandName('./run.sh --flag')).toBe('run.sh');
    expect(commandName('FOO=bar BAZ=1 python script.py')).toBe('python');
    expect(commandName('   ')).toBe('');
  });
});

describe('evaluateCommand', () => {
  it('allows any command when both lists are empty', () => {
    expect(evaluateCommand(makeSandbox(), 'rm -rf /').action).toBe('allow');
  });

  it('denies a denylisted command (denylist wins)', () => {
    const cfg = makeSandbox({ blockedCommands: ['rm'], allowedCommands: ['rm', 'ls'] });
    const d = evaluateCommand(cfg, 'rm -rf /tmp');
    expect(d.allowed).toBe(false);
    expect(d.action).toBe('block');
    expect(d.violations[0].check).toBe('command_blocked');
  });

  it('denies a command absent from a non-empty allowlist', () => {
    const cfg = makeSandbox({ allowedCommands: ['git', 'ls'] });
    const d = evaluateCommand(cfg, 'curl http://x');
    expect(d.allowed).toBe(false);
    expect(d.violations[0].check).toBe('command_not_allowed');
  });

  it('allows an allowlisted command', () => {
    const cfg = makeSandbox({ allowedCommands: ['git'] });
    expect(evaluateCommand(cfg, 'git commit -m x').action).toBe('allow');
  });

  it('warns instead of blocking when onViolation is warn', () => {
    const cfg = makeSandbox({ blockedCommands: ['rm'], onViolation: 'warn' });
    const d = evaluateCommand(cfg, 'rm x');
    expect(d.allowed).toBe(true);
    expect(d.action).toBe('warn');
  });

  it('is a no-op when disabled', () => {
    const cfg = makeSandbox({ enabled: false, blockedCommands: ['rm'] });
    expect(evaluateCommand(cfg, 'rm x').action).toBe('allow');
  });
});

describe('hostMatches', () => {
  it('matches exact hosts case-insensitively', () => {
    expect(hostMatches('API.Example.com', 'api.example.com')).toBe(true);
    expect(hostMatches('example.com', 'evil.com')).toBe(false);
  });

  it('matches wildcard subdomains but not the bare apex', () => {
    expect(hostMatches('*.example.com', 'api.example.com')).toBe(true);
    expect(hostMatches('*.example.com', 'a.b.example.com')).toBe(true);
    expect(hostMatches('*.example.com', 'example.com')).toBe(false);
    expect(hostMatches('*.example.com', 'notexample.com')).toBe(false);
  });
});

describe('evaluateEgress', () => {
  it('blocks all egress under the none policy', () => {
    const d = evaluateEgress(makeSandbox({ networkPolicy: 'none' }), 'api.openai.com');
    expect(d.action).toBe('block');
    expect(d.violations[0].check).toBe('egress_blocked');
  });

  it('allows any host under unrestricted', () => {
    expect(evaluateEgress(makeSandbox({ networkPolicy: 'unrestricted' }), 'x.com').action).toBe('allow');
  });

  it('enforces the allowlist', () => {
    const cfg = makeSandbox({ networkPolicy: 'allowlist', allowedHosts: ['*.anthropic.com'] });
    expect(evaluateEgress(cfg, 'api.anthropic.com').action).toBe('allow');
    const d = evaluateEgress(cfg, 'evil.com');
    expect(d.action).toBe('block');
    expect(d.violations[0].check).toBe('egress_host_not_allowed');
  });
});

describe('normalizeSegments / pathWithin', () => {
  it('resolves . and .. and clamps absolute roots', () => {
    expect(normalizeSegments('/a/b/../c')).toEqual({ absolute: true, segments: ['a', 'c'] });
    expect(normalizeSegments('/a/../../x')).toEqual({ absolute: true, segments: ['x'] });
    expect(normalizeSegments('a/../../x')).toEqual({ absolute: false, segments: ['..', 'x'] });
  });

  it('detects containment and escapes', () => {
    expect(pathWithin('/workspace', 'src/index.ts')).toBe(true);
    expect(pathWithin('/workspace', '/workspace/src/a.ts')).toBe(true);
    expect(pathWithin('/workspace', '../etc/passwd')).toBe(false);
    expect(pathWithin('/workspace', '/etc/passwd')).toBe(false);
    expect(pathWithin('/workspace', 'src/../../secret')).toBe(false);
  });
});

describe('evaluatePath', () => {
  it('blocks writes under a read_only policy', () => {
    const cfg = makeSandbox({ filesystemPolicy: 'read_only', mountPath: '/workspace' });
    expect(evaluatePath(cfg, '/workspace/a.ts', false).action).toBe('allow');
    const d = evaluatePath(cfg, '/workspace/a.ts', true);
    expect(d.action).toBe('block');
    expect(d.violations[0].check).toBe('path_read_only');
  });

  it('blocks paths outside the mount under scoped', () => {
    const cfg = makeSandbox({ filesystemPolicy: 'scoped', mountPath: '/workspace' });
    expect(evaluatePath(cfg, 'src/a.ts', true).action).toBe('allow');
    const d = evaluatePath(cfg, '../etc/passwd', true);
    expect(d.action).toBe('block');
    expect(d.violations[0].check).toBe('path_escapes_mount');
  });

  it('allows anything under unrestricted', () => {
    const cfg = makeSandbox({ filesystemPolicy: 'unrestricted' });
    expect(evaluatePath(cfg, '/etc/passwd', true).action).toBe('allow');
  });
});

describe('evaluateResources', () => {
  it('flags each breached ceiling', () => {
    const cfg = makeSandbox({ cpuLimit: 2, memoryLimitMb: 512, wallClockLimitMs: 1000 });
    expect(evaluateResources(cfg, { cpuCores: 1, memoryMb: 100, wallClockMs: 500 }).action).toBe('allow');
    const d = evaluateResources(cfg, { cpuCores: 4, memoryMb: 1024, wallClockMs: 5000 });
    expect(d.action).toBe('block');
    expect(d.violations.map((v) => v.check)).toEqual(['cpu_ceiling', 'memory_ceiling', 'wall_clock_ceiling']);
  });

  it('treats a zero ceiling as unlimited', () => {
    const cfg = makeSandbox({ cpuLimit: 0, memoryLimitMb: 0, wallClockLimitMs: 0 });
    expect(evaluateResources(cfg, { cpuCores: 99, memoryMb: 99999, wallClockMs: 99999 }).action).toBe('allow');
  });
});

describe('anyBlocked', () => {
  it('is true when at least one decision blocked', () => {
    const cfg = makeSandbox({ networkPolicy: 'none' });
    const decisions = [
      evaluateCommand(makeSandbox(), 'ls'),
      evaluateEgress(cfg, 'x.com'),
    ];
    expect(anyBlocked(decisions)).toBe(true);
  });
});
