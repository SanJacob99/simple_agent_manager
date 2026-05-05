# Agent Comm Node — Design Spec

**Date:** 2026-05-05
**Status:** Draft (pre-implementation)
**Branch:** `feat/agent-comms-node`
**Supersedes:** scaffold in `src/types/nodes.ts#AgentCommNodeData`, `shared/agent-config.ts#ResolvedAgentCommConfig`, `src/utils/graph-to-agent.ts` (currently resolves but is unused at runtime)

## 1. Purpose

Wire the Agent Comm Node from inert scaffold into a working runtime feature. The node enables peer-to-peer messaging between long-lived agents in a graph (distinct from the existing one-shot sub-agent flow), and bundles the safety + loop controls required to keep multi-agent interactions bounded.

This fills a gap in the system: today, an agent can dispatch a one-shot child via `sessions_spawn`, but two long-lived agents in the same graph cannot exchange messages mid-conversation.

## 2. Non-goals

- Pub-sub topics or named channels (deferred; "broadcast" in v1 is fan-out to declared peers, not topic-based)
- Cross-process / cross-host messaging (single SAM server, in-process bus)
- Cycle detection beyond what depth-cap implicitly catches
- Semantic loop detection (message-hash similarity)
- HITL approval gate per outbound message (UI work; SAM HITL registry can be extended later)
- Tool-surface restriction on incoming-message turns (containment)
- Wallclock idle timeout / TTL cleanup of channel-sessions
- Inbound/outbound auto-attachment of comm nodes to sub-agents (sub-agents continue to ignore `agentComm`)

## 3. Interaction model (decided)

| Decision | Choice | Rationale |
|---|---|---|
| When A sends, what happens to B? | **Wake-on-message** | Most useful pattern not already covered by sub-agent (synchronous one-shot) |
| Where does the inbound message land? | **Dedicated channel-session per peer pair** | Clean separation from B's user sessions; per-pair state for limits/audit |
| Does B's reply auto-wake A? | **Symmetric wake with explicit `continue` / `end`** | Conversational flow without infinite-loop footgun; termination is part of the protocol |
| Routing | **Direct + broadcast** (broadcast = fan-out to *declared* peers) | Matches existing scaffold; topology = allowlist |
| Concurrency on a channel | **At most one in-flight run per channel-session** | Reuses run-coordinator queueing |

## 4. Loop controls (v1)

All four are hard numeric ceilings. Each is configured per comm node; pair-wide controls take the **minimum** of the two endpoints' values (most restrictive endpoint defines the contract).

| Control | Scope | Default | Behavior on trip |
|---|---|---|---|
| `maxTurns` | per channel-session (pair) | 10 | Channel auto-ends |
| `maxDepth` | per logical conversation (cascade) | 3 | `agent_send` returns `depth_exceeded` error; channel not sealed |
| `tokenBudget` | per channel-session (pair) | 100_000 | Channel auto-ends |
| `rateLimitPerMinute` | per agent (sender), across all peers | 30 | `agent_send` returns `rate_limited` error; channel not sealed |

**Definitions:**
- **Turn:** one `agent_send` from one agent to another, regardless of `end`. Turns count toward `maxTurns` whether or not they wake the receiver.
- **Depth:** every outbound `agent_send` carries a `depth` integer. The user-initiated run that *first* triggers a comm chain seeds depth = 1. When the receiver's run calls `agent_send`, it stamps `depth = receivedDepth + 1`. Depth is enforced *before* the message is appended.
- **Token budget:** sum of `inputTokens + outputTokens` across all runs scheduled on this channel-session. Read from the existing `RunCoordinator` token-accounting hook.
- **Rate limit:** rolling 60-second window of outbound `agent_send` calls by the sending agent across all its comm channels.

## 5. Safety controls (v1)

| Control | Scope | Default | Behavior |
|---|---|---|---|
| `messageSizeCap` | per comm node (sender side) | 16_000 chars | `agent_send` rejects with `message_too_large` |
| `direction` | per comm node | `bidirectional` | `outbound`: this agent can only send, not receive on this pair. `inbound`: only receive. `bidirectional`: both. |
| Audit log | per channel-session | always on | Every send + every limit trip + every seal is recorded as an event in the channel-session JSONL with `kind: 'agent-comm-audit'` |

**Topology allowlist** is implicit: an agent can only send to peers reachable via at least one connected `agentComm` node whose `targetAgentNodeId` matches. The bus rejects sends to non-declared peers.

**Sender attribution** is server-stamped, not agent-supplied. Agents cannot spoof the `from` field.

## 6. Data model

### 6.1 `AgentCommNodeData` (extended)

