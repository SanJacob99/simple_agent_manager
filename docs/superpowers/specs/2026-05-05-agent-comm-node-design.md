# Agent Comm Node - Design Spec

**Date:** 2026-05-05
**Status:** Draft (pre-implementation)
**Branch:** `feat/agent-comms-node`
**Supersedes:** scaffold in `src/types/nodes.ts#AgentCommNodeData`, `shared/agent-config.ts#ResolvedAgentCommConfig`, `src/utils/graph-to-agent.ts` (currently resolves but is unused at runtime)

## 1. Purpose

Wire the Agent Comm Node from inert scaffold into a working runtime feature. The node enables peer-to-peer messaging between long-lived agents in a graph (distinct from the existing one-shot sub-agent flow), and bundles the safety and loop controls required to keep multi-agent interactions bounded.

This fills a gap in the system: today, an agent can dispatch a one-shot child via `sessions_spawn`, but two long-lived top-level agents in the same graph cannot exchange messages mid-conversation.

## 2. Non-goals

- Pub-sub topics or named channels (deferred; "broadcast" in v1 is fan-out to declared peers, not topic-based)
- Cross-process / cross-host messaging (single SAM server, in-process bus)
- Cross-graph peer communication
- Auto-starting stopped peer agents from persisted configs
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
| Where does the inbound message land? | **Dedicated channel-session per peer pair** | Clean separation from both agents' user sessions; per-pair state for limits/audit |
| Who owns channel storage? | **AgentCommBus-owned channel store** | Existing `SessionRouter` and `StorageEngine` are scoped to one agent; the bus needs a pair-level store/facade |
| Does B's reply auto-wake A? | **Symmetric wake with explicit `continue` / `end`** | Conversational flow with explicit termination |
| Routing | **Reciprocal direct contracts + broadcast fan-out** | Topology is an allowlist, and both endpoints must define their side of the contract |
| Concurrency on a channel | **Bus-owned channel scheduler** | Per-agent `RunCoordinator` queues do not coordinate across agents; the bus serializes channel runs and channel writes |

## 4. Loop controls (v1)

All four controls are hard numeric ceilings. Each is configured per comm node; pair-wide controls take the **minimum** of the two reciprocal endpoint values (the most restrictive endpoint defines the contract).

| Control | Scope | Default | Behavior on trip |
|---|---|---|---|
| `maxTurns` | per channel-session (pair) | 10 | Channel seals |
| `maxDepth` | per logical conversation (cascade) | 3 | `agent_send` returns `depth_exceeded`; channel not sealed |
| `tokenBudget` | per channel-session (pair) | 100_000 | Channel seals |
| `rateLimitPerMinute` | per agent (sender), across all peers | 30 | `agent_send` returns `rate_limited`; channel not sealed |

**Definitions:**

- **Turn:** one accepted `agent_send` from one agent to another, regardless of `end`. Turns count toward `maxTurns` whether or not they wake the receiver.
- **Depth:** every outbound `agent_send` carries a `depth` integer. A normal user-initiated run has `commDepth = 0`; the first send in a comm chain uses `depth = 1`. When a receiver's channel run calls `agent_send`, it stamps `depth = currentRun.commDepth + 1`. Depth is enforced before the message is appended.
- **Token budget:** `channelMeta.tokensIn + channelMeta.tokensOut`, updated from provider-reported usage after every channel run. Pre-flight checks use the latest persisted totals; post-run accounting seals the channel when totals reach or exceed the pair budget.
- **Rate limit:** rolling 60-second in-memory window of accepted outbound `agent_send` calls by the sending agent across all comm channels. The enforced pair value is `min(sender.rateLimitPerMinute, receiver.rateLimitPerMinute)`. Broadcasts count once per recipient. The counter resets on server restart in v1.

## 5. Safety controls (v1)

