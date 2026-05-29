# Section 6B — Backend: Context, Memory, Hooks, Sub-Agents, Comms

<!-- last-verified: 2026-05-08 -->

## Scope

This section covers the backend subsystems that sit alongside the agent run loop but are owned by other modules. Specifically:

- Context engine: token-budget enforcement, compaction, image-stripping (`server/runtime/context-engine.ts`).
- Memory engine: long-term + session memory and the memory tools surface (`server/runtime/memory-engine.ts`).
- Payload accounting: per-section token breakdown for the context-usage panel (`server/runtime/payload-breakdown.ts`).
- Hooks subsystem: hook types, registry, internal/built-in hooks, plugin loader (`server/hooks/*`).
- Sub-agents: synthetic-config builder, executor, registry, sub-session keys (`server/agents/sub-agent-*.ts`).
- Agent-to-agent comms: bus, tool surface, channel store / queue / context prompt (`server/comms/*`) and the front-of-house REST routes (`server/routes/agent-channels.ts`).
- Connections: webhook + WebSocket front-end attachment points (`server/connections/*`).
- Scheduling: cron + maintenance schedulers (`server/scheduling/*`).

Out of scope (covered elsewhere): run coordinator and `AgentRuntime` turn loop (Section 6A); storage, sessions, tools, REST surface generally (Sections 7A/7B).

## Context Engine (`server/runtime/context-engine.ts`)

### Responsibilities

- Strip stale tool-result image blocks beyond `KEEP_RECENT_IMAGE_TOOL_RESULTS = 2` to stop base64 bytes re-traveling on every turn.
- Enforce the per-turn token budget = `tokenBudget - reservedForResponse`.
- Run reactive compaction when assembled tokens exceed budget and proactive compaction in the after-turn hook.
- Persist a `branch_summary` entry into the active session via `SessionManager.appendCompaction()` whenever compaction trims messages.

### Compaction strategies

Implemented in `compact()` (lines 143-231). The strategy is taken from `ResolvedContextEngineConfig.compactionStrategy`:

| Strategy | Behavior |
|----------|----------|
| `trim-oldest` | Drops oldest messages one at a time until total tokens fall under the post-compaction target. Always keeps at least 2 messages. |
| `sliding-window` | Same in code as `trim-oldest` (also slices from the front). The textual difference is only in the persisted compaction summary. |
| `summary` | Keeps the last `max(4, floor(0.3 * len))` messages (further trimmed if that tail still exceeds target), summarizes everything before by joining truncated `role: content` lines, and prepends a synthetic user message containing the summary. |

The `target` post-compaction size is `min(postCompactionTokenTarget, budget)` clamped above 512, defaulting to `budget` when not set.

### Proactive trigger (`afterTurn`)

`resolveProactiveTriggerTokens()` (lines 264-276):

- `compactionTrigger === 'auto'` → fires at `0.8 * budget`.
- `compactionTrigger === 'threshold'` → fires at `compactionThreshold * budget` clamped to `[0, 1]`.
- Otherwise (e.g., `manual`) → returns 0, never fires from the after-turn hook. The `Compact Now` UI button is the only path.

The reactive `assemble()` overflow check (`tokens > budget`) remains as the safety net.

### Public API & call sites

| Method | Used by |
|--------|---------|
| `setActiveSession(sessionManager, onCompaction)` / `clearActiveSession()` | `AgentRuntime` per-run before/after dispatch. |
| `assemble(messages)` | Returns `{ messages, estimatedTokens }`. Used by `buildTransformContext()`. |
| `compact(messages)` | Direct invocation for the manual "Compact Now" path. |
| `afterTurn(messages)` | Called by runtime after each model turn. |
| `buildTransformContext()` | Returns a `(messages, signal?) => Promise<AgentMessage[]>` adapter passed to `pi-agent-core` Agent. |

### Edge cases & failure modes

- `persistCompaction` no-ops if no active session is set or no first-kept entry id can be resolved (e.g., empty branch).
- Image stripping never mutates the original messages array; callers receive a shallow copy.
- Image preservation walks newest-first and keeps the first `keepRecent` (=2) tool-result messages with images intact; older ones are rewritten to `[screenshot ... removed from context ...]` text blocks. Saved-path links are preserved when present.

## Memory Engine (`server/runtime/memory-engine.ts`)

### Backends

Only an in-memory backend is implemented as of this writing:

- `longTermStore: Map<string, MemoryEntry>` — keyword-substring search, sorted by recency, capped at 10 results.
- `sessionMessages: Map<sessionId, Array<{role, content, timestamp}>>` — trimmed to `config.maxSessionMessages`.

The class doc-comment mentions optional IndexedDB persistence and external/cloud REST backends, but neither is wired. Treat any non-builtin backend as TBD.

### Memory tools exposed

`createMemoryTools()` (lines 133-192) returns a list filtered by config flags. Each tool's parameters are TypeBox-defined:

