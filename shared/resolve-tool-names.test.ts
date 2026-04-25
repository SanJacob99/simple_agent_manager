import { describe, expect, it } from 'vitest';
import {
  ALL_TOOL_NAMES,
  TOOL_GROUPS,
  TOOL_NAME_ALIASES,
  canonicalizeToolName,
  resolveToolNames,
} from './resolve-tool-names';
import type { ResolvedToolsConfig } from './agent-config';

function baseConfig(overrides: Partial<ResolvedToolsConfig> = {}): ResolvedToolsConfig {
  return {
    profile: 'custom',
    enabledGroups: [],
    resolvedTools: [],
    skills: [],
    plugins: [],
    subAgentSpawning: false,
    maxSubAgents: 0,
    ...overrides,
  };
}

describe('alias canonicalization', () => {
  it('canonicalizeToolName maps known aliases to the canonical name', () => {
    expect(canonicalizeToolName('bash')).toBe('exec');
    expect(canonicalizeToolName('code_interpreter')).toBe('code_execution');
  });

  it('canonicalizeToolName returns unknown names unchanged', () => {
    expect(canonicalizeToolName('exec')).toBe('exec');
    expect(canonicalizeToolName('calculator')).toBe('calculator');
    expect(canonicalizeToolName('totally_custom_thing')).toBe('totally_custom_thing');
  });
});

describe('ALL_TOOL_NAMES (UI picker source)', () => {
  it('does not expose any aliases', () => {
    for (const alias of Object.keys(TOOL_NAME_ALIASES)) {
      expect(ALL_TOOL_NAMES).not.toContain(alias);
    }
  });

  it('contains the canonical name for every alias instead', () => {
    for (const canonical of Object.values(TOOL_NAME_ALIASES)) {
      expect(ALL_TOOL_NAMES).toContain(canonical);
    }
  });
});

describe('TOOL_GROUPS', () => {
  it('expands to canonical names only — no aliases anywhere', () => {
    for (const [group, tools] of Object.entries(TOOL_GROUPS)) {
      for (const tool of tools) {
        expect(
          Object.keys(TOOL_NAME_ALIASES),
          `group "${group}" contains alias "${tool}"`,
        ).not.toContain(tool);
      }
    }
  });
});

describe('resolveToolNames canonicalization', () => {
  it('collapses `bash` from saved enabledTools into `exec`', () => {
    const names = resolveToolNames(
      baseConfig({ resolvedTools: ['bash', 'exec', 'calculator'] }),
    );
    expect(names.filter((n) => n === 'exec')).toHaveLength(1);
    expect(names).not.toContain('bash');
    expect(names).toContain('calculator');
  });

  it('canonicalizes tools pulled in by groups', () => {
    // `runtime` expands to canonical names only (`exec`, `code_execution`)
    // after this change — but even if a downstream group map contained an
    // alias, resolveToolNames would still canonicalize it.
    const names = resolveToolNames(baseConfig({ enabledGroups: ['runtime'] }));
    expect(names).toContain('exec');
    expect(names).toContain('code_execution');
    expect(names).not.toContain('bash');
    expect(names).not.toContain('code_interpreter');
  });

  it('canonicalizes plugin-declared tool lists', () => {
    const names = resolveToolNames(
      baseConfig({
        plugins: [
          { id: 'legacy-plugin', enabled: true, tools: ['bash'], skills: [] } as any,
        ],
      }),
    );
    expect(names).toContain('exec');
    expect(names).not.toContain('bash');
  });

  it('preserves unknown tool names (plugins may add their own)', () => {
    const names = resolveToolNames(
      baseConfig({ resolvedTools: ['exec', 'some_plugin_tool'] }),
    );
    expect(names).toContain('some_plugin_tool');
  });
});