| Control | Scope | Default | Behavior |
|---|---|---|---|
| `messageSizeCap` | per comm node (sender side) | 16_000 chars | `agent_send` rejects with `message_too_large` |
| `direction` | per comm node | `bidirectional` | `outbound`: can send but not receive. `inbound`: can receive but not send. `bidirectional`: both. |
| Audit log | per channel-session | always on | Every accepted send, every limit trip, wake cancellation, and every seal is recorded as `kind: 'agent-comm-audit'` |

**Topology allowlist:** direct messaging requires a reciprocal pair contract:

- Sender has a connected `agentComm` node with `protocol: 'direct'` and `targetAgentNodeId` set to the receiver.
- Receiver has a connected `agentComm` node with `protocol: 'direct'` and `targetAgentNodeId` set to the sender.
- Sender's node must allow outbound (`direction !== 'inbound'`).
- Receiver's node must allow inbound (`direction !== 'outbound'`).

This makes endpoint-min controls and receiver-side direction meaningful. A one-sided direct comm node is an incomplete contract and is rejected at runtime as `topology_violation` (and should be surfaced as a graph validation warning).

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

  // Loop controls
  maxTurns: number;             // default 10
  maxDepth: number;             // default 3
  tokenBudget: number;          // default 100_000
  rateLimitPerMinute: number;   // default 30

  // Safety controls
  messageSizeCap: number;       // default 16_000 (chars)
  direction: 'bidirectional' | 'outbound' | 'inbound'; // default 'bidirectional'
}
```

### 6.2 `ResolvedAgentCommConfig` (extended)

`graph-to-agent.ts` resolves comm nodes connected to the agent into this array. The resolved peer name is stored so the server can expose literal-union tool schemas without needing the original graph.

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

Resolution fills missing v1 fields with defaults for graceful upgrade of existing graphs. Duplicate direct comm nodes from the same agent to the same target should be rejected by graph validation; as a defensive fallback, the bus treats duplicates as one endpoint and applies the most restrictive limits.

### 6.3 Pair contract

The bus derives a pair contract at send time from the sender's config and the receiver's config.

```ts
interface AgentCommPairContract {
  sender: ResolvedAgentCommConfig;
  receiver: ResolvedAgentCommConfig;
  limits: {
    maxTurns: number;
    maxDepth: number;
    tokenBudget: number;
    rateLimitPerMinute: number; // min(sender, receiver)
  };
}
```

No contract is formed unless both endpoint configs contain reciprocal `direct` entries. Broadcast nodes do not form pair contracts; they only enable the `agent_broadcast` tool.

### 6.4 Channel-session

A channel-session uses the same JSONL transcript format as normal sessions, but it is **not** routed through either endpoint's normal `SessionRouter`. The `AgentCommBus` owns a `ChannelSessionStore` facade that performs pair-level reads/writes and hides channel sessions from ordinary chat session lists.

- **Key:** `channel:<lo>:<hi>` where `<lo>` and `<hi>` are the two agent node IDs sorted lexically. This canonicalizes A->B and B->A to the same channel.
- **Storage owner:** the canonical owner is `<lo>`. The channel entry is persisted in `<lo>`'s configured `StorageEngine`, but all access goes through `ChannelSessionStore`, not through endpoint `SessionRouter.getStatus()` or `SessionRouter.listSessions()`. This keeps the channel durable without pretending it belongs to only one user-facing agent session.
- **Availability:** both endpoints must be managed by the current `AgentManager` process for a wake to run. If the receiver is not started, `agent_send` returns `receiver_unavailable` and no channel state changes.
- **Session entry:** `SessionStoreEntry.agentId` remains the owner agent id (`lo`) for storage compatibility; `channelMeta` is the source of truth for participants.

```ts
interface ChannelSessionMeta {
  pair: [string, string];              // sorted [lo, hi] agent node IDs
  pairNames: [string, string];         // sorted in the same order as pair
  ownerAgentId: string;                // lo
  turns: number;                       // accepted sends, monotonic
  tokensIn: number;
  tokensOut: number;
  sealed: boolean;
  sealedReason:
    | 'max_turns_reached'
    | 'token_budget_exceeded'
    | 'manual'
    | null;
  lastActivityAt: string;              // ISO timestamp
}
```

`SessionStoreEntry` gains:

```ts
channelMeta?: ChannelSessionMeta;
```

Endpoint session routes should filter out entries with `channelMeta` unless explicitly serving a peer-channel API.

### 6.5 Audit event

Error / limit names are shared between tool-result errors and audit events to avoid translation drift.

```ts
type AgentCommErrorCode =
  | 'topology_violation'
  | 'direction_violation'
  | 'message_too_large'
  | 'rate_limited'
  | 'receiver_unavailable'
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
    | { type: 'wake-cancelled'; code: AgentCommErrorCode; from: string; to: string; depth: number }
    | { type: 'sealed'; reason: 'max_turns_reached' | 'token_budget_exceeded' | 'manual' };
};
```

Manual sealing is out of scope for v1 (no API surface), but the data model reserves the reason.

## 7. Tools exposed to the agent

### 7.0 Identity and injection

Peers are addressed by **agent name** (`AgentNodeData.name`), not node ID. Agent names are already immutable and unique in the graph UI, and peer comm validation should also reject imported or SAM-agent-generated graphs that violate uniqueness.

The comm tool surface is **per-run injected by `RunCoordinator`**, similar to session/sub-agent tools. It is not created as a static `tool-factory` builtin because execution needs the current run id, current channel depth, channel key, sender identity, `AgentCommBus`, and abort signal.

The agent's tool surface is auto-enabled per node:

- `agent_send` enabled iff at least one `direct` comm node is attached.
- `agent_broadcast` enabled iff at least one `broadcast` comm node is attached.
- `agent_channel_history` enabled iff `agent_send` is enabled.

Tool schemas expose literal unions of peer names from the sender's resolved direct comm entries. Runtime execution still enforces reciprocal topology, direction, receiver availability, and current limits.

### 7.1 `agent_send`

```ts
{
  to: string,           // literal-union of names from this agent's direct comm nodes
  message: string,
  end?: boolean         // default false; true = append-only, do not wake
}
```

**Pre-flight checks (in order):**

1. Topology - `to` must resolve to a managed peer and a reciprocal direct pair contract.
2. Direction - sender endpoint allows outbound and receiver endpoint allows inbound.
3. Size - `message.length <= sender.messageSizeCap`.
4. Rate limit - sender's accepted outbound count in last 60s is below the pair's `rateLimitPerMinute`.
5. Channel state - channel-session is not sealed.
6. Depth - `currentRun.commDepth + 1 <= min(maxDepth_a, maxDepth_b)`.
7. Token budget - `tokensIn + tokensOut < min(tokenBudget_a, tokenBudget_b)`.
8. Turn count - `turns + 1 <= min(maxTurns_a, maxTurns_b)`.

**On success:** under the channel mutation lock, appends a `user`-role message to the channel-session with metadata:

```ts
{
  from: 'agent:<senderName>',
  fromAgentId: '<senderNodeId>',
  to: 'agent:<receiverName>',
  toAgentId: '<receiverNodeId>',
  depth: N,
  channelKey: 'channel:<lo>:<hi>'
}
```

The bus increments `channelMeta.turns`, writes a `send` audit event, and, if `!end`, enqueues a channel wake for the receiver. The wake runs only when the bus channel scheduler marks the channel idle.

**On failure:** returns a structured error from `AgentCommErrorCode` and does not append the message. If a channel key is derivable, the audit log records the trip. If the trip is a channel-fatal limit (`max_turns_reached` or `token_budget_exceeded`), the channel is also sealed.

Return shape:

```ts
{
  ok: true,
  depth: number,
  turns: number,
  queuedWake: boolean
}
```

or:

```ts
{
  ok: false,
  error: AgentCommErrorCode
}
```

### 7.2 `agent_broadcast`

```ts
{
  message: string,
  end?: boolean
}
```

Fan-out to every peer that forms a valid reciprocal direct pair contract with the sender. The presence of a `broadcast` comm node attached to the agent enables this tool; the broadcast node's `targetAgentNodeId` is unused and kept nullable for backward compatibility with the existing scaffold.

The bus runs the `agent_send` pre-flight and append path once per recipient in stable peer-name order. Rate-limit accounting counts each successful recipient. Per-recipient failures are collected into the result; one peer rejecting does not abort the others.

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

Returns the last `limit` transcript events from the A<->B channel-session, oldest-first. Read-only. Does not consume turns. It reads through `ChannelSessionStore`, not through either endpoint's normal session router.

## 8. Runtime flow

### 8.0 Bus scheduling model

`AgentCommBus` is a singleton owned by `AgentManager`. On agent start/destroy, `AgentManager` registers/unregisters the managed agent config, coordinator, runtime factory dependencies, and storage handle with the bus.

The bus owns two pieces of channel coordination:

- **Channel mutation lock:** a short mutex around pre-flight state reads, message append, audit append, and `channelMeta` updates.
- **Channel scheduler:** a per-channel FIFO wake queue plus `activeRunId`. At most one channel run executes for a channel at a time.

Normal sends from outside the currently active channel run wait for the channel scheduler to become idle before they pre-flight and append. Sends made by the currently active channel run are allowed as reentrant sends; their receiver wake is queued and starts only after the current run ends. This preserves the conversational ping-pong while preventing unrelated concurrent runs from interleaving writes or using stale token/turn state.

All waits are abort-aware. If the caller's run is aborted while waiting for the channel gate, the tool returns `internal_error` with an abort-oriented message and no state change.

### 8.1 Sender path

```text
agent A's run executes assistant turn
  -> A's injected tool call: agent_send({ to: 'B', message: '...', end: false })
  -> AgentCommBus.send(from=A, to=B, msg, end=false, currentRun)
    -> wait for channel gate if needed
    -> resolve reciprocal pair contract
    -> acquire channel mutation lock
    -> pre-flight checks
    -> append user message with server-stamped attribution/depth
    -> append audit event { type: 'send', from: A, to: B, depth: N, ... }
    -> bump channelMeta.turns, lastActivityAt
    -> if !end: enqueue wake(receiver=B, depth=N)
    -> if this send reaches maxTurns, seal after the accepted wake decision
  -> tool returns { ok: true, depth: N, turns: T, queuedWake: !end }