| Tool | Gate | Parameters | Behavior |
|------|------|------------|----------|
| `memory_search` | `exposeMemorySearch` | `{ query: string }` | Returns up to 10 entries matching `query` substring (case-insensitive), formatted `[key] content` joined with `---`. |
| `memory_get` | `exposeMemoryGet` | `{ key: string }` | Returns `[key] content` or "No memory entry found with key: ...". |
| `memory_save` | `exposeMemorySave` | `{ key: string, content: string }` | Overwrites by key; replies "Saved memory entry: <key>". |

Note: there are no `recall_memory`, `save_memory`, `daily_memory_*`, or `parent_fork_*` tools in this file. The CLAUDE.md test-plan template names like "save_memory / recall_memory" do not match the actual tool names.

### Daily memory & daily reset

Not implemented in `memory-engine.ts`. The class has no daily reset, idle reset, or parent-fork machinery. Flag any test that assumes those as **out of scope or unimplemented** — verify against `ResolvedMemoryConfig` in `shared/agent-config.ts` before authoring scenarios that depend on these features.

### Idle reset

Not implemented. Same caveat as above.

### Parent-fork max tokens

Not implemented in `memory-engine.ts`. Sub-agents synthesize their own AgentConfig in `sub-agent-executor.ts` with `memory: null`, so parent-memory-fork as a backend feature is not present today.

### File layout on disk

The builtin backend is purely in-memory (`Map`s). No disk persistence in this file; persistence (if any) would be in the surrounding storage engine.

### Compaction (engine-internal)

The memory engine has its own `compact()` (lines 86-129) operating on plain `{role, content}[]` arrays — separate from `ContextEngine.compact()`. Strategies: `sliding-window` (keep tail) and `summary` (keep tail + prepend synthetic system summary). Returns `{ compacted, summary }`. Wiring for this is unclear from this file alone; do not assume it runs unless the run loop calls it.

### Edge cases

- `searchLongTerm` does only substring matching, not relevance ranking — sort is by recency.
- `saveSessionMessage` trims oldest first when over `maxSessionMessages`, no compaction.

## Payload Breakdown (`server/runtime/payload-breakdown.ts`)

### Components reported

`estimatePayloadBreakdown(payload, skillInputs)` returns a `PayloadBreakdown` with:

- `total` — sum of the four buckets below.
- `systemPrompt` — `estimateTokens(systemText) - skills` (skills are folded into the system prompt at assembly time).
- `skills` — sum of per-skill content tokens.
- `tools` — sum of per-tool stringified-JSON tokens (includes schema, description, provider wrapping).
- `messages` — `estimateTokens(JSON.stringify(remainingMessages))`.
- `skillsEntries` and `toolsEntries` — per-item arrays sorted desc by tokens, used by the context-usage panel.

`extractSystemAndMessages` handles three payload shapes:

- Anthropic: top-level `system` (string or array of `{text}` blocks).
- Pi-core in-state: top-level `systemPrompt`.
- OpenAI-compatible: `messages` with `role: 'system' | 'developer'` plucked out.

### Used by

Wired into the context-usage panel and the run-payload introspection. Confirm exact callers in the runtime; this file exports the function but does not register itself anywhere.

## Hooks Subsystem

### Hook types (`server/hooks/hook-types.ts`)

Two tiers — fully wired vs scaffolded.

**Fully wired core hooks**:

| Constant | Name | When fires | Context fields |
|----------|------|------------|----------------|
| `BEFORE_MODEL_RESOLVE` | `before_model_resolve` | After session resolution, before model is used. | `agentId, runId, sessionId, config, overrides:{provider?, modelId?}` |
| `BEFORE_PROMPT_BUILD` | `before_prompt_build` | After session load, before system prompt is finalized. | `... messages, overrides:{prependContext?, systemPrompt?, prependSystemContext?, appendSystemContext?}` |
| `BEFORE_AGENT_REPLY` | `before_agent_reply` | Before first LLM call; plugin can claim the turn. | `... messages, claimed, syntheticReply?, silent` |
| `BEFORE_TOOL_CALL` | `before_tool_call` | Before each tool execution. | `agentId, runId, toolCallId, toolName, params, blocked, blockReason?` |
| `AFTER_TOOL_CALL` | `after_tool_call` | After each tool execution. | `... result, isError, transformedResult?` |
| `AGENT_END` | `agent_end` | After a run completes (success or error); read-only. | `... status, payloads, usage?, error?` |

**Scaffolded (types only, integration deferred)**:

| Constant | Name | Purpose |
|----------|------|---------|
| `TOOL_RESULT_PERSIST` | `tool_result_persist` | Sync-transform tool results before transcript persistence. |
| `BEFORE_COMPACTION` / `AFTER_COMPACTION` | `before_compaction` / `after_compaction` | Around compaction cycles. |
| `BEFORE_INSTALL` | `before_install` | Before skill/plugin install; can block. |
| `MESSAGE_RECEIVED` | `message_received` | On dispatch, after validation, before queuing. |
| `MESSAGE_SENDING` | `message_sending` | Before reply emitted to frontend. |
| `MESSAGE_SENT` | `message_sent` | After reply broadcast; read-only. |
| `SESSION_START` / `SESSION_END` | `session_start` / `session_end` | Session lifecycle boundaries. |
| `BACKEND_START` / `BACKEND_STOP` | `backend_start` / `backend_stop` | Global backend lifecycle. |
| `AGENT_BOOTSTRAP` | `agent:bootstrap` | Internal: bootstrap file injection during prompt build (this one IS wired internally). |

