# Agent Comm Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the inert `agentComm` peripheral into a working peer-to-peer messaging runtime with bounded loop and safety controls.

**Architecture:** A singleton `AgentCommBus` owned by `AgentManager` mediates wake-on-message between two long-lived agents. Each peer pair gets a dedicated channel-session (transcript) keyed `channel:<lo>:<hi>` and managed by a bus-owned `ChannelSessionStore` facade over the existing `StorageEngine`. A bus-owned per-channel scheduler serializes runs on a channel; the existing `RunCoordinator` is extended with a `dispatchChannel` path. Three per-run-injected tools — `agent_send`, `agent_broadcast`, `agent_channel_history` — drive the protocol with explicit `end:true` termination. Reciprocal direct comm-node pairs are required; one-sided contracts fail at runtime.

**Tech Stack:** TypeScript, Vitest, Express + WebSocket (existing), JSONL transcripts via `session-transcript-store`, React + Zustand (frontend).

**Spec:** [docs/superpowers/specs/2026-05-05-agent-comm-node-design.md](../specs/2026-05-05-agent-comm-node-design.md)

---

## Phase 1 — Data model and graph resolution

### Task 1: Extend `AgentCommNodeData` with v1 fields

**Files:**
- Modify: `src/types/nodes.ts:287-295`
- Modify: `src/utils/default-nodes.ts:145-151`
- Test: `src/utils/default-nodes.test.ts` (create if missing)

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/default-nodes.test.ts
import { describe, it, expect } from 'vitest';
import { defaultNodeData } from './default-nodes';