```

If the send reaches `maxTurns`, the accepted message remains in the transcript. A wake for that message may still run, but any reply will fail with `channel_sealed`.

### 8.2 Receiver path

```text
AgentCommBus channel scheduler starts next wake
  -> calls RunCoordinator.dispatchChannel({ channelKey, receiver=B, peer=A, depth=N })
  -> RunCoordinator opens the channel transcript through ChannelSessionStore
  -> runtime session context is built from the channel transcript, including
     the already-appended inbound user message
  -> RunCoordinator injects comm tools with currentRun.commDepth = N
  -> runtime system prompt gets a channel-context block:
     "You are in a peer channel-session with agent <peerName>. Use agent_send
     to reply. Use end:true when you are intentionally ending the exchange."
  -> if the inbound message reached maxTurns (the channel is now sealed),
     the channel-context block also includes a final-turn notice:
     "NOTE: this channel is sealed. Any agent_send call will be rejected with
     channel_sealed. Reply with normal assistant text only -- it is persisted
     to the channel transcript and the peer can read it via
     agent_channel_history. Do not call agent_send."
  -> AgentRuntime runs a channel-continuation prompt without appending
     another user message
  -> assistant/tool messages are persisted to the channel transcript with
     agent attribution metadata
  -> provider usage is reported to AgentCommBus
  -> bus updates channelMeta.tokensIn/tokensOut and seals if token budget
     is now reached or exceeded
  -> bus releases the active channel run and starts the next queued wake