### Hook Registry (`server/hooks/hook-registry.ts`)

- One `HookRegistry` instance per managed agent, plus one global instance for backend lifecycle hooks.
- `register(hookName, registration)` returns an unregister closure. Handlers are stored as `{pluginId, handler, priority, critical}` and the list is re-sorted on each registration (lower priority = earlier).
- `invoke(hookName, context)` runs handlers as an async waterfall — each handler awaits in priority order, mutating the shared context. Errors are caught: non-critical handlers log and continue; `critical: true` re-throws as a wrapped error and halts the pipeline.
- `destroy()` flips a flag that causes both `register()` (returns a no-op) and `invoke()` (returns context unchanged) to short-circuit, then clears the map.

### Internal Hooks (`server/hooks/internal-hooks.ts`)

`registerInternalHooks(registry, _config)` registers exactly one handler today — `AGENT_BOOTSTRAP` at priority 10:

- Filters `bootstrapFiles` by removing any names listed in `ctx.removed`.
- Pushes `ctx.added` onto the bootstrap file list.

This is invoked once per `HookRegistry` (per agent) during agent setup. The `_config` argument is currently unused.

### Plugin Loader (`server/hooks/plugin-loader.ts`)

`PluginLoader.loadPlugins(plugins, registry, basePath)`:

- Iterates `plugins` (from `AgentConfig.plugins` via `PluginDefinition`); skips `enabled === false`.
- For each `binding` in `plugin.hooks` (`PluginHookBinding`), dynamically `import()`s `binding.handler` (relative paths resolve against `basePath`, absolute paths are used as-is) and registers the module's default export (or the module itself) at `binding.priority ?? 100`, `binding.critical ?? false`.
- Failures are logged and the loader continues — plugin registration is fail-open per binding.

Returns the count of successfully registered handlers. There is no runtime hot-reload path here — registration happens at load time during agent start.

## Sub-Agents

### Sub-Agent Executor (`server/agents/sub-agent-executor.ts`)

`buildSyntheticAgentConfig(parent, sub, overrides)` (lines 24-134) constructs a runtime-ready `AgentConfig` for a single spawn:

- `modelId`, `thinkingLevel` taken from override → sub → parent.
- `tools` taken from sub, optionally `resolvedTools` overridden per-spawn.
- System prompt rebuilt from scratch via `buildSystemPrompt` with sub-specific `userInstructions = subPromptText [+ append override]`, eligible bundled skills, sub's rich skills, parent's reasoning visibility, and runtime metadata.
- `memory: null`, `agentComm: []`, `vectorDatabases: []`, `crons: []` — sub-agents do not own these resources.
- `storage` inherited from parent so sub-sessions live under the same storage engine.
- `subAgents`: empty unless `recursiveSubAgentsEnabled`, in which case parent's `subAgents` array is forwarded (this is the recursion gate).

`SubAgentExecutor.dispatch(d)` (lines 190-228):

- Builds a `ChildRunOptions` bag whose `emit` re-tags every event with `runId: d.childRunId` and forwards to the executor's `eventBus`.
- Registers an abort handler via `d.onAbortRegister` that flips `abortRequested` and calls whatever is currently on `childOpts.onAbort` (the runtime layer reassigns this).
- Awaits `runChild(childOpts)`. If `abortRequested && status !== 'aborted'`, coerces final result to `aborted`.
- Always emits `{ type: 'run:completed', runId, status }` at end so subscribers (parent WS, inline cards) observe completion.

The executor does not know about `pi-coding-agent` or `AgentRuntime`; the bridge `runChild` does.

### Sub-Agent Registry (`server/agents/sub-agent-registry.ts`)

State: `records: Map<subAgentId, SubAgentRecord>`, `byRunId: Map<runId, subAgentId>`, `yields: Map<parentSessionKey, YieldState>`.

Methods worth knowing for testing:

- `spawn(parent, target)` — assigns a UUID, records `status: 'running'`, `sealed: false`.
- `onComplete(runId, result)` / `onError(runId, error)` / `kill(subAgentId)` — set terminal status, mark `sealed: true`, set `endedAt`, then `maybeResolveYield(parentSessionKey)`.
- `setYieldPending(parentSessionKey, opts, resolve)` — fails with `no-active-subs` if no children are running, `already-pending` if one is already set; otherwise installs a timeout via `setTimeout(opts.timeoutMs)` and stores the resolver.
- Yield resolves with `reason: 'all-complete'` when no children are still running, or `reason: 'timeout'` from the timer.
- `cancelAllYields()` — used by `RunCoordinator.destroy()` to clear yields whose parent runs were already evicted from the 5-minute `RUN_RECORD_TTL_MS` cache (yields default to 10 minutes).
- `isSealed`, `findBySessionKey`, `listForParent`, `allComplete` — read accessors.

### Sub-Session Key (`server/agents/sub-session-key.ts`)

