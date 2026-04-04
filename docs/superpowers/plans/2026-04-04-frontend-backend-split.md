# Frontend-Backend Architecture Split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move agent execution from the browser to the Express backend, connected via WebSocket, so agents can access server-side tools and survive tab closure.

**Architecture:** The frontend becomes a thin UI client that sends commands over a single WebSocket. The backend holds `AgentRuntime` instances, streams events back, and persists agent configs for restart resilience. The existing `StorageEngine` + REST routes remain unchanged.

**Tech Stack:** Express 5, `ws` (WebSocket library), TypeScript, React 19, Zustand 5, Vitest

**Spec:** `docs/superpowers/specs/2026-04-04-frontend-backend-split-design.md`

---

## File Map

### New files

| File | Responsibility |
|------|---------------|
| `shared/protocol.ts` | WebSocket command/event type definitions |
| `shared/agent-config.ts` | `AgentConfig` + resolved config interfaces (moved from `src/runtime/agent-config.ts`) |
| `shared/token-estimator.ts` | Pure token estimation functions (moved from `src/runtime/token-estimator.ts`) |
| `server/connections/ws-handler.ts` | WebSocket connection lifecycle, message routing |
| `server/agents/agent-manager.ts` | Agent registry, lifecycle (start/prompt/abort/destroy/sync) |
| `server/agents/event-bridge.ts` | Subscribes to `RuntimeEvent`, forwards to WebSocket clients |
| `server/agents/config-receiver.ts` | Validates incoming `AgentConfig` from frontend |
| `server/auth/api-keys.ts` | In-memory API key storage |
| `src/client/agent-client.ts` | Singleton WebSocket manager for frontend |
| `src/store/agent-connection-store.ts` | Replaces `agent-runtime-store` with WS-backed state |
| `tsconfig.server.json` | Server-specific TypeScript config |
| `tsconfig.shared.json` | Shared module TypeScript config |

### Moved files (server-only)

| From | To |
|------|-----|
| `src/runtime/agent-runtime.ts` | `server/runtime/agent-runtime.ts` |
| `src/runtime/memory-engine.ts` | `server/runtime/memory-engine.ts` |
| `src/runtime/context-engine.ts` | `server/runtime/context-engine.ts` |
| `src/runtime/tool-factory.ts` | `server/runtime/tool-factory.ts` |
| `src/runtime/model-resolver.ts` | `server/runtime/model-resolver.ts` |
| `src/runtime/storage-engine.ts` | `server/runtime/storage-engine.ts` |

### Modified files

| File | Change |
|------|--------|
| `server/index.ts` | Add WebSocket upgrade, AgentManager init, graceful shutdown |
| `src/chat/ChatDrawer.tsx` | Replace direct runtime usage with `AgentConnectionStore` |
| `src/chat/useContextWindow.ts` | Update import path for `estimateTokens` |
| `src/store/session-store.ts` | Update import path for `StorageEngine` types |
| `src/runtime/storage-client.ts` | Update import path for `agent-config` types |
| `src/utils/graph-to-agent.ts` | Update imports to `shared/` |
| `vite.config.ts` | Add WebSocket proxy, remove `pi-agent-core` from `optimizeDeps` |
| `tsconfig.json` | Include `shared/` directory |
| `package.json` | Add `ws` dependency, update scripts |

### Deleted files

| File | Reason |
|------|--------|
| `src/store/agent-runtime-store.ts` | Replaced by `agent-connection-store.ts` |
| `src/runtime/agent-config.ts` | Moved to `shared/agent-config.ts` |
| `src/runtime/token-estimator.ts` | Moved to `shared/token-estimator.ts` |

---

## Task 1: Project scaffolding — shared types and tsconfig

**Files:**
- Create: `shared/protocol.ts`
- Create: `shared/agent-config.ts`
- Create: `shared/token-estimator.ts`
- Create: `tsconfig.server.json`
- Create: `tsconfig.shared.json`
- Modify: `tsconfig.json`
- Modify: `package.json`

- [ ] **Step 1: Install `ws` dependency**

```bash
npm install ws
npm install -D @types/ws
```

- [ ] **Step 2: Create `tsconfig.shared.json`**

Create `tsconfig.shared.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["shared"]
}
```

- [ ] **Step 3: Create `tsconfig.server.json`**

Create `tsconfig.server.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["server", "shared"]
}
```

- [ ] **Step 4: Update `tsconfig.json` to include `shared/`**

In `tsconfig.json`, change the `include` array:

```json
{
  "include": ["src", "shared"]
}
```

- [ ] **Step 5: Move `agent-config.ts` to `shared/`**

Copy `src/runtime/agent-config.ts` to `shared/agent-config.ts`. The content stays identical — it's already a pure types file:

```typescript
import type {
  MemoryBackend,
  ToolProfile,
  ToolGroup,
  SkillDefinition,
  PluginDefinition,
  CompactionStrategy,
} from '../src/types/nodes';
import type { ModelCapabilityOverrides } from '../src/types/model-metadata';

export interface AgentConfig {
  id: string;
  version: number;
  name: string;
  description: string;
  tags: string[];

  provider: string;
  modelId: string;
  thinkingLevel: string;
  systemPrompt: string;
  modelCapabilities: ModelCapabilityOverrides;

  memory: ResolvedMemoryConfig | null;
  tools: ResolvedToolsConfig | null;
  contextEngine: ResolvedContextEngineConfig | null;
  connectors: ResolvedConnectorConfig[];
  agentComm: ResolvedAgentCommConfig[];
  storage: ResolvedStorageConfig | null;
  vectorDatabases: ResolvedVectorDatabaseConfig[];

  exportedAt: number;
  sourceGraphId: string;
}

export interface ResolvedMemoryConfig {
  backend: MemoryBackend;
  maxSessionMessages: number;
  persistAcrossSessions: boolean;
  compactionEnabled: boolean;
  compactionThreshold: number;
  compactionStrategy: string;
  exposeMemorySearch: boolean;
  exposeMemoryGet: boolean;
  exposeMemorySave: boolean;
  searchMode: string;
  externalEndpoint: string;
  externalApiKey: string;
}

export interface ResolvedToolsConfig {
  profile: ToolProfile;
  resolvedTools: string[];
  enabledGroups: ToolGroup[];
  skills: SkillDefinition[];
  plugins: PluginDefinition[];
  subAgentSpawning: boolean;
  maxSubAgents: number;
}

export interface ResolvedContextEngineConfig {
  tokenBudget: number;
  reservedForResponse: number;
  ownsCompaction: boolean;
  compactionStrategy: CompactionStrategy;
  compactionTrigger: string;
  compactionThreshold: number;
  systemPromptAdditions: string[];
  autoFlushBeforeCompact: boolean;
  ragEnabled: boolean;
  ragTopK: number;
  ragMinScore: number;
}

export interface ResolvedConnectorConfig {
  label: string;
  connectorType: string;
  config: Record<string, string>;
}

export interface ResolvedAgentCommConfig {
  label: string;
  targetAgentNodeId: string | null;
  protocol: 'direct' | 'broadcast';
}

export interface ResolvedStorageConfig {
  label: string;
  backendType: 'filesystem';
  storagePath: string;
  sessionRetention: number;
  memoryEnabled: boolean;
  dailyMemoryEnabled: boolean;
}

export interface ResolvedVectorDatabaseConfig {
  label: string;
  provider: string;
  collectionName: string;
  connectionString: string;
}
```

- [ ] **Step 6: Move `token-estimator.ts` to `shared/`**

Copy `src/runtime/token-estimator.ts` to `shared/token-estimator.ts`. Content is identical — pure functions, no dependencies:

```typescript
/**
 * Simple token estimation using char/4 heuristic.
 * Accurate enough for compaction threshold decisions.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessagesTokens(
  messages: Array<{ content?: string | unknown }>,
): number {
  let total = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      total += estimateTokens(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (typeof part === 'object' && part !== null && 'text' in part) {
          total += estimateTokens((part as { text: string }).text);
        }
      }
    }
  }
  return total;
}
```

- [ ] **Step 7: Create `shared/protocol.ts`**