```

This requires a small channel-mode extension to `RunCoordinator` and `AgentRuntime`; reusing ordinary `dispatch({ text })` would duplicate the inbound user message because the bus already persisted it.

The receiver's tool list is its normal tool list plus injected comm tools if its config qualifies. The storage backend for transcript/context is the channel-session, not B's user session.

### 8.3 Broadcast path

When the agent calls `agent_broadcast({ message, end })`, the bus enumerates valid reciprocal direct peers and runs the `agent_send` path once per peer. Each recipient sees `depth = currentRun.commDepth + 1`; the broadcast itself does not add an extra depth level. Rate-limit accounting counts each successful recipient. All checks are per-pair; one peer rejecting does not abort the others.

### 8.4 Auto-seal behavior

`maxTurns`:

- If `turns + 1 > maxTurns`, reject with `max_turns_reached` and seal.
- If `turns + 1 == maxTurns`, accept and append the send, then seal the channel with `max_turns_reached`.
- A wake already accepted for the max-turn message may run, but no future send can be accepted.

`tokenBudget`:

- Before append, if `tokensIn + tokensOut >= tokenBudget`, reject with `token_budget_exceeded` and seal.
- After every channel run, add provider-reported usage to `channelMeta.tokensIn/tokensOut`.
- If post-run totals reach or exceed the budget, seal with `token_budget_exceeded`.
- If sealing happens while wakes are queued but not started, cancel those wakes and write `wake-cancelled` audit events. The messages remain in the transcript as accepted sends; they simply do not wake another model turn after the budget is exhausted.

## 9. Component layout

| File | Status | Purpose |
|---|---|---|
| `src/types/nodes.ts#AgentCommNodeData` | extend | Add new fields (section 6.1) |
| `src/utils/default-nodes.ts` | extend | Defaults for new fields |
| `src/panels/property-editors/AgentCommProperties.tsx` | extend | UI for new fields (numeric inputs + direction select) |
| `shared/agent-config.ts#ResolvedAgentCommConfig` | extend | New fields, including `commNodeId` and `targetAgentName` |
| `src/utils/graph-to-agent.ts` | tweak | Pass new fields through resolution; fill graceful defaults |
| `src/utils/graph-to-agent.ts` or validation helper | tweak | Warn/reject duplicate direct comm nodes and incomplete reciprocal pairs |
| `shared/storage-types.ts` | extend | Add `channelMeta?: ChannelSessionMeta` |
| `shared/run-types.ts` | extend | Add server-side channel dispatch metadata types (not exposed over WS) |
| `server/agents/agent-manager.ts` | tweak | Own/register singleton `AgentCommBus`; register agents on start/destroy |
| `server/comms/agent-comm-types.ts` | new | Error codes, audit events, channel metadata |
| `server/comms/agent-comm-bus.ts` | new | Pair contract resolution, send(), broadcast(), rate limits, audit/seal |
| `server/comms/channel-session-store.ts` | new | Channel key canonicalization and transcript/session metadata persistence |
| `server/comms/channel-run-queue.ts` | new | Per-channel scheduler, active-run tracking, queued wakes |
| `server/comms/agent-comm-tools.ts` | new | Per-run injected `agent_send`, `agent_broadcast`, `agent_channel_history` tools |
| `server/agents/run-coordinator.ts` | tweak | Inject comm tools; add `dispatchChannel`; report channel run usage to bus |
| `server/runtime/agent-runtime.ts` | tweak | Add channel-continuation prompt path and channel-context system prompt append |
| `server/sessions/session-router.ts` | tweak | Filter `channelMeta` entries from normal user session listing/status paths |
| `src/store/session-store.ts` | tweak | Surface peer-channel sessions via a dedicated channel API, not normal chat session list |
| `src/components/...` (chat drawer / sidebar) | tweak | Read-only "Peer channels" section under each agent |
| `docs/concepts/agent-comm-node.md` | rewrite | Replace "Not yet implemented at runtime" copy |