Two formats supported:

- Raw: `sub:<parentSessionKey>:<subAgentName>:<shortUuid>`
- Wrapped: `agent:<agentId>:sub:<parentSessionKey>:<subAgentName>:<shortUuid>`

`parseSubSessionKey()` strips the `agent:<id>:` wrapper if present, then splits on `:`. Minimum 5 segments after `sub:` (so wrapped agent parents work); name segment must match `SUB_AGENT_NAME_REGEX`. Source-comments call out that hook/cron-parented sub-sessions would have only 2 leading segments and would need the min lowered if added.

`buildSubSessionKey(parentSessionKey, subAgentName, shortUuid)` always emits the raw `sub:` form.

### Parent → child handoff

The parent's run loop calls `executor.dispatch(...)` with a synthesized child runId/sessionKey, registers an abort hook so REST/tool kill paths can fire it, and awaits `ChildRunResult`. Events are forwarded through the executor's eventBus with `runId: childRunId` so the WS subscriber can demux.

### Depth limit, fork limits

Recursion is gated by `sub.recursiveSubAgentsEnabled` — when false, the synthetic config's `subAgents` is empty, so the child cannot itself spawn. There is no explicit numeric `maxDepth` enforced by the executor in this file; verify against `RunCoordinator` or the dispatch caller for fork-count or queue-slot accounting.

### Completion / abort propagation

- Completion: `runChild` returns `ChildRunResult`; `onComplete`/`onError` on registry seal the record and resolve any pending parent yield.
- Abort: parent abort path fires the abort closure, which calls `childOpts.onAbort()`; if the runtime returns a non-aborted status after abort was requested, executor coerces it to `aborted`.
- The `run:completed` event is always emitted to the bus.

### Tool surface inherited vs scoped

- Sub's `tools` are used directly (with optional per-spawn `enabledToolsOverride`).
- Sub's `mcps` from the resolved sub config.
- Parent's API keys (xai/openai/gemini/tavily) and image model are forwarded.
- Storage is shared with parent.

## Agent-to-Agent Comms (`server/comms/`)

### Channel model

A channel is the canonical pair-level session between two agents. Key format from `channel-key.ts`:

```
channel:<lo>:<hi>     where lo < hi (lexical sort of agent IDs)
```

The same canonical key is used regardless of direction. The channel-session entry lives in the **lo-sorted** agent's `StorageEngine` (per `channel-session-store.ts`'s `ownerOf()`); transcripts are JSONL with user/assistant/tool messages plus `agent-comm-audit` events. `parseChannelKey` and `isChannelKey` are exported helpers.

### Send pipeline

`AgentCommBus.send(args)` (`agent-comm-bus.ts`, lines 105-302) enforces in this order:

1. **Topology** — sender must be registered, sender must have a matching `direct` edge to the target name, target must be registered, target must have a reciprocal `direct` edge back to the sender ID.
2. **Direction** — sender edge cannot be `inbound`; receiver edge cannot be `outbound`.
3. **Size** — `message.length <= senderEdge.messageSizeCap`.
4. **Rate limit** — outbound timestamps in a rolling 60s window, capped at `min(senderEdge.rateLimitPerMinute, receiverEdge.rateLimitPerMinute)`. The `outboundLog` is pruned at check time so dormant agents don't accumulate entries.
5. **Channel state** — `channelStore.open()` returns `{ key, meta }`; rejects if `meta.sealed`.
6. **Token budget** — if `tokensIn + tokensOut >= min(sender.tokenBudget, receiver.tokenBudget)`, emit `limit-tripped` audit, seal as `token_budget_exceeded`, return that error.
7. **Depth** — `currentDepth + 1 > min(senderEdge.maxDepth, receiverEdge.maxDepth)` → `depth_exceeded`.
8. **Turn count** — `meta.turns + 1 > min(sender.maxTurns, receiver.maxTurns)` → seal as `max_turns_reached`, return that error.
9. **Success** — append the user message (which atomically bumps `turns`), append a `send` audit event, record outbound timestamp, optionally seal pre-emptively if `updatedMeta.turns >= pairMaxTurns`, dispatch a wake to the receiver unless `end: true`.

Storage write failures inside the success block return `internal_error` (the turn counter is not bumped because `appendUserMessage` would have thrown before the bump).

`addUsage(channelKey, usage, pairBudget)` records token spend and pre-emptively seals if the pair budget is reached.

`broadcast(args)` enumerates direct peers (with non-null target names, sorted by name) and calls `send` per peer; per-recipient outcomes are collected into the result.

### Tool surface (`agent-comm-tools.ts`)

`createAgentCommTools(ctx)` returns up to three tools:

| Tool | Gate | Parameters |
|------|------|------------|
| `agent_send` | `directPeerNames.length > 0` | `{ to: enum(directPeerNames), message: string, end?: boolean }` |
| `agent_channel_history` | same | `{ with: enum(directPeerNames), limit?: 1..100 (default 20) }` |
| `agent_broadcast` | `hasBroadcastNode && hasDirects` | `{ message: string, end?: boolean }` |

`end: true` on `agent_send` appends without waking the peer.

