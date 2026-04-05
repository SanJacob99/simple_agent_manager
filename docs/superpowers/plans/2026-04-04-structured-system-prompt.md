# Structured System Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain-string system prompt with a structured, app-assembled system prompt that supports three modes (auto/append/manual), with section-level visibility and token accounting.

**Architecture:** The agent node gains a `systemPromptMode` field. A pure `buildSystemPrompt()` function in `shared/` assembles sections from graph node data into a `ResolvedSystemPrompt` object. `resolveAgentConfig()` calls it. The runtime reads `.assembled`. Context engine loses `systemPromptAdditions` and gains bootstrap truncation limits.

**Tech Stack:** TypeScript, Vitest, React 19, Zustand, @xyflow/react

---

### Task 1: Add shared types (SystemPromptMode, ResolvedSystemPrompt)

**Files:**
- Modify: `shared/agent-config.ts`

- [ ] **Step 1: Write the failing test**

Create a test that imports the new types. This validates they exist and are exported.

```ts
// shared/system-prompt-builder.test.ts
import { describe, it, expect } from 'vitest';
import type { SystemPromptMode, SystemPromptSection, ResolvedSystemPrompt } from './agent-config';

describe('shared types', () => {
  it('SystemPromptMode accepts the three valid modes', () => {
    const modes: SystemPromptMode[] = ['auto', 'append', 'manual'];
    expect(modes).toHaveLength(3);
  });

  it('ResolvedSystemPrompt has the expected shape', () => {
    const prompt: ResolvedSystemPrompt = {
      mode: 'auto',
      sections: [
        { key: 'safety', label: 'Safety', content: 'Be safe.', tokenEstimate: 2 },
      ],
      assembled: 'Be safe.',
      userInstructions: '',
    };
    expect(prompt.sections).toHaveLength(1);
    expect(prompt.assembled).toBe('Be safe.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/system-prompt-builder.test.ts`
Expected: FAIL — cannot import `SystemPromptMode` / `ResolvedSystemPrompt` from `./agent-config`

- [ ] **Step 3: Add types to shared/agent-config.ts**

Add these types after the existing `CompactionStrategy` type alias (line 6):

```ts
export type SystemPromptMode = 'auto' | 'append' | 'manual';

export interface SystemPromptSection {
  key: string;
  label: string;
  content: string;
  tokenEstimate: number;
}

export interface ResolvedSystemPrompt {
  mode: SystemPromptMode;
  sections: SystemPromptSection[];
  assembled: string;
  userInstructions: string;
}
```

Change the `AgentConfig` interface `systemPrompt` field from `string` to `ResolvedSystemPrompt`:

```ts
// In AgentConfig interface, change:
systemPrompt: ResolvedSystemPrompt;  // was: string
```

Remove `systemPromptAdditions` from `ResolvedContextEngineConfig`:

```ts
// In ResolvedContextEngineConfig, remove this line:
// systemPromptAdditions: string[];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/system-prompt-builder.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/agent-config.ts shared/system-prompt-builder.test.ts
git commit -m "feat: add SystemPromptMode and ResolvedSystemPrompt types"
```

---

### Task 2: Add systemPromptMode to AgentNodeData and ContextEngine bootstrap fields

**Files:**
- Modify: `src/types/nodes.ts`
- Modify: `src/utils/default-nodes.ts`

- [ ] **Step 1: Update AgentNodeData in src/types/nodes.ts**

Import `SystemPromptMode` and add the field to `AgentNodeData`:

```ts
// At the top of the file, add:
import type { SystemPromptMode } from '../../shared/agent-config';
```

Add to `AgentNodeData` (after `modelCapabilities`):

```ts
  systemPromptMode: SystemPromptMode;
```

- [ ] **Step 2: Update ContextEngineNodeData in src/types/nodes.ts**

Add new fields and remove `systemPromptAdditions`:

```ts
export interface ContextEngineNodeData {
  [key: string]: unknown;
  type: 'contextEngine';
  label: string;
  tokenBudget: number;
  reservedForResponse: number;
  ownsCompaction: boolean;
  compactionStrategy: CompactionStrategy;
  compactionTrigger: 'auto' | 'manual' | 'threshold';
  compactionThreshold: number;
  autoFlushBeforeCompact: boolean;
  ragEnabled: boolean;
  ragTopK: number;
  ragMinScore: number;
  bootstrapMaxChars: number;
  bootstrapTotalMaxChars: number;
}
```

Note: `systemPromptAdditions` is removed entirely.

- [ ] **Step 3: Update defaults in src/utils/default-nodes.ts**

In the `'agent'` case, add:

```ts
  systemPromptMode: 'auto' as SystemPromptMode,
```

Import `SystemPromptMode` at the top:

```ts
import type { SystemPromptMode } from '../../shared/agent-config';
```

In the `'contextEngine'` case, remove `systemPromptAdditions: [],` and add:

```ts
  bootstrapMaxChars: 20000,
  bootstrapTotalMaxChars: 150000,
```

- [ ] **Step 4: Run existing tests to check nothing is broken yet**

Run: `npx vitest run src/utils/graph-to-agent.test.ts`
Expected: May fail due to `systemPromptAdditions` removal — that's expected and will be fixed in Task 4.

- [ ] **Step 5: Commit**

```bash
git add src/types/nodes.ts src/utils/default-nodes.ts
git commit -m "feat: add systemPromptMode to AgentNodeData, bootstrap limits to ContextEngine"
```

---

### Task 3: Implement buildSystemPrompt() pure function

**Files:**
- Create: `shared/system-prompt-builder.ts`
- Modify: `shared/system-prompt-builder.test.ts` (extend from Task 1)

- [ ] **Step 1: Write failing tests for all three modes**