```typescript
import type { AgentConfig } from './agent-config';

// --- Commands (frontend → backend) ---

export interface AgentStartCommand {
  type: 'agent:start';
  agentId: string;
  config: AgentConfig;
}

export interface AgentPromptCommand {
  type: 'agent:prompt';
  agentId: string;
  sessionId: string;
  text: string;
}

export interface AgentAbortCommand {
  type: 'agent:abort';
  agentId: string;
}

export interface AgentDestroyCommand {
  type: 'agent:destroy';
  agentId: string;
}

export interface AgentSyncCommand {
  type: 'agent:sync';
  agentId: string;
}

export interface SetApiKeysCommand {
  type: 'config:setApiKeys';
  keys: Record<string, string>;
}

export type Command =
  | AgentStartCommand
  | AgentPromptCommand
  | AgentAbortCommand
  | AgentDestroyCommand
  | AgentSyncCommand
  | SetApiKeysCommand;

// --- Events (backend → frontend) ---

export interface MessageUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
}

export interface AgentReadyEvent {
  type: 'agent:ready';
  agentId: string;
}

export interface AgentErrorEvent {
  type: 'agent:error';
  agentId: string;
  error: string;
}

export interface MessageStartEvent {
  type: 'message:start';
  agentId: string;
  message: { role: string };
}

export interface MessageDeltaEvent {
  type: 'message:delta';
  agentId: string;
  delta: string;
}

export interface MessageEndEvent {
  type: 'message:end';
  agentId: string;
  message: { role: string; usage?: MessageUsage };
}

export interface ToolStartEvent {
  type: 'tool:start';
  agentId: string;
  toolCallId: string;
  toolName: string;
}

export interface ToolEndEvent {
  type: 'tool:end';
  agentId: string;
  toolCallId: string;
  toolName: string;
  result: string;
  isError: boolean;
}

export interface AgentEndEvent {
  type: 'agent:end';
  agentId: string;
}

export interface AgentStateEvent {
  type: 'agent:state';
  agentId: string;
  status: 'idle' | 'running' | 'error' | 'not_found';
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'tool';
    content: string;
    timestamp: number;
    tokenCount?: number;
    usage?: MessageUsage;
  }>;
}

export type ServerEvent =
  | AgentReadyEvent
  | AgentErrorEvent
  | MessageStartEvent
  | MessageDeltaEvent
  | MessageEndEvent
  | ToolStartEvent
  | ToolEndEvent
  | AgentEndEvent
  | AgentStateEvent;
```

- [ ] **Step 8: Delete old files**

```bash
rm src/runtime/agent-config.ts
rm src/runtime/token-estimator.ts
```

- [ ] **Step 9: Update all imports that referenced the old locations**

Update these files to import from the new `shared/` paths:

**`src/utils/graph-to-agent.ts`** — change:
```typescript
import type { AgentConfig } from '../runtime/agent-config';
import { resolveToolNames } from '../runtime/tool-factory';
```
to:
```typescript
import type { AgentConfig } from '../../shared/agent-config';
import { resolveToolNames } from '../runtime/tool-factory';
```

Note: `resolveToolNames` stays temporarily in `src/runtime/tool-factory.ts` — it moves to the server in Task 3. For now we keep it importable from frontend because `graph-to-agent.ts` uses it. We'll resolve this circular dependency in Task 3.

**`src/chat/useContextWindow.ts`** — change:
```typescript
import type { AgentConfig } from '../runtime/agent-config';
import { estimateTokens } from '../runtime/token-estimator';
```
to:
```typescript
import type { AgentConfig } from '../../shared/agent-config';
import { estimateTokens } from '../../shared/token-estimator';
```

**`src/chat/ChatDrawer.tsx`** — change:
```typescript
import type { RuntimeEvent } from '../runtime/agent-runtime';
```
to (temporarily, until Task 6 replaces the whole import):
```typescript
import type { RuntimeEvent } from '../runtime/agent-runtime';
```
(No change yet — ChatDrawer gets fully rewritten in Task 6.)