## 10. Defaults (workspace-level)

Added to `src/settings/` so users can change defaults globally; new comm nodes inherit these on creation. Existing comm nodes already in graphs at upgrade time are migrated by filling missing fields with the v1 defaults during config resolution (graceful upgrade - no migration script needed).

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
| Sender calls `agent_send` to non-peer or one-sided peer | Tool returns `topology_violation`. No message append. |
| Sender/receiver direction disallows the send | Tool returns `direction_violation`. No message append. |
| Receiver agent is not started/managed | Tool returns `receiver_unavailable`. No message append. |
| Channel sealed mid-conversation | Tool returns `channel_sealed`. Sender may reason about why and stop. |
| Receiver's run fails mid-execution | Run-coordinator marks the run errored; channel is not sealed unless a limit independently trips. Sender may attempt another send. |
| Storage write fails before append | Bus returns `internal_error`; turn counter is not incremented. |
| Storage write fails after append but before wake enqueue | Bus writes an audit failure if possible and returns `internal_error`; recovery may require manual inspection of the channel transcript. |
| Two non-active senders race a send to same channel | Bus channel gate serializes them; the second pre-flights and appends only after the active channel run/write finishes. |
| Active channel run sends a reply | Reentrant send is accepted if limits allow; the reply wake is queued and starts after the active run finishes. |
| Post-run token accounting seals the channel | Bus cancels not-yet-started wakes and records `wake-cancelled`; accepted transcript messages remain for audit. |
| User starts a new run on agent A while A has a queued peer wake | A's normal run and the peer wake both go through A's `RunCoordinator`; channel ordering is still controlled by the bus scheduler. |
| Owner agent (`<lo>`) is removed from the graph but `<hi>` is not | Channel is orphaned: its transcript and `channelMeta` remain in `<lo>`'s former `StorageEngine` location, but no managed `<lo>` exists to send/receive. Any send from `<hi>` returns `receiver_unavailable`. v1: manual cleanup; the peer-channel UI may surface orphans for explicit deletion. v2: garbage-collect on agent removal. |