### Channel-session isolation

A channel-session is its own session; the receiver agent runs against the channel transcript when woken, not its agent-direct session. `channel-context-prompt.ts` injects a system-prompt block telling the receiver:

> "You are in a peer channel-session with agent <peerName>. Use agent_send to reply. Use end:true when you are intentionally ending the exchange."

When `isFinalTurn: true` (the previous send hit the pair `maxTurns` cap and the channel was sealed), the block appends a notice that any `agent_send` call will be rejected with `channel_sealed` and that the model should reply with normal assistant text only — that text is persisted to the channel transcript and the peer can read it via `agent_channel_history`.

### Loop prevention

Three layers compound:

1. `depth` increments per send and is bounded by `pair.maxDepth`.
2. `turns` is bumped atomically by `appendUserMessage` and bounded by `pair.maxTurns` with pre-emptive seal.
3. Token budget is bounded by `pair.tokenBudget` with seal-on-trip.

There is no separate "loop detector" — these caps are the loop-prevention surface.

### Channel run queue (`channel-run-queue.ts`)

`ChannelRunQueue.enqueue(channelKey, task)` provides per-channel FIFO scheduling: different channels run in parallel; same-channel tasks serialize. Reentrant enqueues (from inside a running task on the same channel) are scheduled on a fresh resolved promise to avoid deadlock and merged back into the tail. Errors do not poison the queue. `isActive(channelKey)` returns true while any task is pending or running.

### Channel session store (`channel-session-store.ts`)

Facade over `StorageEngine` for channel entries:

- Storage owner is the lo-sorted agent in the pair (`ownerOf(key)`).
- `open(args)`, `appendUserMessage`, `appendAssistantMessages`, `appendAudit`, `addUsage`, `seal`, `read`, `tail` are the principal operations used by the bus and the routes.

### Routes that drive comms (`server/routes/agent-channels.ts`)

Two read-only routes today:

| Route | Behavior |
|-------|----------|
| `GET /api/agents/:agentId/channels` | Lists the agent's `direct` peer channels with `{channelKey, peerAgentId, peerAgentName, turns, sealed, sealedReason, lastActivityAt}`. Reads through `mgr.commBus.readChannel(channelKey)`; returns zero-state on read failure. |
| `GET /api/agents/:agentId/channels/:channelKey/transcript` | Tails channel transcript events; `limit` query is clamped to `[1, 500]`, default 50. Returns 404 with the underlying error message if the channel is missing. |

The channel-key path segment is `decodeURIComponent`'d. There is no POST surface here — all writes happen via the agent run loop's tool calls.

## Connections (`server/connections/`)

This directory contains two front-of-house attachment points, not "external connectors" in the connector-node sense.

### Webhook handler (`webhook-handler.ts`)

`WebhookHandler` registers Express POST routes at `/api/webhook/<path>` for each `WebhookConfig`. Per request:

- If `secret` is set, validates `X-Webhook-Signature` as `HMAC-SHA256(secret, JSON.stringify(req.body))` using `crypto.timingSafeEqual`.
- Looks up the agent's `RunCoordinator` via `coordinatorLookup`. Missing → 404.
- Extracts `message` from `body.message` → `body.text` → fallback `JSON.stringify(req.body)`.
- Dispatches to coordinator with `sessionKey = webhook.sessionKeyOverride ?? 'hook:<webhook.id>'`.
- Returns `202 { runId, sessionKey }` on success, 500 on dispatch failure.

### WebSocket handler (`ws-handler.ts`)

`handleConnection(socket, manager, apiKeys, samAgent?, samAgentBroadcasters?)` handles a single WS connection:

- Registers a per-socket SAM-agent broadcaster immediately so events emitted during the very first dispatch turn are not lost; cleared on `close`.
- Tracks `pendingStarts: Map<agentId, Promise<void>>` so dispatch awaits any in-flight start before delivering messages.
- Supported commands include at least `agent:start` (lazy starts an agent and emits `agent:ready`) and `agent:dispatch` (HITL-aware dispatch — text is routed to `manager.hitlRegistry.resolveForSession(...)` first; failed `confirm` parses keep the prompt open).

This is the WebSocket "front door"; it is not a connector module despite the directory name.

## Scheduling (`server/scheduling/`)

### Cron scheduler (`cron-scheduler.ts`)

Backed by `node-cron`. `CronScheduler.reconcile(agentId, crons)` is the principal entrypoint:

- Stops existing jobs for the agent that are no longer in the desired set or are disabled.
- Skips jobs whose `schedule` and `prompt` are unchanged (just refreshes the config reference).
- Otherwise (re)creates a `cron.schedule(config.schedule, tick, { timezone })` job. `timezone === 'local'` translates to `undefined` (system default).
- `executeCronTick` resolves the agent's coordinator, dispatches `{ sessionKey: 'cron:<cronNodeId>', text: config.prompt }`, records `lastRunAt` on the active job entry, and if `maxRunDurationMs > 0` schedules a `coordinator.abort(runId)` after that duration.

`stopAll()` clears every active job. `listJobs()` returns a status snapshot.

