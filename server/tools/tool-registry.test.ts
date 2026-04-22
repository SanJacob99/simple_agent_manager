import fs from 'fs/promises';
import path from 'path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { AgentConfig } from '../../shared/agent-config';
import { HitlRegistry } from '../hitl/hitl-registry';
import {
  TOOL_MODULES,
  TOOL_ALIASES,
  REGISTERED_TOOL_NAMES,
  getToolModule,
  getToolClassification,
  groupToolsByClassification,
  buildToolFromModule,
  initializeToolRegistry,
  resolveToolName,
} from './tool-registry';
import type { RuntimeHints } from './tool-module';
import { createAgentTools } from './tool-factory';

beforeAll(async () => {
  await initializeToolRegistry();
});

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

describe('classification helpers', () => {
  it('getToolClassification resolves aliases', () => {
    expect(getToolClassification('bash')).toBe('destructive');
    expect(getToolClassification('exec')).toBe('destructive');
  });

  it('getToolClassification returns undefined for unknown tools', () => {
    expect(getToolClassification('session_spawn')).toBeUndefined();
    expect(getToolClassification('no_such_tool')).toBeUndefined();
  });

  it('groupToolsByClassification splits tools by safety class', () => {
    const groups = groupToolsByClassification([
      'calculator',
      'web_search',
      'write_file',
      'exec',
      'apply_patch',
    ]);
    expect(groups.readOnly).toEqual(['calculator', 'web_search']);
    expect(groups.stateMutating).toEqual(['write_file']);
    expect(groups.destructive).toEqual(['exec', 'apply_patch']);
    expect(groups.unclassified).toEqual([]);
  });

  it('groupToolsByClassification excludes ask_user and confirm_action', () => {
    const groups = groupToolsByClassification([
      'ask_user',
      'confirm_action',
      'calculator',
    ]);
    expect(groups.readOnly).toEqual(['calculator']);
    expect(groups.stateMutating).toEqual([]);
    expect(groups.destructive).toEqual([]);
    expect(groups.unclassified).toEqual([]);
  });

  it('groupToolsByClassification folds aliases to canonical names and dedupes', () => {
    const groups = groupToolsByClassification(['exec', 'bash', 'exec']);
    expect(groups.destructive).toEqual(['exec']);
  });

  it('groupToolsByClassification puts unknown tools in the unclassified bucket', () => {
    const groups = groupToolsByClassification(['plugin_tool_x', 'calculator']);
    expect(groups.unclassified).toEqual(['plugin_tool_x']);
    expect(groups.readOnly).toEqual(['calculator']);
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

  it('factory dedupes aliases so `bash` + `exec` produce a single tool', () => {
    // Regression: when a Tools node enables both `bash` and `exec`, both
    // names reach the factory and both resolve to the `exec` module. If
    // not deduped, the agent ships two function declarations named
    // `exec` to the model and strict providers (e.g. Gemini) reject the
    // request with "Duplicate function declaration".
    const tools = createAgentTools(['bash', 'exec'], [], undefined, { cwd: '/tmp' });
    const execTools = tools.filter((t) => t.name === 'exec');
    expect(execTools).toHaveLength(1);
  });
});

describe('filesystem-scan discovery', () => {
  let extraDir: string;

  // Each scan-discovery test mutates the global registry. Restore the
  // default state afterwards so subsequent test files in the run aren't
  // contaminated by leftover tools or a stripped registry.
  afterEach(async () => {
    if (extraDir) await fs.rm(extraDir, { recursive: true, force: true });
    await initializeToolRegistry({ resetForTests: true });
  });

  async function makeExtraDir(): Promise<string> {
    // vitest restricts dynamic import() to paths under the project root,
    // so the temp extras dir must live inside the workspace. `.tmp/` is
    // already in .gitignore.
    const base = path.join(process.cwd(), '.tmp', 'tool-registry');
    await fs.mkdir(base, { recursive: true });
    extraDir = await fs.mkdtemp(path.join(base, 'extras-'));
    return extraDir;
  }

  function fakeModuleSource(name: string, label: string): string {
    return `export default {
      name: ${JSON.stringify(name)},
      label: ${JSON.stringify(label)},
      description: 'Fake user-installed tool used in tests',
      classification: 'read-only',
      resolveContext: () => ({}),
      create: () => ({
        name: ${JSON.stringify(name)},
        description: 'fake',
        label: ${JSON.stringify(label)},
        parameters: { type: 'object', properties: {} },
        execute: async () => ({ content: [], details: undefined }),
      }),
    };
    `;
  }

  it('discovers every built-in module by scanning the builtins directory', async () => {
    await initializeToolRegistry({ resetForTests: true });
    const names = TOOL_MODULES.map((m) => m.name);
    // Sample a handful of expected built-ins.
    expect(names).toContain('calculator');
    expect(names).toContain('exec');
    expect(names).toContain('text_to_speech');
    expect(names).toContain('music_generate');
    expect(names).toContain('image_generate');
    // Whatever the exact count, it's at least the 18 built-ins as of writing.
    expect(TOOL_MODULES.length).toBeGreaterThanOrEqual(18);
  });

  it('loads modules from extraDirs alongside the built-ins', async () => {
    const dir = await makeExtraDir();
    await fs.writeFile(
      path.join(dir, 'fake.module.js'),
      fakeModuleSource('fake_user_tool', 'Fake User Tool'),
    );
    await initializeToolRegistry({ resetForTests: true, extraDirs: [dir] });

    expect(TOOL_MODULES.map((m) => m.name)).toContain('fake_user_tool');
    expect(REGISTERED_TOOL_NAMES.has('fake_user_tool')).toBe(true);
    // Built-ins still loaded.
    expect(getToolModule('calculator')).toBeDefined();
  });

  it('treats a missing extraDir as fail-soft (no crash, built-ins intact)', async () => {
    const dir = await makeExtraDir();
    const missing = path.join(dir, 'does-not-exist');
    await expect(
      initializeToolRegistry({ resetForTests: true, extraDirs: [missing] }),
    ).resolves.toBeUndefined();
    expect(TOOL_MODULES.length).toBeGreaterThan(0);
  });

  it('ignores user tools whose name collides with a built-in', async () => {
    const dir = await makeExtraDir();
    await fs.writeFile(
      path.join(dir, 'imposter.module.js'),
      fakeModuleSource('calculator', 'Imposter Calculator'),
    );
    await initializeToolRegistry({ resetForTests: true, extraDirs: [dir] });
    // The built-in calculator must still own the name.
    expect(getToolModule('calculator')?.label).toBe('Calculator');
  });

  it('skips files that do not default-export a valid ToolModule', async () => {
    const dir = await makeExtraDir();
    await fs.writeFile(
      path.join(dir, 'broken.module.js'),
      `export default { name: 'broken' /* missing required fields */ };`,
    );
    await fs.writeFile(
      path.join(dir, 'valid.module.js'),
      fakeModuleSource('valid_user_tool', 'Valid'),
    );
    await initializeToolRegistry({ resetForTests: true, extraDirs: [dir] });
    const names = TOOL_MODULES.map((m) => m.name);
    expect(names).toContain('valid_user_tool');
    expect(names).not.toContain('broken');
  });
});
