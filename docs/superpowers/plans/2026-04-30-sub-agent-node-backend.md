# Sub-Agent Node — Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the backend foundation for declarative sub-agents — a new `SubAgentNode` peripheral declared in the graph, resolved into `AgentConfig.subAgents`, runnable via a non-blocking one-shot child executor with override allowlist, durable history metadata, and REST kill — fully testable end-to-end without UI.

**Architecture:** New `subAgent` node type with required dedicated `ToolsNode` and optional dedicated `ProviderNode`/`SkillsNode`/`MCPNode`. `resolveAgentConfig()` produces `ResolvedSubAgentConfig` per declared sub-agent. A new `SubAgentExecutor` builds a synthetic `AgentConfig` per spawn and runs the child alongside the parent without occupying the parent's queue slot — keyed by a child `runId` on the same event bus. `SubAgentRegistry` gains `appliedOverrides`, one-shot sealing, a `killed` terminal state, and a durable `sam.sub_agent_spawn` custom transcript entry. `sessions_spawn` rewritten to take `subAgent` name + per-call `overrides` validated against the node's allowlist; `sessions_send` rejects sub-session re-engagement; new `/api/subagents/*` REST surface.

**Tech Stack:** TypeScript, vitest, `@sinclair/typebox`, existing `RunCoordinator` / `SubAgentRegistry` / `SessionTranscriptStore`, Express.

**Spec:** [docs/superpowers/specs/2026-04-30-sub-agent-node-design.md](../specs/2026-04-30-sub-agent-node-design.md)

**Convention decisions locked by this plan:**

- **Inheritance for `modelId` and `thinkingLevel`:** **mode field** approach. Add `modelIdMode: 'inherit' | 'custom'` and `thinkingLevelMode: 'inherit' | 'custom'` to `SubAgentNodeData`. The respective value field is honored only when mode is `'custom'`. Discoverable in the UI as a radio; consistent across both fields. Default for both is `'inherit'`.
- **Persistence:** **both** a `sam.sub_agent_spawn` custom transcript entry on the parent's transcript at spawn time (immutable audit) **and** lightweight metadata on `SessionStoreEntry` for the sub-session (mutable: status / sealed for fast list-view). Registry stays as the in-memory fast cache.
- **Child executor:** build a dedicated `SubAgentExecutor` class. It constructs a synthetic `AgentConfig` per spawn and dispatches via a *separate* path that doesn't touch `RunConcurrencyController.enqueue`. Honors `coordinator.abort(childRunId)` and emits run-events on the same event bus (`stream-processor`).
- **UI is out of scope for this plan.** Canvas node, property panel, inline card, and history drawer ship in a follow-up plan once this lands.

---

## File Structure

### New
| File | Responsibility |
|---|---|
| `server/agents/sub-session-key.ts` | `parseSubSessionKey` helper + tests live alongside |
| `server/agents/sub-session-key.test.ts` | Tests for the parser |
| `server/agents/sub-agent-executor.ts` | The child executor: synthetic config, non-blocking run, abort plumbing |
| `server/agents/sub-agent-executor.test.ts` | Tests using fake runtime + event bus |
| `server/routes/subagents.ts` | REST endpoints (kill, get, list-by-parent) |
| `server/routes/subagents.test.ts` | REST integration tests |
| `shared/sub-agent-types.ts` | Shared `SubAgentOverridableField`, persistence types — kept tiny so client and server share without circular imports |
| `docs/concepts/sub-agent-node.md` | Concept doc for the new node type |

### Modified
| File | Change |
|---|---|
| `src/types/nodes.ts` | Add `'subAgent'` to `NodeType`, `SubAgentNodeData`, mode fields, `FlowNodeData` |
| `src/utils/default-nodes.ts` | Sub-agent defaults |
| `src/utils/graph-to-agent.ts` | Resolve `SubAgentNode`s into `AgentConfig.subAgents`; merge skills/mcps; cwd derivation |
| `shared/agent-config.ts` | `ResolvedSubAgentConfig`, `AgentConfig.subAgents` |
| `shared/session-diagnostics.ts` | Add `SUB_AGENT_SPAWN_CUSTOM_TYPE` + `SubAgentSpawnData` |
| `shared/storage-types.ts` | Add `subAgentMeta` to `SessionStoreEntry` |
| `server/agents/sub-agent-registry.ts` | `subAgentName`, `appliedOverrides`, one-shot `sealed` state, `'killed'` status, `seal`, `isSealed` |
| `server/agents/sub-agent-registry.test.ts` | New cases for one-shot sealing and kill terminal state |
| `server/agents/run-coordinator.ts` | Construct `SubAgentExecutor`, pass to `SessionToolContext`, abort plumbing for child `runId`s, persist sub-agent metadata in `SessionStoreEntry` |
| `server/sessions/session-tools.ts` | Rewrite `createSessionsSpawnTool` for new schema + override validation; one-shot `sessions_send` rejection for sub-sessions; conditional registration on `agentConfig.subAgents.length > 0` |
| `server/sessions/session-tools.test.ts` | New cases per Section 6 of spec |
| `server/index.ts` | Mount `/api/subagents` routes |
| `docs/concepts/_manifest.json` | Register `sub-agent-node` |
| `docs/concepts/agent-node.md` | Add `Sub-Agent Node` to Connections list |
| `docs/concepts/tool-node.md` | Deprecation note for `subAgentSpawning` / `maxSubAgents` |

---

## Task 1: Add `SubAgentOverridableField` and persistence types in `shared/sub-agent-types.ts`

**Files:**
- Create: `shared/sub-agent-types.ts`

- [ ] **Step 1: Create the shared types file**

```typescript
// shared/sub-agent-types.ts

export type SubAgentOverridableField =
  | 'modelId'
  | 'thinkingLevel'
  | 'systemPromptAppend'
  | 'enabledTools';

export const ALL_SUB_AGENT_OVERRIDABLE_FIELDS: readonly SubAgentOverridableField[] = [
  'modelId',
  'thinkingLevel',
  'systemPromptAppend',
  'enabledTools',
] as const;

/** The shape recorded on `SessionStoreEntry.subAgentMeta` for sub-sessions. */
export interface SubAgentSessionMeta {
  subAgentId: string;
  subAgentName: string;
  parentSessionKey: string;
  parentRunId: string;
  status: 'running' | 'completed' | 'error' | 'killed';
  sealed: boolean;
  appliedOverrides: Record<string, unknown>;
  modelId: string;
  providerPluginId: string;
  startedAt: number;
  endedAt?: number;
}

/** Sub-agent name validation regex; used by graph-to-agent and the parser helper. */
export const SUB_AGENT_NAME_REGEX = /^[a-z][a-z0-9_-]{0,31}$/;
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (file is referenced nowhere yet, but its own syntax must compile).

- [ ] **Step 3: Commit**

```bash
git add shared/sub-agent-types.ts
git commit -m "feat(sub-agent): add shared sub-agent types and name regex"
```

---

## Task 2: Add `SUB_AGENT_SPAWN_CUSTOM_TYPE` to `shared/session-diagnostics.ts`

**Files:**
- Modify: `shared/session-diagnostics.ts`

- [ ] **Step 1: Append spawn custom-entry types**

Append to `shared/session-diagnostics.ts` (after the existing `SUB_AGENT_RESUME_CUSTOM_TYPE`):

```typescript
export const SUB_AGENT_SPAWN_CUSTOM_TYPE = 'sam.sub_agent_spawn';

/**
 * Persisted on the parent's transcript at spawn time. Immutable audit record;
 * the registry's mutable status (sealed, killed) is in the
 * sub-session's SessionStoreEntry.subAgentMeta.
 */
export interface SubAgentSpawnData {
  subAgentId: string;
  subAgentName: string;
  subSessionKey: string;
  parentRunId: string;
  message: string;             // initial spawn message text
  appliedOverrides: Record<string, unknown>;
  modelId: string;
  providerPluginId: string;
  spawnedAt: number;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add shared/session-diagnostics.ts
git commit -m "feat(sub-agent): add sam.sub_agent_spawn custom transcript entry types"
```

---

## Task 3: Add `subAgentMeta` to `SessionStoreEntry`

**Files:**
- Modify: `shared/storage-types.ts`

- [ ] **Step 1: Find the existing `SessionStoreEntry` interface**

Run: `grep -n "interface SessionStoreEntry" shared/storage-types.ts`

- [ ] **Step 2: Add the optional field**

Inside `SessionStoreEntry`, add:

```typescript
  /**
   * Sub-agent metadata for sub-sessions (sessionKey shape `sub:*` or wrapped
   * `agent:<id>:sub:*`). Mutable: status / sealed are updated
   * by RunCoordinator as the sub-session progresses. Immutable audit lives
   * on the parent's transcript as a `sam.sub_agent_spawn` custom entry.
   */
  subAgentMeta?: SubAgentSessionMeta;
```

- [ ] **Step 3: Add the import**

At the top of `shared/storage-types.ts`:

```typescript
import type { SubAgentSessionMeta } from './sub-agent-types';
```

- [ ] **Step 4: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/storage-types.ts
git commit -m "feat(sub-agent): add subAgentMeta to SessionStoreEntry"
```

---

## Task 4: `SubAgentNodeData` and defaults

**Files:**
- Modify: `src/types/nodes.ts`
- Modify: `src/utils/default-nodes.ts`

- [ ] **Step 1: Extend the `NodeType` union**

In `src/types/nodes.ts`, find:

```typescript
export type NodeType =
  | 'agent'
  ...
  | 'mcp';
```

Add `'subAgent'`:

```typescript
export type NodeType =
  | 'agent'
  | 'memory'
  | 'tools'
  | 'skills'
  | 'contextEngine'
  | 'agentComm'
  | 'connectors'
  | 'storage'
  | 'vectorDatabase'
  | 'cron'
  | 'provider'
  | 'mcp'
  | 'subAgent';
```

- [ ] **Step 2: Add `SubAgentNodeData` interface**

Append before `// --- Union Types ---`:

```typescript
// --- Sub-Agent Node ---

import type { SubAgentOverridableField } from '../../shared/sub-agent-types';

export interface SubAgentNodeData {
  [key: string]: unknown;
  type: 'subAgent';
  name: string;
  description: string;
  systemPrompt: string;
  modelIdMode: 'inherit' | 'custom';
  modelId: string;                              // honored only when modelIdMode === 'custom'
  thinkingLevelMode: 'inherit' | 'custom';
  thinkingLevel: ThinkingLevel;                 // honored only when thinkingLevelMode === 'custom'
  modelCapabilities: ModelCapabilityOverrides;
  overridableFields: SubAgentOverridableField[];
  workingDirectoryMode: 'derived' | 'custom';
  workingDirectory: string;
  recursiveSubAgentsEnabled: boolean;
}
```

(The `import type` for `SubAgentOverridableField` should be moved to the top of the file with the other imports — keep the file's import block clean. If there's already an `import type` from `../../shared/...` near the top, append the import name there instead of creating a new line.)

- [ ] **Step 3: Add to `FlowNodeData` union**

```typescript
export type FlowNodeData =
  | AgentNodeData
  | MemoryNodeData
  | ToolsNodeData
  | SkillsNodeData
  | ContextEngineNodeData
  | AgentCommNodeData
  | ConnectorsNodeData
  | StorageNodeData
  | VectorDatabaseNodeData
  | CronNodeData
  | ProviderNodeData
  | MCPNodeData
  | SubAgentNodeData;
```

- [ ] **Step 4: Add the default in `default-nodes.ts`**

Find the `switch (nodeType)` in `src/utils/default-nodes.ts` and add a case:

```typescript
    case 'subAgent':
      return {
        type: 'subAgent',
        name: '',
        description: '',
        systemPrompt:
          'You are a focused assistant. Complete the parent agent\'s task and report back concisely.',
        modelIdMode: 'inherit',
        modelId: '',
        thinkingLevelMode: 'inherit',
        thinkingLevel: 'off',
        modelCapabilities: {},
        overridableFields: [],
        workingDirectoryMode: 'derived',
        workingDirectory: '',
        recursiveSubAgentsEnabled: false,
      };
```

- [ ] **Step 5: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types/nodes.ts src/utils/default-nodes.ts
git commit -m "feat(sub-agent): add SubAgentNode type and defaults"
```

---

## Task 5: `ResolvedSubAgentConfig` in `shared/agent-config.ts`

**Files:**
- Modify: `shared/agent-config.ts`

- [ ] **Step 1: Re-export `SubAgentOverridableField`**

Near the top of `shared/agent-config.ts` (after existing exports of shared aliases):

```typescript
export type { SubAgentOverridableField } from './sub-agent-types';
```

- [ ] **Step 2: Add the resolved interface**

Append before `export interface AgentConfig`:

```typescript
export interface ResolvedSubAgentConfig {
  name: string;
  description: string;
  systemPrompt: string;
  modelId: string;                              // resolved (custom value or inherited from parent)
  thinkingLevel: string;                        // resolved
  modelCapabilities: ModelCapabilityOverrides;
  overridableFields: SubAgentOverridableField[];
  workingDirectory: string;                     // resolved (derived or custom)
  recursiveSubAgentsEnabled: boolean;