describe('defaultNodeData(agentComm)', () => {
  it('returns v1 defaults including new loop/safety fields', () => {
    const data = defaultNodeData('agentComm');
    expect(data).toMatchObject({
      type: 'agentComm',
      label: 'Agent Comm',
      targetAgentNodeId: null,
      protocol: 'direct',
      maxTurns: 10,
      maxDepth: 3,
      tokenBudget: 100_000,
      rateLimitPerMinute: 30,
      messageSizeCap: 16_000,
      direction: 'bidirectional',
    });
  });
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `npx vitest run src/utils/default-nodes.test.ts`
Expected: FAIL — `expected undefined to equal 10` etc.

- [ ] **Step 3: Extend type and defaults**

Edit `src/types/nodes.ts:287-295`:

```ts
// --- Agent Communication Node ---

export interface AgentCommNodeData {
  [key: string]: unknown;
  type: 'agentComm';
  label: string;
  targetAgentNodeId: string | null;
  protocol: 'direct' | 'broadcast';
  // Loop controls
  maxTurns: number;
  maxDepth: number;
  tokenBudget: number;
  rateLimitPerMinute: number;
  // Safety controls
  messageSizeCap: number;
  direction: 'bidirectional' | 'outbound' | 'inbound';
}
```

Edit `src/utils/default-nodes.ts:145-151`:

```ts
case 'agentComm':
  return {
    type: 'agentComm',
    label: 'Agent Comm',
    targetAgentNodeId: null,
    protocol: 'direct',
    maxTurns: 10,
    maxDepth: 3,
    tokenBudget: 100_000,
    rateLimitPerMinute: 30,
    messageSizeCap: 16_000,
    direction: 'bidirectional',
  };
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run src/utils/default-nodes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types/nodes.ts src/utils/default-nodes.ts src/utils/default-nodes.test.ts
git commit -m "feat(agent-comm): extend AgentCommNodeData with loop and safety fields"
```

---

### Task 2: Extend `ResolvedAgentCommConfig` and graph resolution

**Files:**
- Modify: `shared/agent-config.ts:309-313`
- Modify: `src/utils/graph-to-agent.ts:303-318`
- Test: `src/utils/graph-to-agent.test.ts` (extend or create)

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/graph-to-agent.test.ts (add to file)
import { describe, it, expect } from 'vitest';
import { resolveAgentConfig } from './graph-to-agent';
// (use existing test fixtures for nodes/edges; mirror style of nearby tests)

describe('resolveAgentConfig — agentComm', () => {
  it('passes new fields through resolution and resolves targetAgentName', () => {
    const nodes = [
      { id: 'a1', data: { type: 'agent', name: 'researcher', /* ...minimal */ } },
      { id: 'a2', data: { type: 'agent', name: 'writer', /* ...minimal */ } },
      {
        id: 'c1',
        data: {
          type: 'agentComm', label: 'to-writer', targetAgentNodeId: 'a2',
          protocol: 'direct', maxTurns: 5, maxDepth: 2, tokenBudget: 50_000,
          rateLimitPerMinute: 10, messageSizeCap: 4_000, direction: 'bidirectional',
        },
      },
    ];
    const edges = [{ id: 'e1', source: 'c1', target: 'a1' }];
    const cfg = resolveAgentConfig('a1', nodes as any, edges as any);
    expect(cfg.agentComm).toEqual([{
      commNodeId: 'c1', label: 'to-writer', targetAgentNodeId: 'a2', targetAgentName: 'writer',
      protocol: 'direct', maxTurns: 5, maxDepth: 2, tokenBudget: 50_000,
      rateLimitPerMinute: 10, messageSizeCap: 4_000, direction: 'bidirectional',
    }]);
  });

  it('fills defaults for missing v1 fields on legacy nodes (graceful upgrade)', () => {
    const nodes = [
      { id: 'a1', data: { type: 'agent', name: 'a' } },
      { id: 'a2', data: { type: 'agent', name: 'b' } },
      { id: 'c1', data: { type: 'agentComm', label: 'x', targetAgentNodeId: 'a2', protocol: 'direct' } },
    ];
    const edges = [{ id: 'e1', source: 'c1', target: 'a1' }];
    const cfg = resolveAgentConfig('a1', nodes as any, edges as any);
    expect(cfg.agentComm[0]).toMatchObject({
      maxTurns: 10, maxDepth: 3, tokenBudget: 100_000,
      rateLimitPerMinute: 30, messageSizeCap: 16_000, direction: 'bidirectional',
    });
  });
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `npx vitest run src/utils/graph-to-agent.test.ts`
Expected: FAIL — extra fields missing.

- [ ] **Step 3: Extend the resolved config and resolution code**

Edit `shared/agent-config.ts:309-313`:

```ts
export interface ResolvedAgentCommConfig {
  commNodeId: string;
  label: string;
  targetAgentNodeId: string | null;
  targetAgentName: string | null;
  protocol: 'direct' | 'broadcast';
  maxTurns: number;
  maxDepth: number;
  tokenBudget: number;
  rateLimitPerMinute: number;
  messageSizeCap: number;
  direction: 'bidirectional' | 'outbound' | 'inbound';
}
```

Edit `src/utils/graph-to-agent.ts:303-318`:

```ts
// --- Agent Communication ---
const agentComm: ResolvedAgentCommConfig[] = connectedNodes
  .filter((n) => n.data.type === 'agentComm')
  .map((n) => {
    if (n.data.type !== 'agentComm') throw new Error('unreachable');
    const target = n.data.targetAgentNodeId
      ? nodes.find((x) => x.id === n.data.targetAgentNodeId)
      : null;
    const targetAgentName =
      target && target.data.type === 'agent' ? target.data.name : null;
    return {
      commNodeId: n.id,
      label: n.data.label,
      targetAgentNodeId: n.data.targetAgentNodeId,
      targetAgentName,
      protocol: n.data.protocol,
      maxTurns: typeof n.data.maxTurns === 'number' ? n.data.maxTurns : 10,
      maxDepth: typeof n.data.maxDepth === 'number' ? n.data.maxDepth : 3,
      tokenBudget: typeof n.data.tokenBudget === 'number' ? n.data.tokenBudget : 100_000,
      rateLimitPerMinute:
        typeof n.data.rateLimitPerMinute === 'number' ? n.data.rateLimitPerMinute : 30,
      messageSizeCap:
        typeof n.data.messageSizeCap === 'number' ? n.data.messageSizeCap : 16_000,
      direction:
        n.data.direction === 'outbound' || n.data.direction === 'inbound'
          ? n.data.direction
          : 'bidirectional',
    };
  });
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run src/utils/graph-to-agent.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/agent-config.ts src/utils/graph-to-agent.ts src/utils/graph-to-agent.test.ts
git commit -m "feat(agent-comm): resolve commNodeId, targetAgentName, and v1 fields with graceful defaults"
```

---

### Task 3: Property editor UI for new fields

**Files:**
- Modify: `src/panels/property-editors/AgentCommProperties.tsx`

This is a pure UI extension — no unit tests required. We surface six new inputs (four numbers, one select).

- [ ] **Step 1: Add inputs to the panel**

Replace the body of `AgentCommProperties.tsx` after the existing Protocol field with these additions inside the same root `<div className="space-y-1">`:

```tsx
<Field label="Direction">
  <select
    className={selectClass}
    value={data.direction}
    onChange={(e) =>
      update(nodeId, {
        direction: e.target.value as 'bidirectional' | 'outbound' | 'inbound',
      })
    }
  >
    <option value="bidirectional">Bidirectional</option>
    <option value="outbound">Outbound only</option>
    <option value="inbound">Inbound only</option>
  </select>
</Field>

<Field label="Max turns (per channel)">
  <input
    type="number" min={1} className={inputClass} value={data.maxTurns}
    onChange={(e) => update(nodeId, { maxTurns: Number(e.target.value) })}
  />
</Field>

<Field label="Max depth (cascade)">
  <input
    type="number" min={1} className={inputClass} value={data.maxDepth}
    onChange={(e) => update(nodeId, { maxDepth: Number(e.target.value) })}
  />
</Field>

<Field label="Token budget (per channel)">
  <input
    type="number" min={1000} step={1000} className={inputClass} value={data.tokenBudget}
    onChange={(e) => update(nodeId, { tokenBudget: Number(e.target.value) })}
  />
</Field>

<Field label="Rate limit (msgs/min)">
  <input
    type="number" min={1} className={inputClass} value={data.rateLimitPerMinute}
    onChange={(e) =>
      update(nodeId, { rateLimitPerMinute: Number(e.target.value) })
    }
  />
</Field>

<Field label="Message size cap (chars)">
  <input
    type="number" min={100} step={100} className={inputClass} value={data.messageSizeCap}
    onChange={(e) => update(nodeId, { messageSizeCap: Number(e.target.value) })}
  />
</Field>
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: clean (no new errors).

- [ ] **Step 3: Verify graph build still works**

Run: `npx vitest run src/utils/`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/panels/property-editors/AgentCommProperties.tsx
git commit -m "feat(agent-comm): property editor for direction, turns, depth, budget, rate, size"
```

---

## Phase 2 — Shared types for the bus

### Task 4: Shared comm types — error codes, audit events, channel meta

**Files:**
- Create: `shared/agent-comm-types.ts`
- Modify: `shared/storage-types.ts` (add `channelMeta` field to `SessionStoreEntry`)
- Test: `shared/agent-comm-types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// shared/agent-comm-types.test.ts
import { describe, it, expect } from 'vitest';
import {
  AGENT_COMM_ERROR_CODES,
  isAgentCommErrorCode,
  type AgentCommAuditEvent,
} from './agent-comm-types';

describe('agent-comm-types', () => {
  it('exposes the v1 error code set', () => {
    expect(AGENT_COMM_ERROR_CODES).toEqual([
      'topology_violation',
      'direction_violation',
      'message_too_large',
      'rate_limited',
      'receiver_unavailable',
      'channel_sealed',
      'depth_exceeded',
      'token_budget_exceeded',
      'max_turns_reached',
      'internal_error',
    ]);
  });

  it('isAgentCommErrorCode rejects unknown codes', () => {
    expect(isAgentCommErrorCode('rate_limited')).toBe(true);
    expect(isAgentCommErrorCode('something_else')).toBe(false);
  });

  it('audit event shapes are exhaustive', () => {
    const send: AgentCommAuditEvent = {
      kind: 'agent-comm-audit', ts: '2026-05-05T00:00:00Z',
      event: { type: 'send', from: 'a', to: 'b', depth: 1, chars: 10, end: false },
    };
    const trip: AgentCommAuditEvent = {
      kind: 'agent-comm-audit', ts: '2026-05-05T00:00:00Z',
      event: { type: 'limit-tripped', code: 'max_turns_reached', from: 'a', to: 'b' },
    };
    expect(send.event.type).toBe('send');
    expect(trip.event.type).toBe('limit-tripped');
  });
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `npx vitest run shared/agent-comm-types.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the types module**

Create `shared/agent-comm-types.ts`:

```ts
export const AGENT_COMM_ERROR_CODES = [
  'topology_violation',
  'direction_violation',
  'message_too_large',
  'rate_limited',
  'receiver_unavailable',
  'channel_sealed',
  'depth_exceeded',
  'token_budget_exceeded',
  'max_turns_reached',
  'internal_error',
] as const;

export type AgentCommErrorCode = (typeof AGENT_COMM_ERROR_CODES)[number];

export function isAgentCommErrorCode(v: unknown): v is AgentCommErrorCode {
  return typeof v === 'string' && (AGENT_COMM_ERROR_CODES as readonly string[]).includes(v);
}

export type AgentCommSealReason =
  | 'max_turns_reached'
  | 'token_budget_exceeded'
  | 'manual';

export interface ChannelSessionMeta {
  pair: [string, string];          // sorted [lo, hi] agent node IDs
  pairNames: [string, string];     // names in same order as pair
  ownerAgentId: string;            // lo
  turns: number;
  tokensIn: number;
  tokensOut: number;
  sealed: boolean;
  sealedReason: AgentCommSealReason | null;
  lastActivityAt: string;          // ISO
}

export type AgentCommAuditEvent = {
  kind: 'agent-comm-audit';
  ts: string;
  event:
    | { type: 'send'; from: string; to: string; depth: number; chars: number; end: boolean }
    | { type: 'limit-tripped'; code: AgentCommErrorCode; from: string; to: string }
    | { type: 'wake-cancelled'; code: AgentCommErrorCode; from: string; to: string; depth: number }
    | { type: 'sealed'; reason: AgentCommSealReason };
};

export interface AgentSendMessageMeta {
  from: string;          // 'agent:<senderName>'
  fromAgentId: string;
  to: string;            // 'agent:<receiverName>'
  toAgentId: string;
  depth: number;
  channelKey: string;
}
```

Edit `shared/storage-types.ts` — add to the `SessionStoreEntry` interface (alongside `subAgentMeta`):

```ts
import type { ChannelSessionMeta } from './agent-comm-types';
// ...
export interface SessionStoreEntry {
  // ... existing fields ...
  subAgentMeta?: SubAgentSessionMeta;
  channelMeta?: ChannelSessionMeta;
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run shared/agent-comm-types.test.ts && npx tsc --noEmit`
Expected: PASS, clean tsc.

- [ ] **Step 5: Commit**

```bash
git add shared/agent-comm-types.ts shared/agent-comm-types.test.ts shared/storage-types.ts
git commit -m "feat(agent-comm): shared error codes, audit events, channel metadata"
```

---

## Phase 3 — Channel storage

### Task 5: `ChannelSessionStore` — pair-level facade over StorageEngine

**Files:**
- Create: `server/comms/channel-key.ts`
- Create: `server/comms/channel-key.test.ts`
- Create: `server/comms/channel-session-store.ts`
- Create: `server/comms/channel-session-store.test.ts`

- [ ] **Step 1: Write the failing test for key canonicalization**

```ts
// server/comms/channel-key.test.ts
import { describe, it, expect } from 'vitest';
import { canonicalChannelKey, parseChannelKey, isChannelKey } from './channel-key';

describe('channel-key', () => {
  it('canonicalizes regardless of arg order', () => {
    expect(canonicalChannelKey('beta', 'alpha')).toBe('channel:alpha:beta');
    expect(canonicalChannelKey('alpha', 'beta')).toBe('channel:alpha:beta');
  });
  it('parseChannelKey returns sorted pair', () => {
    expect(parseChannelKey('channel:alpha:beta')).toEqual(['alpha', 'beta']);
  });
  it('rejects non-channel keys', () => {
    expect(isChannelKey('user:alpha')).toBe(false);
    expect(isChannelKey('channel:alpha:beta')).toBe(true);
  });
  it('throws on identical agent IDs', () => {
    expect(() => canonicalChannelKey('alpha', 'alpha')).toThrow();
  });
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `npx vitest run server/comms/channel-key.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement channel-key**

Create `server/comms/channel-key.ts`:

```ts
const PREFIX = 'channel:';

export function canonicalChannelKey(a: string, b: string): string {
  if (a === b) throw new Error('canonicalChannelKey: agent IDs must differ');
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return `${PREFIX}${lo}:${hi}`;
}

export function parseChannelKey(key: string): [string, string] {
  if (!key.startsWith(PREFIX)) throw new Error(`not a channel key: ${key}`);
  const rest = key.slice(PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep < 0) throw new Error(`malformed channel key: ${key}`);
  return [rest.slice(0, sep), rest.slice(sep + 1)];
}

export function isChannelKey(key: string): boolean {
  return key.startsWith(PREFIX) && key.slice(PREFIX.length).includes(':');
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run server/comms/channel-key.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test for the store**

```ts
// server/comms/channel-session-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageEngine } from '../storage/storage-engine';
import { ChannelSessionStore } from './channel-session-store';

describe('ChannelSessionStore', () => {
  let store: ChannelSessionStore;
  let storage: StorageEngine;
  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chan-'));
    storage = new StorageEngine({ storagePath: dir, agentId: 'lo-agent' });
    await storage.init();
    store = new ChannelSessionStore({ ownerStorage: () => storage });
  });

  it('opens a fresh channel with empty meta', async () => {
    const ch = await store.open({ pair: ['lo-agent', 'hi-agent'], pairNames: ['lo', 'hi'] });
    expect(ch.meta.turns).toBe(0);
    expect(ch.meta.sealed).toBe(false);
    expect(ch.meta.pair).toEqual(['lo-agent', 'hi-agent']);
  });

  it('appendUserMessage bumps turns and persists meta', async () => {
    const ch = await store.open({ pair: ['lo-agent', 'hi-agent'], pairNames: ['lo', 'hi'] });
    await store.appendUserMessage(ch.key, {
      content: 'hello', meta: {
        from: 'agent:lo', fromAgentId: 'lo-agent',
        to: 'agent:hi', toAgentId: 'hi-agent', depth: 1, channelKey: ch.key,
      },
    });
    const reloaded = await store.read(ch.key);
    expect(reloaded.meta.turns).toBe(1);
  });

  it('seal marks the channel and rejects further appends', async () => {
    const ch = await store.open({ pair: ['lo-agent', 'hi-agent'], pairNames: ['lo', 'hi'] });
    await store.seal(ch.key, 'max_turns_reached');
    const reloaded = await store.read(ch.key);
    expect(reloaded.meta.sealed).toBe(true);
    expect(reloaded.meta.sealedReason).toBe('max_turns_reached');
  });

  it('addUsage updates tokens and is durable', async () => {
    const ch = await store.open({ pair: ['lo-agent', 'hi-agent'], pairNames: ['lo', 'hi'] });
    await store.addUsage(ch.key, { tokensIn: 100, tokensOut: 50 });
    const reloaded = await store.read(ch.key);
    expect(reloaded.meta.tokensIn).toBe(100);
    expect(reloaded.meta.tokensOut).toBe(50);
  });
});
```

- [ ] **Step 6: Run test, verify fails**

Run: `npx vitest run server/comms/channel-session-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement the store**

Create `server/comms/channel-session-store.ts`:

```ts
import type { StorageEngine } from '../storage/storage-engine';
import type {
  ChannelSessionMeta,
  AgentCommSealReason,
  AgentCommAuditEvent,
  AgentSendMessageMeta,
} from '../../shared/agent-comm-types';
import type { SessionStoreEntry } from '../../shared/storage-types';
import { canonicalChannelKey } from './channel-key';

export interface OpenArgs {
  pair: [string, string];      // sorted [lo, hi]
  pairNames: [string, string]; // sorted in same order as pair
}

export interface ChannelHandle {
  key: string;
  meta: ChannelSessionMeta;
}

export interface AppendUserArgs {
  content: string;
  meta: AgentSendMessageMeta;
}

export interface ChannelSessionStoreOpts {
  /** Returns the StorageEngine for the canonical owner agent (lo). */
  ownerStorage: (ownerAgentId: string) => StorageEngine | undefined;
}

export class ChannelSessionStore {
  constructor(private readonly opts: ChannelSessionStoreOpts) {}

  private storageFor(ownerAgentId: string): StorageEngine {
    const s = this.opts.ownerStorage(ownerAgentId);
    if (!s) throw new Error(`channel store: owner storage unavailable for ${ownerAgentId}`);
    return s;
  }

  async open(args: OpenArgs): Promise<ChannelHandle> {
    const [lo, hi] = args.pair;
    const key = canonicalChannelKey(lo, hi);
    const storage = this.storageFor(lo);
    const existing = await storage.getSession(key);
    if (existing?.channelMeta) {
      return { key, meta: existing.channelMeta };
    }
    const now = new Date().toISOString();
    const meta: ChannelSessionMeta = {
      pair: [lo, hi],
      pairNames: args.pairNames,
      ownerAgentId: lo,
      turns: 0,
      tokensIn: 0,
      tokensOut: 0,
      sealed: false,
      sealedReason: null,
      lastActivityAt: now,
    };
    const entry: SessionStoreEntry = {
      sessionKey: key,
      sessionId: key,
      agentId: lo,
      sessionFile: storage.transcriptPathFor(key),
      createdAt: now,
      updatedAt: now,
      tokenCount: 0,
      chatType: 'channel',
      channelMeta: meta,
    } as SessionStoreEntry;
    await storage.createSession(entry);
    return { key, meta };
  }

  async read(key: string): Promise<ChannelHandle> {
    const [lo] = key.replace(/^channel:/, '').split(':');
    const storage = this.storageFor(lo);
    const entry = await storage.getSession(key);
    if (!entry?.channelMeta) throw new Error(`channel not found: ${key}`);
    return { key, meta: entry.channelMeta };
  }

  async appendUserMessage(key: string, args: AppendUserArgs): Promise<ChannelSessionMeta> {
    const [lo] = key.replace(/^channel:/, '').split(':');
    const storage = this.storageFor(lo);
    const entry = await storage.getSession(key);
    if (!entry?.channelMeta) throw new Error(`channel not found: ${key}`);
    if (entry.channelMeta.sealed) throw new Error(`channel sealed: ${key}`);
    await storage.appendTranscriptEvent(key, {
      role: 'user',
      content: args.content,
      meta: args.meta,
      ts: new Date().toISOString(),
    });
    const next: ChannelSessionMeta = {
      ...entry.channelMeta,
      turns: entry.channelMeta.turns + 1,
      lastActivityAt: new Date().toISOString(),
    };
    await storage.updateSession(key, { channelMeta: next });
    return next;
  }

  async appendAudit(key: string, event: AgentCommAuditEvent): Promise<void> {
    const [lo] = key.replace(/^channel:/, '').split(':');
    const storage = this.storageFor(lo);
    await storage.appendTranscriptEvent(key, event);
  }

  async addUsage(key: string, usage: { tokensIn: number; tokensOut: number }): Promise<ChannelSessionMeta> {
    const [lo] = key.replace(/^channel:/, '').split(':');
    const storage = this.storageFor(lo);
    const entry = await storage.getSession(key);
    if (!entry?.channelMeta) throw new Error(`channel not found: ${key}`);
    const next: ChannelSessionMeta = {
      ...entry.channelMeta,
      tokensIn: entry.channelMeta.tokensIn + usage.tokensIn,
      tokensOut: entry.channelMeta.tokensOut + usage.tokensOut,
      lastActivityAt: new Date().toISOString(),
    };
    await storage.updateSession(key, { channelMeta: next });
    return next;
  }

  async tail(key: string, limit: number): Promise<unknown[]> {
    const [lo] = key.replace(/^channel:/, '').split(':');
    const storage = this.storageFor(lo);
    const events = await storage.tailTranscript(key, Math.min(Math.max(limit, 1), 100));
    return events;
  }

  async seal(key: string, reason: AgentCommSealReason): Promise<ChannelSessionMeta> {
    const [lo] = key.replace(/^channel:/, '').split(':');
    const storage = this.storageFor(lo);
    const entry = await storage.getSession(key);
    if (!entry?.channelMeta) throw new Error(`channel not found: ${key}`);
    if (entry.channelMeta.sealed) return entry.channelMeta;
    const next: ChannelSessionMeta = {
      ...entry.channelMeta,
      sealed: true,
      sealedReason: reason,
      lastActivityAt: new Date().toISOString(),
    };
    await storage.updateSession(key, { channelMeta: next });
    await this.appendAudit(key, {
      kind: 'agent-comm-audit',
      ts: new Date().toISOString(),
      event: { type: 'sealed', reason },
    });
    return next;
  }
}
```

NOTE: This task assumes `StorageEngine` exposes `getSession(key)`, `createSession(entry)`, `updateSession(key, partial)`, `appendTranscriptEvent(key, event)`, and `transcriptPathFor(key)`. **Verify these in `server/storage/storage-engine.ts` before implementing.** If a method is missing or named differently, adjust the test+implementation to use the actual API or add the missing method as part of this task.

- [ ] **Step 8: Run test, verify pass**

Run: `npx vitest run server/comms/channel-session-store.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add server/comms/channel-key.ts server/comms/channel-key.test.ts \
        server/comms/channel-session-store.ts server/comms/channel-session-store.test.ts
git commit -m "feat(agent-comm): channel-session store and key canonicalization"
```

---

## Phase 4 — Bus core

### Task 6: Channel run queue (per-channel scheduler)

**Files:**
- Create: `server/comms/channel-run-queue.ts`
- Create: `server/comms/channel-run-queue.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/comms/channel-run-queue.test.ts
import { describe, it, expect } from 'vitest';
import { ChannelRunQueue } from './channel-run-queue';

describe('ChannelRunQueue', () => {
  it('serializes runs on a single channel', async () => {
    const q = new ChannelRunQueue();
    const order: number[] = [];
    const a = q.enqueue('chan:a:b', async () => { order.push(1); await sleep(20); order.push(2); });
    const b = q.enqueue('chan:a:b', async () => { order.push(3); });
    await Promise.all([a, b]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('runs different channels in parallel', async () => {
    const q = new ChannelRunQueue();
    const order: string[] = [];
    const a = q.enqueue('c1', async () => { await sleep(20); order.push('a'); });
    const b = q.enqueue('c2', async () => { order.push('b'); });
    await Promise.all([a, b]);
    expect(order).toEqual(['b', 'a']); // c2 finished first
  });

  it('reentrant runs from inside an active task are queued, not deadlocked', async () => {
    const q = new ChannelRunQueue();
    const order: string[] = [];
    await q.enqueue('c1', async () => {
      order.push('outer-start');
      // reentrant — must NOT deadlock; runs after outer finishes
      const reentrant = q.enqueue('c1', async () => order.push('inner'));
      order.push('outer-end');
      await reentrant;
    });
    expect(order).toEqual(['outer-start', 'outer-end', 'inner']);
  });

  it('isActive reports current state', async () => {
    const q = new ChannelRunQueue();
    expect(q.isActive('c1')).toBe(false);
    const p = q.enqueue('c1', async () => { await sleep(10); });
    expect(q.isActive('c1')).toBe(true);
    await p;
    expect(q.isActive('c1')).toBe(false);
  });
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
```

- [ ] **Step 2: Run test, verify fails**

Run: `npx vitest run server/comms/channel-run-queue.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the queue**

Create `server/comms/channel-run-queue.ts`:

```ts
type Task<T> = () => Promise<T>;

interface QueueState {
  active: boolean;
  tail: Promise<unknown>;
}

export class ChannelRunQueue {
  private readonly states = new Map<string, QueueState>();

  isActive(channelKey: string): boolean {
    return this.states.get(channelKey)?.active ?? false;
  }

  enqueue<T>(channelKey: string, task: Task<T>): Promise<T> {
    const prev = this.states.get(channelKey) ?? { active: false, tail: Promise.resolve() };
    const next = prev.tail.then(async () => {
      const state = this.states.get(channelKey);
      if (state) state.active = true;
      try {
        return await task();
      } finally {
        const s = this.states.get(channelKey);
        if (s) s.active = false;
      }
    });
    this.states.set(channelKey, { active: prev.active, tail: next });
    return next as Promise<T>;
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run server/comms/channel-run-queue.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/comms/channel-run-queue.ts server/comms/channel-run-queue.test.ts
git commit -m "feat(agent-comm): per-channel run queue with reentrant safety"
```

---

### Task 7: `AgentCommBus` — registration, contracts, and pre-flight

**Files:**
- Create: `server/comms/agent-comm-bus.ts`
- Create: `server/comms/agent-comm-bus.test.ts`

This task implements the bus skeleton and the full pre-flight pipeline. Sending the actual wake to a `RunCoordinator` is stubbed via an injectable callback so we can unit-test pre-flight in isolation; Task 11 wires it to the real coordinator.

- [ ] **Step 1: Write the failing test**

```ts
// server/comms/agent-comm-bus.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentCommBus, type AgentCommBusDeps } from './agent-comm-bus';
import type { ResolvedAgentCommConfig } from '../../shared/agent-config';

const peer = (overrides: Partial<ResolvedAgentCommConfig>): ResolvedAgentCommConfig => ({
  commNodeId: 'c?', label: 'x',
  targetAgentNodeId: null, targetAgentName: null,
  protocol: 'direct',
  maxTurns: 10, maxDepth: 3, tokenBudget: 100_000,
  rateLimitPerMinute: 30, messageSizeCap: 16_000,
  direction: 'bidirectional',
  ...overrides,
});

function makeBus(): { bus: AgentCommBus; channelStore: any; queue: any; dispatch: any } {
  const channelStore = {
    open: vi.fn().mockResolvedValue({ key: 'channel:a:b', meta: { pair: ['a','b'], pairNames: ['a','b'], ownerAgentId: 'a', turns: 0, tokensIn: 0, tokensOut: 0, sealed: false, sealedReason: null, lastActivityAt: '' } }),
    read: vi.fn().mockResolvedValue({ key: 'channel:a:b', meta: { pair: ['a','b'], pairNames: ['a','b'], ownerAgentId: 'a', turns: 0, tokensIn: 0, tokensOut: 0, sealed: false, sealedReason: null, lastActivityAt: '' } }),
    appendUserMessage: vi.fn().mockResolvedValue({ turns: 1 }),
    appendAudit: vi.fn().mockResolvedValue(undefined),
    seal: vi.fn().mockResolvedValue(undefined),
    addUsage: vi.fn().mockResolvedValue(undefined),
  };
  const queue = { enqueue: vi.fn(async (_k: string, fn: () => any) => fn()), isActive: vi.fn().mockReturnValue(false) };
  const dispatch = vi.fn().mockResolvedValue(undefined); // wake dispatcher stub
  const deps: AgentCommBusDeps = {
    channelStore: channelStore as any,
    queue: queue as any,
    dispatchChannelWake: dispatch,
    now: () => '2026-05-05T00:00:00Z',
  };
  return { bus: new AgentCommBus(deps), channelStore, queue, dispatch };
}

describe('AgentCommBus.send — pre-flight', () => {
  let ctx: ReturnType<typeof makeBus>;
  beforeEach(() => { ctx = makeBus(); });

  function register() {
    ctx.bus.register({
      agentId: 'a', agentName: 'alpha',
      agentComm: [peer({ commNodeId: 'a-to-b', targetAgentNodeId: 'b', targetAgentName: 'beta' })],
    });
    ctx.bus.register({
      agentId: 'b', agentName: 'beta',
      agentComm: [peer({ commNodeId: 'b-to-a', targetAgentNodeId: 'a', targetAgentName: 'alpha' })],
    });
  }

  it('rejects unknown peer (topology_violation)', async () => {
    register();
    const r = await ctx.bus.send({ fromAgentId: 'a', toAgentName: 'gamma', message: 'hi', end: false, currentDepth: 0 });
    expect(r).toEqual({ ok: false, error: 'topology_violation' });
  });

  it('rejects when sender agent unmanaged', async () => {
    const r = await ctx.bus.send({ fromAgentId: 'ghost', toAgentName: 'beta', message: 'hi', end: false, currentDepth: 0 });
    expect(r).toEqual({ ok: false, error: 'topology_violation' });
  });

  it('rejects one-sided contract (topology_violation)', async () => {
    ctx.bus.register({ agentId: 'a', agentName: 'alpha', agentComm: [peer({ commNodeId: 'a-to-b', targetAgentNodeId: 'b', targetAgentName: 'beta' })] });
    ctx.bus.register({ agentId: 'b', agentName: 'beta', agentComm: [] }); // no reciprocal
    const r = await ctx.bus.send({ fromAgentId: 'a', toAgentName: 'beta', message: 'hi', end: false, currentDepth: 0 });
    expect(r).toEqual({ ok: false, error: 'topology_violation' });
  });

  it('rejects outbound by sender direction lock', async () => {
    ctx.bus.register({ agentId: 'a', agentName: 'alpha', agentComm: [peer({ commNodeId: 'a-to-b', targetAgentNodeId: 'b', targetAgentName: 'beta', direction: 'inbound' })] });
    ctx.bus.register({ agentId: 'b', agentName: 'beta', agentComm: [peer({ commNodeId: 'b-to-a', targetAgentNodeId: 'a', targetAgentName: 'alpha' })] });
    const r = await ctx.bus.send({ fromAgentId: 'a', toAgentName: 'beta', message: 'hi', end: false, currentDepth: 0 });
    expect(r).toEqual({ ok: false, error: 'direction_violation' });
  });

  it('rejects oversize message', async () => {
    register();
    const long = 'x'.repeat(16_001);
    const r = await ctx.bus.send({ fromAgentId: 'a', toAgentName: 'beta', message: long, end: false, currentDepth: 0 });
    expect(r).toEqual({ ok: false, error: 'message_too_large' });
  });

  it('rejects when depth would exceed pair min', async () => {
    ctx.bus.register({ agentId: 'a', agentName: 'alpha', agentComm: [peer({ commNodeId: 'a-to-b', targetAgentNodeId: 'b', targetAgentName: 'beta', maxDepth: 5 })] });
    ctx.bus.register({ agentId: 'b', agentName: 'beta', agentComm: [peer({ commNodeId: 'b-to-a', targetAgentNodeId: 'a', targetAgentName: 'alpha', maxDepth: 2 })] });
    const r = await ctx.bus.send({ fromAgentId: 'a', toAgentName: 'beta', message: 'hi', end: false, currentDepth: 2 });
    expect(r).toEqual({ ok: false, error: 'depth_exceeded' });
  });

  it('happy path: appends, audits, enqueues wake when !end', async () => {
    register();
    const r = await ctx.bus.send({ fromAgentId: 'a', toAgentName: 'beta', message: 'hi', end: false, currentDepth: 0 });
    expect(r).toMatchObject({ ok: true, depth: 1, queuedWake: true });
    expect(ctx.channelStore.appendUserMessage).toHaveBeenCalledOnce();
    expect(ctx.channelStore.appendAudit).toHaveBeenCalledOnce();
    expect(ctx.dispatch).toHaveBeenCalledOnce();
  });

  it('end:true does not enqueue wake', async () => {
    register();
    const r = await ctx.bus.send({ fromAgentId: 'a', toAgentName: 'beta', message: 'hi', end: true, currentDepth: 0 });
    expect(r).toMatchObject({ ok: true, queuedWake: false });
    expect(ctx.dispatch).not.toHaveBeenCalled();
  });

  it('rate_limited when sender exceeds outbound count', async () => {
    ctx.bus.register({ agentId: 'a', agentName: 'alpha', agentComm: [peer({ commNodeId: 'a-to-b', targetAgentNodeId: 'b', targetAgentName: 'beta', rateLimitPerMinute: 2 })] });
    ctx.bus.register({ agentId: 'b', agentName: 'beta', agentComm: [peer({ commNodeId: 'b-to-a', targetAgentNodeId: 'a', targetAgentName: 'alpha', rateLimitPerMinute: 2 })] });
    await ctx.bus.send({ fromAgentId: 'a', toAgentName: 'beta', message: 'a', end: true, currentDepth: 0 });
    await ctx.bus.send({ fromAgentId: 'a', toAgentName: 'beta', message: 'b', end: true, currentDepth: 0 });
    const r = await ctx.bus.send({ fromAgentId: 'a', toAgentName: 'beta', message: 'c', end: true, currentDepth: 0 });
    expect(r).toEqual({ ok: false, error: 'rate_limited' });
  });
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `npx vitest run server/comms/agent-comm-bus.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the bus skeleton**

Create `server/comms/agent-comm-bus.ts`:

```ts
import type { ResolvedAgentCommConfig } from '../../shared/agent-config';
import type {
  AgentCommErrorCode,
  AgentSendMessageMeta,
  AgentCommSealReason,
} from '../../shared/agent-comm-types';
import { canonicalChannelKey } from './channel-key';
import type { ChannelSessionStore } from './channel-session-store';
import type { ChannelRunQueue } from './channel-run-queue';

export interface BusAgentRegistration {
  agentId: string;
  agentName: string;
  agentComm: ResolvedAgentCommConfig[];
}

export interface SendArgs {
  fromAgentId: string;
  toAgentName: string;
  message: string;
  end: boolean;
  currentDepth: number;
}

export type SendResult =
  | { ok: true; depth: number; turns: number; queuedWake: boolean }
  | { ok: false; error: AgentCommErrorCode };

export interface BroadcastArgs {
  fromAgentId: string;
  message: string;
  end: boolean;
  currentDepth: number;
}

export interface BroadcastResult {
  results: Array<{ to: string; ok: boolean; error?: AgentCommErrorCode }>;
}

export interface DispatchChannelWakeArgs {
  channelKey: string;
  receiverAgentId: string;
  senderAgentName: string;
  depth: number;
  isFinalTurn: boolean;
}

export interface AgentCommBusDeps {
  channelStore: ChannelSessionStore;
  queue: ChannelRunQueue;
  dispatchChannelWake: (args: DispatchChannelWakeArgs) => Promise<void>;
  now?: () => string;
}

const RATE_WINDOW_MS = 60_000;

export class AgentCommBus {
  private readonly registry = new Map<string, BusAgentRegistration>();
  private readonly outboundLog = new Map<string, number[]>(); // agentId -> timestamps (ms)

  constructor(private readonly deps: AgentCommBusDeps) {}

  private now(): string { return this.deps.now ? this.deps.now() : new Date().toISOString(); }
  private nowMs(): number { return Date.parse(this.now()); }

  register(reg: BusAgentRegistration): void {
    this.registry.set(reg.agentId, reg);
  }

  unregister(agentId: string): void {
    this.registry.delete(agentId);
    this.outboundLog.delete(agentId);
  }

  listManaged(): BusAgentRegistration[] { return [...this.registry.values()]; }

  private resolveContract(fromAgentId: string, toAgentName: string):
    | { error: AgentCommErrorCode }
    | { sender: BusAgentRegistration; receiver: BusAgentRegistration; senderEdge: ResolvedAgentCommConfig; receiverEdge: ResolvedAgentCommConfig } {
    const sender = this.registry.get(fromAgentId);
    if (!sender) return { error: 'topology_violation' };
    const senderEdge = sender.agentComm.find(
      (c) => c.protocol === 'direct' && c.targetAgentName === toAgentName,
    );
    if (!senderEdge || !senderEdge.targetAgentNodeId) return { error: 'topology_violation' };
    const receiver = this.registry.get(senderEdge.targetAgentNodeId);
    if (!receiver) return { error: 'receiver_unavailable' };
    const receiverEdge = receiver.agentComm.find(
      (c) => c.protocol === 'direct' && c.targetAgentNodeId === sender.agentId,
    );
    if (!receiverEdge) return { error: 'topology_violation' };
    return { sender, receiver, senderEdge, receiverEdge };
  }

  private checkDirection(senderEdge: ResolvedAgentCommConfig, receiverEdge: ResolvedAgentCommConfig): AgentCommErrorCode | null {
    if (senderEdge.direction === 'inbound') return 'direction_violation';
    if (receiverEdge.direction === 'outbound') return 'direction_violation';
    return null;
  }

  private trimRateLog(agentId: string): number[] {
    const now = this.nowMs();
    const log = (this.outboundLog.get(agentId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    this.outboundLog.set(agentId, log);
    return log;
  }

  private noteRateUsage(agentId: string): void {
    const log = this.trimRateLog(agentId);
    log.push(this.nowMs());
  }

  async send(args: SendArgs): Promise<SendResult> {
    const contract = this.resolveContract(args.fromAgentId, args.toAgentName);
    if ('error' in contract) return { ok: false, error: contract.error };
    const { sender, receiver, senderEdge, receiverEdge } = contract;

    const dirErr = this.checkDirection(senderEdge, receiverEdge);
    if (dirErr) return { ok: false, error: dirErr };

    if (args.message.length > senderEdge.messageSizeCap) {
      return { ok: false, error: 'message_too_large' };
    }

    const limit = Math.min(senderEdge.rateLimitPerMinute, receiverEdge.rateLimitPerMinute);
    const log = this.trimRateLog(args.fromAgentId);
    if (log.length >= limit) {
      return { ok: false, error: 'rate_limited' };
    }

    const minMaxTurns = Math.min(senderEdge.maxTurns, receiverEdge.maxTurns);
    const minMaxDepth = Math.min(senderEdge.maxDepth, receiverEdge.maxDepth);
    const minTokenBudget = Math.min(senderEdge.tokenBudget, receiverEdge.tokenBudget);

    if (args.currentDepth + 1 > minMaxDepth) {
      return { ok: false, error: 'depth_exceeded' };
    }

    const channel = await this.deps.channelStore.open({
      pair: sender.agentId < receiver.agentId
        ? [sender.agentId, receiver.agentId]
        : [receiver.agentId, sender.agentId],
      pairNames: sender.agentId < receiver.agentId
        ? [sender.agentName, receiver.agentName]
        : [receiver.agentName, sender.agentName],
    });

    if (channel.meta.sealed) return { ok: false, error: 'channel_sealed' };
    if (channel.meta.tokensIn + channel.meta.tokensOut >= minTokenBudget) {
      await this.deps.channelStore.appendAudit(channel.key, {
        kind: 'agent-comm-audit', ts: this.now(),
        event: { type: 'limit-tripped', code: 'token_budget_exceeded', from: sender.agentName, to: receiver.agentName },
      });
      await this.deps.channelStore.seal(channel.key, 'token_budget_exceeded');
      return { ok: false, error: 'token_budget_exceeded' };
    }
    if (channel.meta.turns + 1 > minMaxTurns) {
      await this.deps.channelStore.appendAudit(channel.key, {
        kind: 'agent-comm-audit', ts: this.now(),
        event: { type: 'limit-tripped', code: 'max_turns_reached', from: sender.agentName, to: receiver.agentName },
      });
      await this.deps.channelStore.seal(channel.key, 'max_turns_reached');
      return { ok: false, error: 'max_turns_reached' };
    }

    const depth = args.currentDepth + 1;
    const meta: AgentSendMessageMeta = {
      from: `agent:${sender.agentName}`, fromAgentId: sender.agentId,
      to: `agent:${receiver.agentName}`, toAgentId: receiver.agentId,
      depth, channelKey: channel.key,
    };
    const updated = await this.deps.channelStore.appendUserMessage(channel.key, {
      content: args.message, meta,
    });
    await this.deps.channelStore.appendAudit(channel.key, {
      kind: 'agent-comm-audit', ts: this.now(),
      event: { type: 'send', from: sender.agentName, to: receiver.agentName, depth, chars: args.message.length, end: args.end },
    });
    this.noteRateUsage(args.fromAgentId);

    const isFinalTurn = updated.turns === minMaxTurns;
    if (isFinalTurn) {
      await this.deps.channelStore.seal(channel.key, 'max_turns_reached');
    }

    if (!args.end) {
      await this.deps.dispatchChannelWake({
        channelKey: channel.key,
        receiverAgentId: receiver.agentId,
        senderAgentName: sender.agentName,
        depth,
        isFinalTurn,
      });
    }

    return { ok: true, depth, turns: updated.turns, queuedWake: !args.end };
  }

  async broadcast(args: BroadcastArgs): Promise<BroadcastResult> {
    const sender = this.registry.get(args.fromAgentId);
    if (!sender) return { results: [] };
    const peers = sender.agentComm
      .filter((c) => c.protocol === 'direct' && c.targetAgentName)
      .map((c) => c.targetAgentName as string)
      .sort();
    const out: BroadcastResult['results'] = [];
    for (const to of peers) {
      const r = await this.send({
        fromAgentId: args.fromAgentId, toAgentName: to,
        message: args.message, end: args.end, currentDepth: args.currentDepth,
      });
      if (r.ok) out.push({ to, ok: true });
      else out.push({ to, ok: false, error: r.error });
    }
    return { results: out };
  }

  async addUsage(channelKey: string, usage: { tokensIn: number; tokensOut: number }, pairBudget: number): Promise<void> {
    const next = await this.deps.channelStore.addUsage(channelKey, usage);
    if (next.tokensIn + next.tokensOut >= pairBudget && !next.sealed) {
      await this.deps.channelStore.seal(channelKey, 'token_budget_exceeded');
    }
  }

  // Read-only pass-throughs used by the channels REST route.
  async readChannel(channelKey: string) {
    return this.deps.channelStore.read(channelKey);
  }
  async readChannelTranscript(channelKey: string, limit: number): Promise<unknown[]> {
    return this.deps.channelStore.tail(channelKey, limit);
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run server/comms/agent-comm-bus.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/comms/agent-comm-bus.ts server/comms/agent-comm-bus.test.ts
git commit -m "feat(agent-comm): bus core — registration, contracts, send pre-flight, broadcast"
```

---

### Task 8: Bus auto-seal on `maxTurns == minMax` boundary + queue serialization

This task hardens two behaviors with focused tests on the bus + queue together.

**Files:**
- Modify: `server/comms/agent-comm-bus.test.ts` (add cases)
- Modify: `server/comms/agent-comm-bus.ts` if any test fails

- [ ] **Step 1: Add test cases**

Append to `agent-comm-bus.test.ts`:

```ts
describe('AgentCommBus — auto-seal and serialization', () => {
  it('seals after the message that reaches maxTurns is appended', async () => {
    const ctx = makeBus();
    ctx.bus.register({ agentId: 'a', agentName: 'alpha', agentComm: [peer({ commNodeId: 'a-to-b', targetAgentNodeId: 'b', targetAgentName: 'beta', maxTurns: 1 })] });
    ctx.bus.register({ agentId: 'b', agentName: 'beta', agentComm: [peer({ commNodeId: 'b-to-a', targetAgentNodeId: 'a', targetAgentName: 'alpha', maxTurns: 1 })] });
    // first send accepted, then channel auto-sealed at the boundary
    ctx.channelStore.appendUserMessage.mockResolvedValueOnce({ turns: 1, sealed: false });
    const r = await ctx.bus.send({ fromAgentId: 'a', toAgentName: 'beta', message: 'hi', end: false, currentDepth: 0 });
    expect(r.ok).toBe(true);
    expect(ctx.channelStore.seal).toHaveBeenCalledWith('channel:a:b', 'max_turns_reached');
  });

  it('isFinalTurn is true when seal occurs at boundary', async () => {
    const ctx = makeBus();
    ctx.bus.register({ agentId: 'a', agentName: 'alpha', agentComm: [peer({ commNodeId: 'a-to-b', targetAgentNodeId: 'b', targetAgentName: 'beta', maxTurns: 1 })] });
    ctx.bus.register({ agentId: 'b', agentName: 'beta', agentComm: [peer({ commNodeId: 'b-to-a', targetAgentNodeId: 'a', targetAgentName: 'alpha', maxTurns: 1 })] });
    ctx.channelStore.appendUserMessage.mockResolvedValueOnce({ turns: 1, sealed: false });
    await ctx.bus.send({ fromAgentId: 'a', toAgentName: 'beta', message: 'hi', end: false, currentDepth: 0 });
    expect(ctx.dispatch).toHaveBeenCalledWith(expect.objectContaining({ isFinalTurn: true }));
  });
});
```

- [ ] **Step 2: Run test, verify pass**

Run: `npx vitest run server/comms/agent-comm-bus.test.ts`
Expected: PASS (boundary logic was already implemented in Task 7).

- [ ] **Step 3: Commit**

```bash
git add server/comms/agent-comm-bus.test.ts
git commit -m "test(agent-comm): cover maxTurns boundary auto-seal and isFinalTurn dispatch flag"
```

---

## Phase 5 — Tools

### Task 9: Per-run injected `agent_send`, `agent_broadcast`, `agent_channel_history` tools

**Files:**
- Create: `server/comms/agent-comm-tools.ts`
- Create: `server/comms/agent-comm-tools.test.ts`

The tools are produced by a factory function that takes a runtime context (sender id/name, current depth, bus, channel-store reader) and returns SDK-shaped tools matching the existing `tool-adapter` patterns. They're injected per-run by the coordinator (Task 11).

- [ ] **Step 1: Write the failing test**

```ts
// server/comms/agent-comm-tools.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createAgentCommTools } from './agent-comm-tools';
import type { AgentCommBus } from './agent-comm-bus';

describe('createAgentCommTools', () => {
  function ctx(overrides: Partial<Parameters<typeof createAgentCommTools>[0]> = {}) {
    const bus = {
      send: vi.fn().mockResolvedValue({ ok: true, depth: 1, turns: 1, queuedWake: true }),
      broadcast: vi.fn().mockResolvedValue({ results: [{ to: 'beta', ok: true }] }),
    } as unknown as AgentCommBus;
    return {
      bus,
      fromAgentId: 'a',
      fromAgentName: 'alpha',
      currentDepth: 0,
      directPeerNames: ['beta'],
      hasBroadcastNode: true,
      readChannelHistory: vi.fn().mockResolvedValue([{ role: 'user', content: 'hi' }]),
      pairNamesToChannelKey: vi.fn().mockReturnValue('channel:a:b'),
      ...overrides,
    };
  }

  it('agent_send is exposed when at least one direct peer exists', () => {
    const tools = createAgentCommTools(ctx());
    expect(tools.find((t) => t.name === 'agent_send')).toBeTruthy();
  });

  it('agent_broadcast is exposed only when hasBroadcastNode is true', () => {
    const withBroadcast = createAgentCommTools(ctx());
    const without = createAgentCommTools(ctx({ hasBroadcastNode: false }));
    expect(withBroadcast.find((t) => t.name === 'agent_broadcast')).toBeTruthy();
    expect(without.find((t) => t.name === 'agent_broadcast')).toBeFalsy();
  });

  it('returns an empty list when no direct peers (agent_send disabled)', () => {
    expect(createAgentCommTools(ctx({ directPeerNames: [], hasBroadcastNode: false }))).toEqual([]);
  });

  it('agent_send invokes bus.send with current run context', async () => {
    const c = ctx();
    const tools = createAgentCommTools(c);
    const send = tools.find((t) => t.name === 'agent_send')!;
    const result = await send.execute({ to: 'beta', message: 'hi' });
    expect(c.bus.send).toHaveBeenCalledWith({
      fromAgentId: 'a', toAgentName: 'beta', message: 'hi', end: false, currentDepth: 0,
    });
    expect(result).toMatchObject({ ok: true, depth: 1 });
  });

  it("agent_send forwards end:true", async () => {
    const c = ctx();
    const tools = createAgentCommTools(c);
    const send = tools.find((t) => t.name === 'agent_send')!;
    await send.execute({ to: 'beta', message: 'bye', end: true });
    expect(c.bus.send).toHaveBeenCalledWith(expect.objectContaining({ end: true }));
  });

  it('agent_send returns shaped error for non-peer', async () => {
    const c = ctx();
    (c.bus.send as any).mockResolvedValueOnce({ ok: false, error: 'topology_violation' });
    const tools = createAgentCommTools(c);
    const send = tools.find((t) => t.name === 'agent_send')!;
    const result = await send.execute({ to: 'gamma', message: 'hi' });
    expect(result).toEqual({ ok: false, error: 'topology_violation' });
  });

  it('agent_broadcast invokes bus.broadcast', async () => {
    const c = ctx();
    const tools = createAgentCommTools(c);
    const bc = tools.find((t) => t.name === 'agent_broadcast')!;
    const result = await bc.execute({ message: 'hello peers' });
    expect(c.bus.broadcast).toHaveBeenCalled();
    expect(result).toEqual({ results: [{ to: 'beta', ok: true }] });
  });

  it('agent_channel_history reads through provided reader', async () => {
    const c = ctx();
    const tools = createAgentCommTools(c);
    const hist = tools.find((t) => t.name === 'agent_channel_history')!;
    const result = await hist.execute({ with: 'beta', limit: 5 });
    expect(c.readChannelHistory).toHaveBeenCalledWith({ channelKey: 'channel:a:b', limit: 5 });
    expect(result).toEqual([{ role: 'user', content: 'hi' }]);
  });
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `npx vitest run server/comms/agent-comm-tools.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the tools**

Create `server/comms/agent-comm-tools.ts`:

```ts
import type { AgentCommBus } from './agent-comm-bus';

export interface AgentCommToolsCtx {
  bus: AgentCommBus;
  fromAgentId: string;
  fromAgentName: string;
  currentDepth: number;
  directPeerNames: string[];
  hasBroadcastNode: boolean;
  readChannelHistory: (args: { channelKey: string; limit: number }) => Promise<unknown[]>;
  pairNamesToChannelKey: (peerName: string) => string;
}

export interface AgentCommTool {
  name: 'agent_send' | 'agent_broadcast' | 'agent_channel_history';
  description: string;
  parameters: object;
  execute: (input: any) => Promise<unknown>;
}

export function createAgentCommTools(ctx: AgentCommToolsCtx): AgentCommTool[] {
  const tools: AgentCommTool[] = [];
  if (ctx.directPeerNames.length === 0 && !ctx.hasBroadcastNode) return tools;

  if (ctx.directPeerNames.length > 0) {
    tools.push({
      name: 'agent_send',
      description:
        'Send a message to a peer agent. Wakes the peer unless end:true.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', enum: ctx.directPeerNames, description: 'peer agent name' },
          message: { type: 'string' },
          end: { type: 'boolean', default: false },
        },
        required: ['to', 'message'],
        additionalProperties: false,
      },
      execute: async (input: { to: string; message: string; end?: boolean }) => {
        return ctx.bus.send({
          fromAgentId: ctx.fromAgentId,
          toAgentName: input.to,
          message: input.message,
          end: input.end === true,
          currentDepth: ctx.currentDepth,
        });
      },
    });

    tools.push({
      name: 'agent_channel_history',
      description: 'Return the last N transcript events from your channel with a peer.',
      parameters: {
        type: 'object',
        properties: {
          with: { type: 'string', enum: ctx.directPeerNames },
          limit: { type: 'number', minimum: 1, maximum: 100, default: 20 },
        },
        required: ['with'],
        additionalProperties: false,
      },
      execute: async (input: { with: string; limit?: number }) => {
        const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
        return ctx.readChannelHistory({
          channelKey: ctx.pairNamesToChannelKey(input.with),
          limit,
        });
      },
    });
  }

  if (ctx.hasBroadcastNode && ctx.directPeerNames.length > 0) {
    tools.push({
      name: 'agent_broadcast',
      description:
        'Send the same message to every direct peer; per-peer outcomes are returned.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          end: { type: 'boolean', default: false },
        },
        required: ['message'],
        additionalProperties: false,
      },
      execute: async (input: { message: string; end?: boolean }) => {
        return ctx.bus.broadcast({
          fromAgentId: ctx.fromAgentId,
          message: input.message,
          end: input.end === true,
          currentDepth: ctx.currentDepth,
        });
      },
    });
  }

  return tools;
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run server/comms/agent-comm-tools.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/comms/agent-comm-tools.ts server/comms/agent-comm-tools.test.ts
git commit -m "feat(agent-comm): per-run injected agent_send / agent_broadcast / agent_channel_history tools"
```

---

## Phase 6 — Runtime wiring

### Task 10: AgentManager owns the bus; registers/unregisters managed agents

**Files:**
- Modify: `server/agents/agent-manager.ts` (add bus instance, hook `start` and `destroy`)
- Modify: `server/agents/agent-manager.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// add to server/agents/agent-manager.test.ts
import { describe, it, expect } from 'vitest';
// ... existing imports + helpers

describe('AgentManager + AgentCommBus', () => {
  it('registers managed agents on start and unregisters on destroy', async () => {
    const mgr = newAgentManager(); // existing test helper
    await mgr.start(makeAgentConfig({ id: 'a', name: 'alpha', agentComm: [/* one direct edge to b */] }));
    expect(mgr.commBus.listManaged().map((r) => r.agentId)).toContain('a');
    mgr.destroy('a');
    expect(mgr.commBus.listManaged().map((r) => r.agentId)).not.toContain('a');
  });
});
```

(The existing `agent-manager.test.ts` has helpers — reuse `newAgentManager()` / `makeAgentConfig()` patterns.)

- [ ] **Step 2: Run test, verify fails**

Run: `npx vitest run server/agents/agent-manager.test.ts`
Expected: FAIL — `mgr.commBus` undefined.

- [ ] **Step 3: Wire the bus into AgentManager**

In `server/agents/agent-manager.ts`:

1. Import `AgentCommBus`, `ChannelSessionStore`, `ChannelRunQueue`.
2. Construct one `commBus` in the constructor. Pass `ownerStorage: (lo) => this.agents.get(lo)?.storage` into the channel store, and a `dispatchChannelWake` callback that, for v1, looks up the receiver's coordinator and calls a new method `dispatchChannel` (added in Task 11).
3. In `start()`, after the `ManagedAgent` is fully assembled, call `this.commBus.register({ agentId: config.id, agentName: config.name, agentComm: config.agentComm })`.
4. In `destroy()`, call `this.commBus.unregister(agentId)` before tearing down the runtime.
5. Expose `commBus` as a public readonly field for use by routes/tests.

```ts
// near top of class
public readonly commBus: AgentCommBus;
constructor(/* existing args */) {
  // ... existing init
  const channelStore = new ChannelSessionStore({
    ownerStorage: (lo) => this.agents.get(lo)?.storage,
  });
  const queue = new ChannelRunQueue();
  this.commBus = new AgentCommBus({
    channelStore,
    queue,
    dispatchChannelWake: async (args) => {
      const managed = this.agents.get(args.receiverAgentId);
      if (!managed) return;
      await queue.enqueue(args.channelKey, () =>
        managed.coordinator.dispatchChannel({
          channelKey: args.channelKey,
          peerName: args.senderAgentName,
          depth: args.depth,
          isFinalTurn: args.isFinalTurn,
        })
      );
    },
  });
}

// at end of start(), after ManagedAgent inserted:
this.commBus.register({
  agentId: config.id, agentName: config.name, agentComm: config.agentComm,
});

// at start of destroy():
this.commBus.unregister(agentId);
```

NOTE: `coordinator.dispatchChannel` does not exist yet — it is added in Task 11. The compile error for it is expected at the end of this task; resolve it in Task 11.

- [ ] **Step 4: Run partial test (skip dispatchChannel-dependent paths)**

Run: `npx vitest run server/agents/agent-manager.test.ts -t 'registers managed agents on start'`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/agents/agent-manager.ts server/agents/agent-manager.test.ts
git commit -m "feat(agent-comm): AgentManager owns AgentCommBus and registers managed agents"
```

---

### Task 11: `RunCoordinator.dispatchChannel` and channel-mode runtime path

**Files:**
- Modify: `server/agents/run-coordinator.ts`
- Modify: `server/runtime/agent-runtime.ts`
- Modify: `server/agents/run-coordinator.test.ts`

`dispatchChannel` opens the channel transcript, builds a runtime context where the inbound message is already present, injects channel-context system-prompt block, injects the comm tools with `currentDepth = depth`, runs the model once (no extra user message append), reports usage to the bus, and clears tools after.

- [ ] **Step 1: Write the failing test**

```ts
// add to server/agents/run-coordinator.test.ts
describe('RunCoordinator.dispatchChannel', () => {
  it('runs receiver against channel transcript without re-appending the inbound user message', async () => {
    const env = newCoordinatorEnv(/* with channel store + bus stubs */);
    env.bus.send.mockReturnThis();
    // pretend bus already appended a user message; dispatchChannel should NOT call appendUserMessage again
    await env.coordinator.dispatchChannel({
      channelKey: 'channel:a:b', peerName: 'alpha', depth: 1, isFinalTurn: false,
    });
    expect(env.runtime.appendUserMessageCalls).toBe(0);
    expect(env.runtime.runCalls).toBe(1);
    expect(env.runtime.injectedTools.map((t) => t.name)).toContain('agent_send');
  });

  it('injects final-turn notice into channel-context system prompt when isFinalTurn=true', async () => {
    const env = newCoordinatorEnv();
    await env.coordinator.dispatchChannel({
      channelKey: 'channel:a:b', peerName: 'alpha', depth: 1, isFinalTurn: true,
    });
    expect(env.runtime.lastChannelContextBlock).toContain('this channel is sealed');
  });

  it('reports usage to bus.addUsage after run', async () => {
    const env = newCoordinatorEnv();
    env.runtime.usage = { tokensIn: 200, tokensOut: 100 };
    await env.coordinator.dispatchChannel({
      channelKey: 'channel:a:b', peerName: 'alpha', depth: 1, isFinalTurn: false,
    });
    expect(env.bus.addUsage).toHaveBeenCalledWith('channel:a:b', { tokensIn: 200, tokensOut: 100 }, expect.any(Number));
  });
});
```

(Use the existing test helpers / extend them. If `newCoordinatorEnv` does not exist, create one based on existing test setup in this file.)

- [ ] **Step 2: Run test, verify fails**

Run: `npx vitest run server/agents/run-coordinator.test.ts -t 'dispatchChannel'`
Expected: FAIL — method missing.

- [ ] **Step 3: Implement `dispatchChannel`**

In `server/agents/run-coordinator.ts`, add a new public method:

```ts
async dispatchChannel(args: {
  channelKey: string;
  peerName: string;
  depth: number;
  isFinalTurn: boolean;
}): Promise<void> {
  // 1. Open the channel transcript
  const ch = await this.deps.channelStore.read(args.channelKey);
  // 2. Build channel-context system prompt addendum
  const block = buildChannelContextBlock(args.peerName, args.isFinalTurn);
  // 3. Inject comm tools per-run
  const tools = createAgentCommTools({
    bus: this.deps.commBus,
    fromAgentId: this.config.id,
    fromAgentName: this.config.name,
    currentDepth: args.depth,
    directPeerNames: this.config.agentComm.filter((c) => c.protocol === 'direct').map((c) => c.targetAgentName!).filter(Boolean),
    hasBroadcastNode: this.config.agentComm.some((c) => c.protocol === 'broadcast'),
    readChannelHistory: async ({ channelKey, limit }) =>
      this.deps.channelStore.tail(channelKey, limit),
    pairNamesToChannelKey: (peer) => {
      const peerId = this.config.agentComm.find((c) => c.targetAgentName === peer)?.targetAgentNodeId;
      if (!peerId) throw new Error(`no peer ${peer}`);
      return canonicalChannelKey(this.config.id, peerId);
    },
  });
  this.runtime.addTools(tools);
  this.runtime.appendSystemPromptBlock(block);
  // 4. Run the model on the existing channel transcript.
  // The runtime resolves the transcript file path from the channel key via the
  // ChannelSessionStore it holds (passed via deps); it does NOT receive a raw path here.
  const usage = await this.runtime.runOnTranscript({
    channelKey: args.channelKey,
    appendInboundUserMessage: false,
  });
  // 5. Report usage
  if (usage) {
    const minTokenBudget = Math.min(
      ...this.config.agentComm
        .filter((c) => c.protocol === 'direct')
        .map((c) => c.tokenBudget),
    );
    await this.deps.commBus.addUsage(args.channelKey, usage, minTokenBudget);
  }
}
```

Add a helper at module top:

```ts
function buildChannelContextBlock(peerName: string, isFinalTurn: boolean): string {
  const base =
    `You are in a peer channel-session with agent ${peerName}. ` +
    `Use agent_send to reply. Use end:true when you are intentionally ending the exchange.`;
  if (!isFinalTurn) return base;
  return (
    base +
    '\n\nNOTE: this channel is sealed. Any agent_send call will be rejected with ' +
    'channel_sealed. Reply with normal assistant text only — it is persisted to the ' +
    'channel transcript and the peer can read it via agent_channel_history. Do not call agent_send.'
  );
}
```

In `server/runtime/agent-runtime.ts`, add two helper methods used above:

```ts
appendSystemPromptBlock(block: string): void {
  this.systemPromptBlocks.push(block);
  this.refreshSystemPrompt();
}

async runOnTranscript(args: { channelKey: string; appendInboundUserMessage: boolean }): Promise<{ tokensIn: number; tokensOut: number } | null> {
  // Variant of run() that uses a channel transcript (resolved via the channelStore
  // dep already injected into AgentRuntime) as the conversation backing store and
  // skips appending an inbound user message. Returns aggregated usage from the
  // single model call.
  // ... implementation reuses the prompt() pipeline with the channel transcript path.
}
```

NOTE: The exact `runOnTranscript` implementation depends on `agent-runtime.ts` internals. Read the existing `prompt()` flow at `server/runtime/agent-runtime.ts:101-730` and factor out the transcript-source path. If the existing flow couples session and transcript tightly, prefer adding a `channelMode: { transcriptPath, peerName }` option to `prompt()` rather than a separate method. Keep the surface minimal.

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run server/agents/run-coordinator.test.ts -t 'dispatchChannel'`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/agents/run-coordinator.ts server/runtime/agent-runtime.ts server/agents/run-coordinator.test.ts
git commit -m "feat(agent-comm): RunCoordinator.dispatchChannel and runtime channel-mode prompt"
```

---

### Task 12: Filter `channelMeta` entries from normal session listings

**Files:**
- Modify: `server/sessions/session-router.ts:155` (`listSessions`) and any other public lister
- Modify: `server/sessions/session-router.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// add to server/sessions/session-router.test.ts
it('listSessions excludes entries with channelMeta', async () => {
  const router = newSessionRouterTestEnv(); // helper
  await seedSession(router, { sessionKey: 'user:a:1' });
  await seedSession(router, { sessionKey: 'channel:a:b', channelMeta: makeChannelMeta() });
  const list = await router.listSessions();
  expect(list.map((e) => e.sessionKey)).toEqual(['user:a:1']);
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `npx vitest run server/sessions/session-router.test.ts -t 'channelMeta'`
Expected: FAIL — both sessions listed.

- [ ] **Step 3: Add the filter**

In `server/sessions/session-router.ts:155`, change the body of `listSessions`:

```ts
async listSessions(...args): Promise<SessionStoreEntry[]> {
  const all = await this.storage.listAllSessions(...args);
  return all.filter((e) => !e.channelMeta);
}
```

If there are other lister methods (e.g. `getStatus`), ensure they also filter `channelMeta` entries unless the caller is the channel API.

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run server/sessions/session-router.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/sessions/session-router.ts server/sessions/session-router.test.ts
git commit -m "feat(agent-comm): hide channel-session entries from normal session listings"
```

---

## Phase 7 — Settings + UI surface

### Task 13: Workspace-level defaults for agent-comm

**Files:**
- Modify: `src/settings/types.ts`
- Modify: `src/settings/settings-store.ts`
- Modify: any settings UI section list

- [ ] **Step 1: Add the type**

In `src/settings/types.ts` add:

```ts
export interface AgentCommDefaults {
  defaultMaxTurns: number;
  defaultMaxDepth: number;
  defaultTokenBudget: number;
  defaultRateLimitPerMinute: number;
  defaultMessageSizeCap: number;
  defaultDirection: 'bidirectional' | 'outbound' | 'inbound';
}
```

Add a field to `PersistedSettings`:

```ts
agentCommDefaults?: AgentCommDefaults;
```

- [ ] **Step 2: Add the default constants**

In `src/settings/settings-store.ts` initialize:

```ts
const AGENT_COMM_DEFAULTS: AgentCommDefaults = {
  defaultMaxTurns: 10,
  defaultMaxDepth: 3,
  defaultTokenBudget: 100_000,
  defaultRateLimitPerMinute: 30,
  defaultMessageSizeCap: 16_000,
  defaultDirection: 'bidirectional',
};
```

Wire `setAgentCommDefaults(updates)` setter following the existing `setMemoryDefaults(...)` pattern at `src/settings/settings-store.ts:36-51`.

- [ ] **Step 3: Use defaults in `defaultNodeData('agentComm')`**

Edit `src/utils/default-nodes.ts`'s `agentComm` case to read from settings (via the same mechanism other peripheral nodes use — e.g. `useSettingsStore.getState()`). Fall back to baked-in constants if the settings store hasn't loaded yet.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx vitest run src/utils/`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/settings/types.ts src/settings/settings-store.ts src/utils/default-nodes.ts
git commit -m "feat(agent-comm): workspace-level defaults for new comm-node fields"
```

---

### Task 14: Read-only "Peer channels" surface in chat drawer

**Files:**
- Modify: `src/store/session-store.ts`
- Modify: a chat drawer or sidebar component (find via grep: existing sub-agent session listing)
- Optional: small REST route on the server to expose channels

This is intentionally minimal: list channel-sessions for a given agent and let the user read the transcript. No write controls.

- [ ] **Step 1: Add the channel-list API method**

Add to `src/store/session-store.ts`:

```ts
listPeerChannels: async (agentId: string) => {
  const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/channels`);
  if (!res.ok) return [];
  return (await res.json()) as PeerChannelSummary[];
},
```

Define `PeerChannelSummary`:

```ts
export interface PeerChannelSummary {
  channelKey: string;
  peerAgentId: string;
  peerAgentName: string;
  turns: number;
  sealed: boolean;
  sealedReason: 'max_turns_reached' | 'token_budget_exceeded' | 'manual' | null;
  lastActivityAt: string;
}
```

- [ ] **Step 2: Add the server route**

Create `server/routes/agent-channels.ts` (mirror `server/routes/subagents.ts` structure) exposing:

```
GET /api/agents/:agentId/channels
GET /api/agents/:agentId/channels/:channelKey/transcript?limit=50
```

Both are read-only. Implementation:

```ts
import express from 'express';
import type { AgentManager } from '../agents/agent-manager';

export function buildAgentChannelsRouter(mgr: AgentManager) {
  const r = express.Router();
  r.get('/api/agents/:agentId/channels', async (req, res) => {
    const managed = mgr.getManaged(req.params.agentId);
    if (!managed) return res.status(404).end();
    const peers = managed.config.agentComm
      .filter((c) => c.protocol === 'direct' && c.targetAgentNodeId)
      .map((c) => ({
        channelKey: canonicalChannelKey(managed.config.id, c.targetAgentNodeId!),
        peerAgentId: c.targetAgentNodeId!,
        peerAgentName: c.targetAgentName ?? '',
      }));
    const out = await Promise.all(peers.map(async (p) => {
      try {
        const ch = await mgr.commBus.readChannel(p.channelKey);
        return { ...p, turns: ch.meta.turns, sealed: ch.meta.sealed, sealedReason: ch.meta.sealedReason, lastActivityAt: ch.meta.lastActivityAt };
      } catch {
        return { ...p, turns: 0, sealed: false, sealedReason: null, lastActivityAt: '' };
      }
    }));
    res.json(out);
  });
  r.get('/api/agents/:agentId/channels/:channelKey/transcript', async (req, res) => {
    const events = await mgr.commBus.readChannelTranscript(req.params.channelKey, Number(req.query.limit ?? 50));
    res.json(events);
  });
  return r;
}
```

Add `commBus.readChannel` and `commBus.readChannelTranscript` thin pass-throughs to the channel store.

Mount in `server/main.ts` next to existing routes.

- [ ] **Step 3: Add a minimal "Peer channels" UI section**

Find the existing component that lists per-agent sessions (search for "Peer channels" placeholder if missing — likely `src/components/ChatDrawer.tsx` or a sidebar component). Add a collapsed `Peer channels` section under each agent that calls `useSessionStore.listPeerChannels(agentId)` and renders `PeerChannelSummary[]`. Clicking an entry opens a read-only transcript modal/panel that calls the transcript endpoint.

(Defer styling. The expected shape: compact list with peer name, turn count, sealed badge, last-activity timestamp.)

- [ ] **Step 4: Manual verification**

Start the dev server:

```bash
npm run dev
```

Build a graph with two agents and reciprocal direct comm nodes. Run a turn that triggers `agent_send`. Open the chat drawer, expand "Peer channels" under either agent, and verify the channel appears with `turns >= 1`. Click to view the transcript; verify the sent message is visible.

- [ ] **Step 5: Commit**

```bash
git add src/store/session-store.ts src/components/ server/routes/agent-channels.ts server/main.ts server/comms/agent-comm-bus.ts
git commit -m "feat(agent-comm): read-only Peer channels surface in chat drawer"
```

---

## Phase 8 — Integration tests + documentation

### Task 15: End-to-end peer round-trip integration test

**Files:**
- Create: `server/comms/agent-comm-integration.test.ts`

This is the highest-value test: two real agents, real coordinator, real bus, mocked provider. Mirror the structure of `server/agents/sub-agent-integration.test.ts`.

- [ ] **Step 1: Write the test**

```ts
// server/comms/agent-comm-integration.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { newIntegrationEnv } from '../agents/sub-agent-integration.test'; // adapt or replicate

describe('agent-comm — round trip', () => {
  it('A sends -> B replies (continue) -> A sends end -> channel sealed by maxTurns', async () => {
    const env = await newIntegrationEnv();
    await env.startAgent({ id: 'a', name: 'alpha', agentComm: [reciprocal('a', 'b', { maxTurns: 3 })] });
    await env.startAgent({ id: 'b', name: 'beta', agentComm: [reciprocal('b', 'a', { maxTurns: 3 })] });
    env.providerStub.queueAssistant('a', { tool: 'agent_send', input: { to: 'beta', message: 'q1' } });
    env.providerStub.queueAssistant('b', { tool: 'agent_send', input: { to: 'alpha', message: 'r1' } });
    env.providerStub.queueAssistant('a', { tool: 'agent_send', input: { to: 'beta', message: 'q2', end: true } });
    await env.dispatchUser('a', 'kick off');
    await env.idle();
    const channel = await env.commBus.readChannel('channel:a:b');
    expect(channel.meta.turns).toBe(3);
    expect(channel.meta.sealed).toBe(true);
    expect(channel.meta.sealedReason).toBe('max_turns_reached');
  });

  it('one-sided contract is rejected at runtime', async () => {
    const env = await newIntegrationEnv();
    await env.startAgent({ id: 'a', name: 'alpha', agentComm: [reciprocal('a', 'b')] });
    await env.startAgent({ id: 'b', name: 'beta', agentComm: [] });
    env.providerStub.queueAssistant('a', { tool: 'agent_send', input: { to: 'beta', message: 'hi' } });
    await env.dispatchUser('a', 'kick off');
    await env.idle();
    expect(env.observedToolResults('a').at(-1)).toMatchObject({
      ok: false, error: 'topology_violation',
    });
  });

  it('sub-agents do not receive agent_send even if parent declares peers', async () => {
    const env = await newIntegrationEnv();
    await env.startAgent({ id: 'a', name: 'alpha', agentComm: [reciprocal('a', 'b')], subAgents: [{ name: 'r', /* ... */ }] });
    await env.startAgent({ id: 'b', name: 'beta', agentComm: [reciprocal('b', 'a')] });
    const subTools = env.snapshotSubAgentTools('a', 'r');
    expect(subTools).not.toContain('agent_send');
    expect(subTools).not.toContain('agent_broadcast');
  });
});
```

(Helper functions: `reciprocal(a, b, overrides)` returns the comm node array; `env.providerStub.queueAssistant` queues a fake assistant turn. If the existing sub-agent integration harness doesn't expose these, copy and rename minimal helpers.)

- [ ] **Step 2: Run test, expect FAIL initially if any wiring is incomplete**

Run: `npx vitest run server/comms/agent-comm-integration.test.ts`

Diagnose any failures and fix them in the most appropriate prior task's surface (don't pile fixes here).

- [ ] **Step 3: Verify pass**

Run: `npx vitest run server/comms/agent-comm-integration.test.ts`
Expected: PASS

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — no regressions in sub-agents, sessions, runtime, sam-agent, etc.

- [ ] **Step 5: Commit**

```bash
git add server/comms/agent-comm-integration.test.ts
git commit -m "test(agent-comm): end-to-end peer round-trip and reciprocal-contract enforcement"
```

---

### Task 16: Update concept doc and project README mentions

**Files:**
- Modify: `docs/concepts/agent-comm-node.md` (replace "Not yet implemented at runtime" stub)
- Modify: `AGENTS.md` (note runtime is wired)
- Modify: `README.md` if multi-agent comms are mentioned

- [ ] **Step 1: Rewrite the concept doc**

Replace the body of `docs/concepts/agent-comm-node.md` with:

```markdown
# Agent Communication Node

> Wakes a peer agent on send. Bounded by per-pair turn/depth/token limits and per-sender rate limits.

<!-- source: src/types/nodes.ts#AgentCommNodeData -->
<!-- last-verified: 2026-05-05 -->

## Overview

The Agent Communication Node connects two long-lived agents in a graph for peer-to-peer messaging.
Direct comm nodes form a **reciprocal pair contract**: both agents must declare each other.
A successful `agent_send` wakes the receiver in a dedicated channel-session shared between the pair.

For one-shot child dispatch, see [Sub-Agent Node](./sub-agent-node.md). The two flows are independent.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Agent Comm"` | Display label |
| `targetAgentNodeId` | `string \| null` | `null` | Peer node id (direct only) |
| `protocol` | `'direct' \| 'broadcast'` | `'direct'` | Direct = one-to-one; broadcast = fan-out to declared direct peers |
| `direction` | `'bidirectional' \| 'outbound' \| 'inbound'` | `'bidirectional'` | Per-comm-node lock |
| `maxTurns` | `number` | `10` | Hard ceiling on sends in this channel |
| `maxDepth` | `number` | `3` | Cascade depth across chained sends |
| `tokenBudget` | `number` | `100_000` | Cumulative model tokens for this channel |
| `rateLimitPerMinute` | `number` | `30` | Sender-side outbound count across all peers |
| `messageSizeCap` | `number` | `16_000` | Max message length in characters |

Pair-symmetric controls take the **minimum** of the two endpoints' values.

## Runtime Behavior

1. Resolution wires `agentComm` into `AgentConfig.agentComm[]` with `commNodeId`, `targetAgentName`, and the v1 fields.
2. `AgentManager` registers each managed agent with `AgentCommBus`.
3. When `agentComm.length > 0`, the agent's tool surface includes `agent_send` (per direct peers), `agent_channel_history`, and (when a broadcast node is attached) `agent_broadcast`.
4. `agent_send` runs pre-flight checks (topology, direction, size, rate, channel state, depth, token budget, turns), appends a user-role message to the canonical `channel:<lo>:<hi>` session, audits the send, and (unless `end:true`) wakes the receiver via `RunCoordinator.dispatchChannel`.
5. The receiver runs in channel mode: its system prompt gets a channel-context block; the inbound message is the most-recent transcript event; tool calls (including more `agent_send`) are accepted up to the limits.
6. Reaching `maxTurns` or exhausting `tokenBudget` seals the channel. Further sends return `channel_sealed`.

## Connections

- Direct: requires reciprocal `direct` comm nodes on both endpoints.
- Broadcast: a single broadcast comm node enables `agent_broadcast` (which fans out to the agent's direct peers).
- Sub-agents do **not** receive comm tools.

## Example

A↔B with stricter limits:

```json
[
  { "type": "agentComm", "label": "to-beta", "protocol": "direct",
    "targetAgentNodeId": "agent-b", "direction": "bidirectional",
    "maxTurns": 5, "maxDepth": 2, "tokenBudget": 50000,
    "rateLimitPerMinute": 10, "messageSizeCap": 8000 },
  { "type": "agentComm", "label": "to-alpha", "protocol": "direct",
    "targetAgentNodeId": "agent-a", "direction": "bidirectional",
    "maxTurns": 5, "maxDepth": 2, "tokenBudget": 50000,
    "rateLimitPerMinute": 10, "messageSizeCap": 8000 }
]
```
```

- [ ] **Step 2: Update AGENTS.md**

Find the section that says "Verify `connectors`, `agentComm`, ... before documenting them as fully implemented" and remove `agentComm` from the unverified list. Add a one-line note: "`agentComm` is wired at runtime as of v1 (see `docs/concepts/agent-comm-node.md`)."

- [ ] **Step 3: Verify spec/plan dates**

Update `docs/concepts/agent-comm-node.md`'s `last-verified` to today's date. Confirm the manifest entry exists; no new entry needed.

- [ ] **Step 4: Commit**

```bash
git add docs/concepts/agent-comm-node.md AGENTS.md README.md
git commit -m "docs(agent-comm): replace stub concept doc; mark agentComm wired at runtime"
```

---

## Self-review checklist

After completing all 16 tasks, re-run:

```bash
npx tsc --noEmit
npx vitest run
```

Manual verification flow:

1. Start dev server: `npm run dev`.
2. Build a 2-agent graph with reciprocal direct comm nodes (default limits).
3. Trigger an exchange that uses `agent_send` and observe:
   - Channel appears under "Peer channels" for both agents
   - Turn count increments
   - Reaching `maxTurns` seals the channel and shows the sealed badge
   - Final-turn assistant text from the receiver lands in the channel transcript
4. Set one comm node to `direction: 'inbound'`; verify outbound `agent_send` returns `direction_violation`.
5. Set `messageSizeCap: 100` and send a long message; verify `message_too_large`.
6. Remove the receiver's reciprocal comm node; verify `topology_violation`.