**Reachability caveat (per CLAUDE.md):** cron is *not* in the default node palette. The schema includes `cron` and the scheduler is wired, but verify whether a graph can ever produce a `crons` array reachable from the UI before authoring TC scenarios that depend on UI flows. REST/import paths are likely required to drive it end-to-end.

### Maintenance scheduler (`maintenance-scheduler.ts`)

`MaintenanceScheduler` runs `engine.runMaintenance()` once at start and then on a `setInterval(intervalMinutes * 60_000)`. `runNow(mode?: 'warn' | 'enforce')` exposes a one-shot. Errors are logged but never throw.

## End-to-End Test Scenarios

### TC6B.1 — Reactive compaction triggered at token budget

**Setup**: ContextEngine with `tokenBudget: 1000`, `reservedForResponse: 100`, `compactionStrategy: 'trim-oldest'`, `compactionTrigger: 'manual'` (so only `assemble` overflow triggers compaction). Build a message array exceeding 900 tokens.

**Action**: Call `assemble(messages)`.

**Expected**: Returns `{ messages, estimatedTokens }` with `estimatedTokens <= 900`. Original `messages` unmutated. If a `SessionManager` was set, a `branch_summary` entry is appended via `appendCompaction` with the count-of-trimmed message in the summary text.

### TC6B.2 — Proactive compaction at 80% on `auto`

**Setup**: `tokenBudget: 1000`, `reservedForResponse: 100`, `compactionTrigger: 'auto'`. Budget = 900; trigger = 720.

**Action**: Call `afterTurn(messages)` with 800 tokens of messages.

**Expected**: Compaction runs (verify by observing the persisted summary or the resulting size on a follow-up `assemble`). With 700 tokens of messages, no compaction.

### TC6B.3 — Proactive compaction with explicit `threshold`

**Setup**: `compactionTrigger: 'threshold'`, `compactionThreshold: 0.5`. Budget = 900; trigger = 450.

**Action**: `afterTurn` with 500 tokens; then again with 400.

**Expected**: First call compacts; second does not.

### TC6B.4 — Image stripping retains 2 newest tool-result images

**Setup**: 5 toolResult messages each containing one image block, interleaved with assistant messages.

**Action**: `assemble(messages)`.

**Expected**: The 2 most recent toolResult messages with images keep them. The older 3 have their image blocks rewritten to `[screenshot ... removed from context ...]` text blocks (with `savedPath` in the message when the original image had one). User-attached images on user/assistant messages pass through unchanged.

### TC6B.5 — `summary` strategy produces a synthetic summary message

**Setup**: `compactionStrategy: 'summary'`, force `assemble` to overflow.

**Expected**: First message is a synthetic `user` role with `[Summary of N earlier messages]\n...` content, capped at ~2000 chars. The kept tail is `last(max(4, floor(0.3 * len)))` further trimmed if needed.

### TC6B.6 — `memory_save` then `memory_search`

**Setup**: Memory engine with `exposeMemorySave: true, exposeMemorySearch: true`. Backend = builtin (in-memory).

**Action**: Call `memory_save({key:'k1', content:'lorem ipsum'})`, then `memory_search({query:'lorem'})`.

**Expected**: Save returns "Saved memory entry: k1". Search returns `[k1] lorem ipsum`. Sort order across multiple keys is recency-desc.

### TC6B.7 — `memory_get` for missing key

**Action**: `memory_get({key:'missing'})` against an empty store.

**Expected**: Returns "No memory entry found with key: missing". No throw.

### TC6B.8 — `before_tool_call` hook denies a tool call

**Setup**: Plugin registers a `before_tool_call` handler that sets `ctx.blocked = true; ctx.blockReason = 'denied'`. Run a turn that invokes that tool.

**Expected**: The runtime observes `ctx.blocked` after waterfall and skips execution; the tool surface returns a denial. Verify the hook waterfall's mutation propagated (registry `invoke` returns the mutated context).

### TC6B.9 — Critical hook error halts the pipeline

**Setup**: Plugin registers a hook with `critical: true` that throws.

**Expected**: `HookRegistry.invoke` re-throws as `Critical hook error in <pluginId>/<hookName>: ...`. Non-critical handlers in the same hook also do not run after the throw (because the loop awaits each).

### TC6B.10 — Non-critical hook error is logged and pipeline continues

**Setup**: Two non-critical handlers; first throws.

**Expected**: Console logs `[HookRegistry] Error in ...`; second handler still runs; `invoke` returns the (possibly mutated) context normally.

### TC6B.11 — Plugin loader skips disabled plugins

**Setup**: `PluginDefinition` with `enabled: false`.

**Expected**: `loadPlugins` logs "Skipping disabled plugin" and registers nothing. Returns `loaded === 0` for that plugin.

### TC6B.12 — Plugin loader continues past per-binding failure

**Setup**: A plugin with two hook bindings; first points to a non-existent module path, second is valid.

**Expected**: First binding logs `Failed to load handler for ...`; second registers; total `loaded === 1`.

### TC6B.13 — Internal `agent:bootstrap` hook applies adds and removes