```ts
export interface AgentCommNodeData {
  [key: string]: unknown;
  type: 'agentComm';
  label: string;
  targetAgentNodeId: string | null;
  protocol: 'direct' | 'broadcast';
  // NEW — loop controls
  maxTurns: number;             // default 10
  maxDepth: number;             // default 3
  tokenBudget: number;          // default 100_000
  rateLimitPerMinute: number;   // default 30
  // NEW — safety controls
  messageSizeCap: number;       // default 16_000 (chars)
  direction: 'bidirectional' | 'outbound' | 'inbound'; // default 'bidirectional'
}
```

### 6.2 `ResolvedAgentCommConfig` (extended)

Same fields as the node, plus the resolved peer:

```ts
export interface ResolvedAgentCommConfig {
  label: string;
  targetAgentNodeId: string | null;
  protocol: 'direct' | 'broadcast';
  maxTurns: number;
  maxDepth: number;
  tokenBudget: number;
  rateLimitPerMinute: number;
  messageSizeCap: number;
  direction: 'bidirectional' | 'outbound' | 'inbound';
}
```

`graph-to-agent.ts` resolves comm nodes connected to the agent into this array (no change to the collection logic; only the per-entry shape).

### 6.3 Channel-session

A channel-session is a regular `SessionStoreEntry` under the existing `StorageEngine`, with a reserved key shape and extra metadata.

- **Key:** `channel:<lo>:<hi>` where `<lo>` and `<hi>` are the two agent node IDs sorted lexically. Canonicalizes A→B and B→A to the same session.
- **Metadata (new fields on the session record):**
  ```ts
  channelMeta: {
    pair: [string, string];          // sorted [lo, hi]
    turns: number;                   // counter, monotonic
    tokensIn: number;
    tokensOut: number;
    sealed: boolean;
    sealedReason: 'max-turns' | 'token-budget' | 'manual' | null;
    lastActivityAt: string;          // ISO timestamp
  }
  ```
- **Transcript events:** standard `user` / `assistant` / `tool` events, plus a new `kind: 'agent-comm-audit'` event for sends/limit-trips/seals.

### 6.4 Audit event

Error / limit names are shared between tool-result errors and audit events to avoid translation drift.

```ts
type AgentCommErrorCode =
  | 'topology_violation'
  | 'direction_violation'
  | 'message_too_large'
  | 'rate_limited'
  | 'channel_sealed'
  | 'depth_exceeded'
  | 'token_budget_exceeded'
  | 'max_turns_reached'
  | 'internal_error';

type AgentCommAuditEvent = {
  kind: 'agent-comm-audit';
  ts: string;
  event:
    | { type: 'send'; from: string; to: string; depth: number; chars: number; end: boolean }
    | { type: 'limit-tripped'; code: AgentCommErrorCode; from: string; to: string }
    | { type: 'sealed'; reason: 'max_turns_reached' | 'token_budget_exceeded' };
};
```

Manual sealing is out of scope for v1 (no API surface). If added later, a `'manual'` reason would join the `sealed` event.

## 7. Tools exposed to the agent

### 7.0 Identity

Peers are addressed by **agent name** (`AgentNodeData.name`), not node ID. Agent names must be unique within a graph; this is already enforced for sub-agents and is extended to peer comms by the same validation. The bus resolves name → `targetAgentNodeId` via the agent's `agentComm` config; the resolved nodeId determines the channel-session key.

The agent's tool surface is auto-enabled per node:
- `agent_send` enabled iff at least one `direct` comm node is attached
- `agent_broadcast` enabled iff at least one `broadcast` comm node is attached
- `agent_channel_history` enabled iff `agent_send` is enabled

### 7.1 `agent_send`

```ts
{
  to: string,           // literal-union of names from this agent's `direct` comm nodes
  message: string,
  end?: boolean         // default false; true = append-only, do not wake
}
```