Replace/extend `shared/system-prompt-builder.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from './system-prompt-builder';
import type { SystemPromptBuilderInput } from './system-prompt-builder';

function makeInput(overrides: Partial<SystemPromptBuilderInput> = {}): SystemPromptBuilderInput {
  return {
    mode: 'auto',
    userInstructions: '',
    safetyGuardrails: '## Safety\nBe safe.',
    toolsSummary: null,
    skillsSummary: null,
    workspacePath: null,
    bootstrapFiles: null,
    bootstrapMaxChars: 20000,
    bootstrapTotalMaxChars: 150000,
    timezone: null,
    runtimeMeta: {
      host: 'simple-agent-manager',
      os: 'linux',
      model: 'claude-sonnet-4-20250514',
      thinkingLevel: 'off',
    },
    ...overrides,
  };
}

describe('buildSystemPrompt', () => {
  describe('auto mode', () => {
    it('includes safety and runtime sections', () => {
      const result = buildSystemPrompt(makeInput());
      expect(result.mode).toBe('auto');
      expect(result.sections.find(s => s.key === 'safety')).toBeDefined();
      expect(result.sections.find(s => s.key === 'runtime')).toBeDefined();
      expect(result.assembled).toContain('Be safe.');
    });

    it('ignores userInstructions', () => {
      const result = buildSystemPrompt(makeInput({ userInstructions: 'Custom stuff' }));
      expect(result.assembled).not.toContain('Custom stuff');
      expect(result.sections.find(s => s.key === 'userInstructions')).toBeUndefined();
    });

    it('includes tooling section when toolsSummary is provided', () => {
      const result = buildSystemPrompt(makeInput({ toolsSummary: 'web_fetch, calculator' }));
      const section = result.sections.find(s => s.key === 'tooling');
      expect(section).toBeDefined();
      expect(section!.content).toContain('web_fetch');
    });

    it('skips tooling section when toolsSummary is null', () => {
      const result = buildSystemPrompt(makeInput({ toolsSummary: null }));
      expect(result.sections.find(s => s.key === 'tooling')).toBeUndefined();
    });

    it('includes skills section when skillsSummary is provided', () => {
      const result = buildSystemPrompt(makeInput({ skillsSummary: 'research, coding' }));
      const section = result.sections.find(s => s.key === 'skills');
      expect(section).toBeDefined();
      expect(section!.content).toContain('research');
    });

    it('includes workspace section with bootstrap files', () => {
      const result = buildSystemPrompt(makeInput({
        workspacePath: '/home/user/project',
        bootstrapFiles: [
          { name: 'IDENTITY.md', content: 'I am a research agent.' },
        ],
      }));
      const section = result.sections.find(s => s.key === 'workspace');
      expect(section).toBeDefined();
      expect(section!.content).toContain('/home/user/project');
      expect(section!.content).toContain('I am a research agent.');
    });

    it('includes time section when timezone is provided', () => {
      const result = buildSystemPrompt(makeInput({ timezone: 'America/New_York' }));
      const section = result.sections.find(s => s.key === 'time');
      expect(section).toBeDefined();
      expect(section!.content).toContain('America/New_York');
    });

    it('skips time section when timezone is null', () => {
      const result = buildSystemPrompt(makeInput({ timezone: null }));
      expect(result.sections.find(s => s.key === 'time')).toBeUndefined();
    });
  });

  describe('append mode', () => {
    it('includes all auto sections plus userInstructions at the end', () => {
      const result = buildSystemPrompt(makeInput({
        mode: 'append',
        userInstructions: 'Always be concise.',
      }));
      expect(result.mode).toBe('append');
      expect(result.sections.find(s => s.key === 'safety')).toBeDefined();
      const userSection = result.sections.find(s => s.key === 'userInstructions');
      expect(userSection).toBeDefined();
      expect(userSection!.content).toContain('Always be concise.');
      // userInstructions must be the last section
      expect(result.sections[result.sections.length - 1].key).toBe('userInstructions');
    });

    it('skips userInstructions section when instructions are empty', () => {
      const result = buildSystemPrompt(makeInput({
        mode: 'append',
        userInstructions: '',
      }));
      expect(result.sections.find(s => s.key === 'userInstructions')).toBeUndefined();
    });
  });

  describe('manual mode', () => {
    it('returns only the user instructions as a single section', () => {
      const result = buildSystemPrompt(makeInput({
        mode: 'manual',
        userInstructions: 'Full custom prompt.',
        safetyGuardrails: '## Safety\nBe safe.',
      }));
      expect(result.mode).toBe('manual');
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].key).toBe('manual');
      expect(result.assembled).toBe('Full custom prompt.');
      expect(result.assembled).not.toContain('Be safe.');
    });
  });

  describe('bootstrap truncation', () => {
    it('truncates individual files to bootstrapMaxChars', () => {
      const longContent = 'x'.repeat(500);
      const result = buildSystemPrompt(makeInput({
        workspacePath: '/project',
        bootstrapFiles: [{ name: 'BIG.md', content: longContent }],
        bootstrapMaxChars: 100,
      }));
      const section = result.sections.find(s => s.key === 'workspace');
      expect(section!.content).toContain('[truncated]');
      expect(section!.content).not.toContain('x'.repeat(500));
    });

    it('caps total bootstrap content to bootstrapTotalMaxChars', () => {
      const files = Array.from({ length: 10 }, (_, i) => ({
        name: `FILE_${i}.md`,
        content: 'y'.repeat(200),
      }));
      const result = buildSystemPrompt(makeInput({
        workspacePath: '/project',
        bootstrapFiles: files,
        bootstrapMaxChars: 20000,
        bootstrapTotalMaxChars: 500,
      }));
      const section = result.sections.find(s => s.key === 'workspace');
      // Not all 10 files * 200 chars should be present
      const fileMatches = section!.content.match(/FILE_\d+\.md/g) || [];
      expect(fileMatches.length).toBeLessThan(10);
    });
  });

  describe('token estimates', () => {
    it('sets tokenEstimate on each section', () => {
      const result = buildSystemPrompt(makeInput());
      for (const section of result.sections) {
        expect(section.tokenEstimate).toBeGreaterThan(0);
      }
    });
  });

  describe('assembled output', () => {
    it('joins all section contents with double newlines', () => {
      const result = buildSystemPrompt(makeInput({
        toolsSummary: 'web_fetch',
      }));
      const parts = result.sections.map(s => s.content);
      expect(result.assembled).toBe(parts.join('\n\n'));
    });
  });

  it('preserves userInstructions in the output', () => {
    const result = buildSystemPrompt(makeInput({
      mode: 'append',
      userInstructions: 'My instructions',
    }));
    expect(result.userInstructions).toBe('My instructions');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run shared/system-prompt-builder.test.ts`
