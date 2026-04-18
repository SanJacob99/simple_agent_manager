import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '../../shared/agent-config';
import { HitlRegistry } from '../hitl/hitl-registry';
import {
  TOOL_MODULES,
  TOOL_ALIASES,
  REGISTERED_TOOL_NAMES,
  getToolModule,
  buildToolFromModule,
  resolveToolName,
} from './tool-registry';
import type { RuntimeHints } from './tool-module';
import { createAgentTools } from './tool-factory';

const MINIMAL_AGENT_CONFIG = {} as AgentConfig;

function hitlRuntime(): RuntimeHints {
  const registry = new HitlRegistry();
  return {
    cwd: '/tmp',
    hitl: {
      agentId: 'test-agent',
      getSessionKey: () => 'test-session',
      registry,
      emit: () => {},
    },
  };
}

describe('tool-registry', () => {
  it('exports unique tool names', () => {
    const names = TOOL_MODULES.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('REGISTERED_TOOL_NAMES contains every module name plus aliases', () => {
    for (const m of TOOL_MODULES) {
      expect(REGISTERED_TOOL_NAMES.has(m.name)).toBe(true);
    }
    for (const alias of Object.keys(TOOL_ALIASES)) {
      expect(REGISTERED_TOOL_NAMES.has(alias)).toBe(true);
    }
    expect(REGISTERED_TOOL_NAMES.size).toBe(
      TOOL_MODULES.length + Object.keys(TOOL_ALIASES).length,
    );
  });

  it('resolveToolName maps aliases to canonical names', () => {
    expect(resolveToolName('bash')).toBe('exec');
    expect(resolveToolName('exec')).toBe('exec');
    expect(resolveToolName('calculator')).toBe('calculator');
    expect(resolveToolName('unknown')).toBe('unknown');
  });

  it('getToolModule resolves aliases', () => {
    expect(getToolModule('bash')?.name).toBe('exec');
  });

  it('every alias points at a canonical module that actually exists', () => {
    for (const canonical of Object.values(TOOL_ALIASES)) {
      expect(TOOL_MODULES.some((m) => m.name === canonical)).toBe(true);
    }
  });

  it('getToolModule returns the module by name', () => {
    const m = getToolModule('calculator');
    expect(m).toBeDefined();
    expect(m!.label).toBe('Calculator');
  });

  it('getToolModule returns undefined for unknown names', () => {
    expect(getToolModule('no_such_tool')).toBeUndefined();
  });

  it('buildToolFromModule produces an AgentTool for calculator', () => {
    const tool = buildToolFromModule('calculator', MINIMAL_AGENT_CONFIG, { cwd: '/tmp' });
    expect(tool).not.toBeNull();
    expect(tool!.name).toBe('calculator');
    expect(typeof tool!.execute).toBe('function');
  });

  it('buildToolFromModule returns null when HITL is required but missing', () => {
    // ask_user requires runtime.hitl; without it, create() returns null.
    const tool = buildToolFromModule('ask_user', MINIMAL_AGENT_CONFIG, { cwd: '/tmp' });
    expect(tool).toBeNull();
  });

  it('buildToolFromModule produces ask_user when HITL runtime is provided', () => {
    const tool = buildToolFromModule('ask_user', MINIMAL_AGENT_CONFIG, hitlRuntime());
    expect(tool).not.toBeNull();
    expect(tool!.name).toBe('ask_user');
  });

  it('buildToolFromModule returns null for unknown names', () => {
    expect(buildToolFromModule('no_such_tool', MINIMAL_AGENT_CONFIG, { cwd: '/tmp' })).toBeNull();
  });

  it('confirm_action classification is read-only (the tool itself is a gate, not a mutation)', () => {
    expect(getToolModule('confirm_action')!.classification).toBe('read-only');
  });
});

describe('tool-factory registry integration', () => {
  it('factory serves calculator through the registry path', () => {
    const tools = createAgentTools(['calculator']);
    expect(tools.map((t) => t.name)).toContain('calculator');
  });

  it('factory serves ask_user and confirm_action when hitl context is provided', () => {
    const hitl = hitlRuntime().hitl!;
    const tools = createAgentTools(['ask_user', 'confirm_action'], [], undefined, {
      cwd: '/tmp',
      hitl,
    });
    const names = tools.map((t) => t.name);
    expect(names).toContain('ask_user');
    expect(names).toContain('confirm_action');
  });

  it('factory silently skips migrated tools when their required context is missing', () => {
    // ask_user without hitl -> no factoryContext.hitl -> module.create returns null ->
    // factory consumes the null and moves on without erroring.
    const tools = createAgentTools(['ask_user'], [], undefined, { cwd: '/tmp' });
    expect(tools.find((t) => t.name === 'ask_user')).toBeUndefined();
  });
});