## 12. Testing

Functional tests should cover:

1. Direct send wakes receiver, receiver replies, A wakes again - full round trip.
2. `end: true` appends without waking receiver; channel remains usable if not sealed.
3. Each loop control (`maxTurns`, `maxDepth`, `tokenBudget`, `rateLimitPerMinute`) trips at the expected boundary.
4. Each safety control (`messageSizeCap`, `direction`, topology, receiver availability) rejects out-of-policy sends.
5. Pair-symmetric controls take the minimum across reciprocal endpoints.
6. One-sided direct comm nodes do not form a runtime contract.
7. Broadcast fan-out: valid reciprocal peers receive; invalid/non-declared peers do not; one peer's rejection does not abort the others.
8. Concurrency: two simultaneous non-active sends to the same channel serialize correctly.
9. Reentrant reply from an active channel run queues the next wake and does not deadlock.
10. Channel-session sealing and `channelMeta` are durable across server restart.
11. Channel runs do not duplicate the inbound user message.
12. Channel sessions are hidden from normal chat session lists and visible through peer-channel UI/API.
13. Auto-enable of `agent_send` only when direct comm nodes exist; execution still rejects incomplete reciprocal contracts.
14. Sub-agents do not receive `agent_send` even if the parent declares peers.

## 13. Out-of-scope / v2 backlog

- Auto-starting stopped peer agents from persisted configs
- Cycle detection (A->B->A within depth chain) with auto-end or HITL prompt
- HITL approval gate per outbound message (extend SAM HITL registry)
- Topic / pub-sub routing
- Tool-surface restriction on incoming-message turns
- Semantic loop detection
- Wallclock idle timeout / channel TTL cleanup
- Cross-process / federated comm (e.g., A2A protocol bridge)
- "Referee" / supervisor agent that can force-seal channels

## 14. Documentation

After implementation, update:

- `docs/concepts/agent-comm-node.md` - replace stub copy; document new fields, tools, runtime behavior, limit-tripping, channel-session storage. Bump `last-verified`.
- `docs/concepts/_manifest.json` - no change (entry already exists).
- `README.md` - mention peer comms in the multi-agent section if not already.
- `AGENTS.md` - note that `agentComm` is now wired at runtime (current text says "verify before documenting").