**Setup**: Register internal hooks. Invoke `agent:bootstrap` with `bootstrapFiles: [{name:'a',...},{name:'b',...}]`, `removed: ['a']`, `added: [{name:'c',...}]`.

**Expected**: Final `bootstrapFiles` contains `b` and `c` only. Order: existing kept (minus removed), then additions appended.

### TC6B.14 — Sub-agent: synthetic config drops parent's memory/agentComm/crons

**Setup**: Parent with `memory`, `agentComm`, `crons` populated; spawn a non-recursive sub.

**Expected**: Synthetic config has `memory: null, agentComm: [], vectorDatabases: [], crons: []`, `subAgents: []`. Parent's `storage`, API keys, `sandboxWorkdir`, `imageModel` are forwarded.

### TC6B.15 — Sub-agent recursion gated by `recursiveSubAgentsEnabled`

**Setup**: Parent with `subAgents: [...]`; sub's `recursiveSubAgentsEnabled: true`.

**Expected**: Synthetic config's `subAgents` equals parent's `subAgents` (the child can re-spawn). With `false`, child's `subAgents` is `[]`.

### TC6B.16 — Sub-agent yield resolves on `all-complete`

**Setup**: Spawn 2 children; call `setYieldPending(parentSessionKey, {timeoutMs: 60_000}, resolve)`.

**Action**: `onComplete(child1)`, then `onComplete(child2)`.

**Expected**: After the second completion, yield resolves once with `reason: 'all-complete'`, `results` containing both children with `durationMs`, `text`, statuses. Timer is cleared; `isYieldPending` returns false.

### TC6B.17 — Sub-agent yield resolves on `timeout`

**Setup**: Spawn 1 child; `setYieldPending(..., timeoutMs: 50)`.

**Action**: Wait 100ms without completing the child.

**Expected**: Yield resolves with `reason: 'timeout'`; child still appears in results with `status: 'running'`.

### TC6B.18 — Sub-agent abort coerces final result

**Setup**: Dispatch a sub via executor; register an abort fn; `runChild` resolves with `status: 'completed'` after abort was requested.

**Expected**: `dispatch` returns `status: 'aborted'`. `run:completed` event still emitted.

### TC6B.19 — Sub-session key parsing accepts both forms

**Action**: `parseSubSessionKey('sub:agent:abc:s1:childName:uuid123')` and `parseSubSessionKey('agent:def:sub:agent:abc:s1:childName:uuid123')`.

**Expected**: Both return `{ parentSessionKey, subAgentName: 'childName', shortUuid: 'uuid123', isSubSession: true }`. Names failing `SUB_AGENT_NAME_REGEX` return `null`. Fewer than 5 segments return `null`.

### TC6B.20 — Comms: A → B succeeds with reciprocal direct edges

**Setup**: A registered with `direct` edge to B by name; B registered with reciprocal `direct` edge to A by id; both `outbound`/`inbound` directions compatible; budgets healthy.

**Action**: `bus.send({fromAgentId: A, toAgentName: B, message, end: false, currentDepth: 0})`.

**Expected**: `{ ok: true, depth: 1, turns: 1, queuedWake: true }`. Channel store has appended user message + `send` audit event. Receiver wake dispatched.

### TC6B.21 — Comms: turn limit halts the loop

**Setup**: Pair `maxTurns = 2`. Send 2 messages successfully.

**Action**: Third send.

**Expected**: Returns `{ ok: false, error: 'max_turns_reached' }`. Channel sealed with `sealedReason: 'max_turns_reached'` (the second send pre-emptively sealed once `updatedMeta.turns >= pairMaxTurns`). Audit log contains a `limit-tripped` event.

### TC6B.22 — Comms: depth limit blocks the send

**Setup**: Pair `maxDepth = 2`.

**Action**: `send` with `currentDepth = 2` (so `depth = 3`).

**Expected**: `{ ok: false, error: 'depth_exceeded' }`. No channel state mutation, no seal.

### TC6B.23 — Comms: rate limit blocks burst

**Setup**: Pair rate limit = 5/min. Send 5 successfully within a second.

**Action**: 6th send.

**Expected**: `{ ok: false, error: 'rate_limited' }`. The 6th does not bump turns, does not append. After 60s the window slides and sends are accepted again.

### TC6B.24 — Comms: token budget trip seals the channel

**Setup**: Pair `tokenBudget = 1000`. Use `addUsage` to drive `tokensIn + tokensOut` past 1000.

**Expected**: After `addUsage` crosses the threshold, channel is auto-sealed with `token_budget_exceeded`. A subsequent `send` returns `{ ok: false, error: 'channel_sealed' }`.

### TC6B.25 — Comms: message size cap

**Setup**: `senderEdge.messageSizeCap = 100`. Send a 200-char message.

**Expected**: `{ ok: false, error: 'message_too_large' }` before any channel state is touched.

### TC6B.26 — Comms: topology / direction violations

**Cases**:

- Sender not registered → `topology_violation`.
- Sender has no edge to target name → `topology_violation`.
- Receiver registered but no reciprocal edge → `topology_violation`.
- Sender edge `direction === 'inbound'` → `direction_violation`.
- Receiver edge `direction === 'outbound'` → `direction_violation`.