  provider: ResolvedProviderConfig;             // dedicated wins; else parent's
  tools: ResolvedToolsConfig;                   // dedicated; required
  skills: SkillDefinition[];                    // parent ∪ dedicated; dedicated wins by id
  mcps: ResolvedMcpConfig[];                    // parent ∪ dedicated; dedicated wins by mcpNodeId
}
```

(Add `SubAgentOverridableField` to the import line you re-exported earlier. The interface lives between the existing `ResolvedProviderConfig` and `AgentConfig` — pick a spot that makes the file flow naturally.)

- [ ] **Step 3: Add to `AgentConfig`**

In `AgentConfig`, after `crons: ResolvedCronConfig[];` and `mcps: ResolvedMcpConfig[];`:

```typescript
  subAgents: ResolvedSubAgentConfig[];
```

- [ ] **Step 4: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: existing call sites that construct `AgentConfig` literals will fail to typecheck because they don't set `subAgents`.

- [ ] **Step 5: Patch `AgentConfig` literal sites with `subAgents: []`**

Run: `grep -rn "exportedAt: " --include="*.ts" --include="*.tsx" src shared server scripts`

Each site that builds an `AgentConfig` literal (look for the existing `crons:` field) must add `subAgents: []`. The expected sites are:
- `src/utils/graph-to-agent.ts` (the `return { ... }` near the bottom of `resolveAgentConfig`)
- `server/agents/agent-manager.ts` (any default/fallback construction)
- Tests under `server/**/*.test.ts` and `src/**/*.test.ts` that build minimal AgentConfig literals.

For each, add `subAgents: [],` at the same indentation level as the other resolved arrays.

- [ ] **Step 6: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add shared/agent-config.ts src/utils/graph-to-agent.ts server/agents/agent-manager.ts $(git ls-files -m '*.test.ts' '*.test.tsx')
git commit -m "feat(sub-agent): add ResolvedSubAgentConfig and AgentConfig.subAgents"
```

---

## Task 6: `parseSubSessionKey` helper

**Files:**
- Create: `server/agents/sub-session-key.ts`
- Create: `server/agents/sub-session-key.test.ts`

Sub-session keys are emitted as `sub:<parentSessionKey>:<subAgentName>:<shortUuid>` but the parent session key itself includes colons (`agent:<id>:main`). And `SessionRouter.buildSessionKey` may wrap as `agent:<agentId>:sub:...`. The parser must handle both raw and wrapped forms.

- [ ] **Step 1: Write the failing test**

Create `server/agents/sub-session-key.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseSubSessionKey } from './sub-session-key';

describe('parseSubSessionKey', () => {
  it('parses a raw sub:* key whose parent is agent:<id>:main', () => {
    const result = parseSubSessionKey('sub:agent:a1:main:researcher:abc123');
    expect(result).toEqual({
      parentSessionKey: 'agent:a1:main',
      subAgentName: 'researcher',
      shortUuid: 'abc123',
      isSubSession: true,
    });
  });

  it('parses a wrapped agent:<id>:sub:* key', () => {
    const result = parseSubSessionKey('agent:a1:sub:agent:a1:main:researcher:abc123');
    expect(result).toEqual({
      parentSessionKey: 'agent:a1:main',
      subAgentName: 'researcher',
      shortUuid: 'abc123',
      isSubSession: true,
    });
  });

  it('returns null for non-sub keys', () => {
    expect(parseSubSessionKey('agent:a1:main')).toBeNull();
    expect(parseSubSessionKey('cron:job-1')).toBeNull();
    expect(parseSubSessionKey('hook:hook-1')).toBeNull();
  });

  it('returns null when name segment fails the regex', () => {
    // "Researcher" capitalized -> invalid
    expect(parseSubSessionKey('sub:agent:a1:main:Researcher:abc123')).toBeNull();
  });

  it('returns null when shortUuid segment is missing', () => {
    expect(parseSubSessionKey('sub:agent:a1:main:researcher')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test (must fail)**

Run: `npx vitest run server/agents/sub-session-key.test.ts`
Expected: FAIL with `Failed to resolve import './sub-session-key'`.

- [ ] **Step 3: Implement the parser**

Create `server/agents/sub-session-key.ts`:

```typescript
import { SUB_AGENT_NAME_REGEX } from '../../shared/sub-agent-types';

export interface ParsedSubSessionKey {
  parentSessionKey: string;
  subAgentName: string;
  shortUuid: string;
  isSubSession: true;
}

/**
 * Parse a sub-session key into its parts. Handles two forms:
 *   - raw:     sub:<parentSessionKey>:<subAgentName>:<shortUuid>
 *   - wrapped: agent:<agentId>:sub:<parentSessionKey>:<subAgentName>:<shortUuid>
 *
 * Returns null when the key isn't a sub-session key, when the name segment
 * fails the regex, or when the shortUuid segment is missing.
 */
export function parseSubSessionKey(sessionKey: string): ParsedSubSessionKey | null {
  let working = sessionKey;
  // Strip a single agent:<id>: wrapper if present and a sub: segment follows.
  const wrappedMatch = /^agent:[^:]+:(sub:.+)$/.exec(sessionKey);
  if (wrappedMatch) {
    working = wrappedMatch[1];
  }

  if (!working.startsWith('sub:')) {
    return null;
  }

  const rest = working.slice('sub:'.length);
  // Last segment = shortUuid, second-to-last = subAgentName, everything before = parentSessionKey.
  const segments = rest.split(':');
  if (segments.length < 3) {
    return null;
  }

  const shortUuid = segments[segments.length - 1];
  const subAgentName = segments[segments.length - 2];
  const parentSessionKey = segments.slice(0, segments.length - 2).join(':');

  if (!shortUuid) return null;
  if (!SUB_AGENT_NAME_REGEX.test(subAgentName)) return null;
  if (!parentSessionKey) return null;

  return {
    parentSessionKey,
    subAgentName,
    shortUuid,
    isSubSession: true,
  };
}

/** Build a raw sub-session key from parts. Always emits the `sub:` form. */
export function buildSubSessionKey(
  parentSessionKey: string,
  subAgentName: string,
  shortUuid: string,
): string {
  return `sub:${parentSessionKey}:${subAgentName}:${shortUuid}`;
}
```

- [ ] **Step 4: Run the test (must pass)**

Run: `npx vitest run server/agents/sub-session-key.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add server/agents/sub-session-key.ts server/agents/sub-session-key.test.ts
git commit -m "feat(sub-agent): add parseSubSessionKey/buildSubSessionKey helpers"
```

---

## Task 7: Resolve `SubAgentNode` graphs into `AgentConfig.subAgents`

**Files:**
- Modify: `src/utils/graph-to-agent.ts`

This task wires graph resolution. We don't add validation diagnostics in this task — they come in Task 8. Here we only walk edges, build `ResolvedSubAgentConfig` per node, and produce an empty array when nothing is attached.

- [ ] **Step 1: Add a helper near the top of `graph-to-agent.ts`**

After the existing imports:

```typescript
import type { ResolvedSubAgentConfig, ResolvedProviderConfig, ResolvedToolsConfig, ResolvedMcpConfig } from '../../shared/agent-config';
import type { SkillDefinition } from '../../shared/agent-config';
import type { SubAgentNodeData } from '../types/nodes';
import { SUB_AGENT_NAME_REGEX } from '../../shared/sub-agent-types';
import * as posixPath from 'path';
```

(Skip imports already present.)

- [ ] **Step 2: Define `resolveSubAgent`**

Append a private function inside `graph-to-agent.ts` (above `resolveAgentConfig`, since it's called from it):

```typescript
function resolveSubAgent(
  subAgentNode: AppNode & { data: SubAgentNodeData },
  parent: {
    provider: ResolvedProviderConfig;
    modelId: string;
    thinkingLevel: string;
    modelCapabilities: ModelCapabilityOverrides;
    skills: SkillDefinition[];
    mcps: ResolvedMcpConfig[];
    workspacePath: string;
  },
  nodes: AppNode[],
  edges: Edge[],
): ResolvedSubAgentConfig | null {
  const data = subAgentNode.data;

  // Validate name (callers handle the null return path)
  if (!SUB_AGENT_NAME_REGEX.test(data.name)) {
    return null;
  }

  // Walk peripherals attached to this sub-agent node
  const subEdges = edges.filter((e) => e.target === subAgentNode.id);
  const subInputs = subEdges
    .map((e) => nodes.find((n) => n.id === e.source))
    .filter((n): n is AppNode => n !== undefined);

  // Required: dedicated Tools node
  const toolsNodes = subInputs.filter((n) => n.data.type === 'tools');
  if (toolsNodes.length !== 1) {
    return null;
  }
  const toolsNode = toolsNodes[0];
  if (toolsNode.data.type !== 'tools') return null;

  // Optional: dedicated provider; else inherit
  const dedicatedProviderNode = subInputs.find((n) => n.data.type === 'provider');
  const provider: ResolvedProviderConfig =
    dedicatedProviderNode && dedicatedProviderNode.data.type === 'provider'
      ? {
          pluginId: dedicatedProviderNode.data.pluginId as string,
          authMethodId: dedicatedProviderNode.data.authMethodId as string,
          envVar: dedicatedProviderNode.data.envVar as string,
          baseUrl: dedicatedProviderNode.data.baseUrl as string,
        }
      : parent.provider;

  // Resolve modelId / thinkingLevel via mode fields
  const modelId = data.modelIdMode === 'custom' && data.modelId ? data.modelId : parent.modelId;
  const thinkingLevel =
    data.thinkingLevelMode === 'custom' ? data.thinkingLevel : parent.thinkingLevel;
  // modelCapabilities: own when present; else inherit
  const modelCapabilities =
    Object.keys(data.modelCapabilities ?? {}).length > 0
      ? data.modelCapabilities
      : parent.modelCapabilities;

  // Skills merge: parent ∪ dedicated, dedup by id, dedicated wins
  const dedicatedSkillsNodes = subInputs.filter((n) => n.data.type === 'skills');
  const dedicatedSkillsFromTools = toolsNode.data.type === 'tools' ? [...toolsNode.data.skills] : [];
  const dedicatedSkills: SkillDefinition[] = [...dedicatedSkillsFromTools];
  for (const sn of dedicatedSkillsNodes) {
    if (sn.data.type !== 'skills') continue;
    for (const skillName of sn.data.enabledSkills) {
      dedicatedSkills.push({
        id: skillName,
        name: skillName,
        content: '',
        injectAs: 'system-prompt' as const,
      });
    }
  }
  const dedicatedIds = new Set(dedicatedSkills.map((s) => s.id));
  const skills: SkillDefinition[] = [
    ...parent.skills.filter((s) => !dedicatedIds.has(s.id)),
    ...dedicatedSkills,
  ];

  // MCP merge: parent ∪ dedicated, dedup by mcpNodeId, dedicated wins
  const dedicatedMcps: ResolvedMcpConfig[] = subInputs
    .filter((n) => n.data.type === 'mcp')
    .map((n) => {
      if (n.data.type !== 'mcp') throw new Error('unreachable');
      return {
        mcpNodeId: n.id,
        label: n.data.label,
        transport: n.data.transport,
        command: n.data.command,
        args: n.data.args,
        env: n.data.env,
        cwd: n.data.cwd,
        url: n.data.url,
        headers: n.data.headers,
        toolPrefix: n.data.toolPrefix,
        allowedTools: n.data.allowedTools,
        autoConnect: n.data.autoConnect,
      };
    });
  const dedicatedMcpIds = new Set(dedicatedMcps.map((m) => m.mcpNodeId));
  const mcps: ResolvedMcpConfig[] = [
    ...parent.mcps.filter((m) => !dedicatedMcpIds.has(m.mcpNodeId)),
    ...dedicatedMcps,
  ];

  // Tools resolved: same shape used for parent agents
  const tools: ResolvedToolsConfig =
    toolsNode.data.type === 'tools'
      ? {
          profile: toolsNode.data.profile,
          resolvedTools: toolsNode.data.enabledTools,
          enabledGroups: toolsNode.data.enabledGroups,
          skills: dedicatedSkills,
          plugins: toolsNode.data.plugins,
          subAgentSpawning: toolsNode.data.subAgentSpawning,
          maxSubAgents: toolsNode.data.maxSubAgents,
        }
      : (() => {
          throw new Error('unreachable');
        })();

  // Working directory derivation
  const workingDirectory =
    data.workingDirectoryMode === 'custom'
      ? data.workingDirectory
      : parent.workspacePath
        ? posixPath.posix.join(parent.workspacePath.replace(/\\/g, '/'), 'subagent', data.name)
        : '';

  return {
    name: data.name,
    description: data.description,
    systemPrompt: data.systemPrompt,
    modelId,
    thinkingLevel,
    modelCapabilities,
    overridableFields: [...data.overridableFields],
    workingDirectory,
    recursiveSubAgentsEnabled: data.recursiveSubAgentsEnabled,
    provider,
    tools,
    skills,
    mcps,
  };
}
```

- [ ] **Step 3: Call `resolveSubAgent` from `resolveAgentConfig`**

Inside `resolveAgentConfig`, after the existing peripheral resolutions and *before* the final `return { ... }`, build the sub-agents list:

```typescript
  // --- Sub-Agents ---
  const subAgentNodes = connectedNodes.filter(
    (n): n is AppNode & { data: SubAgentNodeData } => n.data.type === 'subAgent',
  );