**`src/store/session-store.ts`** — change:
```typescript
import type { SessionMeta, SessionEntry } from '../runtime/storage-engine';
```
This import references types from `storage-engine.ts` which stays in `src/runtime/` for now (it's used by `storage-client.ts` too). No change needed here yet — the types are re-exported.

**`src/runtime/storage-client.ts`** — change:
```typescript
import type { ResolvedStorageConfig } from './agent-config';
```
to:
```typescript
import type { ResolvedStorageConfig } from '../../shared/agent-config';
```

**`src/runtime/storage-engine.ts`** — change:
```typescript
import type { ResolvedStorageConfig } from './agent-config';
```
to:
```typescript
import type { ResolvedStorageConfig } from '../../shared/agent-config';
```

**`src/runtime/agent-runtime.ts`** — change:
```typescript
import type { AgentConfig } from './agent-config';
```
to:
```typescript
import type { AgentConfig } from '../../shared/agent-config';
```

**`src/runtime/context-engine.ts`** — change:
```typescript
import type { ResolvedContextEngineConfig } from './agent-config';
```
to:
```typescript
import type { ResolvedContextEngineConfig } from '../../shared/agent-config';
```

Also update its import of `estimateMessagesTokens`:
```typescript
import { estimateMessagesTokens } from './token-estimator';
```
to:
```typescript
import { estimateMessagesTokens } from '../../shared/token-estimator';
```

**`src/runtime/tool-factory.ts`** — change:
```typescript
import type { ResolvedToolsConfig } from './agent-config';
```
to:
```typescript
import type { ResolvedToolsConfig } from '../../shared/agent-config';
```

**`src/runtime/model-resolver.ts`** — no `agent-config` import, no change needed.

**`src/runtime/memory-engine.ts`** — change:
```typescript
import type { ResolvedMemoryConfig } from './agent-config';
```
to:
```typescript
import type { ResolvedMemoryConfig } from '../../shared/agent-config';
```

Also find all other files that import from `src/runtime/agent-config` and update them. Search for `from '../runtime/agent-config'` and `from './agent-config'` across `src/`.

**`src/chat/ContextUsagePanel.tsx`** (if it imports `estimateTokens`):
Update to import from `../../shared/token-estimator`.

- [ ] **Step 10: Verify the frontend still builds**

```bash
npx tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 11: Commit**

```bash
git add shared/ tsconfig.server.json tsconfig.shared.json tsconfig.json package.json package-lock.json src/
git commit -m "refactor: extract shared types (protocol, agent-config, token-estimator) for frontend-backend split"
```

---

## Task 2: Server auth — API key storage

**Files:**
- Create: `server/auth/api-keys.ts`

- [ ] **Step 1: Write the test**

Create `server/auth/api-keys.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { ApiKeyStore } from './api-keys';

describe('ApiKeyStore', () => {
  let store: ApiKeyStore;

  beforeEach(() => {
    store = new ApiKeyStore();
  });

  it('returns undefined for unknown provider', () => {
    expect(store.get('openai')).toBeUndefined();
  });

  it('stores and retrieves a key', () => {
    store.setAll({ openai: 'sk-test-123' });
    expect(store.get('openai')).toBe('sk-test-123');
  });

  it('overwrites all keys on setAll', () => {
    store.setAll({ openai: 'sk-1', anthropic: 'sk-2' });
    store.setAll({ openai: 'sk-3' });
    expect(store.get('openai')).toBe('sk-3');
    expect(store.get('anthropic')).toBeUndefined();
  });

  it('has() returns true only for set keys', () => {
    store.setAll({ openai: 'sk-1' });
    expect(store.has('openai')).toBe(true);
    expect(store.has('anthropic')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/auth/api-keys.test.ts
```

Expected: FAIL — `ApiKeyStore` not found.

- [ ] **Step 3: Write the implementation**

Create `server/auth/api-keys.ts`:

```typescript
/**
 * In-memory API key storage.
 * Single-user, not persisted to disk. Keys are re-entered on server restart.
 */
export class ApiKeyStore {
  private keys: Record<string, string> = {};

  /** Replace all stored keys. */
  setAll(keys: Record<string, string>): void {
    this.keys = { ...keys };
  }

  /** Get a key for a provider. Returns undefined if not set. */
  get(provider: string): string | undefined {
    return this.keys[provider];
  }

  /** Check whether a key exists for a provider. */
  has(provider: string): boolean {
    return provider in this.keys;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run server/auth/api-keys.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/auth/
git commit -m "feat: add server-side ApiKeyStore for in-memory API key management"
```

---

## Task 3: Move runtime files to server

This task physically moves the runtime code from `src/runtime/` to `server/runtime/` and fixes the import paths. The runtime files that move are: `agent-runtime.ts`, `memory-engine.ts`, `context-engine.ts`, `tool-factory.ts`, `model-resolver.ts`, `storage-engine.ts`.

Files that stay in `src/runtime/`: `storage-client.ts` (browser-only HTTP client).

**Files:**
- Move: `src/runtime/agent-runtime.ts` → `server/runtime/agent-runtime.ts`
- Move: `src/runtime/memory-engine.ts` → `server/runtime/memory-engine.ts`
- Move: `src/runtime/context-engine.ts` → `server/runtime/context-engine.ts`
- Move: `src/runtime/tool-factory.ts` → `server/runtime/tool-factory.ts`
- Move: `src/runtime/model-resolver.ts` → `server/runtime/model-resolver.ts`
- Move: `src/runtime/storage-engine.ts` → `server/runtime/storage-engine.ts`
- Modify: `server/runtime/agent-runtime.ts` (remove `useModelCatalogStore` dependency)
- Modify: `src/utils/graph-to-agent.ts` (inline `resolveToolNames` or extract the parts it needs)
- Modify: `server/index.ts` (update `StorageEngine` import path)
- Modify: `src/runtime/storage-client.ts` (update `StorageEngine` type import)

- [ ] **Step 1: Create `server/runtime/` directory and move files**

```bash
mkdir -p server/runtime
mv src/runtime/agent-runtime.ts server/runtime/agent-runtime.ts
mv src/runtime/memory-engine.ts server/runtime/memory-engine.ts
mv src/runtime/context-engine.ts server/runtime/context-engine.ts
mv src/runtime/tool-factory.ts server/runtime/tool-factory.ts
mv src/runtime/model-resolver.ts server/runtime/model-resolver.ts
mv src/runtime/storage-engine.ts server/runtime/storage-engine.ts
```

- [ ] **Step 2: Fix import paths in moved files**

All moved files already import from `../../shared/` (updated in Task 1). Now fix cross-references between server/runtime files.

**`server/runtime/agent-runtime.ts`** — update imports:
```typescript
import { Agent, type AgentEvent, type AgentTool } from '@mariozechner/pi-agent-core';
import type { TSchema } from '@sinclair/typebox';
import type { AgentConfig } from '../../shared/agent-config';
import { MemoryEngine } from './memory-engine';
import { ContextEngine } from './context-engine';
import { resolveToolNames, createAgentTools } from './tool-factory';
import { resolveRuntimeModel } from './model-resolver';
```

Remove the `useModelCatalogStore` import and the line that calls `useModelCatalogStore.getState().getModelMetadata`. Replace it by accepting model metadata as a constructor parameter:

Change the constructor signature from:
```typescript
constructor(
  config: AgentConfig,
  getApiKey: (provider: string) => Promise<string | undefined> | string | undefined,
)
```
to:
```typescript
constructor(
  config: AgentConfig,
  getApiKey: (provider: string) => Promise<string | undefined> | string | undefined,
  getDiscoveredModel?: (provider: string, modelId: string) => DiscoveredModelMetadata | undefined,
)
```

And update the `resolveRuntimeModel` call:
```typescript
const model = resolveRuntimeModel({
  provider: config.provider,
  modelId: config.modelId,
  modelCapabilities: config.modelCapabilities,
  getDiscoveredModel: getDiscoveredModel ?? (() => undefined),
});
```

Add the import:
```typescript
import type { DiscoveredModelMetadata } from '../../src/types/model-metadata';
```

**`server/runtime/context-engine.ts`** — imports already updated in Task 1. Verify:
```typescript
import type { ResolvedContextEngineConfig } from '../../shared/agent-config';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { estimateMessagesTokens } from '../../shared/token-estimator';
```

**`server/runtime/memory-engine.ts`** — verify:
```typescript
import type { ResolvedMemoryConfig } from '../../shared/agent-config';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { Type, type TSchema } from '@sinclair/typebox';
```

**`server/runtime/tool-factory.ts`** — verify:
```typescript
import type { ToolProfile, ToolGroup } from '../../src/types/nodes';
import type { ResolvedToolsConfig } from '../../shared/agent-config';
import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
```

**`server/runtime/model-resolver.ts`** — verify:
```typescript
import { getModel, getModels } from '@mariozechner/pi-ai';
import type { Api, Model } from '@mariozechner/pi-ai';
import type { DiscoveredModelMetadata, ModelCapabilityOverrides } from '../../src/types/model-metadata';
```

**`server/runtime/storage-engine.ts`** — verify:
```typescript
import type { ResolvedStorageConfig } from '../../shared/agent-config';
```

- [ ] **Step 3: Fix `graph-to-agent.ts` — extract `resolveToolNames` to shared**

`graph-to-agent.ts` uses `resolveToolNames` from `tool-factory.ts`. Since `tool-factory.ts` has moved to the server and has Node/pi-agent-core deps, we need to extract just the name resolution logic.

Create `shared/resolve-tool-names.ts`:

```typescript
import type { ResolvedToolsConfig } from './agent-config';

// These constants are duplicated from server/runtime/tool-factory.ts
// to avoid pulling pi-agent-core into the frontend bundle.

type ToolGroup = ResolvedToolsConfig['enabledGroups'][number];

const TOOL_GROUPS: Record<string, string[]> = {
  runtime: ['bash', 'code_interpreter'],
  fs: ['read_file', 'write_file', 'list_directory'],
  web: ['web_search', 'web_fetch'],
  memory: ['memory_search', 'memory_get', 'memory_save'],
  coding: ['bash', 'read_file', 'write_file', 'code_interpreter'],
  communication: ['send_message'],
};

const TOOL_PROFILES: Record<string, string[]> = {
  full: ['runtime', 'fs', 'web', 'memory', 'coding', 'communication'],
  coding: ['runtime', 'fs', 'coding', 'memory'],
  messaging: ['web', 'communication', 'memory'],
  minimal: ['web'],
  custom: [],
};

/**
 * Expand profile + groups + custom enabledTools into a flat deduplicated list.
 */
export function resolveToolNames(config: ResolvedToolsConfig): string[] {
  const names = new Set<string>();

  if (config.profile !== 'custom') {
    const groups = TOOL_PROFILES[config.profile];
    if (groups) {
      for (const group of groups) {
        for (const tool of TOOL_GROUPS[group] ?? []) {
          names.add(tool);
        }
      }
    }
  }

  for (const group of config.enabledGroups) {
    for (const tool of TOOL_GROUPS[group] ?? []) {
      names.add(tool);
    }
  }

  for (const tool of config.resolvedTools) {
    names.add(tool);
  }

  for (const plugin of config.plugins) {
    if (plugin.enabled) {
      for (const tool of plugin.tools) {
        names.add(tool);
      }
    }
  }

  return [...names];
}
```

Update `src/utils/graph-to-agent.ts`:
```typescript
import type { AgentConfig } from '../../shared/agent-config';
import { resolveToolNames } from '../../shared/resolve-tool-names';
```

Update `server/runtime/tool-factory.ts` to import `resolveToolNames` from shared too:
```typescript
import { resolveToolNames } from '../../shared/resolve-tool-names';
export { resolveToolNames };
```
And remove the duplicate `resolveToolNames` function and the `TOOL_GROUPS`/`TOOL_PROFILES` constants from `tool-factory.ts`, keeping only `createAgentTools`, `ALL_TOOL_NAMES`, and the tool creator functions.

- [ ] **Step 4: Update `server/index.ts` import path**

Change:
```typescript
import { StorageEngine } from '../src/runtime/storage-engine';
```
to:
```typescript
import { StorageEngine } from './runtime/storage-engine';
```

Also update the type imports:
```typescript
import type { ResolvedStorageConfig } from '../shared/agent-config';
import type { SessionMeta, SessionEntry } from './runtime/storage-engine';
```

- [ ] **Step 5: Update `src/runtime/storage-client.ts`**

Update the `StorageEngine` type import. The `StorageClient` currently imports types from `./storage-engine` — those types need to come from the server path or be re-exported. Since the frontend can't import from `server/`, re-export the types from `shared/`.

Add to `shared/agent-config.ts` (append at bottom — these are already there but we need the `SessionMeta`/`SessionEntry` types accessible to the frontend too):

Actually, `SessionMeta` and `SessionEntry` are defined in `storage-engine.ts` which is now server-only. Extract them into a separate shared file.

Create `shared/storage-types.ts`:

```typescript
export interface SessionMeta {
  sessionId: string;
  agentName: string;
  llmSlug: string;
  startedAt: string;
  updatedAt: string;
  sessionFile: string;
  skillsSnapshot?: {
    version: number;
    prompt: string;
    skills: { name: string; requiredEnv: string[]; primaryEnv?: string }[];
    resolvedSkills: {
      name: string;
      description: string;
      filePath: string;
      baseDir: string;
      source?: string;
      disableModelInvocation?: boolean;
    }[];
  };
  contextTokens: number;
  systemPromptReport?: {
    skills: {
      promptChars: number;
      entries: { name: string; blockChars: number }[];
    };
    tools: {
      listChars: number;
      schemaChars: number;
      entries: { name: string; summaryChars: number; schemaChars: number; propertyCount: number }[];
    };
  };
  totalInputTokens: number;
  totalOutputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  totalEstimatedCostUsd: number;
  totalTokens: number;
}

export interface SessionEntry {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  [key: string]: unknown;
}

export interface MemoryFileInfo {
  name: string;
  isEvergreen: boolean;
  date: string | null;
}
```

Update `server/runtime/storage-engine.ts` to import from shared:
```typescript
import type { ResolvedStorageConfig } from '../../shared/agent-config';
import type { SessionMeta, SessionEntry, MemoryFileInfo } from '../../shared/storage-types';
export type { SessionMeta, SessionEntry, MemoryFileInfo };
```

Remove the duplicate interface definitions from `storage-engine.ts`.

Update `src/runtime/storage-client.ts`:
```typescript
import type { ResolvedStorageConfig } from '../../shared/agent-config';
import type { SessionMeta, SessionEntry, MemoryFileInfo } from '../../shared/storage-types';
```

Update `src/store/session-store.ts`:
```typescript
import type { SessionMeta, SessionEntry } from '../../shared/storage-types';
```

Update `server/index.ts`:
```typescript
import type { SessionMeta, SessionEntry } from '../shared/storage-types';
import type { ResolvedStorageConfig } from '../shared/agent-config';
```

- [ ] **Step 6: Verify everything compiles**

```bash
npx tsc --noEmit
npx tsc --noEmit -p tsconfig.server.json
```

Expected: no type errors on either.

- [ ] **Step 7: Commit**

```bash
git add server/runtime/ shared/ src/ 
git commit -m "refactor: move runtime engine files to server/, extract shared storage types"
```

---

## Task 4: EventBridge — runtime events to WebSocket

**Files:**
- Create: `server/agents/event-bridge.ts`
- Test: `server/agents/event-bridge.test.ts`

- [ ] **Step 1: Write the test**

Create `server/agents/event-bridge.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { EventBridge } from './event-bridge';
import type { ServerEvent } from '../../shared/protocol';

// Minimal mock WebSocket
function mockSocket() {
  return {
    readyState: 1, // OPEN
    send: vi.fn(),
    OPEN: 1,
  } as any;
}

describe('EventBridge', () => {
  it('forwards a runtime event to connected sockets as a ServerEvent', () => {
    const bridge = new EventBridge('agent-1');
    const socket = mockSocket();
    bridge.addSocket(socket);

    bridge.handleRuntimeEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
    } as any);

    expect(socket.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(socket.send.mock.calls[0][0]) as ServerEvent;
    expect(sent.type).toBe('message:delta');
    expect((sent as any).agentId).toBe('agent-1');
    expect((sent as any).delta).toBe('hello');
  });

  it('does not send to closed sockets', () => {
    const bridge = new EventBridge('agent-1');
    const socket = mockSocket();
    socket.readyState = 3; // CLOSED
    bridge.addSocket(socket);

    bridge.handleRuntimeEvent({
      type: 'agent_end',
    } as any);

    expect(socket.send).not.toHaveBeenCalled();
  });

  it('removeSocket stops sending', () => {
    const bridge = new EventBridge('agent-1');
    const socket = mockSocket();
    bridge.addSocket(socket);
    bridge.removeSocket(socket);

    bridge.handleRuntimeEvent({ type: 'agent_end' } as any);

    expect(socket.send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/agents/event-bridge.test.ts
```

Expected: FAIL — `EventBridge` not found.

- [ ] **Step 3: Write the implementation**

Create `server/agents/event-bridge.ts`:

```typescript
import type WebSocket from 'ws';
import type { RuntimeEvent } from '../runtime/agent-runtime';
import type { ServerEvent } from '../../shared/protocol';

/**
 * Bridges RuntimeEvents from an AgentRuntime to connected WebSocket clients.
 * One EventBridge per managed agent.
 */
export class EventBridge {
  private sockets = new Set<WebSocket>();

  constructor(private readonly agentId: string) {}

  addSocket(socket: WebSocket): void {
    this.sockets.add(socket);
  }

  removeSocket(socket: WebSocket): void {
    this.sockets.delete(socket);
  }

  get socketCount(): number {
    return this.sockets.size;
  }

  handleRuntimeEvent(event: RuntimeEvent): void {
    const serverEvent = this.mapEvent(event);
    if (!serverEvent) return;
    this.broadcast(serverEvent);
  }

  private broadcast(event: ServerEvent): void {
    const json = JSON.stringify(event);
    for (const socket of this.sockets) {
      if (socket.readyState === socket.OPEN) {
        socket.send(json);
      }
    }
  }

  private mapEvent(event: RuntimeEvent): ServerEvent | null {
    const agentId = this.agentId;

    switch (event.type) {
      case 'runtime_ready':
        return { type: 'agent:ready', agentId };

      case 'runtime_error':
        return { type: 'agent:error', agentId, error: event.error };

      case 'message_start': {
        const msg = event.message as { role?: string };
        if (msg.role === 'assistant') {
          return { type: 'message:start', agentId, message: { role: 'assistant' } };
        }
        return null;
      }

      case 'message_update': {
        const aEvent = event.assistantMessageEvent;
        if (aEvent.type === 'text_delta') {
          return { type: 'message:delta', agentId, delta: aEvent.delta };
        }
        if (aEvent.type === 'error') {
          return {
            type: 'agent:error',
            agentId,
            error: aEvent.error?.errorMessage || 'Unknown provider error',
          };
        }
        return null;
      }

      case 'message_end': {
        const endMsg = event.message as {
          role?: string;
          usage?: {
            input: number;
            output: number;
            cacheRead: number;
            cacheWrite: number;
            totalTokens: number;
          };
        };
        if (endMsg.role === 'assistant') {
          return {
            type: 'message:end',
            agentId,
            message: { role: 'assistant', usage: endMsg.usage },
          };
        }
        return null;
      }

      case 'tool_execution_start':
        return {
          type: 'tool:start',
          agentId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
        };

      case 'tool_execution_end': {
        const resultText =
          event.result?.content
            ?.map((c: { type: string; text?: string }) =>
              c.type === 'text' ? c.text : '',
            )
            .join('') || '';
        return {
          type: 'tool:end',
          agentId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: resultText.slice(0, 500),
          isError: !!event.isError,
        };
      }

      case 'agent_end':
        return { type: 'agent:end', agentId };

      default:
        return null;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run server/agents/event-bridge.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/agents/
git commit -m "feat: add EventBridge to translate RuntimeEvents to WebSocket protocol"
```

---

## Task 5: AgentManager — agent lifecycle

**Files:**
- Create: `server/agents/agent-manager.ts`
- Test: `server/agents/agent-manager.test.ts`

- [ ] **Step 1: Write the test**

Create `server/agents/agent-manager.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentManager } from './agent-manager';
import { ApiKeyStore } from '../auth/api-keys';
import type { AgentConfig } from '../../shared/agent-config';

// Minimal config for testing
function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'agent-1',
    version: 2,
    name: 'Test Agent',
    description: '',
    tags: [],
    provider: 'openai',
    modelId: 'gpt-4',
    thinkingLevel: 'none',
    systemPrompt: 'You are a test agent.',
    modelCapabilities: {},
    memory: null,
    tools: null,
    contextEngine: {
      tokenBudget: 128000,
      reservedForResponse: 4096,
      ownsCompaction: true,
      compactionStrategy: 'trim-oldest',
      compactionTrigger: 'auto',
      compactionThreshold: 0.8,
      systemPromptAdditions: [],
      autoFlushBeforeCompact: false,
      ragEnabled: false,
      ragTopK: 5,
      ragMinScore: 0.7,
    },
    connectors: [],
    agentComm: [],
    storage: {
      label: 'Local',
      backendType: 'filesystem',
      storagePath: '/tmp/test-storage',
      sessionRetention: 10,
      memoryEnabled: false,
      dailyMemoryEnabled: false,
    },
    vectorDatabases: [],
    exportedAt: Date.now(),
    sourceGraphId: 'agent-1',
    ...overrides,
  };
}

describe('AgentManager', () => {
  let manager: AgentManager;
  let apiKeys: ApiKeyStore;

  beforeEach(() => {
    apiKeys = new ApiKeyStore();
    apiKeys.setAll({ openai: 'sk-test' });
    manager = new AgentManager(apiKeys);
  });

  it('starts an agent and tracks it', () => {
    const config = makeConfig();
    manager.start(config);
    expect(manager.has('agent-1')).toBe(true);
    expect(manager.getStatus('agent-1')).toBe('idle');
  });

  it('destroys an agent', () => {
    manager.start(makeConfig());
    manager.destroy('agent-1');
    expect(manager.has('agent-1')).toBe(false);
  });

  it('replaces an existing agent on re-start', () => {
    manager.start(makeConfig());
    manager.start(makeConfig({ systemPrompt: 'Updated prompt' }));
    expect(manager.has('agent-1')).toBe(true);
  });

  it('getStatus returns not_found for unknown agent', () => {
    expect(manager.getStatus('unknown')).toBe('not_found');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/agents/agent-manager.test.ts
```

Expected: FAIL — `AgentManager` not found.

- [ ] **Step 3: Write the implementation**

Create `server/agents/agent-manager.ts`:

```typescript
import { AgentRuntime, type RuntimeEvent } from '../runtime/agent-runtime';
import { EventBridge } from './event-bridge';
import { ApiKeyStore } from '../auth/api-keys';
import type { AgentConfig } from '../../shared/agent-config';
import type { StorageEngine } from '../runtime/storage-engine';
import type WebSocket from 'ws';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export interface ManagedAgent {
  runtime: AgentRuntime;
  config: AgentConfig;
  status: 'idle' | 'running' | 'error';
  bridge: EventBridge;
  activeSessionId: string | null;
  lastActivity: number;
  unsubscribe: () => void;
}

export class AgentManager {
  private agents = new Map<string, ManagedAgent>();

  constructor(private readonly apiKeys: ApiKeyStore) {}

  start(config: AgentConfig): void {
    // Destroy existing if present
    if (this.agents.has(config.id)) {
      this.destroy(config.id);
    }

    const bridge = new EventBridge(config.id);

    const runtime = new AgentRuntime(
      config,
      (provider) => Promise.resolve(this.apiKeys.get(provider)),
    );

    const unsubscribe = runtime.subscribe((event: RuntimeEvent) => {
      bridge.handleRuntimeEvent(event);

      if (event.type === 'agent_end') {
        const managed = this.agents.get(config.id);
        if (managed) managed.status = 'idle';
      }
    });

    this.agents.set(config.id, {
      runtime,
      config,
      status: 'idle',
      bridge,
      activeSessionId: null,
      lastActivity: Date.now(),
      unsubscribe,
    });

    // Persist config for restart resilience
    this.persistConfig(config).catch(console.error);
  }

  async prompt(agentId: string, sessionId: string, text: string): Promise<void> {
    const managed = this.agents.get(agentId);
    if (!managed) throw new Error(`Agent ${agentId} not found`);

    managed.status = 'running';
    managed.activeSessionId = sessionId;
    managed.lastActivity = Date.now();

    try {
      await managed.runtime.prompt(text);
    } catch (error) {
      managed.status = 'error';
      throw error;
    }
  }

  abort(agentId: string): void {
    const managed = this.agents.get(agentId);
    if (!managed) return;
    managed.runtime.abort();
    managed.status = 'idle';
  }

  destroy(agentId: string): void {
    const managed = this.agents.get(agentId);
    if (!managed) return;
    managed.unsubscribe();
    managed.runtime.destroy();
    this.agents.delete(agentId);
  }

  has(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  getStatus(agentId: string): 'idle' | 'running' | 'error' | 'not_found' {
    const managed = this.agents.get(agentId);
    return managed?.status ?? 'not_found';
  }

  getBridge(agentId: string): EventBridge | undefined {
    return this.agents.get(agentId)?.bridge;
  }

  addSocket(agentId: string, socket: WebSocket): void {
    this.agents.get(agentId)?.bridge.addSocket(socket);
  }

  removeSocketFromAll(socket: WebSocket): void {
    for (const managed of this.agents.values()) {
      managed.bridge.removeSocket(socket);
    }
  }

  /** Persist agent config to disk for restart resilience. */
  private async persistConfig(config: AgentConfig): Promise<void> {
    if (!config.storage) return;
    const storagePath = config.storage.storagePath.startsWith('~')
      ? config.storage.storagePath.replace('~', os.homedir())
      : config.storage.storagePath;
    const agentDir = path.join(storagePath, config.name);
    await fs.mkdir(agentDir, { recursive: true });
    await fs.writeFile(
      path.join(agentDir, 'agent-config.json'),
      JSON.stringify(config, null, 2),
      'utf-8',
    );
  }

  /** Restore agents from persisted configs on server boot. */
  async restoreFromDisk(storagePath: string): Promise<number> {
    const resolvedPath = storagePath.startsWith('~')
      ? storagePath.replace('~', os.homedir())
      : storagePath;

    let restored = 0;
    try {
      const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const configPath = path.join(resolvedPath, entry.name, 'agent-config.json');
        try {
          const raw = await fs.readFile(configPath, 'utf-8');
          const config = JSON.parse(raw) as AgentConfig;
          this.start(config);
          restored++;
        } catch {
          // No config file in this directory — skip
        }
      }
    } catch {
      // Storage path doesn't exist yet — nothing to restore
    }
    return restored;
  }

  /** Graceful shutdown: destroy all agents. */
  async shutdown(): Promise<void> {
    for (const [agentId] of this.agents) {
      this.destroy(agentId);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run server/agents/agent-manager.test.ts
```

Expected: PASS (note: `AgentRuntime` constructor may fail due to missing model — the test may need mocking. If it fails, mock `AgentRuntime` in the test:

```typescript
vi.mock('../runtime/agent-runtime', () => ({
  AgentRuntime: vi.fn().mockImplementation(() => ({
    subscribe: vi.fn(() => vi.fn()),
    prompt: vi.fn(),
    abort: vi.fn(),
    destroy: vi.fn(),
    state: { messages: [] },
  })),
}));
```

Add this at the top of the test file if needed.)

- [ ] **Step 5: Commit**

```bash
git add server/agents/
git commit -m "feat: add AgentManager for agent lifecycle, persistence, and restart resilience"
```

---

## Task 6: WebSocket handler + server entry point upgrade

**Files:**
- Create: `server/connections/ws-handler.ts`
- Modify: `server/index.ts`

- [ ] **Step 1: Create `server/connections/ws-handler.ts`**

```typescript
import type WebSocket from 'ws';
import type { AgentManager } from '../agents/agent-manager';
import type { ApiKeyStore } from '../auth/api-keys';
import type { Command, AgentStateEvent } from '../../shared/protocol';

/**
 * Handles a single WebSocket connection: parses incoming commands,
 * routes them to AgentManager, manages socket lifecycle.
 */
export function handleConnection(
  socket: WebSocket,
  manager: AgentManager,
  apiKeys: ApiKeyStore,
): void {
  console.log('[ws] Client connected');

  socket.on('message', async (data) => {
    let command: Command;
    try {
      command = JSON.parse(data.toString()) as Command;
    } catch {
      socket.send(JSON.stringify({ type: 'error', error: 'Invalid JSON' }));
      return;
    }

    try {
      switch (command.type) {
        case 'agent:start': {
          manager.start(command.config);
          manager.addSocket(command.agentId, socket);
          socket.send(JSON.stringify({
            type: 'agent:ready',
            agentId: command.agentId,
          }));
          break;
        }

        case 'agent:prompt': {
          // Ensure socket is subscribed to this agent's events
          manager.addSocket(command.agentId, socket);
          await manager.prompt(command.agentId, command.sessionId, command.text);
          break;
        }

        case 'agent:abort': {
          manager.abort(command.agentId);
          break;
        }

        case 'agent:destroy': {
          manager.destroy(command.agentId);
          break;
        }

        case 'agent:sync': {
          const status = manager.getStatus(command.agentId);
          manager.addSocket(command.agentId, socket);

          const stateEvent: AgentStateEvent = {
            type: 'agent:state',
            agentId: command.agentId,
            status: status,
            messages: [], // Messages loaded from StorageEngine by the frontend via existing REST
          };
          socket.send(JSON.stringify(stateEvent));
          break;
        }

        case 'config:setApiKeys': {
          apiKeys.setAll(command.keys);
          break;
        }
      }
    } catch (err) {
      socket.send(JSON.stringify({
        type: 'agent:error',
        agentId: (command as any).agentId ?? 'unknown',
        error: err instanceof Error ? err.message : 'Unknown error',
      }));
    }
  });

  socket.on('close', () => {
    console.log('[ws] Client disconnected');
    manager.removeSocketFromAll(socket);
  });

  socket.on('error', (err) => {
    console.error('[ws] Socket error:', err.message);
    manager.removeSocketFromAll(socket);
  });
}
```

- [ ] **Step 2: Rewrite `server/index.ts`**

```typescript
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { StorageEngine } from './runtime/storage-engine';
import { AgentManager } from './agents/agent-manager';
import { ApiKeyStore } from './auth/api-keys';
import { handleConnection } from './connections/ws-handler';
import type { ResolvedStorageConfig } from '../shared/agent-config';
import type { SessionMeta, SessionEntry } from '../shared/storage-types';

const app = express();
app.use(express.json({ limit: '10mb' }));

// --- Shared state ---

const apiKeys = new ApiKeyStore();
const agentManager = new AgentManager(apiKeys);

// --- Storage engine instances ---

const engines = new Map<string, StorageEngine>();

function getOrCreateEngine(config: ResolvedStorageConfig, agentName: string): StorageEngine {
  const key = `${config.storagePath}:${agentName}`;
  let engine = engines.get(key);
  if (!engine) {
    engine = new StorageEngine(config, agentName);
    engines.set(key, engine);
  }
  return engine;
}

// --- Storage REST routes (unchanged) ---

app.post('/api/storage/init', async (req, res) => {
  const { config, agentName } = req.body as { config: ResolvedStorageConfig; agentName: string };
  try {
    const engine = getOrCreateEngine(config, agentName);
    await engine.init();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/storage/sessions', async (req, res) => {
  const { config, agentName } = req.query as { config: string; agentName: string };
  try {
    const parsedConfig = JSON.parse(config) as ResolvedStorageConfig;
    const engine = getOrCreateEngine(parsedConfig, agentName);
    const sessions = await engine.listSessions();
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/storage/sessions', async (req, res) => {
  const { config, agentName, meta } = req.body as {
    config: ResolvedStorageConfig;
    agentName: string;
    meta: SessionMeta;
  };
  try {
    const engine = getOrCreateEngine(config, agentName);
    await engine.createSession(meta);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.delete('/api/storage/sessions/:id', async (req, res) => {
  const { config, agentName } = req.query as { config: string; agentName: string };
  try {
    const parsedConfig = JSON.parse(config) as ResolvedStorageConfig;
    const engine = getOrCreateEngine(parsedConfig, agentName);
    await engine.deleteSession(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/storage/sessions/:id', async (req, res) => {
  const { config, agentName } = req.query as { config: string; agentName: string };
  try {
    const parsedConfig = JSON.parse(config) as ResolvedStorageConfig;
    const engine = getOrCreateEngine(parsedConfig, agentName);
    const meta = await engine.getSessionMeta(req.params.id);
    res.json(meta);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.patch('/api/storage/sessions/:id', async (req, res) => {
  const { config, agentName, partial } = req.body as {
    config: ResolvedStorageConfig;
    agentName: string;
    partial: Partial<SessionMeta>;
  };
  try {
    const engine = getOrCreateEngine(config, agentName);
    await engine.updateSessionMeta(req.params.id, partial);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/storage/sessions/:id/entries', async (req, res) => {
  const { config, agentName, entry } = req.body as {
    config: ResolvedStorageConfig;
    agentName: string;
    entry: SessionEntry;
  };
  try {
    const engine = getOrCreateEngine(config, agentName);
    await engine.appendEntry(req.params.id, entry);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/storage/sessions/:id/entries', async (req, res) => {
  const { config, agentName } = req.query as { config: string; agentName: string };
  try {
    const parsedConfig = JSON.parse(config) as ResolvedStorageConfig;
    const engine = getOrCreateEngine(parsedConfig, agentName);
    const entries = await engine.readEntries(req.params.id);
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/storage/sessions/enforce-retention', async (req, res) => {
  const { config, agentName, maxSessions } = req.body as {
    config: ResolvedStorageConfig;
    agentName: string;
    maxSessions: number;
  };
  try {
    const engine = getOrCreateEngine(config, agentName);
    await engine.enforceRetention(maxSessions);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/storage/memory/daily', async (req, res) => {
  const { config, agentName, content, date } = req.body as {
    config: ResolvedStorageConfig;
    agentName: string;
    content: string;
    date?: string;
  };
  try {
    const engine = getOrCreateEngine(config, agentName);
    await engine.appendDailyMemory(content, date);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/storage/memory/daily/:date', async (req, res) => {
  const { config, agentName } = req.query as { config: string; agentName: string };
  try {
    const parsedConfig = JSON.parse(config) as ResolvedStorageConfig;
    const engine = getOrCreateEngine(parsedConfig, agentName);
    const content = await engine.readDailyMemory(req.params.date);
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/storage/memory/long-term', async (req, res) => {
  const { config, agentName } = req.query as { config: string; agentName: string };
  try {
    const parsedConfig = JSON.parse(config) as ResolvedStorageConfig;
    const engine = getOrCreateEngine(parsedConfig, agentName);
    const content = await engine.readLongTermMemory();
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.put('/api/storage/memory/long-term', async (req, res) => {
  const { config, agentName, content } = req.body as {
    config: ResolvedStorageConfig;
    agentName: string;
    content: string;
  };
  try {
    const engine = getOrCreateEngine(config, agentName);
    await engine.writeLongTermMemory(content);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/storage/memory/files', async (req, res) => {
  const { config, agentName } = req.query as { config: string; agentName: string };
  try {
    const parsedConfig = JSON.parse(config) as ResolvedStorageConfig;
    const engine = getOrCreateEngine(parsedConfig, agentName);
    const files = await engine.listMemoryFiles();
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// --- Health check ---

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// --- Start server with WebSocket support ---

const PORT = parseInt(process.env.STORAGE_PORT ?? '3210', 10);
const httpServer = createServer(app);

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (socket) => {
  handleConnection(socket, agentManager, apiKeys);
});

httpServer.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`WebSocket available at ws://localhost:${PORT}/ws`);
});

// --- Graceful shutdown ---

function shutdown() {
  console.log('\nShutting down...');

  // Close WebSocket connections
  for (const client of wss.clients) {
    client.close(1001, 'Server shutting down');
  }

  agentManager.shutdown()
    .then(() => {
      httpServer.close(() => {
        console.log('Server closed.');
        process.exit(0);
      });
    })
    .catch((err) => {
      console.error('Error during shutdown:', err);
      process.exit(1);
    });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

- [ ] **Step 3: Update `vite.config.ts` — add WebSocket proxy**

```typescript
import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api/storage': {
        target: 'http://localhost:3210',
        changeOrigin: true,
      },
      '/api/health': {
        target: 'http://localhost:3210',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3210',
        ws: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    exclude: [...configDefaults.exclude, '.worktrees/**'],
  },
});
```

- [ ] **Step 4: Verify server starts**

```bash
npx tsx server/index.ts &
sleep 2
curl http://localhost:3210/api/health
```

Expected: `{"status":"ok"}`

Kill the server after verification.

- [ ] **Step 5: Commit**

```bash
git add server/ vite.config.ts
git commit -m "feat: add WebSocket handler and upgrade server entry point with WS support"
```

---

## Task 7: Frontend — AgentClient (WebSocket manager)

**Files:**
- Create: `src/client/agent-client.ts`
- Test: `src/client/agent-client.test.ts`

- [ ] **Step 1: Write the test**

Create `src/client/agent-client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentClient } from './agent-client';

// Mock WebSocket
class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  OPEN = MockWebSocket.OPEN;
}

let mockWsInstance: MockWebSocket;

vi.stubGlobal('WebSocket', vi.fn().mockImplementation(() => {
  mockWsInstance = new MockWebSocket();
  // Simulate async open
  setTimeout(() => mockWsInstance.onopen?.(), 0);
  return mockWsInstance;
}));

describe('AgentClient', () => {
  let client: AgentClient;

  beforeEach(() => {
    client = new AgentClient('ws://localhost:3210/ws');
  });

  it('connects and reports status', async () => {
    client.connect();
    // Trigger open
    await new Promise((r) => setTimeout(r, 10));
    expect(client.status).toBe('connected');
  });

  it('sends a command as JSON', async () => {
    client.connect();
    await new Promise((r) => setTimeout(r, 10));
    client.send({ type: 'agent:abort', agentId: 'a1' });
    expect(mockWsInstance.sent).toHaveLength(1);
    expect(JSON.parse(mockWsInstance.sent[0])).toEqual({
      type: 'agent:abort',
      agentId: 'a1',
    });
  });

  it('dispatches incoming events to listeners', async () => {
    client.connect();
    await new Promise((r) => setTimeout(r, 10));
    const handler = vi.fn();
    client.onEvent(handler);
    mockWsInstance.onmessage?.({ data: JSON.stringify({ type: 'agent:ready', agentId: 'a1' }) });
    expect(handler).toHaveBeenCalledWith({ type: 'agent:ready', agentId: 'a1' });
  });

  it('unsubscribe removes listener', async () => {
    client.connect();
    await new Promise((r) => setTimeout(r, 10));
    const handler = vi.fn();
    const unsub = client.onEvent(handler);
    unsub();
    mockWsInstance.onmessage?.({ data: JSON.stringify({ type: 'agent:end', agentId: 'a1' }) });
    expect(handler).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/client/agent-client.test.ts
```

Expected: FAIL — `AgentClient` not found.

- [ ] **Step 3: Write the implementation**

Create `src/client/agent-client.ts`:

```typescript
import type { Command, ServerEvent } from '../../shared/protocol';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';
export type EventHandler = (event: ServerEvent) => void;
export type StatusHandler = (status: ConnectionStatus) => void;

/**
 * Singleton WebSocket manager for the frontend.
 * Connects to the backend, sends commands, dispatches events.
 * Auto-reconnects with exponential backoff.
 */
export class AgentClient {
  private socket: WebSocket | null = null;
  private _status: ConnectionStatus = 'disconnected';
  private eventListeners = new Set<EventHandler>();
  private statusListeners = new Set<StatusHandler>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSyncs = new Set<string>();

  constructor(private readonly url: string) {}

  get status(): ConnectionStatus {
    return this._status;
  }

  connect(): void {
    if (this.socket && this._status !== 'disconnected') return;
    this.setStatus('connecting');

    this.socket = new WebSocket(this.url);

    this.socket.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus('connected');
      // Re-sync any pending agents
      for (const agentId of this.pendingSyncs) {
        this.send({ type: 'agent:sync', agentId });
      }
    };

    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as ServerEvent;
        for (const handler of this.eventListeners) {
          handler(data);
        }
      } catch {
        console.error('[AgentClient] Failed to parse message:', event.data);
      }
    };

    this.socket.onclose = () => {
      this.setStatus('disconnected');
      this.scheduleReconnect();
    };

    this.socket.onerror = () => {
      // onclose will fire after onerror
    };
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.setStatus('disconnected');
  }

  send(command: Command): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn('[AgentClient] Cannot send, socket not open');
      return;
    }
    this.socket.send(JSON.stringify(command));
  }

  /** Register for sync on reconnect. */
  trackAgent(agentId: string): void {
    this.pendingSyncs.add(agentId);
  }

  /** Stop tracking an agent for reconnect sync. */
  untrackAgent(agentId: string): void {
    this.pendingSyncs.delete(agentId);
  }

  onEvent(handler: EventHandler): () => void {
    this.eventListeners.add(handler);
    return () => this.eventListeners.delete(handler);
  }

  onStatusChange(handler: StatusHandler): () => void {
    this.statusListeners.add(handler);
    return () => this.statusListeners.delete(handler);
  }

  private setStatus(status: ConnectionStatus): void {
    this._status = status;
    for (const handler of this.statusListeners) {
      handler(status);
    }
  }

  private scheduleReconnect(): void {
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/client/agent-client.test.ts
```

Expected: PASS

- [ ] **Step 5: Create the singleton instance**

Create `src/client/index.ts`:

```typescript
import { AgentClient } from './agent-client';

// Determine WebSocket URL based on environment
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = import.meta.env.DEV
  ? `${wsProtocol}//${window.location.host}/ws` // Proxied by Vite
  : `${wsProtocol}//${window.location.host}/ws`;

export const agentClient = new AgentClient(wsUrl);

// Connect on import
agentClient.connect();
```

- [ ] **Step 6: Commit**

```bash
git add src/client/
git commit -m "feat: add AgentClient WebSocket manager for frontend-backend communication"
```

---

## Task 8: Frontend — AgentConnectionStore

**Files:**
- Create: `src/store/agent-connection-store.ts`
- Delete: `src/store/agent-runtime-store.ts`

- [ ] **Step 1: Write the test**

Create `src/store/agent-connection-store.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the agent-client module before importing the store
vi.mock('../client', () => ({
  agentClient: {
    send: vi.fn(),
    onEvent: vi.fn(() => vi.fn()),
    trackAgent: vi.fn(),
    untrackAgent: vi.fn(),
  },
}));

import { useAgentConnectionStore } from './agent-connection-store';

describe('AgentConnectionStore', () => {
  beforeEach(() => {
    useAgentConnectionStore.getState().reset();
  });

  it('startAgent sends agent:start command', () => {
    const { agentClient } = require('../client');
    const config = { id: 'a1', name: 'Test' } as any;
    useAgentConnectionStore.getState().startAgent('a1', config);
    expect(agentClient.send).toHaveBeenCalledWith({
      type: 'agent:start',
      agentId: 'a1',
      config,
    });
  });

  it('sendPrompt sends agent:prompt command', () => {
    const { agentClient } = require('../client');
    useAgentConnectionStore.getState().sendPrompt('a1', 'sess-1', 'hello');
    expect(agentClient.send).toHaveBeenCalledWith({
      type: 'agent:prompt',
      agentId: 'a1',
      sessionId: 'sess-1',
      text: 'hello',
    });
  });

  it('tracks agent status from events', () => {
    const store = useAgentConnectionStore.getState();
    store.handleEvent({ type: 'agent:ready', agentId: 'a1' });
    expect(store.getAgentStatus('a1')).toBe('idle');
  });

  it('tracks running status during prompt', () => {
    const store = useAgentConnectionStore.getState();
    store.handleEvent({ type: 'message:start', agentId: 'a1', message: { role: 'assistant' } });
    expect(store.getAgentStatus('a1')).toBe('running');
  });

  it('returns to idle after agent:end', () => {
    const store = useAgentConnectionStore.getState();
    store.handleEvent({ type: 'message:start', agentId: 'a1', message: { role: 'assistant' } });
    store.handleEvent({ type: 'agent:end', agentId: 'a1' });
    expect(store.getAgentStatus('a1')).toBe('idle');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/store/agent-connection-store.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/store/agent-connection-store.ts`:

```typescript
import { create } from 'zustand';
import { agentClient } from '../client';
import type { AgentConfig } from '../../shared/agent-config';
import type { ServerEvent } from '../../shared/protocol';

export type AgentStatus = 'connecting' | 'idle' | 'running' | 'error' | 'disconnected';

interface AgentState {
  status: AgentStatus;
}

interface AgentConnectionStore {
  agents: Record<string, AgentState>;

  // Actions
  startAgent: (agentId: string, config: AgentConfig) => void;
  sendPrompt: (agentId: string, sessionId: string, text: string) => void;
  abortAgent: (agentId: string) => void;
  destroyAgent: (agentId: string) => void;
  syncAgent: (agentId: string) => void;
  sendApiKeys: (keys: Record<string, string>) => void;

  // Event handling
  handleEvent: (event: ServerEvent) => void;

  // Queries
  getAgentStatus: (agentId: string) => AgentStatus;

  // Reset (for testing)
  reset: () => void;
}

export const useAgentConnectionStore = create<AgentConnectionStore>((set, get) => ({
  agents: {},

  startAgent: (agentId, config) => {
    set((state) => ({
      agents: {
        ...state.agents,
        [agentId]: { status: 'connecting' },
      },
    }));
    agentClient.trackAgent(agentId);
    agentClient.send({ type: 'agent:start', agentId, config });
  },

  sendPrompt: (agentId, sessionId, text) => {
    agentClient.send({ type: 'agent:prompt', agentId, sessionId, text });
  },

  abortAgent: (agentId) => {
    agentClient.send({ type: 'agent:abort', agentId });
    set((state) => ({
      agents: {
        ...state.agents,
        [agentId]: { ...state.agents[agentId], status: 'idle' },
      },
    }));
  },

  destroyAgent: (agentId) => {
    agentClient.send({ type: 'agent:destroy', agentId });
    agentClient.untrackAgent(agentId);
    set((state) => {
      const { [agentId]: _, ...rest } = state.agents;
      return { agents: rest };
    });
  },

  syncAgent: (agentId) => {
    agentClient.trackAgent(agentId);
    agentClient.send({ type: 'agent:sync', agentId });
  },

  sendApiKeys: (keys) => {
    agentClient.send({ type: 'config:setApiKeys', keys });
  },

  handleEvent: (event) => {
    const agentId = 'agentId' in event ? event.agentId : null;
    if (!agentId) return;

    switch (event.type) {
      case 'agent:ready':
        set((state) => ({
          agents: {
            ...state.agents,
            [agentId]: { status: 'idle' },
          },
        }));
        break;

      case 'agent:error':
        set((state) => ({
          agents: {
            ...state.agents,
            [agentId]: { status: 'error' },
          },
        }));
        break;

      case 'message:start':
        set((state) => ({
          agents: {
            ...state.agents,
            [agentId]: { status: 'running' },
          },
        }));
        break;

      case 'agent:end':
        set((state) => ({
          agents: {
            ...state.agents,
            [agentId]: { status: 'idle' },
          },
        }));
        break;

      case 'agent:state':
        set((state) => ({
          agents: {
            ...state.agents,
            [agentId]: { status: event.status === 'not_found' ? 'disconnected' : event.status },
          },
        }));
        break;
    }
  },

  getAgentStatus: (agentId) => {
    return get().agents[agentId]?.status ?? 'disconnected';
  },

  reset: () => {
    set({ agents: {} });
  },
}));

// Wire up AgentClient events to the store
agentClient.onEvent((event) => {
  useAgentConnectionStore.getState().handleEvent(event);
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/store/agent-connection-store.test.ts
```

Expected: PASS

- [ ] **Step 5: Delete `agent-runtime-store.ts`**

```bash
rm src/store/agent-runtime-store.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/store/ src/client/
git commit -m "feat: add AgentConnectionStore, remove agent-runtime-store"
```

---

## Task 9: Rewire ChatDrawer to use WebSocket

**Files:**
- Modify: `src/chat/ChatDrawer.tsx`

This is the core frontend integration task. ChatDrawer currently imports `AgentRuntime` and talks to it directly. We replace all runtime calls with `AgentConnectionStore` + `AgentClient` commands.

- [ ] **Step 1: Update imports**

Replace the old imports:
```typescript
import { useAgentRuntimeStore } from '../store/agent-runtime-store';
import type { RuntimeEvent } from '../runtime/agent-runtime';
```

With:
```typescript
import { useAgentConnectionStore } from '../store/agent-connection-store';
import { agentClient } from '../client';
import type { ServerEvent } from '../../shared/protocol';
```

- [ ] **Step 2: Replace runtime interactions in the component**

Remove these lines:
```typescript
const getOrCreateRuntime = useAgentRuntimeStore((s) => s.getOrCreateRuntime);
const destroyRuntime = useAgentRuntimeStore((s) => s.destroyRuntime);
const getApiKey = useSettingsStore((s) => s.getApiKey);
```

Replace with:
```typescript
const startAgent = useAgentConnectionStore((s) => s.startAgent);
const sendPrompt = useAgentConnectionStore((s) => s.sendPrompt);
const abortAgent = useAgentConnectionStore((s) => s.abortAgent);
const destroyAgent = useAgentConnectionStore((s) => s.destroyAgent);
const agentStatus = useAgentConnectionStore((s) => s.getAgentStatus(agentNodeId));
```

- [ ] **Step 3: Rewrite `sendMessage` callback**

Replace the current `sendMessage` callback with:

```typescript
const sendMessage = useCallback(async () => {
  if (!input.trim() || isStreaming || !config || !activeSessionId) return;

  const trimmedInput = input.trim();
  const userMessage: Message = {
    id: `msg_${Date.now()}`,
    role: 'user',
    content: trimmedInput,
    timestamp: Date.now(),
    tokenCount: estimateTokens(trimmedInput),
  };

  addMessage(activeSessionId, userMessage);
  setInput('');
  setIsStreaming(true);

  // Ensure agent is started with current config
  startAgent(agentNodeId, config);

  // Subscribe to events for this agent
  const unsub = agentClient.onEvent((event: ServerEvent) => {
    if (!('agentId' in event) || event.agentId !== agentNodeId) return;

    if (event.type === 'message:start') {
      assistantContent = '';
      addMessage(activeSessionId, {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      });
    } else if (event.type === 'message:delta') {
      assistantContent += event.delta;
      updateMessage(activeSessionId, assistantMessageId, (m) => ({
        ...m,
        content: assistantContent,
      }));
    } else if (event.type === 'message:end') {
      if (event.message.usage) {
        updateMessage(activeSessionId, assistantMessageId, (m) => ({
          ...m,
          tokenCount: event.message.usage!.output,
          usage: event.message.usage,
        }));
      }
    } else if (event.type === 'tool:start') {
      addMessage(activeSessionId, {
        id: `tool_${event.toolCallId}`,
        role: 'tool',
        content: `Calling tool: ${event.toolName}`,
        timestamp: Date.now(),
      });
    } else if (event.type === 'tool:end') {
      const toolContent = `${event.toolName}: ${event.result}${event.isError ? ' (error)' : ''}`;
      updateMessage(activeSessionId, `tool_${event.toolCallId}`, (m) => ({
        ...m,
        content: toolContent,
        tokenCount: estimateTokens(toolContent),
      }));
    } else if (event.type === 'agent:end') {
      setIsStreaming(false);
      unsub();
    } else if (event.type === 'agent:error') {
      addMessage(activeSessionId, {
        id: `err_${Date.now()}`,
        role: 'assistant',
        content: `Error: ${event.error}`,
        timestamp: Date.now(),
      });
      setIsStreaming(false);
      unsub();
    }
  });

  unsubRef.current?.();
  unsubRef.current = unsub;

  const assistantMessageId = `msg_${Date.now()}_a`;
  let assistantContent = '';

  // Send the prompt to the backend
  sendPrompt(agentNodeId, activeSessionId, trimmedInput);
}, [input, isStreaming, config, agentNodeId, activeSessionId, startAgent, sendPrompt]);
```

- [ ] **Step 4: Update `handleStop`**

```typescript
const handleStop = () => {
  abortAgent(agentNodeId);
  setIsStreaming(false);
};
```

- [ ] **Step 5: Update `handleClose`**

```typescript
const handleClose = () => {
  destroyAgent(agentNodeId);
  onClose();
};
```

- [ ] **Step 6: Update `handleNewSession`**

Replace `destroyRuntime(agentNodeId)` with `destroyAgent(agentNodeId)`.

- [ ] **Step 7: Update `handleSwitchSession`**

Replace `destroyRuntime(agentNodeId)` with `destroyAgent(agentNodeId)`.

- [ ] **Step 8: Remove `getApiKey` from `useSettingsStore` import if no longer used**

Check if `getApiKey` is still used in ChatDrawer. It was only used for `getOrCreateRuntime`. If not used, remove it from the import.

- [ ] **Step 9: Update `estimateTokens` import**

```typescript
import { estimateTokens } from '../../shared/token-estimator';
```

- [ ] **Step 10: Verify the app compiles**

```bash
npx tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 11: Commit**

```bash
git add src/chat/ChatDrawer.tsx
git commit -m "refactor: rewire ChatDrawer to use WebSocket backend instead of browser runtime"
```

---

## Task 10: Send API keys to backend

**Files:**
- Modify: `src/settings/settings-store.ts` (or the settings UI component)

- [ ] **Step 1: Add API key sync to settings store**

In the settings store, after each `setApiKey` call, also push keys to the backend. Add at the top:

```typescript
import { useAgentConnectionStore } from '../store/agent-connection-store';
```

Then in `setApiKey`, after `set({ apiKeys: updated })`, add:

```typescript
useAgentConnectionStore.getState().sendApiKeys(updated);
```

- [ ] **Step 2: Send keys on initial connection**

In `src/client/index.ts`, add a listener that pushes keys on connect:

```typescript
import { useSettingsStore } from '../settings/settings-store';

agentClient.onStatusChange((status) => {
  if (status === 'connected') {
    const keys = useSettingsStore.getState().apiKeys;
    if (Object.keys(keys).length > 0) {
      agentClient.send({ type: 'config:setApiKeys', keys });
    }
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add src/settings/settings-store.ts src/client/index.ts
git commit -m "feat: sync API keys to backend on set and on reconnect"
```

---

## Task 11: Clean up frontend — remove pi-agent-core from bundle

**Files:**
- Modify: `vite.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Remove `pi-agent-core` from `optimizeDeps` in `vite.config.ts`**

Remove these lines from `optimizeDeps.include`:
```
'@mariozechner/pi-ai',
'@mariozechner/pi-agent-core',
'@mariozechner/pi-web-ui',
```

The frontend no longer imports these directly.

- [ ] **Step 2: Verify no remaining frontend imports of runtime modules**

```bash
grep -r "from.*runtime/agent-runtime" src/
grep -r "from.*runtime/memory-engine" src/
grep -r "from.*runtime/context-engine" src/
grep -r "from.*runtime/tool-factory" src/
grep -r "from.*runtime/model-resolver" src/
grep -r "pi-agent-core" src/
```

Each should return empty (no matches). If any remain, update them.

- [ ] **Step 3: Remove leftover `src/runtime/` files**

After all moves, `src/runtime/` should only contain `storage-client.ts`. Verify and clean up any stale files:

```bash
ls src/runtime/
```

Expected: only `storage-client.ts` remains.

- [ ] **Step 4: Verify full build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both pass without errors.

- [ ] **Step 5: Commit**

```bash
git add vite.config.ts src/ package.json
git commit -m "chore: remove pi-agent-core from frontend bundle, clean up stale runtime files"
```

---

## Task 12: End-to-end verification

- [ ] **Step 1: Start the dev environment**

```bash
npm run dev
```

Verify both the Vite dev server and the Express backend start without errors.

- [ ] **Step 2: Open the app and verify graph editor works**

Open `http://localhost:5173`. The graph editor, node dragging, property panels should all work as before.

- [ ] **Step 3: Test the chat flow**

1. Create an agent node
2. Connect a Context Engine and Storage node
3. Configure an API key in Settings
4. Open chat — should connect via WebSocket
5. Send a message — should see streaming response
6. Close and reopen the chat drawer — should reconnect and show history

- [ ] **Step 4: Test tab close resilience**

1. Send a message to an agent
2. Close the browser tab while the agent is responding
3. Reopen the tab — the agent should have finished and the response should be visible

- [ ] **Step 5: Test server restart resilience**

1. Start a conversation with an agent
2. Stop the server (`Ctrl+C`)
3. Restart the server (`npm run dev:server`)
4. Refresh the browser — the agent should restore from persisted config

- [ ] **Step 6: Commit final state**

```bash
git add -A
git commit -m "test: verify end-to-end frontend-backend split"
```