### TC6B.27 — Comms: storage failure surfaces as `internal_error`

**Setup**: Force `appendUserMessage` to throw (e.g., owner storage missing).

**Expected**: `send` returns `{ ok: false, error: 'internal_error' }`. Pre-flight checks (topology, direction, size, rate) still run *before* the try/catch and would return their own shaped errors.

### TC6B.28 — Comms: channel-session prompt has correct final-turn variant

**Action**: `buildChannelContextBlock('peerB', false)` and `buildChannelContextBlock('peerB', true)`.

**Expected**: `false` returns the base block. `true` appends the "channel is sealed" notice instructing the model to reply with normal assistant text only.

### TC6B.29 — Comms: REST channels list

**Action**: `GET /api/agents/<id>/channels`.

**Expected**: Array of `{channelKey, peerAgentId, peerAgentName, turns, sealed, sealedReason, lastActivityAt}` for every direct peer with a `targetAgentNodeId`. Channels that have not been opened yet return zero-state (`turns: 0, sealed: false, sealedReason: null, lastActivityAt: ''`). 404 if the agent is not managed.

### TC6B.30 — Comms: REST channel transcript

**Action**: `GET /api/agents/<id>/channels/<channelKey>/transcript?limit=10`.

**Expected**: 200 with up to 10 most recent JSONL events. `limit` clamped to `[1, 500]`, default 50. 404 with `{error}` if the channel does not exist.

### TC6B.31 — Webhook: HMAC validation

**Setup**: Webhook configured with `secret`.

**Cases**:

- Missing `X-Webhook-Signature` → 401 `Missing X-Webhook-Signature header`.
- Wrong signature → 401 `Invalid signature` (timing-safe compare).
- Correct signature → 202 `{ runId, sessionKey: 'hook:<id>' }`.

### TC6B.32 — Webhook: missing agent

**Action**: Webhook configured for an unknown agent id.

**Expected**: 404 `{ error: 'Agent <id> not found' }`.

### TC6B.33 — Webhook: message extraction priority

**Action**: POSTs with body shapes `{message: 'a'}`, `{text: 'b'}`, and arbitrary `{foo: 'c'}`.

**Expected**: Dispatch text is `'a'`, `'b'`, and `JSON.stringify({foo:'c'})` respectively.

### TC6B.34 — Cron: schedule fires `dispatch` at tick (only if reachable from graph)

**Setup**: Resolved cron config with `schedule: '* * * * * *'` (every second), `prompt: 'tick'`, `enabled: true`.

**Expected**: Within ~2s, coordinator receives a dispatch with `sessionKey: 'cron:<cronNodeId>', text: 'tick'`. `lastRunAt` updates on the active job entry.

**Caveat**: Per CLAUDE.md, cron is not in the default palette. Verify the test path (REST `agent:start` import? programmatic config?) before classifying this scenario as UI-reachable.

### TC6B.35 — Cron: `maxRunDurationMs` aborts the run

**Setup**: Cron with `maxRunDurationMs: 50`. Dispatched run takes longer than that.

**Expected**: `coordinator.abort(runId)` is invoked ~50ms after dispatch.

### TC6B.36 — Cron: reconcile stops removed jobs

**Setup**: Two cron configs `[A, B]`; reconcile. Then reconcile with just `[A]`.

**Expected**: Job for `B` is stopped and removed from the active map; `A` continues unchanged (since `schedule` and `prompt` are unchanged).

### TC6B.37 — Maintenance scheduler runs once on start and on interval

**Setup**: `intervalMinutes: 1`.

**Expected**: `engine.runMaintenance()` called once synchronously on `start()`, then again every 60s. `stop()` clears the timer; `runNow('warn'|'enforce')` invokes once with the mode.

## Open Questions / Ambiguity Flags

- **Memory engine richness** — the test plan template names `recall_memory`, `save_memory`, `daily_memory` etc., none of which exist in `memory-engine.ts`. The actual tools are `memory_search`/`memory_get`/`memory_save`. Daily/idle reset and parent-fork-max-tokens are not implemented in this file. Confirm by checking `shared/agent-config.ts` (`ResolvedMemoryConfig`) before authoring scenarios beyond what is documented here.
- **Memory engine compaction wiring** — `MemoryEngine.compact()` exists but no caller is visible in the read file. Verify whether the run loop ever invokes it before authoring TC scenarios.
- **Sub-agent fork-count limit** — not enforced in `sub-agent-executor.ts` itself. Recursion gating is via `recursiveSubAgentsEnabled` only. Look in `RunCoordinator` for queue/slot caps if a numeric fork limit is to be tested.
- **Cron reachability from UI** — schema includes `cron`, but per CLAUDE.md it's not in the default palette. Treat TC6B.34/35/36 as REST/import-driven until the UI path is confirmed.
- **`connections/` directory naming** — contains the WebSocket and webhook handlers, not "connector" lifecycle code. The connector concept (referenced in docs) lives elsewhere (likely under `server/connectors/` or similar). Verify before linking from connector-node concept docs.