  const subAgents: ResolvedSubAgentConfig[] = [];
  const seenNames = new Set<string>();
  const conflictedNames = new Set<string>();

  for (const sub of subAgentNodes) {
    const name = sub.data.name;
    if (seenNames.has(name)) {
      conflictedNames.add(name);
      continue;
    }
    seenNames.add(name);
  }

  for (const sub of subAgentNodes) {
    if (conflictedNames.has(sub.data.name)) continue;
    const resolved = resolveSubAgent(
      sub,
      {
        provider: providerConfig,
        modelId: data.modelId,
        thinkingLevel: data.thinkingLevel,
        modelCapabilities: data.modelCapabilities,
        skills: allSkills,
        mcps,
        workspacePath: data.workingDirectory ?? '',
      },
      nodes,
      edges,
    );
    if (resolved) {
      subAgents.push(resolved);
    }
  }
```

(`mcps` here is the parent's resolved mcps array; `allSkills` is the parent's resolved skill list — both already exist in `resolveAgentConfig`.)

- [ ] **Step 4: Add `subAgents` to the returned `AgentConfig`**

In the `return { ... }`:

```typescript
    subAgents,
```

(Place it next to the other resolved arrays like `crons`, `mcps`.)

- [ ] **Step 5: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/graph-to-agent.ts
git commit -m "feat(sub-agent): resolve SubAgentNodes into AgentConfig.subAgents"
```

---

## Task 8: Tests for sub-agent resolution

**Files:**
- Modify: `src/utils/graph-to-agent.test.ts` (or create if missing)

- [ ] **Step 1: Locate or create the test file**

Run: `ls src/utils/graph-to-agent.test.ts`. If it doesn't exist, create it with a top-level `describe('resolveAgentConfig', ...)` block. Otherwise, append a new `describe('SubAgentNode resolution', ...)` block.

- [ ] **Step 2: Write failing tests**

Append (or create with):

```typescript
import { describe, it, expect } from 'vitest';
import type { AppNode } from '../types/nodes';
import type { Edge } from '@xyflow/react';
import { resolveAgentConfig } from './graph-to-agent';

function makeNode<T extends Record<string, unknown>>(
  id: string,
  data: T,
): AppNode {
  return { id, type: 'default', position: { x: 0, y: 0 }, data: data as any } as AppNode;
}

describe('SubAgentNode resolution', () => {
  const baseAgent = makeNode('agent-1', {
    type: 'agent',
    name: 'main',
    nameConfirmed: true,
    systemPrompt: 'You help.',
    modelId: 'parent/model',
    thinkingLevel: 'low',
    description: '',
    tags: [],
    modelCapabilities: {},
    systemPromptMode: 'auto',
    showReasoning: false,
    verbose: false,
    workingDirectory: '/work',
  });

  const baseProvider = makeNode('prov-1', {
    type: 'provider',
    label: 'p',
    pluginId: 'parentProvider',
    authMethodId: 'apikey',
    envVar: '',
    baseUrl: '',
  });

  const subAgentToolsNode = makeNode('sub-tools-1', {
    type: 'tools',
    label: 't',
    profile: 'minimal',
    enabledTools: ['ask_user'],
    enabledGroups: [],
    skills: [],
    plugins: [],
    subAgentSpawning: false,
    maxSubAgents: 0,
    toolSettings: {
      exec: { cwd: '', sandboxWorkdir: false, skill: '' },
      codeExecution: { apiKey: '', model: '', skill: '' },
      webSearch: { tavilyApiKey: '', skill: '' },
      image: { openaiApiKey: '', geminiApiKey: '', preferredModel: '', skill: '' },
      canva: { portRangeStart: 5173, portRangeEnd: 5273, skill: '' },
      browser: {
        userDataDir: '', headless: true, viewportWidth: 1280, viewportHeight: 800,
        timeoutMs: 30000, autoScreenshot: false, screenshotFormat: 'jpeg',
        screenshotQuality: 60, stealth: true, locale: '', timezone: '',
        userAgent: '', cdpEndpoint: '', skill: '',
      },
      textToSpeech: {
        preferredProvider: '', elevenLabsApiKey: '', elevenLabsDefaultVoice: '',
        elevenLabsDefaultModel: '', openaiVoice: '', openaiModel: '',
        geminiVoice: '', geminiModel: '', microsoftApiKey: '', microsoftRegion: '',
        microsoftDefaultVoice: '', minimaxApiKey: '', minimaxGroupId: '',
        minimaxDefaultVoice: '', minimaxDefaultModel: '', openrouterVoice: '',
        openrouterModel: '', skill: '',
      },
      musicGenerate: { preferredProvider: '', geminiModel: '', minimaxModel: '', skill: '' },
    },
  });

  const subAgent = makeNode('sub-1', {
    type: 'subAgent',
    name: 'researcher',
    description: 'Researches things',
    systemPrompt: 'Research focused.',
    modelIdMode: 'inherit',
    modelId: '',
    thinkingLevelMode: 'inherit',
    thinkingLevel: 'off',
    modelCapabilities: {},
    overridableFields: ['modelId', 'thinkingLevel'],
    workingDirectoryMode: 'derived',
    workingDirectory: '',
    recursiveSubAgentsEnabled: false,
  });

  const baseEdges: Edge[] = [
    { id: 'e1', source: 'prov-1', target: 'agent-1' },
    { id: 'e2', source: 'sub-1', target: 'agent-1' },
    { id: 'e3', source: 'sub-tools-1', target: 'sub-1' },
  ];

  it('produces one ResolvedSubAgentConfig with required Tools', () => {
    const config = resolveAgentConfig('agent-1', [baseAgent, baseProvider, subAgent, subAgentToolsNode], baseEdges);
    expect(config?.subAgents).toHaveLength(1);
    expect(config?.subAgents[0].name).toBe('researcher');
    expect(config?.subAgents[0].tools.resolvedTools).toEqual(['ask_user']);
  });

  it('inherits modelId and thinkingLevel when mode is "inherit"', () => {
    const config = resolveAgentConfig('agent-1', [baseAgent, baseProvider, subAgent, subAgentToolsNode], baseEdges);
    expect(config?.subAgents[0].modelId).toBe('parent/model');
    expect(config?.subAgents[0].thinkingLevel).toBe('low');
  });

  it('uses custom modelId when modelIdMode is "custom"', () => {
    const customSub = { ...subAgent, data: { ...subAgent.data, modelIdMode: 'custom', modelId: 'custom/model' } };
    const config = resolveAgentConfig('agent-1', [baseAgent, baseProvider, customSub, subAgentToolsNode], baseEdges);
    expect(config?.subAgents[0].modelId).toBe('custom/model');
  });

  it('inherits parent provider when no dedicated provider is attached', () => {
    const config = resolveAgentConfig('agent-1', [baseAgent, baseProvider, subAgent, subAgentToolsNode], baseEdges);
    expect(config?.subAgents[0].provider.pluginId).toBe('parentProvider');
  });

  it('uses dedicated provider when one is attached to the SubAgentNode', () => {
    const dedicatedProvider = makeNode('sub-prov-1', {
      type: 'provider',
      label: 'dp',
      pluginId: 'subProvider',
      authMethodId: 'apikey',
      envVar: '',
      baseUrl: '',
    });
    const edges: Edge[] = [
      ...baseEdges,
      { id: 'e4', source: 'sub-prov-1', target: 'sub-1' },
    ];
    const config = resolveAgentConfig(
      'agent-1',
      [baseAgent, baseProvider, subAgent, subAgentToolsNode, dedicatedProvider],
      edges,
    );
    expect(config?.subAgents[0].provider.pluginId).toBe('subProvider');
  });

  it('excludes a SubAgentNode without a Tools node', () => {
    const edgesNoTools: Edge[] = [
      { id: 'e1', source: 'prov-1', target: 'agent-1' },
      { id: 'e2', source: 'sub-1', target: 'agent-1' },
    ];
    const config = resolveAgentConfig('agent-1', [baseAgent, baseProvider, subAgent], edgesNoTools);
    expect(config?.subAgents).toHaveLength(0);
  });

  it('excludes ALL conflicting names when two SubAgentNodes share a name', () => {
    const sub2 = { ...subAgent, id: 'sub-2', data: { ...subAgent.data } };
    const tools2 = { ...subAgentToolsNode, id: 'sub-tools-2' };
    const edges: Edge[] = [
      ...baseEdges,
      { id: 'e5', source: 'sub-2', target: 'agent-1' },
      { id: 'e6', source: 'sub-tools-2', target: 'sub-2' },
    ];
    const config = resolveAgentConfig(
      'agent-1',
      [baseAgent, baseProvider, subAgent, subAgentToolsNode, sub2, tools2],
      edges,
    );
    expect(config?.subAgents).toHaveLength(0);
  });

  it('excludes a SubAgentNode whose name fails the regex', () => {
    const badSub = { ...subAgent, data: { ...subAgent.data, name: 'Researcher' } };
    const config = resolveAgentConfig(
      'agent-1',
      [baseAgent, baseProvider, badSub, subAgentToolsNode],
      baseEdges,
    );
    expect(config?.subAgents).toHaveLength(0);
  });

  it('derives cwd as <parentCwd>/subagent/<name>', () => {
    const config = resolveAgentConfig(
      'agent-1',
      [baseAgent, baseProvider, subAgent, subAgentToolsNode],
      baseEdges,
    );
    expect(config?.subAgents[0].workingDirectory).toBe('/work/subagent/researcher');
  });

});
```

- [ ] **Step 3: Run the tests (must pass)**

Run: `npx vitest run src/utils/graph-to-agent.test.ts`
Expected: PASS, all sub-agent cases (plus any existing cases).

- [ ] **Step 4: Commit**

```bash
git add src/utils/graph-to-agent.test.ts
git commit -m "test(sub-agent): cover SubAgentNode resolution paths"
```

---

## Task 9: Extend `SubAgentRegistry` with `subAgentName`, one-shot sealing, and `'killed'` status

**Files:**
- Modify: `server/agents/sub-agent-registry.ts`
- Modify: `server/agents/sub-agent-registry.test.ts`

- [ ] **Step 1: Update the record + status types**

In `server/agents/sub-agent-registry.ts`, find `SubAgentRecord` and update:

```typescript
export type SubAgentStatus = 'running' | 'completed' | 'error' | 'killed';

export interface SubAgentRecord {
  subAgentId: string;
  parentSessionKey: string;
  parentRunId: string;
  targetAgentId: string;
  subAgentName: string;
  sessionKey: string;
  runId: string;
  status: SubAgentStatus;
  startedAt: number;
  endedAt?: number;
  result?: string;
  error?: string;
  sealed: boolean;
  appliedOverrides: Record<string, unknown>;
}
```

(Update `ResumeResult.status` similarly to include `'killed'`.)

- [ ] **Step 2: Update `spawn` to take the new fields**

```typescript
  spawn(
    parent: { sessionKey: string; runId: string },
    target: {
      agentId: string;
      sessionKey: string;
      runId: string;
      subAgentName: string;
      appliedOverrides: Record<string, unknown>;
    },
  ): SubAgentRecord {
    const subAgentId = randomUUID();
    const record: SubAgentRecord = {
      subAgentId,
      parentSessionKey: parent.sessionKey,
      parentRunId: parent.runId,
      targetAgentId: target.agentId,
      subAgentName: target.subAgentName,
      sessionKey: target.sessionKey,
      runId: target.runId,
      status: 'running',
      startedAt: Date.now(),
      sealed: false,
      appliedOverrides: target.appliedOverrides,
    };
    this.records.set(subAgentId, record);
    this.byRunId.set(target.runId, subAgentId);
    return record;
  }
```

- [ ] **Step 3: Add `seal`, `isSealed`, and `findBySessionKey`**

```typescript
  isSealed(subAgentIdOrSessionKey: string): boolean {
    const record = this.records.get(subAgentIdOrSessionKey)
      ?? [...this.records.values()].find((r) => r.sessionKey === subAgentIdOrSessionKey);
    return record?.sealed ?? false;
  }

  seal(subAgentId: string): void {
    const record = this.records.get(subAgentId);
    if (!record) return;
    record.sealed = true;
  }

  findBySessionKey(sessionKey: string): SubAgentRecord | undefined {
    for (const r of this.records.values()) {
      if (r.sessionKey === sessionKey) return r;
    }
    return undefined;
  }
```

- [ ] **Step 4: Rewrite `kill` to use the `'killed'` terminal state**

Replace the existing `kill` method body:

```typescript
  kill(subAgentId: string): boolean {
    const record = this.records.get(subAgentId);
    if (!record || record.status !== 'running') return false;
    record.status = 'killed';
    record.error = 'Killed';
    record.endedAt = Date.now();
    record.sealed = true;
    this.maybeResolveYield(record.parentSessionKey);
    return true;
  }
```

- [ ] **Step 5: Update `onError` so it does NOT clobber a `'killed'` record**

```typescript
  onError(runId: string, error: string): void {
    const record = this.recordForRunId(runId);
    if (!record || record.status !== 'running') return;
    record.status = 'error';
    record.error = error;
    record.endedAt = Date.now();
    record.sealed = true;
    this.maybeResolveYield(record.parentSessionKey);
  }
```

(Note the `record.status !== 'running'` guard already prevents clobbering a `'killed'` record because `kill()` flips status to `'killed'` *before* the underlying coordinator abort fires `onError`. The order of operations is enforced in Task 16 by the REST handler and Task 13 by `RunCoordinator`.)

- [ ] **Step 6: Update `onComplete` to seal on the way out**

```typescript
  onComplete(runId: string, result: string): void {
    const record = this.recordForRunId(runId);
    if (!record || record.status !== 'running') return;
    record.status = 'completed';
    record.result = result;
    record.endedAt = Date.now();
    record.sealed = true;
    this.maybeResolveYield(record.parentSessionKey);
  }
```

- [ ] **Step 7: Update existing test file**

In `server/agents/sub-agent-registry.test.ts`, every existing call to `spawn(...)` needs the new fields. Replace each call's `target` literal with one that includes:

```typescript
      target: {
        agentId: 'a',
        sessionKey: 'sub:agent:a:main:helper:abc',
        runId: 'r1',
        subAgentName: 'helper',
        appliedOverrides: {},
      },
```

Also: the existing test that asserts `error: 'Killed by parent'` after `kill()` must change to assert `status: 'killed'` and `error: 'Killed'`.

- [ ] **Step 8: Add new test cases**

Append at the end of the existing `describe`:

```typescript
  it('starts unsealed on spawn', () => {
    const registry = new SubAgentRegistry();
    const record = registry.spawn(
      { sessionKey: 'agent:a:main', runId: 'pr1' },
      {
        agentId: 'a',
        sessionKey: 'sub:agent:a:main:helper:abc',
        runId: 'cr1',
        subAgentName: 'helper',
        appliedOverrides: { modelId: 'foo' },
      },
    );
    expect(record.sealed).toBe(false);
    expect(record.appliedOverrides).toEqual({ modelId: 'foo' });
  });

  it('onComplete seals the record', () => {
    const registry = new SubAgentRegistry();
    const record = registry.spawn(
      { sessionKey: 'agent:a:main', runId: 'pr1' },
      {
        agentId: 'a',
        sessionKey: 'sub:agent:a:main:helper:abc',
        runId: 'cr1',
        subAgentName: 'helper',
        appliedOverrides: {},
      },
    );
    registry.onComplete('cr1', 'done');
    expect(registry.get(record.subAgentId)?.status).toBe('completed');
    expect(registry.isSealed('sub:agent:a:main:helper:abc')).toBe(true);
  });

  it('kill flips status to "killed" and seals', () => {
    const registry = new SubAgentRegistry();
    const record = registry.spawn(
      { sessionKey: 'agent:a:main', runId: 'pr1' },
      {
        agentId: 'a',
        sessionKey: 'sub:agent:a:main:helper:abc',
        runId: 'cr1',
        subAgentName: 'helper',
        appliedOverrides: {},
      },
    );
    expect(registry.kill(record.subAgentId)).toBe(true);
    const updated = registry.get(record.subAgentId);
    expect(updated?.status).toBe('killed');
    expect(updated?.sealed).toBe(true);
  });

  it('onError after kill does NOT overwrite the killed status', () => {
    const registry = new SubAgentRegistry();
    const record = registry.spawn(
      { sessionKey: 'agent:a:main', runId: 'pr1' },
      {
        agentId: 'a',
        sessionKey: 'sub:agent:a:main:helper:abc',
        runId: 'cr1',
        subAgentName: 'helper',
        appliedOverrides: {},
      },
    );
    registry.kill(record.subAgentId);
    registry.onError('cr1', 'aborted');
    expect(registry.get(record.subAgentId)?.status).toBe('killed');
  });

  it('findBySessionKey returns the record', () => {
    const registry = new SubAgentRegistry();
    registry.spawn(
      { sessionKey: 'agent:a:main', runId: 'pr1' },
      {
        agentId: 'a',
        sessionKey: 'sub:agent:a:main:helper:abc',
        runId: 'cr1',
        subAgentName: 'helper',
        appliedOverrides: {},
      },
    );
    const r = registry.findBySessionKey('sub:agent:a:main:helper:abc');
    expect(r?.runId).toBe('cr1');
  });
```

- [ ] **Step 9: Run the tests**

Run: `npx vitest run server/agents/sub-agent-registry.test.ts`
Expected: PASS, all old + new cases.

- [ ] **Step 10: Commit**

```bash
git add server/agents/sub-agent-registry.ts server/agents/sub-agent-registry.test.ts
git commit -m "feat(sub-agent): extend registry with one-shot sealing and killed terminal state"
```

---

## Task 10: Run-coordinator + caller fixes for the new `spawn` signature

The new `spawn(...)` requires `subAgentName` and `appliedOverrides`. Existing callers in `session-tools.ts` and `run-coordinator.ts` will fail to typecheck.

**Files:**
- Modify: `server/sessions/session-tools.ts`
- Modify: `server/agents/run-coordinator.ts` (callers, if any)
- Modify: `server/agents/run-coordinator.test.ts` (callers, if any)

- [ ] **Step 1: Update existing call sites with placeholder values**

Run: `grep -rn "subAgentRegistry.spawn(" server`

For each call, add `subAgentName: '<inferred-or-empty>'` and `appliedOverrides: {}` to the `target` argument. These are placeholders — the real values flow through Task 12's spawn-tool rewrite.

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Run full test suite to make sure nothing regressed**

Run: `npx vitest run`
Expected: PASS (some sub-agent test files may already be passing from earlier tasks).

- [ ] **Step 4: Commit**

```bash
git add server/sessions/session-tools.ts server/agents/run-coordinator.ts server/agents/run-coordinator.test.ts
git commit -m "chore(sub-agent): pass placeholder spawn fields at existing call sites"
```

---

## Task 11: `SubAgentExecutor` — synthetic `AgentConfig` adapter + non-blocking child runs

This is the most architecturally novel piece. The executor builds a synthetic `AgentConfig` per spawn from a `ResolvedSubAgentConfig` plus the parent's resolved context, then runs the child via a runtime path that does not consume the parent's queue slot.

**Files:**
- Create: `server/agents/sub-agent-executor.ts`
- Create: `server/agents/sub-agent-executor.test.ts`

- [ ] **Step 1: Read the existing `RunCoordinator.executeRun` to understand how a run is constructed**

Run: `grep -n "executeRun\|buildRuntime\|AgentRuntime" server/agents/run-coordinator.ts | head -30`

Note the function signature of `executeRun` (which session/run identifiers it takes, which side-effects it has on the registry/transcript). The executor will mimic the *runtime construction + dispatch* portion but bypass the concurrency queue.

- [ ] **Step 2: Skeleton with the synthetic-config adapter — write the failing test first**

Create `server/agents/sub-agent-executor.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { AgentConfig, ResolvedSubAgentConfig } from '../../shared/agent-config';
import { buildSyntheticAgentConfig } from './sub-agent-executor';

describe('buildSyntheticAgentConfig', () => {
  const parent: AgentConfig = {
    id: 'parent',
    version: 1,
    name: 'parent',
    description: '',
    tags: [],
    provider: { pluginId: 'parentP', authMethodId: 'k', envVar: '', baseUrl: '' },
    modelId: 'parent/model',
    thinkingLevel: 'low',
    systemPrompt: { mode: 'auto', sections: [], assembled: 'parent prompt', userInstructions: '' },
    modelCapabilities: {},
    memory: null,
    tools: null,
    contextEngine: null,
    connectors: [],
    agentComm: [],
    storage: null,
    vectorDatabases: [],
    crons: [],
    mcps: [],
    subAgents: [],
    workspacePath: '/parent',
    exportedAt: 0,
    sourceGraphId: 'g1',
    runTimeoutMs: 60000,
  };

  const sub: ResolvedSubAgentConfig = {
    name: 'researcher',
    description: 'r',
    systemPrompt: 'sub prompt',
    modelId: 'sub/model',
    thinkingLevel: 'medium',
    modelCapabilities: {},
    overridableFields: [],
    workingDirectory: '/parent/subagent/researcher',
    recursiveSubAgentsEnabled: false,
    provider: { pluginId: 'subP', authMethodId: 'k', envVar: '', baseUrl: '' },
    tools: {
      profile: 'minimal',
      resolvedTools: ['ask_user'],
      enabledGroups: [],
      skills: [],
      plugins: [],
      subAgentSpawning: false,
      maxSubAgents: 0,
    },
    skills: [],
    mcps: [],
  };

  it('uses sub provider/model/prompt/workspace', () => {
    const synthetic = buildSyntheticAgentConfig(parent, sub, {
      systemPromptAppend: '',
      modelIdOverride: undefined,
      thinkingLevelOverride: undefined,
      enabledToolsOverride: undefined,
    });
    expect(synthetic.provider.pluginId).toBe('subP');
    expect(synthetic.modelId).toBe('sub/model');
    expect(synthetic.workspacePath).toBe('/parent/subagent/researcher');
    expect(synthetic.systemPrompt.assembled).toContain('sub prompt');
    expect(synthetic.contextEngine).toBeNull();
    expect(synthetic.crons).toEqual([]);
    expect(synthetic.connectors).toEqual([]);
    expect(synthetic.subAgents).toEqual([]);
  });

  it('appends systemPromptAppend when provided', () => {
    const synthetic = buildSyntheticAgentConfig(parent, sub, {
      systemPromptAppend: 'Extra task instructions.',
      modelIdOverride: undefined,
      thinkingLevelOverride: undefined,
      enabledToolsOverride: undefined,
    });
    expect(synthetic.systemPrompt.assembled).toContain('sub prompt');
    expect(synthetic.systemPrompt.assembled).toContain('Extra task instructions.');
  });

  it('honors enabledTools override (subset of sub.tools.resolvedTools)', () => {
    const subWithTools = {
      ...sub,
      tools: { ...sub.tools, resolvedTools: ['ask_user', 'web_search', 'exec'] },
    };
    const synthetic = buildSyntheticAgentConfig(parent, subWithTools, {
      systemPromptAppend: '',
      modelIdOverride: undefined,
      thinkingLevelOverride: undefined,
      enabledToolsOverride: ['ask_user', 'web_search'],
    });
    expect(synthetic.tools?.resolvedTools).toEqual(['ask_user', 'web_search']);
  });

  it('exposes subAgents to the synthetic config when recursiveSubAgentsEnabled is true', () => {
    const recSub = { ...sub, recursiveSubAgentsEnabled: true };
    const parentWithSubs = { ...parent, subAgents: [sub] };
    const synthetic = buildSyntheticAgentConfig(parentWithSubs, recSub, {
      systemPromptAppend: '',
      modelIdOverride: undefined,
      thinkingLevelOverride: undefined,
      enabledToolsOverride: undefined,
    });
    expect(synthetic.subAgents).toHaveLength(1);
    expect(synthetic.subAgents[0].name).toBe('researcher');
  });

  it('hides subAgents (empty list) when recursiveSubAgentsEnabled is false', () => {
    const parentWithSubs = { ...parent, subAgents: [sub] };
    const synthetic = buildSyntheticAgentConfig(parentWithSubs, sub, {
      systemPromptAppend: '',
      modelIdOverride: undefined,
      thinkingLevelOverride: undefined,
      enabledToolsOverride: undefined,
    });
    expect(synthetic.subAgents).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test (must fail)**

Run: `npx vitest run server/agents/sub-agent-executor.test.ts`
Expected: FAIL — `buildSyntheticAgentConfig` not defined.

- [ ] **Step 4: Implement `buildSyntheticAgentConfig`**

Create `server/agents/sub-agent-executor.ts`:

```typescript
import type { AgentConfig, ResolvedSubAgentConfig, ResolvedSystemPrompt } from '../../shared/agent-config';

export interface SubAgentSpawnOverrides {
  systemPromptAppend: string;
  modelIdOverride: string | undefined;
  thinkingLevelOverride: string | undefined;
  enabledToolsOverride: string[] | undefined;
}

/**
 * Build a runtime-ready AgentConfig for a single sub-agent spawn. Does not
 * mutate the parent or sub config.
 *
 * Inheritance for fields NOT present on ResolvedSubAgentConfig (memory,
 * connectors, agentComm, vectorDatabases, crons): always cleared on the
 * synthetic config — sub-agents do not own these resources.
 *
 * Inheritance for fields present on the sub: take the sub's value (already
 * resolved to inherit-from-parent at graph-resolution time).
 */
export function buildSyntheticAgentConfig(
  parent: AgentConfig,
  sub: ResolvedSubAgentConfig,
  overrides: SubAgentSpawnOverrides,
): AgentConfig {
  const modelId = overrides.modelIdOverride ?? sub.modelId;
  const thinkingLevel = overrides.thinkingLevelOverride ?? sub.thinkingLevel;

  const baseTools = sub.tools;
  const tools = overrides.enabledToolsOverride
    ? { ...baseTools, resolvedTools: [...overrides.enabledToolsOverride] }
    : baseTools;

  const subPromptText = sub.systemPrompt;
  const appendText = overrides.systemPromptAppend?.trim();
  const assembled = appendText ? `${subPromptText}\n\n${appendText}` : subPromptText;

  const systemPrompt: ResolvedSystemPrompt = {
    mode: 'manual',
    sections: [],
    assembled,
    userInstructions: subPromptText,
  };

  return {
    id: `${parent.id}::sub::${sub.name}`,
    version: parent.version,
    name: `${parent.name}/${sub.name}`,
    description: sub.description,
    tags: [],

    provider: sub.provider,
    modelId,
    thinkingLevel,
    systemPrompt,
    modelCapabilities: sub.modelCapabilities,

    memory: null,
    tools,
    contextEngine: null,             // sub-agents are one-shot; no compaction
    connectors: [],
    agentComm: [],
    storage: parent.storage,         // sub-sessions live under the parent's storage
    vectorDatabases: [],
    crons: [],
    mcps: sub.mcps,
    subAgents: sub.recursiveSubAgentsEnabled ? parent.subAgents : [],

    workspacePath: sub.workingDirectory || parent.workspacePath || null,
    sandboxWorkdir: parent.sandboxWorkdir,
    xaiApiKey: parent.xaiApiKey,
    xaiModel: parent.xaiModel,
    tavilyApiKey: parent.tavilyApiKey,
    openaiApiKey: parent.openaiApiKey,
    geminiApiKey: parent.geminiApiKey,
    imageModel: parent.imageModel,

    exportedAt: parent.exportedAt,
    sourceGraphId: parent.sourceGraphId,
    runTimeoutMs: parent.runTimeoutMs,
    showReasoning: parent.showReasoning,
    verbose: parent.verbose,
  };
}
```

- [ ] **Step 5: Run the test (must pass)**

Run: `npx vitest run server/agents/sub-agent-executor.test.ts`
Expected: PASS, all 5 cases.

- [ ] **Step 6: Commit**

```bash
git add server/agents/sub-agent-executor.ts server/agents/sub-agent-executor.test.ts
git commit -m "feat(sub-agent): synthetic AgentConfig adapter for sub-agent spawns"
```

---

## Task 12: `SubAgentExecutor` class — non-blocking dispatch + abort plumbing

Now wire the executor itself. It owns the runtime construction and dispatch; the parent's `RunCoordinator` instantiates it lazily.

**Files:**
- Modify: `server/agents/sub-agent-executor.ts`
- Modify: `server/agents/sub-agent-executor.test.ts`

- [ ] **Step 1: Add a failing test for the executor**

Append to `server/agents/sub-agent-executor.test.ts`:

```typescript
describe('SubAgentExecutor', () => {
  it('runs a child without occupying the parent run-concurrency slot', async () => {
    // Fake runtime + concurrency controller stubs
    const concurrency = {
      activeRunId: 'parent-run-1',  // parent slot is held
      enqueue: vi.fn(),
      drain: vi.fn(),
      start: vi.fn(),
    };
    const runChild = vi.fn(async () => ({ status: 'completed', text: 'done' }));
    const events: any[] = [];
    const eventBus = { emit: (e: any) => events.push(e) };

    const executor = new SubAgentExecutor({
      runChild: runChild as any,
      eventBus: eventBus as any,
    });

    const result = await executor.dispatch({
      childRunId: 'child-1',
      childSessionKey: 'sub:agent:a:main:r:abc',
      syntheticConfig: {} as any,
      message: 'hi',
      onAbortRegister: () => {},
    });

    expect(concurrency.enqueue).not.toHaveBeenCalled();
    expect(runChild).toHaveBeenCalledOnce();
    expect(result.status).toBe('completed');
    expect(events.some((e) => e.runId === 'child-1')).toBe(true);
  });

  it('honors abort via the registered callback', async () => {
    let abortFn: (() => void) | null = null;
    const runChild = vi.fn((opts: any) =>
      new Promise<{ status: string }>((resolve) => {
        opts.onAbort = () => resolve({ status: 'aborted' });
      }),
    );
    const eventBus = { emit: vi.fn() };

    const executor = new SubAgentExecutor({
      runChild: runChild as any,
      eventBus: eventBus as any,
    });

    const dispatchP = executor.dispatch({
      childRunId: 'child-2',
      childSessionKey: 'sub:agent:a:main:r:def',
      syntheticConfig: {} as any,
      message: 'hi',
      onAbortRegister: (fn) => { abortFn = fn; },
    });

    abortFn?.();
    const result = await dispatchP;
    expect(result.status).toBe('aborted');
  });
});
```

(Add `import { vi } from 'vitest';` to the top.)

- [ ] **Step 2: Run the test (must fail)**

Run: `npx vitest run server/agents/sub-agent-executor.test.ts`
Expected: FAIL — `SubAgentExecutor` not defined.

- [ ] **Step 3: Implement the executor**

Append to `server/agents/sub-agent-executor.ts`:

```typescript
import type { AgentConfig } from '../../shared/agent-config';

export interface ChildRunResult {
  status: 'completed' | 'error' | 'aborted';
  text?: string;
  error?: string;
}

export interface ChildRunOptions {
  runId: string;
  sessionKey: string;
  syntheticConfig: AgentConfig;
  message: string;
  onAbort: () => void;            // called by the executor when abort is triggered
  emit: (event: unknown) => void; // forwarded to the event bus
}

export type ChildRunFn = (opts: ChildRunOptions) => Promise<ChildRunResult>;

export interface SubAgentExecutorOpts {
  /**
   * Bridge to the actual runtime layer that constructs a runtime from
   * `syntheticConfig` and runs it to completion. The executor doesn't know
   * about pi-coding-agent or AgentRuntime directly; the bridge does.
   */
  runChild: ChildRunFn;
  /**
   * Event bus to forward run events onto so the WebSocket subscription path
   * (and future inline cards) can read them keyed by child runId.
   */
  eventBus: { emit: (event: unknown) => void };
}

export interface DispatchOpts {
  childRunId: string;
  childSessionKey: string;
  syntheticConfig: AgentConfig;
  message: string;
  /** Caller registers an abort handler so REST/tool kill paths can fire it. */
  onAbortRegister: (abortFn: () => void) => void;
}

/**
 * Runs a sub-agent invocation alongside the parent run. Bypasses the
 * RunConcurrencyController's queue/slot accounting — sub-agents are owned
 * by the parent's run lifecycle, not by the global queue.
 */
export class SubAgentExecutor {
  constructor(private readonly opts: SubAgentExecutorOpts) {}