Expected: FAIL — `buildSystemPrompt` does not exist yet

- [ ] **Step 3: Implement buildSystemPrompt**

Create `shared/system-prompt-builder.ts`:

```ts
import { estimateTokens } from './token-estimator';
import type { SystemPromptMode, SystemPromptSection, ResolvedSystemPrompt } from './agent-config';

export interface SystemPromptBuilderInput {
  mode: SystemPromptMode;
  userInstructions: string;
  safetyGuardrails: string;
  toolsSummary: string | null;
  skillsSummary: string | null;
  workspacePath: string | null;
  bootstrapFiles: { name: string; content: string }[] | null;
  bootstrapMaxChars: number;
  bootstrapTotalMaxChars: number;
  timezone: string | null;
  runtimeMeta: {
    host: string;
    os: string;
    model: string;
    thinkingLevel: string;
  };
}

function makeSection(key: string, label: string, content: string): SystemPromptSection {
  return { key, label, content, tokenEstimate: estimateTokens(content) };
}

function truncateFile(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + '\n[truncated]';
}

function buildWorkspaceContent(
  workspacePath: string,
  files: { name: string; content: string }[],
  maxPerFile: number,
  maxTotal: number,
): string {
  let result = `## Workspace\n\nWorking directory: ${workspacePath}`;
  if (files.length === 0) return result;

  result += '\n\n### Project Context\n';
  let totalChars = 0;

  for (const file of files) {
    const truncated = truncateFile(file.content, maxPerFile);
    if (totalChars + truncated.length > maxTotal) break;
    result += `\n#### ${file.name}\n${truncated}\n`;
    totalChars += truncated.length;
  }

  return result;
}

function buildAutoSections(input: SystemPromptBuilderInput): SystemPromptSection[] {
  const sections: SystemPromptSection[] = [];

  // 1. Safety
  if (input.safetyGuardrails) {
    sections.push(makeSection('safety', 'Safety Guardrails', input.safetyGuardrails));
  }

  // 2. Tooling
  if (input.toolsSummary) {
    sections.push(makeSection('tooling', 'Tooling', `## Tooling\n\n${input.toolsSummary}`));
  }

  // 3. Skills
  if (input.skillsSummary) {
    sections.push(makeSection('skills', 'Skills', `## Skills\n\n${input.skillsSummary}`));
  }

  // 4. Workspace + bootstrap files
  if (input.workspacePath) {
    const content = buildWorkspaceContent(
      input.workspacePath,
      input.bootstrapFiles ?? [],
      input.bootstrapMaxChars,
      input.bootstrapTotalMaxChars,
    );
    sections.push(makeSection('workspace', 'Workspace', content));
  }

  // 5. Time
  if (input.timezone) {
    sections.push(makeSection('time', 'Current Date & Time', `## Current Date & Time\n\nTimezone: ${input.timezone}`));
  }

  // 6. Runtime
  const { host, os, model, thinkingLevel } = input.runtimeMeta;
  sections.push(makeSection(
    'runtime',
    'Runtime',
    `## Runtime\n\n${host} | ${os} | ${model} | thinking: ${thinkingLevel}`,
  ));

  return sections;
}