**Pre-flight checks (in order):**
1. Topology — `to` must resolve to a peer declared via a `direct` comm node on this agent.
2. Direction — sender's comm node for this peer must allow outbound.
3. Size — `message.length <= messageSizeCap` (sender's setting).
4. Rate limit — sender's outbound count in last 60s < `rateLimitPerMinute` (counted across all peers; broadcasts count once per recipient).
5. Channel state — channel-session not sealed.
6. Depth — `parentDepth + 1 <= min(maxDepth_a, maxDepth_b)`.
7. Token budget — `tokensIn + tokensOut < min(tokenBudget_a, tokenBudget_b)`.
8. Turn count — `turns + 1 <= min(maxTurns_a, maxTurns_b)`.

**On success:** appends a `user`-role event to the channel-session with metadata `{ from: 'agent:<senderName>', depth: N }`, increments `turns`, writes audit event, and (if `!end`) enqueues a run for the receiver on the channel-session.

**On failure:** returns a structured error from `AgentCommErrorCode` (§6.4). Audit log records the trip. If the trip is a "channel-fatal" limit (`max_turns_reached` or `token_budget_exceeded`), the channel is also sealed.

### 7.2 `agent_broadcast`

```ts
{
  message: string,
  end?: boolean
}
```

Fan-out to every peer the agent has a `direct` comm node for. The bus runs §7.1 once per recipient, **with shared per-call rate-limit accounting** (each recipient counts toward `rateLimitPerMinute`). All checks are per-pair. Per-recipient failures are collected into the result; one peer rejecting does not abort the others.

The presence of a `broadcast` comm node attached to the agent is what enables this tool; the broadcast node's `targetAgentNodeId` is unused (kept nullable in the data model for backward compatibility with the existing scaffold). Recipients are derived from the agent's `direct` comm nodes.

Returns:
```ts
{
  results: Array<{ to: string; ok: boolean; error?: AgentCommErrorCode }>
}
```

### 7.3 `agent_channel_history`

```ts
{
  with: string,         // peer agent name
  limit?: number        // default 20, max 100
}
```

Returns the last `limit` transcript events from the A↔B channel-session, oldest-first. Read-only. Does not consume turns.

## 8. Runtime flow

### 8.1 Sender path

```
agent A's run executes assistant turn
  → A's tool call: agent_send({ to: 'B', message: '...', end: false })
  → AgentCommBus.send(from=A, to=B, msg, end=false, parentDepth=A_run.depth)
    → pre-flight checks (§7.1)
    → resolve channel-session 'channel:<lo>:<hi>' via SessionRouter
    → append user event { role: 'user', content: msg, meta: { from: 'agent:A', depth: N } }
    → append audit event { type: 'send', from: A, to: B, depth: N, ... }
    → bump channelMeta.turns, lastActivityAt
    → if !end: RunCoordinator.enqueueRun(channelKey, agent=B, depth=N)
  → tool returns { ok: true, depth: N, turns: T }
```

### 8.2 Receiver path

```
RunCoordinator dequeues run on channel-session
  → builds AgentRuntime for agent B
    - resolves B's AgentConfig (model, tools, system-prompt)
    - augments system prompt with channel-context block:
      "You are in a peer channel-session with agent <senderName>. Use agent_send
      to reply (with end:true to terminate the conversation)."
    - tool list is B's normal tool list (incl. agent_send if B has comm nodes)
    - storage backend is the channel-session, NOT B's user storage
  → run executes; assistant output appended to channel-session
  → if assistant output contains an agent_send tool call → recurse into §8.1
  → run finishes; runtime destroyed
```

### 8.3 Broadcast path

When the agent calls `agent_broadcast({ message, end })`, the bus enumerates the agent's `direct`-protocol peers and runs §8.1 once per peer. Each recipient sees `depth = parentDepth + 1` (the broadcast itself does not add an extra depth level). Rate-limit accounting counts each recipient. All checks are per-pair; one peer rejecting (e.g., size cap, channel sealed) does not abort the others. Per-recipient outcomes are returned to the caller.

### 8.4 Auto-end on limit trip

If `turns + 1 == min(maxTurns_a, maxTurns_b)` after the current send (i.e., this send is the last allowed), the receiver's wake still fires for that turn, and the receiver may reply — but its reply will trip `max_turns_reached` on its own pre-flight. To make the seal explicit and observable:

- The bus computes whether this send is the last allowed (`turns + 1 == max`). If so, after a successful append + run-enqueue, it pre-emptively writes a sealed-pending marker. The receiver's run may complete normally; its outbound `agent_send` will hit the seal cleanly.
- Alternatively (chosen for v1 simplicity): no pre-emption. The receiver's reply trips the limit and seals. The audit log shows the trip; the channel-session has a final `agent-comm-audit { type: 'sealed', reason: 'max-turns' }` event. Downstream UI shows the conversation as ended.

For `tokenBudget`: same treatment. Seal is fired post-trip, and any subsequent send returns `channel_sealed`.

## 9. Component layout

| File | Status | Purpose |
|---|---|---|
| `src/types/nodes.ts#AgentCommNodeData` | extend | Add new fields (§6.1) |
| `src/utils/default-nodes.ts` | extend | Defaults for new fields |
| `src/panels/property-editors/AgentCommProperties.tsx` | extend | UI for new fields (numeric inputs + direction select) |
| `shared/agent-config.ts#ResolvedAgentCommConfig` | extend | New fields (§6.2) |
| `src/utils/graph-to-agent.ts` | tweak | Pass new fields through resolution |
| `server/comms/agent-comm-bus.ts` | **new** | The bus: send(), check(), seal(), audit |
| `server/comms/channel-session.ts` | **new** | Channel-session lifecycle, key canonicalization, metadata |
| `server/tools/builtins/agent-send.ts` | **new** | `agent_send` tool implementation |
| `server/tools/builtins/agent-broadcast.ts` | **new** | `agent_broadcast` tool implementation |
| `server/tools/builtins/agent-channel-history.ts` | **new** | `agent_channel_history` tool |
| `server/tools/tool-factory.ts` | tweak | Auto-enable comm tools per §7.0 |
| `server/agents/run-coordinator.ts` | tweak | Channel-session run dispatch (no concurrency overlap per channel) |
| `server/sessions/session-router.ts` | tweak | Recognize `channel:` keys; route to comm flow |
| `server/runtime/agent-runtime.ts` | tweak | When run is on a channel-session, append channel-context system prompt block |
| `src/store/session-store.ts` | tweak | Surface peer-channel sessions per agent |
| `src/components/...` (chat drawer / sidebar) | tweak | Read-only "Peer channels" section under each agent |
| `docs/concepts/agent-comm-node.md` | rewrite | Replace "Not yet implemented at runtime" copy |

## 10. Defaults (workspace-level)

Added to `src/settings/` so users can change defaults globally; new comm nodes inherit these on creation. Existing comm nodes already in graphs at upgrade time are migrated by filling missing fields with the v1 defaults during config resolution (graceful upgrade — no migration script needed).

| Setting | Default |
|---|---|
| `agentComm.defaultMaxTurns` | 10 |
| `agentComm.defaultMaxDepth` | 3 |
| `agentComm.defaultTokenBudget` | 100_000 |
| `agentComm.defaultRateLimitPerMinute` | 30 |
| `agentComm.defaultMessageSizeCap` | 16_000 |
| `agentComm.defaultDirection` | `bidirectional` |

## 11. Failure modes & recovery

| Failure | Behavior |
|---|---|
| Sender agent calls `agent_send` to non-peer | Tool returns `topology_violation`. No state change. |
| Channel sealed mid-conversation | Tool returns `channel_sealed`. Sender may reason about why and stop. |
| Receiver's run fails mid-execution | Run-coordinator marks the run errored; channel is *not* sealed. Sender may attempt another send. |
| Storage write fails | Bus returns `internal_error`; turn counter NOT incremented. Idempotent on retry. |
| Two senders race a send to same channel | Run-coordinator queues; second send appends after first run completes (no concurrent run on a channel). |
| User starts a new run on agent A while A is mid-send-to-B | Independent: A's user-session run and A's outbound send are separate; user run waits for A's slot per existing run-coordinator semantics. Channel-session enqueue does not block A's user-session run. |

## 12. Testing

Functional tests should cover:

1. Direct send wakes receiver, receiver replies, A wakes again — full round trip.
2. `end: true` does not wake receiver; channel remains usable.
3. Each loop control (`maxTurns`, `maxDepth`, `tokenBudget`, `rateLimitPerMinute`) trips at the expected boundary.
4. Each safety control (`messageSizeCap`, `direction`, topology) rejects out-of-policy sends.
5. Pair-symmetric controls take the minimum across endpoints.
6. Broadcast fan-out: declared peers receive; non-declared do not; one peer's rejection does not abort the others.
7. Concurrency: two simultaneous sends to the same channel serialize correctly.
8. Channel-session sealing is durable across server restart (state restored from `StorageEngine`).
9. Auto-enable of `agent_send` only when `agentComm.length > 0`.
10. Sub-agents do not receive `agent_send` even if the parent declares peers.

## 13. Out-of-scope / v2 backlog

- Cycle detection (A→B→A within depth chain) with auto-end or HITL prompt
- HITL approval gate per outbound message (extend SAM HITL registry)
- Topic / pub-sub routing
- Tool-surface restriction on incoming-message turns
- Semantic loop detection
- Wallclock idle timeout / channel TTL cleanup
- Cross-process / federated comm (e.g., A2A protocol bridge)
- "Referee" / supervisor agent that can force-seal channels

## 14. Documentation

After implementation, update:

- `docs/concepts/agent-comm-node.md` — replace stub copy; document new fields, tools, runtime behavior, limit-tripping, channel-session storage. Bump `last-verified`.
- `docs/concepts/_manifest.json` — no change (entry already exists).
- `README.md` — mention peer comms in the multi-agent section if not already.
- `CLAUDE.md` — note that `agentComm` is now wired at runtime (current text says "verify before documenting").