  async dispatch(d: DispatchOpts): Promise<ChildRunResult> {
    let abortRequested = false;
    const abortListeners: Array<() => void> = [];

    d.onAbortRegister(() => {
      abortRequested = true;
      for (const l of abortListeners) l();
    });

    const result = await this.opts.runChild({
      runId: d.childRunId,
      sessionKey: d.childSessionKey,
      syntheticConfig: d.syntheticConfig,
      message: d.message,
      onAbort: () => {
        abortListeners.push(() => {});
      },
      emit: (event) => {
        // Tag every emitted event with the child runId so subscribers can
        // filter (the inline card, the parent's WS stream).
        const tagged = typeof event === 'object' && event !== null
          ? { ...event, runId: d.childRunId }
          : { event, runId: d.childRunId };
        this.opts.eventBus.emit(tagged);
      },
    });

    if (abortRequested && result.status !== 'aborted') {
      return { status: 'aborted' };
    }
    return result;
  }
}
```

- [ ] **Step 4: Run the test (must pass)**

Run: `npx vitest run server/agents/sub-agent-executor.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add server/agents/sub-agent-executor.ts server/agents/sub-agent-executor.test.ts
git commit -m "feat(sub-agent): SubAgentExecutor for non-blocking child runs"
```

---

## Task 13: Bridge `SubAgentExecutor` into `RunCoordinator`

The executor's `runChild` bridge is the integration point with the actual runtime layer. `RunCoordinator` provides a `runChild` implementation that constructs an `AgentRuntime` from the synthetic config, runs the message through it, and finalizes.

**Files:**
- Modify: `server/agents/run-coordinator.ts`

This task is the trickiest in the plan; the implementer must understand `RunCoordinator.executeRun` deeply. Approach:

- [ ] **Step 1: Read the existing run pipeline**

Run: `grep -n "executeRun\|finalizeRunSuccess\|persistAssistantMessage\|buildRuntime" server/agents/run-coordinator.ts`

Trace the full lifecycle of a normal run from `dispatch()` → `executeRun()` → final persistence. Note especially:

- Where `AgentRuntime` is constructed.
- Where the run record is created (`this.records.set(runId, ...)`).
- Where the transcript is opened/written.
- Where success/error/abort finalization writes to the registry.

- [ ] **Step 2: Add a `runChild` private method**

Inside the `RunCoordinator` class, add a method that builds the bridge:

```typescript
  /**
   * Bridge implementation passed to `SubAgentExecutor`. Constructs a runtime
   * from the synthetic config, runs the message to completion, and returns a
   * `ChildRunResult`. Bypasses the concurrency queue.
   */
  private async runChild(opts: import('./sub-agent-executor').ChildRunOptions): Promise<import('./sub-agent-executor').ChildRunResult> {
    const { runId, sessionKey, syntheticConfig, message, onAbort, emit } = opts;

    // Open transcript on the parent's storage (sessionKey is sub:*)
    const session = await this.sessionRouter.routeBySessionKey(sessionKey);
    const transcriptManager = await this.transcriptStore.openSession(session.transcriptPath);

    const abortController = new AbortController();
    onAbort = () => abortController.abort();   // record handler reference for the executor

    try {
      // The pre-existing executeRun has all the logic for: building the
      // AgentRuntime, streaming events, persisting messages. We re-use that
      // by registering a synthetic record and calling the same internals,
      // but flag the run as a sub so it doesn't enqueue on concurrency.
      const result = await this.executeRunInternal({
        runId,
        sessionKey,
        sessionId: session.sessionId,
        config: syntheticConfig,
        text: message,
        signal: abortController.signal,
        skipConcurrencyQueue: true,
        emit,
      });
      return { status: 'completed', text: result.text };
    } catch (err) {
      if (abortController.signal.aborted) {
        return { status: 'aborted' };
      }
      return { status: 'error', error: err instanceof Error ? err.message : String(err) };
    }
  }
```

(`executeRunInternal` is the refactored internals of `executeRun`. If `executeRun` doesn't already split out cleanly, the implementer must extract a private `executeRunInternal` — a mechanical refactor — and have the public `executeRun` call it via the queue path. The `skipConcurrencyQueue: true` branch routes around `concurrency.enqueue/drain/start`.)

- [ ] **Step 3: Construct the executor in the coordinator**

In the constructor, after `this.subAgentRegistry` is available:

```typescript
this.subAgentExecutor = new SubAgentExecutor({
  runChild: (o) => this.runChild(o),
  eventBus: { emit: (e) => this.streamProcessor.publish(e as any) },
});
```

Add `private readonly subAgentExecutor: SubAgentExecutor;` and `import { SubAgentExecutor } from './sub-agent-executor';`.

- [ ] **Step 4: Pass executor + abort registry through `SessionToolContext`**

In the existing `SessionToolContext` interface, add:

```typescript
  subAgentExecutor: SubAgentExecutor;
  registerSubAgentAbort: (childRunId: string, fn: () => void) => void;
  unregisterSubAgentAbort: (childRunId: string) => void;
```

In the coordinator, maintain a `Map<string, () => void>` of child abort handlers and expose a typed register/unregister pair through the context.

- [ ] **Step 5: Wire `coordinator.abort(runId)` to also fire any registered child abort**

In `RunCoordinator.abort`, after the existing logic, also fire any matching child abort:

```typescript
  const childAbort = this.childAborts.get(runId);
  if (childAbort) {
    childAbort();
    this.childAborts.delete(runId);
  }
```

- [ ] **Step 6: Run the existing test suite to make sure nothing regressed**

Run: `npx vitest run server/agents`
Expected: PASS (sub-agent tests included).

- [ ] **Step 7: Commit**

```bash
git add server/agents/run-coordinator.ts server/agents/run-coordinator.test.ts
git commit -m "feat(sub-agent): wire SubAgentExecutor into RunCoordinator"
```

---

## Task 14: Rewrite `createSessionsSpawnTool` for the new schema + override validation

**Files:**
- Modify: `server/sessions/session-tools.ts`

- [ ] **Step 1: Update `SessionToolContext` to carry the parent's resolved `subAgents`**

Find the existing `SessionToolContext` and add:

```typescript
  parentSubAgents: ResolvedSubAgentConfig[];
```

(Plus the import.)

- [ ] **Step 2: Replace `createSessionsSpawnTool` body**

Replace the whole function with the new schema-based implementation:

```typescript
function createSessionsSpawnTool(ctx: SessionToolContext): AgentTool<TSchema> | null {
  if (ctx.parentSubAgents.length === 0) {
    // No declared sub-agents -> tool not available.
    return null;
  }

  const subAgentNames = ctx.parentSubAgents.map((s) => s.name);

  return {
    name: 'sessions_spawn',
    description:
      'Spawn one of the agent\'s declared sub-agents with a one-shot message. Returns the sub-agent\'s reply or a sub-agent id for async tracking.',
    label: 'Sessions Spawn',
    parameters: Type.Object({
      subAgent: Type.Union(
        subAgentNames.map((n) => Type.Literal(n)) as any,
        { description: 'Name of the sub-agent to dispatch' },
      ),
      message: Type.String({ description: 'Initial message for the sub-agent' }),
      overrides: Type.Optional(
        Type.Object({
          modelId: Type.Optional(Type.String()),
          thinkingLevel: Type.Optional(Type.String()),
          systemPromptAppend: Type.Optional(Type.String()),
          enabledTools: Type.Optional(Type.Array(Type.String())),
        }),
      ),
      wait: Type.Optional(Type.Boolean({ description: 'Wait for the sub-agent reply (default true)' })),
      timeoutMs: Type.Optional(Type.Number()),
    }),
    execute: async (_id, params: any) => {
      try {
        const subName = params.subAgent as string;
        const sub = ctx.parentSubAgents.find((s) => s.name === subName);
        if (!sub) {
          return textResult(`Unknown sub-agent: ${subName}. Declared: ${subAgentNames.join(', ')}.`);
        }

        const overrides = (params.overrides ?? {}) as Record<string, unknown>;
        const validation = validateOverrides(overrides, sub);
        if (validation.error) {
          return textResult(validation.error);
        }

        const message = params.message as string;
        const shouldWait = params.wait !== false;  // default true
        const timeoutMs = params.timeoutMs as number | undefined;

        const shortUuid = randomUUID().slice(0, 8);
        const subSessionKey = `sub:${ctx.callerSessionKey}:${subName}:${shortUuid}`;
        const childRunId = randomUUID();

        const syntheticConfig = buildSyntheticAgentConfig(ctx.parentAgentConfig, sub, {
          systemPromptAppend: validation.values.systemPromptAppend ?? '',
          modelIdOverride: validation.values.modelId,
          thinkingLevelOverride: validation.values.thinkingLevel,
          enabledToolsOverride: validation.values.enabledTools,
        });

        const record = ctx.subAgentRegistry.spawn(
          { sessionKey: ctx.callerSessionKey, runId: ctx.callerRunId },
          {
            agentId: ctx.callerAgentId,
            sessionKey: subSessionKey,
            runId: childRunId,
            subAgentName: subName,
            appliedOverrides: validation.values as Record<string, unknown>,
          },
        );

        // Persist the sam.sub_agent_spawn custom transcript entry on the parent's transcript
        await ctx.persistSubAgentSpawn({
          subAgentId: record.subAgentId,
          subAgentName: subName,
          subSessionKey,
          parentRunId: ctx.callerRunId,
          message,
          appliedOverrides: validation.values as Record<string, unknown>,
          modelId: syntheticConfig.modelId,
          providerPluginId: syntheticConfig.provider.pluginId,
          spawnedAt: Date.now(),
        });

        // Persist subAgentMeta on the sub-session entry
        await ctx.persistSubAgentMeta(subSessionKey, {
          subAgentId: record.subAgentId,
          subAgentName: subName,
          parentSessionKey: ctx.callerSessionKey,
          parentRunId: ctx.callerRunId,
          status: 'running',
          sealed: false,
          appliedOverrides: validation.values as Record<string, unknown>,
          modelId: syntheticConfig.modelId,
          providerPluginId: syntheticConfig.provider.pluginId,
          startedAt: record.startedAt,
        });

        const dispatchPromise = ctx.subAgentExecutor.dispatch({
          childRunId,
          childSessionKey: subSessionKey,
          syntheticConfig,
          message,
          onAbortRegister: (fn) => ctx.registerSubAgentAbort(childRunId, fn),
        });

        if (!shouldWait) {
          // Fire-and-forget: register completion to fire registry hooks
          dispatchPromise.then(
            (r) => {
              if (r.status === 'completed') ctx.subAgentRegistry.onComplete(childRunId, r.text ?? '');
              else if (r.status === 'aborted') {/* registry already updated by kill path */}
              else ctx.subAgentRegistry.onError(childRunId, r.error ?? 'unknown');
              ctx.unregisterSubAgentAbort(childRunId);
            },
          );
          return textResult(JSON.stringify({
            spawned: true,
            subAgentId: record.subAgentId,
            sessionKey: subSessionKey,
            runId: childRunId,
          }));
        }

        const timed = timeoutMs ? withTimeout(dispatchPromise, timeoutMs) : dispatchPromise;
        const result = await timed;

        if (result.status === 'completed') {
          ctx.subAgentRegistry.onComplete(childRunId, result.text ?? '');
        } else if (result.status === 'error') {
          ctx.subAgentRegistry.onError(childRunId, result.error ?? 'unknown');
        }
        ctx.unregisterSubAgentAbort(childRunId);

        return textResult(result.text || `(no text reply, status: ${result.status})`);
      } catch (e) {
        return textResult(`Error spawning sub-agent: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    },
  };
}
```

- [ ] **Step 3: Add `validateOverrides`**

Above `createSessionsSpawnTool`, add:

```typescript
import { resolveToolNames } from '../../shared/resolve-tool-names';

interface OverrideValues {
  modelId?: string;
  thinkingLevel?: string;
  systemPromptAppend?: string;
  enabledTools?: string[];
}

function validateOverrides(
  raw: Record<string, unknown>,
  sub: ResolvedSubAgentConfig,
): { error: string | null; values: OverrideValues } {
  const allowed = new Set(sub.overridableFields);
  const out: OverrideValues = {};

  for (const key of Object.keys(raw)) {
    if (!allowed.has(key as any)) {
      return {
        error: `Override "${key}" is not in the sub-agent "${sub.name}" allowlist (allowed: ${[...allowed].join(', ') || 'none'}).`,
        values: out,
      };
    }
  }

  if (typeof raw.modelId === 'string' && raw.modelId.trim()) {
    out.modelId = raw.modelId.trim();
  }
  if (typeof raw.thinkingLevel === 'string') {
    const ok = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
    if (!ok.includes(raw.thinkingLevel)) {
      return { error: `Invalid thinkingLevel: ${raw.thinkingLevel}. Allowed: ${ok.join(', ')}.`, values: out };
    }
    out.thinkingLevel = raw.thinkingLevel;
  }
  if (typeof raw.systemPromptAppend === 'string' && raw.systemPromptAppend.trim()) {
    out.systemPromptAppend = raw.systemPromptAppend.trim();
  }
  if (Array.isArray(raw.enabledTools)) {
    const effective = resolveToolNames(sub.tools);
    const effectiveSet = new Set(effective);
    for (const t of raw.enabledTools) {
      if (typeof t !== 'string' || !effectiveSet.has(t)) {
        return {
          error: `Override enabledTools contains "${t}" which is not in the sub-agent's effective tools (${effective.join(', ') || 'none'}).`,
          values: out,
        };
      }
    }
    out.enabledTools = raw.enabledTools as string[];
  }
  return { error: null, values: out };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}
```

- [ ] **Step 4: Add `persistSubAgentSpawn` and `persistSubAgentMeta` to `SessionToolContext`**

Add to the interface:

```typescript
  parentAgentConfig: AgentConfig;
  persistSubAgentSpawn: (data: SubAgentSpawnData) => Promise<void>;
  persistSubAgentMeta: (sessionKey: string, meta: SubAgentSessionMeta) => Promise<void>;
```

(Imports: `import type { SubAgentSpawnData } from '../../shared/session-diagnostics'; import type { SubAgentSessionMeta } from '../../shared/sub-agent-types';`.)

- [ ] **Step 5: Wire from `RunCoordinator`**

In `RunCoordinator.executeRun` (or wherever `SessionToolContext` is constructed), set:

```typescript
parentAgentConfig: this.config,
parentSubAgents: this.config.subAgents,
subAgentExecutor: this.subAgentExecutor,
registerSubAgentAbort: (rid, fn) => this.childAborts.set(rid, fn),
unregisterSubAgentAbort: (rid) => this.childAborts.delete(rid),
persistSubAgentSpawn: async (data) => {
  await transcriptManager.appendCustomEntry({
    type: SUB_AGENT_SPAWN_CUSTOM_TYPE,
    data,
  });
  await this.transcriptStore.snapshot(transcriptManager);
},
persistSubAgentMeta: async (sessionKey, meta) => {
  await this.storageEngine.updateSessionEntry(sessionKey, (e) => ({ ...e, subAgentMeta: meta }));
},
```

(`updateSessionEntry` may need to be added to `StorageEngine` if it doesn't exist — small surface, just a read/modify/write helper.)

- [ ] **Step 6: Conditional registration in `createSessionTools`**

Find the existing `createSessionTools(ctx)` factory. Update the `if (isEnabled('sessions_spawn'))` branch to:

```typescript
if (ctx.parentSubAgents.length > 0) {
  const t = createSessionsSpawnTool(ctx);
  if (t) tools.push(t);
}
```

(Remove the `subAgentSpawning` gate; it's superseded.)

- [ ] **Step 7: Run typecheck and the session-tools tests**

Run: `npx tsc --noEmit && npx vitest run server/sessions/session-tools.test.ts`

Some tests will need updating because the spawn tool's signature changed and `parentSubAgents` is a new context field. Update test fixtures to set `parentSubAgents: []` (no spawn) or a populated list (spawn enabled).

- [ ] **Step 8: Commit**

```bash
git add server/sessions/session-tools.ts server/sessions/session-tools.test.ts server/agents/run-coordinator.ts server/runtime/storage-engine.ts
git commit -m "feat(sub-agent): rewrite sessions_spawn for SubAgentNode + allowlist validation"
```

---

## Task 15: Reject `sessions_send` re-engagement for sub-sessions

**Files:**
- Modify: `server/sessions/session-tools.ts`
- Modify: `server/sessions/session-tools.test.ts`

- [ ] **Step 1: Add a one-shot rejection at the top of `createSessionsSendTool.execute`**

Inside the `execute` function, after parsing `params.sessionKey`:

```typescript
        const parsed = parseSubSessionKey(params.sessionKey as string);
        if (parsed) {
          return textResult(
            'Sub-agent sessions are one-shot and cannot be re-engaged with sessions_send; spawn a new sub-agent to continue.',
          );
        }
```

(`parseSubSessionKey` import added at top: `import { parseSubSessionKey } from '../agents/sub-session-key';`.)

- [ ] **Step 2: Add a test that sub-session sends never dispatch**

In `server/sessions/session-tools.test.ts`, append:

```typescript
it('sessions_send to a sub-session returns one-shot error and does not dispatch', async () => {
  const registry = new SubAgentRegistry();
  registry.spawn(
    { sessionKey: 'agent:a:main', runId: 'pr1' },
    {
      agentId: 'a',
      sessionKey: 'sub:agent:a:main:helper:abc',
      runId: 'cr1',
      subAgentName: 'helper',
      appliedOverrides: {},
    },
  );

  const ctx = makeMockContext({ subAgentRegistry: registry });
  const tools = createSessionTools(ctx);
  const send = tools.find((t) => t.name === 'sessions_send')!;

  const result = await send.execute('id', { sessionKey: 'sub:agent:a:main:helper:abc', message: 'again' });
  expect(result.content).toContain('one-shot');
  expect(ctx.coordinator.dispatch).not.toHaveBeenCalled();
});
```

(`makeMockContext` is whatever helper the existing tests use; if there's no shared helper, build one inline matching the `SessionToolContext` shape.)

- [ ] **Step 3: Run the test**

Run: `npx vitest run server/sessions/session-tools.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/sessions/session-tools.ts server/sessions/session-tools.test.ts
git commit -m "feat(sub-agent): reject sessions_send for one-shot sub-sessions"
```

---

## Task 16: REST endpoints for kill / get / list-by-parent

**Files:**
- Create: `server/routes/subagents.ts`
- Create: `server/routes/subagents.test.ts`
- Modify: `server/index.ts`

- [ ] **Step 1: Write the failing test**

Create `server/routes/subagents.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mountSubAgentRoutes } from './subagents';
import { SubAgentRegistry } from '../agents/sub-agent-registry';