export function buildSystemPrompt(input: SystemPromptBuilderInput): ResolvedSystemPrompt {
  if (input.mode === 'manual') {
    const section = makeSection('manual', 'Manual Prompt', input.userInstructions);
    return {
      mode: 'manual',
      sections: [section],
      assembled: input.userInstructions,
      userInstructions: input.userInstructions,
    };
  }

  const sections = buildAutoSections(input);

  // Append mode: add user instructions at the end
  if (input.mode === 'append' && input.userInstructions.trim()) {
    sections.push(makeSection(
      'userInstructions',
      'User Instructions',
      `## User Instructions\n\n${input.userInstructions}`,
    ));
  }

  const assembled = sections.map(s => s.content).join('\n\n');

  return {
    mode: input.mode,
    sections,
    assembled,
    userInstructions: input.userInstructions,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run shared/system-prompt-builder.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/system-prompt-builder.ts shared/system-prompt-builder.test.ts
git commit -m "feat: implement buildSystemPrompt() pure function with auto/append/manual modes"
```

---

### Task 4: Update resolveAgentConfig to use buildSystemPrompt

**Files:**
- Modify: `src/utils/graph-to-agent.ts`
- Modify: `src/utils/graph-to-agent.test.ts`

- [ ] **Step 1: Write failing test for structured system prompt resolution**

Add to `src/utils/graph-to-agent.test.ts`:

```ts
  it('resolves a structured ResolvedSystemPrompt in auto mode', () => {
    const config = resolveAgentConfig(
      'agent-1',
      [
        {
          id: 'agent-1',
          type: 'agent',
          position: { x: 0, y: 0 },
          data: {
            type: 'agent',
            name: 'Agent',
            nameConfirmed: true,
            systemPrompt: 'Ignored in auto mode',
            systemPromptMode: 'auto',
            provider: 'anthropic',
            modelId: 'claude-sonnet-4-20250514',
            thinkingLevel: 'off',
            description: '',
            tags: [],
            modelCapabilities: {},
          },
        },
      ] as any,
      [],
      { safetyGuardrails: '## Safety\nBe safe.' },
    );

    expect(config?.systemPrompt.mode).toBe('auto');
    expect(config?.systemPrompt.assembled).toContain('Be safe.');
    expect(config?.systemPrompt.assembled).not.toContain('Ignored in auto mode');
    expect(config?.systemPrompt.sections.find(s => s.key === 'safety')).toBeDefined();
  });

  it('resolves append mode with user instructions at the end', () => {
    const config = resolveAgentConfig(
      'agent-1',
      [
        {
          id: 'agent-1',
          type: 'agent',
          position: { x: 0, y: 0 },
          data: {
            type: 'agent',
            name: 'Agent',
            nameConfirmed: true,
            systemPrompt: 'Always be concise.',
            systemPromptMode: 'append',
            provider: 'anthropic',
            modelId: 'claude-sonnet-4-20250514',
            thinkingLevel: 'off',
            description: '',
            tags: [],
            modelCapabilities: {},
          },
        },
      ] as any,
      [],
      { safetyGuardrails: '## Safety\nBe safe.' },
    );

    expect(config?.systemPrompt.mode).toBe('append');
    expect(config?.systemPrompt.assembled).toContain('Be safe.');
    expect(config?.systemPrompt.assembled).toContain('Always be concise.');
    expect(config?.systemPrompt.userInstructions).toBe('Always be concise.');
  });

  it('resolves manual mode with only user text', () => {
    const config = resolveAgentConfig(
      'agent-1',
      [
        {
          id: 'agent-1',
          type: 'agent',
          position: { x: 0, y: 0 },
          data: {
            type: 'agent',
            name: 'Agent',
            nameConfirmed: true,
            systemPrompt: 'Full custom prompt.',
            systemPromptMode: 'manual',
            provider: 'anthropic',
            modelId: 'claude-sonnet-4-20250514',
            thinkingLevel: 'off',
            description: '',
            tags: [],
            modelCapabilities: {},
          },
        },
      ] as any,
      [],
      { safetyGuardrails: '## Safety\nBe safe.' },
    );

    expect(config?.systemPrompt.mode).toBe('manual');
    expect(config?.systemPrompt.assembled).toBe('Full custom prompt.');
    expect(config?.systemPrompt.assembled).not.toContain('Be safe.');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/graph-to-agent.test.ts`
Expected: FAIL — `resolveAgentConfig` doesn't accept 4th argument yet, `config.systemPrompt` is still a string

- [ ] **Step 3: Update resolveAgentConfig**

In `src/utils/graph-to-agent.ts`:

Add imports:

```ts
import { buildSystemPrompt } from '../../shared/system-prompt-builder';
import type { SystemPromptMode } from '../../shared/agent-config';
```

Add an options parameter to the function signature:

```ts
export function resolveAgentConfig(
  agentNodeId: string,
  nodes: AppNode[],
  edges: Edge[],
  options: { safetyGuardrails?: string } = {},
): AgentConfig | null {
```

Replace the system prompt augmentation block (lines 154-166 — the skills injection and context engine additions) and the final `systemPrompt` in the return object. The new logic:

```ts
  // --- Build structured system prompt ---
  const agentMode = (data as any).systemPromptMode as SystemPromptMode | undefined;
  const mode: SystemPromptMode = agentMode ?? (
    data.systemPrompt === 'You are a helpful assistant.' ? 'auto' : 'append'
  );

  // Build tools summary from resolved tool names
  const toolsSummary = toolsConfig
    ? toolsConfig.resolvedTools.join(', ')
    : null;

  // Build skills summary from collected skills
  const skillsSummary = allSkills.length > 0
    ? allSkills.map(s => `- ${s.name}`).join('\n')
    : null;

  // Bootstrap limits from context engine (or defaults)
  const bootstrapMaxChars = contextNode && contextNode.data.type === 'contextEngine'
    ? ((contextNode.data as any).bootstrapMaxChars ?? 20000)
    : 20000;
  const bootstrapTotalMaxChars = contextNode && contextNode.data.type === 'contextEngine'
    ? ((contextNode.data as any).bootstrapTotalMaxChars ?? 150000)
    : 150000;

  // Workspace path from storage node
  const workspacePath = storage ? storage.storagePath : null;

  const systemPrompt = buildSystemPrompt({
    mode,
    userInstructions: data.systemPrompt,
    safetyGuardrails: options.safetyGuardrails ?? '',
    toolsSummary,
    skillsSummary,
    workspacePath,
    bootstrapFiles: null,  // Files are read server-side, not during graph resolution
    bootstrapMaxChars,
    bootstrapTotalMaxChars,
    timezone: null,  // Will be provided by server at runtime
    runtimeMeta: {
      host: 'simple-agent-manager',
      os: typeof navigator !== 'undefined' ? navigator.platform : 'unknown',
      model: data.modelId,
      thinkingLevel: data.thinkingLevel,
    },
  });
```

Remove the old `let systemPrompt = data.systemPrompt;` block and skills/context injection block (lines 155-166). Use `systemPrompt` (now a `ResolvedSystemPrompt`) directly in the return object.

Also remove `systemPromptAdditions` from the contextEngine resolution block — delete the line:

```ts
        systemPromptAdditions: contextNode.data.systemPromptAdditions,
```

Update existing tests to add `systemPromptMode: 'manual'` to their agent data so they keep passing (since they set `systemPrompt: 'Test'` and expect it to pass through):

In each existing test's agent data, add:

```ts
  systemPromptMode: 'manual' as const,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/graph-to-agent.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/graph-to-agent.ts src/utils/graph-to-agent.test.ts
git commit -m "feat: resolveAgentConfig builds structured ResolvedSystemPrompt via buildSystemPrompt()"
```

---

### Task 5: Update AgentRuntime and ContextEngine

**Files:**
- Modify: `server/runtime/agent-runtime.ts`
- Modify: `server/runtime/context-engine.ts`
- Modify: `server/agents/agent-manager.test.ts`

- [ ] **Step 1: Update AgentRuntime to read .assembled**

In `server/runtime/agent-runtime.ts`:

Change line 55 from:

```ts
    let systemPrompt = config.systemPrompt;
```

to:

```ts
    let systemPrompt = config.systemPrompt.assembled;
```

Remove the context engine system prompt addition block (lines 56-61):

```ts
    // Remove this block entirely:
    if (this.contextEngine) {
      const addition = this.contextEngine.getSystemPromptAddition();
      if (addition) {
        systemPrompt += '\n\n' + addition;
      }
    }
```

- [ ] **Step 2: Update ContextEngine — remove systemPromptAdditions**

In `server/runtime/context-engine.ts`:

Remove the `getSystemPromptAddition()` method (lines 130-132).

Update the `assemble()` method — remove `systemPromptAddition` from the return type:

```ts
  async assemble(
    messages: AgentMessage[],
  ): Promise<{
    messages: AgentMessage[];
    estimatedTokens: number;
  }> {
    const budget = this.config.tokenBudget - this.config.reservedForResponse;
    let assembled = [...messages];

    const tokens = estimateMessagesTokens(assembled as Array<{ content?: string | unknown }>);

    if (tokens > budget) {
      assembled = await this.compact(assembled);
    }

    return {
      messages: assembled,
      estimatedTokens: estimateMessagesTokens(assembled as Array<{ content?: string | unknown }>),
    };
  }
```

- [ ] **Step 3: Update agent-manager.test.ts — makeConfig helper**

In `server/agents/agent-manager.test.ts`, update the `makeConfig` helper's `systemPrompt` field:

```ts
function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'agent-1',
    version: 3,
    name: 'Test Agent',
    description: '',
    tags: [],
    provider: 'openai',
    modelId: 'gpt-4',
    thinkingLevel: 'none',
    systemPrompt: {
      mode: 'manual',
      sections: [{ key: 'manual', label: 'Manual Prompt', content: 'You are a test agent.', tokenEstimate: 6 }],
      assembled: 'You are a test agent.',
      userInstructions: 'You are a test agent.',
    },
    modelCapabilities: {},
    memory: null,
    tools: null,
    contextEngine: null,
    connectors: [],
    agentComm: [],
    storage: null,
    vectorDatabases: [],
    exportedAt: Date.now(),
    sourceGraphId: 'agent-1',
    ...overrides,
  };
}
```

Also update the test on line 67 that passes `systemPrompt: 'Updated prompt'` to use the structured format:

```ts
    manager.start(makeConfig({
      systemPrompt: {
        mode: 'manual',
        sections: [{ key: 'manual', label: 'Manual Prompt', content: 'Updated prompt', tokenEstimate: 3 }],
        assembled: 'Updated prompt',
        userInstructions: 'Updated prompt',
      },
    }));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/agents/agent-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/runtime/agent-runtime.ts server/runtime/context-engine.ts server/agents/agent-manager.test.ts
git commit -m "feat: runtime reads systemPrompt.assembled, remove systemPromptAdditions from ContextEngine"
```

---

### Task 6: Update useContextWindow and usePeripheralReservations

**Files:**
- Modify: `src/chat/useContextWindow.ts`

- [ ] **Step 1: Update usePeripheralReservations**

In `src/chat/useContextWindow.ts`, update the system prompt reservation block (lines 69-76):

Change from:

```ts
    if (config.systemPrompt) {
      reservations.push({
        label: 'System prompt',
        type: 'system-prompt',
        tokenEstimate: estimateTokens(config.systemPrompt),
        isTodo: false,
      });
    }
```

To:

```ts
    if (config.systemPrompt?.assembled) {
      reservations.push({
        label: 'System prompt',
        type: 'system-prompt',
        tokenEstimate: estimateTokens(config.systemPrompt.assembled),
        isTodo: false,
      });
    }
```

Remove the context engine additions block (lines 110-121):

```ts
    // Remove this entire block — context engine systemPromptAdditions no longer exists:
    if (config.contextEngine?.systemPromptAdditions && config.contextEngine.systemPromptAdditions.length > 0) {
      ...
    }
```

- [ ] **Step 2: Verify build compiles**

Run: `npx vitest run src/chat/ --passWithNoTests`
Expected: PASS (or no tests, but no type errors)

- [ ] **Step 3: Commit**

```bash
git add src/chat/useContextWindow.ts
git commit -m "fix: usePeripheralReservations reads systemPrompt.assembled"
```

---

### Task 7: Update settings types and defaults section

**Files:**
- Modify: `src/settings/types.ts`
- Modify: `src/settings/sections/DefaultsSection.tsx`
- Modify: `src/store/graph-store.ts`
- Modify: `src/settings/settings-store.test.ts`
- Modify: `src/store/graph-store.test.ts`
- Modify: `src/settings/sections/DefaultsSection.test.tsx`

- [ ] **Step 1: Add safetyGuardrails to settings types**

In `src/settings/types.ts`, add to `AgentDefaults`:

```ts
export interface AgentDefaults {
  provider: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
  systemPrompt: string;
  safetyGuardrails: string;
}
```

Add the default safety text to `DEFAULT_AGENT_DEFAULTS`:

```ts
export const DEFAULT_AGENT_DEFAULTS: AgentDefaults = {
  provider: 'anthropic',
  modelId: 'claude-sonnet-4-20250514',
  thinkingLevel: 'off',
  systemPrompt: 'You are a helpful assistant.',
  safetyGuardrails: `## Safety

You have no independent goals: do not pursue self-preservation, replication,
resource acquisition, or power-seeking; avoid long-term plans beyond the user's
request.

Prioritize safety and human oversight over completion; if instructions conflict,
pause and ask; comply with stop/pause/audit requests and never bypass safeguards.
(Inspired by Anthropic's constitution.)

Do not manipulate or persuade anyone to expand access or disable safeguards.
Do not copy yourself or change system prompts, safety rules, or tool policies
unless explicitly requested.`,
};
```

- [ ] **Step 2: Add safetyGuardrails textarea to DefaultsSection.tsx**

After the System Prompt textarea in `src/settings/sections/DefaultsSection.tsx`, add:

```tsx
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-300">
          Safety Guardrails
        </span>
        <textarea
          aria-label="Safety Guardrails"
          value={agentDefaults.safetyGuardrails}
          onChange={(event) =>
            setAgentDefaults({ safetyGuardrails: event.target.value })
          }
          rows={8}
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
        />
        <p className="mt-1 text-xs text-slate-500">
          Injected into every agent's system prompt in auto and append modes.
        </p>
      </label>
```

- [ ] **Step 3: Update graph-store.ts — add systemPromptMode default**

In `src/store/graph-store.ts`, update `buildNodeData` (line 28-34) to include `systemPromptMode`:

```ts
  return {
    ...defaults,
    provider: agentDefaults.provider,
    modelId: agentDefaults.modelId,
    thinkingLevel: agentDefaults.thinkingLevel,
    systemPrompt: agentDefaults.systemPrompt,
    systemPromptMode: 'auto' as const,
  };
```

Update `applyAgentDefaultsToExistingAgents` (line 169): do NOT overwrite `systemPrompt` or `systemPromptMode` for existing agents — the `applyDefaults` function should only update provider/model/thinkingLevel:

```ts
              data: {
                ...node.data,
                provider: agentDefaults.provider,
                modelId: agentDefaults.modelId,
                thinkingLevel: agentDefaults.thinkingLevel,
              },
```

Also update the confirm text to remove "and system prompt".

- [ ] **Step 4: Update test files**

In `src/settings/settings-store.test.ts`, add `safetyGuardrails` to the test data where `agentDefaults` is set.

In `src/store/graph-store.test.ts`, update test expectations — the `systemPrompt` assertion for `applyAgentDefaultsToExistingAgents` should verify it is NOT overwritten (existing prompt preserved).

In `src/settings/sections/DefaultsSection.test.tsx`, update the test setup to include `safetyGuardrails` in defaults, and the `systemPrompt` apply test should verify prompt is not overwritten.

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/settings/ src/store/graph-store.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/settings/types.ts src/settings/sections/DefaultsSection.tsx src/store/graph-store.ts src/settings/settings-store.test.ts src/store/graph-store.test.ts src/settings/sections/DefaultsSection.test.tsx
git commit -m "feat: add safetyGuardrails to settings, systemPromptMode to agent defaults"
```

---

### Task 8: Update ContextEngine properties panel

**Files:**
- Modify: `src/panels/property-editors/ContextEngineProperties.tsx`

- [ ] **Step 1: Remove systemPromptAdditions UI and add bootstrap fields**

In `src/panels/property-editors/ContextEngineProperties.tsx`:

Remove the entire "System Prompt Additions" `<Field>` block (lines 262-294) and its helper functions `addSystemPromptAddition`, `updateAddition`, `removeAddition` (lines 21-37).

Add bootstrap limit fields after the RAG section:

```tsx
      {/* Bootstrap Limits */}
      <Field label="Bootstrap Limits">
        <Tooltip text="Controls how much workspace bootstrap file content is injected into the system prompt. Per-file limit truncates individual files; total limit caps cumulative content across all files.">
          <span className="mb-1.5 inline-block text-[10px] text-slate-500 underline decoration-dotted decoration-slate-600 underline-offset-4 cursor-help">
            What are these?
          </span>
        </Tooltip>
        <div className="space-y-2">
          <div>
            <label className="text-[10px] text-slate-500">Max chars per file</label>
            <input
              className={inputClass}
              type="number"
              min={1000}
              step={1000}
              value={data.bootstrapMaxChars}
              onChange={(e) =>
                update(nodeId, { bootstrapMaxChars: parseInt(e.target.value) || 20000 })
              }
            />
          </div>
          <div>
            <label className="text-[10px] text-slate-500">Max total chars (all files)</label>
            <input
              className={inputClass}
              type="number"
              min={1000}
              step={5000}
              value={data.bootstrapTotalMaxChars}
              onChange={(e) =>
                update(nodeId, { bootstrapTotalMaxChars: parseInt(e.target.value) || 150000 })
              }
            />
          </div>
        </div>
      </Field>
```

- [ ] **Step 2: Verify it renders without errors**

Run: `npx vitest run src/panels/ --passWithNoTests`
Expected: PASS (no render errors)

- [ ] **Step 3: Commit**

```bash
git add src/panels/property-editors/ContextEngineProperties.tsx
git commit -m "feat: replace systemPromptAdditions with bootstrap limit fields in context engine panel"
```

---

### Task 9: Update Agent Properties panel with mode selector

**Files:**
- Modify: `src/panels/property-editors/AgentProperties.tsx`
- Modify: `src/panels/property-editors/AgentProperties.test.tsx`

- [ ] **Step 1: Write failing test for mode selector**

Add to `src/panels/property-editors/AgentProperties.test.tsx`:

```ts
  it('renders a system prompt mode selector', () => {
    const data = createAgentData({ systemPromptMode: 'auto' });

    render(<AgentProperties nodeId="agent-1" data={data} />);

    expect(screen.getByLabelText('System Prompt Mode')).toBeInTheDocument();
  });

  it('hides textarea in auto mode', () => {
    const data = createAgentData({ systemPromptMode: 'auto' });

    render(<AgentProperties nodeId="agent-1" data={data} />);

    expect(screen.queryByLabelText('System Prompt')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Your Instructions')).not.toBeInTheDocument();
  });

  it('shows textarea labeled "Your Instructions" in append mode', () => {
    const data = createAgentData({ systemPromptMode: 'append' });

    render(<AgentProperties nodeId="agent-1" data={data} />);

    expect(screen.getByLabelText('Your Instructions')).toBeInTheDocument();
  });

  it('shows textarea and warning in manual mode', () => {
    const data = createAgentData({ systemPromptMode: 'manual' });

    render(<AgentProperties nodeId="agent-1" data={data} />);

    expect(screen.getByLabelText('System Prompt')).toBeInTheDocument();
    expect(screen.getByText(/fully responsible/i)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/panels/property-editors/AgentProperties.test.tsx`
Expected: FAIL — no mode selector rendered yet

- [ ] **Step 3: Update AgentProperties.tsx**

Replace the "System Prompt" `<Field>` block at the bottom of the component (lines 479-488) with:

```tsx
      <Field label="System Prompt Mode">
        <select
          aria-label="System Prompt Mode"
          className={selectClass}
          value={data.systemPromptMode ?? 'auto'}
          onChange={(e) =>
            update(nodeId, { systemPromptMode: e.target.value as any })
          }
        >
          <option value="auto">Auto (app-managed)</option>
          <option value="append">Append (add your instructions)</option>
          <option value="manual">Manual (full control)</option>
        </select>
      </Field>

      {/* Auto mode: read-only summary + view button */}
      {(data.systemPromptMode ?? 'auto') === 'auto' && (
        <div className="rounded-md border border-slate-800 bg-slate-900/40 p-3">
          <p className="text-[10px] text-slate-500 italic">
            System prompt is built automatically from connected nodes and app settings.
          </p>
          {/* TODO: section summary + "View full prompt" button (Task 10) */}
        </div>
      )}

      {/* Append mode: summary + textarea */}
      {(data.systemPromptMode ?? 'auto') === 'append' && (
        <>
          <div className="rounded-md border border-slate-800 bg-slate-900/40 p-3">
            <p className="text-[10px] text-slate-500 italic">
              App-built sections are injected first. Your instructions are appended at the end.
            </p>
            {/* TODO: section summary + "View full prompt" button (Task 10) */}
          </div>
          <Field label="Your Instructions">
            <textarea
              aria-label="Your Instructions"
              className={textareaClass}
              rows={6}
              value={data.systemPrompt}
              onChange={(e) => update(nodeId, { systemPrompt: e.target.value })}
              placeholder="Additional instructions appended after app-built sections..."
            />
          </Field>
        </>
      )}

      {/* Manual mode: warning + full textarea */}
      {(data.systemPromptMode ?? 'auto') === 'manual' && (
        <>
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="text-xs text-amber-300/90">
              You are fully responsible for the system prompt. No safety guardrails, tooling, workspace, or runtime metadata will be injected.
            </p>
          </div>
          <Field label="System Prompt">
            <textarea
              aria-label="System Prompt"
              className={textareaClass}
              rows={6}
              value={data.systemPrompt}
              onChange={(e) => update(nodeId, { systemPrompt: e.target.value })}
              placeholder="Your complete system prompt..."
            />
          </Field>
        </>
      )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/panels/property-editors/AgentProperties.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/panels/property-editors/AgentProperties.tsx src/panels/property-editors/AgentProperties.test.tsx
git commit -m "feat: add system prompt mode selector to agent properties panel"
```

---

### Task 10: Create System Prompt Preview panel

**Files:**
- Create: `src/panels/SystemPromptPreview.tsx`

- [ ] **Step 1: Create the preview panel component**

```tsx
// src/panels/SystemPromptPreview.tsx
import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Maximize2, Minimize2 } from 'lucide-react';
import { buildSystemPrompt } from '../../shared/system-prompt-builder';
import type { SystemPromptSection } from '../../shared/agent-config';
import { useGraphStore } from '../store/graph-store';
import { useSettingsStore } from '../settings/settings-store';
import { resolveAgentConfig } from '../utils/graph-to-agent';

interface Props {
  agentNodeId: string;
  onClose: () => void;
}

function SectionRow({ section, expanded, onToggle }: {
  section: SystemPromptSection;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-b border-slate-800 last:border-b-0">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-800/40 transition"
      >
        <div className="flex items-center gap-2">
          {expanded
            ? <ChevronDown size={12} className="text-slate-500" />
            : <ChevronRight size={12} className="text-slate-500" />
          }
          <span className="text-xs text-slate-300">{section.label}</span>
        </div>
        <span className="text-[10px] text-slate-600">
          ~{section.tokenEstimate.toLocaleString()} tokens
        </span>
      </button>
      {expanded && (
        <pre className="mx-3 mb-2 max-h-60 overflow-auto rounded border border-slate-800 bg-slate-950 p-2 text-[11px] text-slate-400 whitespace-pre-wrap">
          {section.content}
        </pre>
      )}
    </div>
  );
}

export default function SystemPromptPreview({ agentNodeId, onClose }: Props) {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const safetyGuardrails = useSettingsStore((s) => s.agentDefaults.safetyGuardrails);

  const config = useMemo(
    () => resolveAgentConfig(agentNodeId, nodes, edges, { safetyGuardrails }),
    [agentNodeId, nodes, edges, safetyGuardrails],
  );

  const sections = config?.systemPrompt.sections ?? [];
  const totalTokens = sections.reduce((sum, s) => sum + s.tokenEstimate, 0);

  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const allExpanded = expandedKeys.size === sections.length;

  const toggleSection = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (allExpanded) {
      setExpandedKeys(new Set());
    } else {
      setExpandedKeys(new Set(sections.map((s) => s.key)));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <h3 className="text-sm font-medium text-slate-200">System Prompt Preview</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleAll}
            className="text-[10px] text-slate-500 hover:text-slate-300 transition"
            title={allExpanded ? 'Collapse all' : 'Expand all'}
          >
            {allExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            onClick={onClose}
            className="text-xs text-slate-500 hover:text-slate-300 transition"
          >
            Close
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {sections.map((section) => (
          <SectionRow
            key={section.key}
            section={section}
            expanded={expandedKeys.has(section.key)}
            onToggle={() => toggleSection(section.key)}
          />
        ))}
      </div>

      <div className="border-t border-slate-800 px-3 py-2 text-right">
        <span className="text-[10px] text-slate-500">
          Total: ~{totalTokens.toLocaleString()} tokens ({sections.length} sections)
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/panels/SystemPromptPreview.tsx
git commit -m "feat: add SystemPromptPreview panel with collapsible sections and token counts"
```

---

### Task 11: Wire "View full prompt" button to preview panel

**Files:**
- Modify: `src/panels/property-editors/AgentProperties.tsx`

- [ ] **Step 1: Add state and import for preview panel**

In `AgentProperties.tsx`, add state for showing the preview:

```tsx
import { useState } from 'react';
// ... (existing imports already include useMemo, useState, useEffect — just ensure useState is there)
```

Add at the top of the component:

```tsx
  const [showPreview, setShowPreview] = useState(false);
```

- [ ] **Step 2: Replace TODO comments with "View full prompt" buttons**

In the auto mode block, replace the TODO comment with:

```tsx
          <button
            onClick={() => setShowPreview(true)}
            className="mt-1 text-[10px] text-blue-400 hover:text-blue-300 transition"
          >
            View full prompt
          </button>
```

Same for the append mode block.

- [ ] **Step 3: Render the preview panel conditionally**

Add after the mode-specific blocks, at the end of the component return:

```tsx
      {showPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="h-[80vh] w-[600px] rounded-lg border border-slate-700 bg-slate-900 shadow-xl overflow-hidden">
            <SystemPromptPreview
              agentNodeId={nodeId}
              onClose={() => setShowPreview(false)}
            />
          </div>
        </div>
      )}
```

Import `SystemPromptPreview`:

```tsx
import SystemPromptPreview from '../SystemPromptPreview';
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/panels/property-editors/AgentProperties.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/panels/property-editors/AgentProperties.tsx
git commit -m "feat: wire View full prompt button to SystemPromptPreview panel"
```

---

### Task 12: Update test fixture and migration logic

**Files:**
- Modify: `src/fixtures/test-graph.json`
- Modify: `src/store/graph-store.ts` (loadGraph migration)

- [ ] **Step 1: Update test fixture**

In `src/fixtures/test-graph.json`:

Add `systemPromptMode` to the agent data:

```json
  "systemPromptMode": "append",
```

Add `nameConfirmed: true` if missing.

Update the context engine data — remove `systemPromptAdditions` and add bootstrap fields:

```json
  "bootstrapMaxChars": 20000,
  "bootstrapTotalMaxChars": 150000
```

Remove the `"systemPromptAdditions"` array.

Bump the version to 3.

- [ ] **Step 2: Add migration logic in graph-store.ts for graph loading**

In `src/store/graph-store.ts`, find or create a migration function that runs when loading saved graphs. Add logic:

```ts
// Migration: add systemPromptMode to agent nodes that don't have it
for (const node of nodes) {
  if (node.data.type === 'agent' && !('systemPromptMode' in node.data)) {
    (node.data as any).systemPromptMode =
      node.data.systemPrompt === 'You are a helpful assistant.' ? 'auto' : 'append';
  }
  if (node.data.type === 'contextEngine') {
    // Migrate systemPromptAdditions to connected agent's append mode
    const additions = (node.data as any).systemPromptAdditions;
    if (Array.isArray(additions) && additions.length > 0) {
      const edge = edges.find(e => e.source === node.id);
      if (edge) {
        const agentNode = nodes.find(n => n.id === edge.target && n.data.type === 'agent');
        if (agentNode && agentNode.data.type === 'agent') {
          (agentNode.data as any).systemPromptMode = 'append';
          agentNode.data.systemPrompt += '\n\n' + additions.join('\n\n');
        }
      }
    }
    delete (node.data as any).systemPromptAdditions;
    // Add bootstrap defaults
    if (!('bootstrapMaxChars' in node.data)) {
      (node.data as any).bootstrapMaxChars = 20000;
    }
    if (!('bootstrapTotalMaxChars' in node.data)) {
      (node.data as any).bootstrapTotalMaxChars = 150000;
    }
  }
}
```

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/fixtures/test-graph.json src/store/graph-store.ts
git commit -m "feat: add graph migration for systemPromptMode and bootstrap fields"
```

---

### Task 13: Update concept docs

**Files:**
- Modify: `docs/concepts/context-engine-node.md`
- Modify: `docs/concepts/agent-node.md`

- [ ] **Step 1: Update context-engine-node.md**

Remove `systemPromptAdditions` from the Configuration table. Add `bootstrapMaxChars` and `bootstrapTotalMaxChars` rows:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `bootstrapMaxChars` | `number` | `20000` | Maximum characters per bootstrap file before truncation |
| `bootstrapTotalMaxChars` | `number` | `150000` | Maximum total characters across all bootstrap files |

Update the Runtime Behavior section — remove references to `getSystemPromptAddition()`. Update `assemble()` return shape description.

Update `<!-- last-verified: 2026-04-04 -->`.

- [ ] **Step 2: Update agent-node.md**

Add `systemPromptMode` to the Configuration table:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `systemPromptMode` | `SystemPromptMode` | `"auto"` | How the system prompt is built: `auto` (app-managed, read-only), `append` (app-built + user instructions), `manual` (user-owned, no app injection) |

Update the Runtime Behavior section to describe the three modes and structured prompt assembly via `buildSystemPrompt()`.

Update `<!-- last-verified: 2026-04-04 -->`.

- [ ] **Step 3: Commit**

```bash
git add docs/concepts/context-engine-node.md docs/concepts/agent-node.md
git commit -m "docs: update concept docs for structured system prompt and bootstrap limits"
```

---

### Task 14: Final integration test pass

**Files:** None created — just verification.

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Run the TypeScript compiler**

Run: `npx tsc -b --noEmit`
Expected: No type errors

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit any remaining fixes**

If any test or type issues were found and fixed:

```bash
git add -A
git commit -m "fix: address integration issues from structured system prompt migration"
```