function makeAppWithRegistry(registry: SubAgentRegistry, abort = (() => {}) as (id: string) => void) {
  const app = express();
  app.use(express.json());
  mountSubAgentRoutes(app, {
    registry,
    abortRun: abort,
  });
  return app;
}

function spawnRecord(registry: SubAgentRegistry) {
  return registry.spawn(
    { sessionKey: 'agent:a:main', runId: 'pr1' },
    {
      agentId: 'a',
      sessionKey: 'sub:agent:a:main:helper:abc',
      runId: 'cr1',
      subAgentName: 'helper',
      appliedOverrides: {},
    },
  );
}

describe('POST /api/subagents/:id/kill', () => {
  it('aborts run and marks killed', async () => {
    const registry = new SubAgentRegistry();
    const record = spawnRecord(registry);
    let abortedRunId: string | null = null;
    const app = makeAppWithRegistry(registry, (rid) => { abortedRunId = rid; });

    const res = await request(app).post(`/api/subagents/${record.subAgentId}/kill`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ killed: true });
    expect(abortedRunId).toBe('cr1');
    expect(registry.get(record.subAgentId)?.status).toBe('killed');
  });

  it('returns 404 for unknown id', async () => {
    const app = makeAppWithRegistry(new SubAgentRegistry());
    const res = await request(app).post('/api/subagents/nope/kill');
    expect(res.status).toBe(404);
  });

  it('returns 409 for already-terminal sub', async () => {
    const registry = new SubAgentRegistry();
    const record = spawnRecord(registry);
    registry.kill(record.subAgentId);
    const app = makeAppWithRegistry(registry);
    const res = await request(app).post(`/api/subagents/${record.subAgentId}/kill`);
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('not-running');
  });
});

describe('GET /api/subagents/:id', () => {
  it('returns the registry record', async () => {
    const registry = new SubAgentRegistry();
    const record = spawnRecord(registry);
    const app = makeAppWithRegistry(registry);
    const res = await request(app).get(`/api/subagents/${record.subAgentId}`);
    expect(res.status).toBe(200);
    expect(res.body.subAgentId).toBe(record.subAgentId);
    expect(res.body.subAgentName).toBe('helper');
  });

  it('404 on unknown', async () => {
    const app = makeAppWithRegistry(new SubAgentRegistry());
    const res = await request(app).get('/api/subagents/nope');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/subagents?parentSessionKey=...', () => {
  it('lists records for a parent session', async () => {
    const registry = new SubAgentRegistry();
    spawnRecord(registry);
    const app = makeAppWithRegistry(registry);
    const res = await request(app).get('/api/subagents?parentSessionKey=agent:a:main');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('400 when missing parentSessionKey query', async () => {
    const app = makeAppWithRegistry(new SubAgentRegistry());
    const res = await request(app).get('/api/subagents');
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test (must fail)**

Run: `npx vitest run server/routes/subagents.test.ts`
Expected: FAIL — `mountSubAgentRoutes` not defined.

- [ ] **Step 3: Implement the routes**

Create `server/routes/subagents.ts`:

```typescript
import type { Express, Request, Response } from 'express';
import type { SubAgentRegistry } from '../agents/sub-agent-registry';

export interface SubAgentRouteDeps {
  registry: SubAgentRegistry;
  /**
   * Aborts the run with the given runId. Backed by RunCoordinator.abort
   * in production; tests pass a stub.
   */
  abortRun: (runId: string) => void;
}

export function mountSubAgentRoutes(app: Express, deps: SubAgentRouteDeps): void {
  app.post('/api/subagents/:subAgentId/kill', (req: Request, res: Response) => {
    const { subAgentId } = req.params;
    const record = deps.registry.get(subAgentId);
    if (!record) {
      res.status(404).json({ error: 'unknown-sub-agent', subAgentId });
      return;
    }
    if (record.status !== 'running') {
      res.status(409).json({ error: 'not-running', reason: 'not-running', status: record.status });
      return;
    }
    // Order matters: mark killed first, THEN abort. The killed flag prevents
    // onError from clobbering it once abort propagates.
    deps.registry.kill(subAgentId);
    deps.abortRun(record.runId);
    res.status(200).json({ killed: true });
  });

  app.get('/api/subagents/:subAgentId', (req: Request, res: Response) => {
    const record = deps.registry.get(req.params.subAgentId);
    if (!record) {
      res.status(404).json({ error: 'unknown-sub-agent' });
      return;
    }
    res.status(200).json(record);
  });

  app.get('/api/subagents', (req: Request, res: Response) => {
    const parentSessionKey = req.query.parentSessionKey;
    if (typeof parentSessionKey !== 'string' || !parentSessionKey) {
      res.status(400).json({ error: 'parentSessionKey query param required' });
      return;
    }
    const records = deps.registry.listForParent(parentSessionKey);
    res.status(200).json(records);
  });
}
```

- [ ] **Step 4: Run the test (must pass)**

Run: `npx vitest run server/routes/subagents.test.ts`
Expected: PASS, all 7 cases.

- [ ] **Step 5: Mount routes in `server/index.ts`**

Find where other routes are mounted (`app.post`, `app.get` on `/api/...`) and add:

```typescript
import { mountSubAgentRoutes } from './routes/subagents';

// after RunCoordinator is constructed
mountSubAgentRoutes(app, {
  registry: subAgentRegistry,
  abortRun: (runId) => coordinator.abort(runId),
});
```

(Use the actual variable names that exist in `server/index.ts`. If `subAgentRegistry` isn't a top-level reference, expose it via `coordinator.subAgentRegistry` as a public getter.)

- [ ] **Step 6: Verify build**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/routes/subagents.ts server/routes/subagents.test.ts server/index.ts
git commit -m "feat(sub-agent): REST endpoints for kill, get, list-by-parent"
```

---

## Task 17: Make `subagents({action: 'kill'})` use the same combined path

**Files:**
- Modify: `server/sessions/session-tools.ts`

The agent-facing `subagents` tool must call the same coordinator-abort + registry-kill path as the REST endpoint. Avoid two killing semantics.

- [ ] **Step 1: Find the existing `subagents` tool's `kill` branch**

Run: `grep -n "action === 'kill'\|'kill':" server/sessions/session-tools.ts`

- [ ] **Step 2: Replace its body**

Replace the `kill` branch with:

```typescript
if (action === 'kill') {
  const record = ctx.subAgentRegistry.get(subAgentId);
  if (!record) return textResult(`Sub-agent not found: ${subAgentId}`);
  if (record.status !== 'running') {
    return textResult(`Sub-agent ${subAgentId} is already ${record.status}.`);
  }
  ctx.subAgentRegistry.kill(subAgentId);
  ctx.abortRun(record.runId);
  return textResult(`Killed sub-agent ${subAgentId}.`);
}
```

- [ ] **Step 3: Add `abortRun` to `SessionToolContext`**

```typescript
  abortRun: (runId: string) => void;
```

Wired from `RunCoordinator` as `(rid) => this.abort(rid)`.

- [ ] **Step 4: Run the session-tools tests**

Run: `npx vitest run server/sessions/session-tools.test.ts`
Expected: PASS (some test fixtures need `abortRun: () => {}` added).

- [ ] **Step 5: Commit**

```bash
git add server/sessions/session-tools.ts server/sessions/session-tools.test.ts server/agents/run-coordinator.ts
git commit -m "feat(sub-agent): subagents kill action uses combined abort+mark path"
```

---

## Task 18: Concept doc + manifest entry

**Files:**
- Create: `docs/concepts/sub-agent-node.md`
- Modify: `docs/concepts/_manifest.json`
- Modify: `docs/concepts/agent-node.md`
- Modify: `docs/concepts/tool-node.md`

- [ ] **Step 1: Read the template**

Run: `cat docs/concepts/_template.md`

- [ ] **Step 2: Create the concept doc**

Create `docs/concepts/sub-agent-node.md` based on the template. Structure:

```markdown
# Sub-Agent Node

> A peripheral that declares a named, one-shot sub-agent the parent agent can dispatch via `sessions_spawn`.

<!-- source: src/types/nodes.ts#SubAgentNodeData -->
<!-- last-verified: 2026-04-30 -->

## Overview

The Sub-Agent Node attaches to an Agent Node as a peripheral. Each declared sub-agent has its own system prompt, model, and dedicated Tools Node. The parent agent invokes a sub-agent by name through the `sessions_spawn` tool, which dispatches a one-shot run that reports back. Once the sub-agent returns, errors, or is killed, the sub-session is sealed; follow-up messages require spawning a fresh sub-agent.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | `string` | `""` | Identity used by the parent (e.g. `researcher`). Must match `/^[a-z][a-z0-9_-]{0,31}$/` |
| `description` | `string` | `""` | Shown to the parent in the `sessions_spawn` schema |
| `systemPrompt` | `string` | `"You are a focused assistant. ..."` | The sub's system prompt |
| `modelIdMode` | `'inherit' \| 'custom'` | `'inherit'` | When `inherit`, the parent's `modelId` is used at runtime |
| `modelId` | `string` | `""` | Honored only when `modelIdMode === 'custom'` |
| `thinkingLevelMode` | `'inherit' \| 'custom'` | `'inherit'` | Same convention as modelId |
| `thinkingLevel` | `ThinkingLevel` | `'off'` | Honored only when `thinkingLevelMode === 'custom'` |
| `modelCapabilities` | `ModelCapabilityOverrides` | `{}` | Snapshot/overrides like the Agent Node |
| `overridableFields` | `SubAgentOverridableField[]` | `[]` | Fields the parent may override per-call (`modelId`, `thinkingLevel`, `systemPromptAppend`, `enabledTools`) |
| `workingDirectoryMode` | `'derived' \| 'custom'` | `'derived'` | When `derived`, cwd is `<parentCwd>/subagent/<name>` |
| `workingDirectory` | `string` | `""` | Honored only when `workingDirectoryMode === 'custom'` |
| `recursiveSubAgentsEnabled` | `boolean` | `false` | When true, the sub may call `sessions_spawn` itself. Marked **Unstable** in the UI |

## Connections

- Receives from: Provider (optional), Tools (REQUIRED), Skills (any), MCP (any)
- Sends to: Agent Node only (peripheral→agent edge)
- Multiple Sub-Agent Nodes may attach to one agent; names must be unique per agent

## Runtime Behavior

1. `resolveAgentConfig()` walks edges into each Sub-Agent Node, requires exactly one Tools Node, optionally accepts one Provider Node, and merges Skills/MCPs with the parent (dedicated wins by id).
2. The parent's `sessions_spawn` tool is auto-enabled when `agentConfig.subAgents.length > 0`. Its schema lists declared sub-agent names as a literal-union enum.
3. When the parent calls `sessions_spawn({ subAgent: "<name>", message, overrides })`, the runtime validates `overrides` against `subAgent.overridableFields`, builds a synthetic `AgentConfig`, and dispatches via `SubAgentExecutor` — bypassing the parent's run-concurrency slot so the sub runs alongside the parent's tool call.
4. Each sub-session uses a key of shape `sub:<parentSessionKey>:<subAgentName>:<shortUuid>`. Storage routes it under the parent's `StorageEngine`.
5. The registry marks the sub-session `sealed` when the child run completes, errors, or is killed. `sessions_send` to any sub-session returns a one-shot error and no further work is dispatched.
6. Kill (REST `/api/subagents/:id/kill` or agent-facing `subagents({action: 'kill'})`) marks the registry record as `killed` *before* aborting the run, so the abort path doesn't downgrade the terminal state to `error`.

## Inheritance

| Resource | Source |
|---|---|
| Provider | Dedicated wins; else parent's |
| Tools | Dedicated only (required) |
| Storage | Inherited (sub-sessions live under parent's storage) |
| Memory | Sub-sessions share the parent's `MemoryEngine`; sub-session's own message history starts empty per spawn |
| Context Engine | None — sub-agents are one-shot |
| Skills | Parent ∪ dedicated; dedicated wins on `id` collision |
| MCP | Parent ∪ dedicated; dedicated wins on `mcpNodeId` collision |
| Connectors / Vector DB / AgentComm / Cron | Never apply |

## Example

```json
{
  "type": "subAgent",
  "name": "researcher",
  "description": "Researches a topic and reports back with sources.",
  "systemPrompt": "You are a research assistant. Search the web; return concise findings with sources.",
  "modelIdMode": "custom",
  "modelId": "anthropic/claude-opus-4-7",
  "thinkingLevelMode": "inherit",
  "thinkingLevel": "off",
  "modelCapabilities": {},
  "overridableFields": ["thinkingLevel", "systemPromptAppend"],
  "workingDirectoryMode": "derived",
  "workingDirectory": "",
  "recursiveSubAgentsEnabled": false
}
```
```

- [ ] **Step 3: Add to manifest**

In `docs/concepts/_manifest.json`, add an entry mapping `subAgent` to `sub-agent-node.md`. (Open the file and add a key matching the existing pattern, e.g.:

```json
"subAgent": "sub-agent-node.md"
```

placed alongside the existing entries.)

- [ ] **Step 4: Update `agent-node.md` Connections list**

Find the "Connections" section and add `Sub-Agent` to the "Receives from" line.

- [ ] **Step 5: Add deprecation note to `tool-node.md`**

Below the `subAgentSpawning` / `maxSubAgents` rows in the Configuration table, add an admonition:

```markdown
> **Deprecated.** `subAgentSpawning` and `maxSubAgents` are no longer used by the runtime. Sub-agent capability is now declared via the [Sub-Agent Node](sub-agent-node.md). Existing graphs continue to load, but these fields have no effect.
```

- [ ] **Step 6: Verify the manifest is valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('docs/concepts/_manifest.json', 'utf-8')); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 7: Commit**

```bash
git add docs/concepts/sub-agent-node.md docs/concepts/_manifest.json docs/concepts/agent-node.md docs/concepts/tool-node.md
git commit -m "docs(sub-agent): concept doc, manifest entry, deprecation notes"
```

---

## Task 19: Integration smoke test — spawn → run → complete → kill via REST

**Files:**
- Create: `server/agents/sub-agent-integration.test.ts`

This is the end-to-end smoke test that proves the backend is shippable on its own (UI not yet built).

- [ ] **Step 1: Write the test**

Create `server/agents/sub-agent-integration.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mountSubAgentRoutes } from '../routes/subagents';
import { SubAgentRegistry } from './sub-agent-registry';
import { SubAgentExecutor } from './sub-agent-executor';

describe('sub-agent backend smoke', () => {
  it('spawns, runs to completion, seals the sub-session, returns final text', async () => {
    const registry = new SubAgentRegistry();

    const executor = new SubAgentExecutor({
      runChild: async (opts) => {
        // Simulate a child run that emits a message and completes
        opts.emit({ type: 'message', text: 'I researched and found X.' });
        return { status: 'completed', text: 'I researched and found X.' };
      },
      eventBus: { emit: vi.fn() },
    });

    const record = registry.spawn(
      { sessionKey: 'agent:a:main', runId: 'pr1' },
      {
        agentId: 'a',
        sessionKey: 'sub:agent:a:main:researcher:abc',
        runId: 'cr1',
        subAgentName: 'researcher',
        appliedOverrides: {},
      },
    );

    const result = await executor.dispatch({
      childRunId: 'cr1',
      childSessionKey: 'sub:agent:a:main:researcher:abc',
      syntheticConfig: {} as any,
      message: 'Research X',
      onAbortRegister: () => {},
    });

    expect(result.status).toBe('completed');
    expect(result.text).toContain('researched');

    registry.onComplete('cr1', result.text!);

    expect(registry.get(record.subAgentId)?.status).toBe('completed');
    expect(registry.get(record.subAgentId)?.sealed).toBe(true);
  });

  it('REST kill aborts an in-flight sub and marks killed, not error', async () => {
    const registry = new SubAgentRegistry();
    const record = registry.spawn(
      { sessionKey: 'agent:a:main', runId: 'pr1' },
      {
        agentId: 'a',
        sessionKey: 'sub:agent:a:main:researcher:abc',
        runId: 'cr1',
        subAgentName: 'researcher',
        appliedOverrides: {},
      },
    );

    let abortFn: (() => void) | null = null;
    const executor = new SubAgentExecutor({
      runChild: (opts) => new Promise((resolve) => {
        opts.onAbort = () => resolve({ status: 'aborted' });
      }),
      eventBus: { emit: vi.fn() },
    });

    const dispatchP = executor.dispatch({
      childRunId: 'cr1',
      childSessionKey: 'sub:agent:a:main:researcher:abc',
      syntheticConfig: {} as any,
      message: 'Research X',
      onAbortRegister: (fn) => { abortFn = fn; },
    });

    const app = express();
    app.use(express.json());
    mountSubAgentRoutes(app, {
      registry,
      abortRun: () => abortFn?.(),
    });

    const killRes = await request(app).post(`/api/subagents/${record.subAgentId}/kill`);
    expect(killRes.status).toBe(200);

    // The dispatch should resolve as aborted; registry stays 'killed'.
    const result = await dispatchP;
    expect(result.status).toBe('aborted');
    expect(registry.get(record.subAgentId)?.status).toBe('killed');
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run server/agents/sub-agent-integration.test.ts`
Expected: PASS, both cases.

- [ ] **Step 3: Run the entire test suite as a final check**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/agents/sub-agent-integration.test.ts
git commit -m "test(sub-agent): integration smoke test for spawn/run/kill"
```

---

## Task 20: Final typecheck + manual verification harness

**Files:**
- Modify: `scripts/verify-session-tools.ts` (or create `scripts/verify-subagents.ts`)

- [ ] **Step 1: Find the existing verify harness**

Run: `ls scripts/`. The repo has `scripts/verify-session-tools.ts` for manual verification.

- [ ] **Step 2: Create `scripts/verify-subagents.ts`**

Mirror the structure of `verify-session-tools.ts` with a flow that:

1. Builds an `AgentConfig` with one declared sub-agent (`researcher`).
2. Calls `sessions_spawn` with a message and `overrides: { thinkingLevel: 'high' }`.
3. Awaits the reply.
4. Calls `sessions_send` to the same sub-session once and expects the one-shot rejection message.
5. Verifies no dispatch occurs for that rejected sub-session send.
6. Spawns a fresh sub-agent and kills it via `POST /api/subagents/:id/kill` — verifies status is `killed`.
7. Prints a tiny report (per-step pass/fail).

The exact bootstrap (creating the `RunCoordinator`, `StorageEngine`, etc.) follows whatever `verify-session-tools.ts` already does — copy its harness setup and adapt.

- [ ] **Step 3: Run the harness**

Run: `npx tsx scripts/verify-subagents.ts`
Expected: all steps pass; transcript files written under the verify storage dir.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-subagents.ts
git commit -m "chore(sub-agent): add manual verification harness"
```

---

## Self-Review

After completing all tasks, this plan implements:

| Spec section | Implemented in task(s) |
|---|---|
| §1 Data model — `SubAgentNodeData` + defaults + connection rules | Task 4 |
| §1 Inheritance mode fields decision | Task 4 |
| §2 `ResolvedSubAgentConfig` shape | Task 5 |
| §2 Resolution algorithm | Tasks 7, 8 |
| §3.1 `sessions_spawn` schema rewrite + legacy `targetAgentId` removal | Task 14 |
| §3.2 Override allowlist validation (effective-tools) | Task 14 |
| §3.3 Session-key shape + helper | Task 6 |
| §3.3 Registry record extensions (`appliedOverrides`, sealed, killed) | Task 9 |
| §3.4 One-shot sub-session enforcement on `sessions_send` | Tasks 9, 15 |
| §3.5 Recursive spawn gate (synthetic config exposes parent's subAgents only when flag is on) | Task 11 |
| §3.6 cwd derivation | Task 7 |
| §3.7 Abort-on-destroy / kill semantics | Tasks 9 (terminal state), 13 (abort plumbing), 16 (REST), 17 (tool) |
| §5 REST surface | Task 16 |
| §6 Tests | Tasks 6, 8, 9, 11, 12, 14, 15, 16, 19 |
| Guardrail 1: child executor non-blocking | Tasks 11, 12, 13 |
| Guardrail 2: synthetic AgentConfig | Task 11 |
| Guardrail 4: runtime gate by `subAgents.length` | Task 14 |
| Guardrail 5: durable spawn entry + `subAgentMeta` | Tasks 2, 3, 14 |
| Guardrail 6: session-key parser | Task 6 |
| Guardrail 7: kill terminal state preserved | Tasks 9, 16, 17 |
| Guardrail 8: effective-tools validation | Task 14 |
| Guardrail 9: mode-field convention for both modelId and thinkingLevel | Task 4 |
| Guardrail 10: MCP schema-only | Tasks 5, 7 (config plumbing only — no runtime change) |

**Out-of-scope reminders (deferred to follow-up plans):**

- UI: canvas node, property panel, inline card, history drawer
- Cross-agent sub-agents
- Persistent memory inheritance
- Per-turn fan-out quotas
- Top-level "Sub-agents" workspace page

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-04-30-sub-agent-node-backend.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
