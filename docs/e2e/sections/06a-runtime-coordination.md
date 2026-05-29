# Section 6A — Backend: Run Coordination & Agent Runtime

<!-- last-verified: 2026-05-08 -->

## Scope

Covers the per-agent control plane: `AgentManager`, the `RunCoordinator`/`RunConcurrencyController` queue, `StreamProcessor`/`EventBridge` event fan-out, and the `AgentRuntime` model loop (system-prompt resolution, model resolution, provider streaming wrapper, payload breakdown, runtime-state PID file).

Out of scope (covered in 6B): `ContextEngine` and `MemoryEngine`, hook lifecycles in detail, `AgentCommBus` / channel-mode comms, sub-agents (`SubAgentRegistry`, `SubAgentExecutor`, `runChild`). Storage, sessions, tools, and CLI live in 7A/7B.

## Lifecycle Overview

```
WS message / REST endpoint
        |
        v
AgentManager.dispatch(agentId, params)             server/agents/agent-manager.ts:240
        |
        v
RunCoordinator.dispatch(params)                    server/agents/run-coordinator.ts:274
   - resolveSession() -> SessionRouter
   - randomUUID() -> RunRecord (status=pending)
   - hooks.MESSAGE_RECEIVED (may block)
   - concurrency.enqueue() -> queue snapshot
   - emit lifecycle:queue:entered, tryStartNextRun()
        |
        v
RunConcurrencyController.drain()/start()           server/agents/run-concurrency-controller.ts:60,78
        |
        v (only when no other run active in process)
RunCoordinator.executeRun(record, params)          server/agents/run-coordinator.ts:1396
   - openSession transcript, setSessionContext
   - inject session tools + comm tools (per-run)
   - hooks: BEFORE_MODEL_RESOLVE / BEFORE_PROMPT_BUILD / BEFORE_AGENT_REPLY
   - emit lifecycle:start
   - runtime.prompt(text, attachments)             server/runtime/agent-runtime.ts:592
        |
        v
AgentRuntime -> pi-agent-core Agent.prompt()
   - wrappedStreamFn (server/runtime/stream-wrapper.ts:50)
   - onPayload -> estimatePayloadBreakdown -> emit context_usage_preview
   - tool calls dispatched via Agent's loop, hooks wrap each tool
        |
        v (AgentEvent stream)
RunCoordinator subscribes to runtime, re-emits as CoordinatorEvent
        |
        v
StreamProcessor.handleEvent (server/agents/stream-processor.ts:59)
   - shared transforms: ReasoningGate, ReplyFilter, ToolSummaryCollector,
     CompactionHandler, ReplyAssembler
        |
        v (ServerEvent)
EventBridge.broadcast -> ws.send to all attached sockets (server/agents/event-bridge.ts:45)
        |
        v
Client receives over /ws (REST polling via /api/agents/:id/runs/:runId is the F-01 fallback path)
```

## Components

### Agent Manager (`server/agents/agent-manager.ts`)

- Owns a `Map<agentId, ManagedAgent>` (line 56). Each `ManagedAgent` bundles `runtime`, `coordinator`, `processor`, `bridge`, `storage`, `hooks`, `lastActivity`, `unsubscribe`, plus the resolved `config` (lines 30-40).
- `start(config)` (line 118):
  1. Destroys any existing entry with the same `id` (line 121).
  2. Builds `StorageEngine` and awaits `init()` if `config.storage` exists (lines 125-129). If absent, the agent has no storage and `dispatch()` will throw.
  3. Creates a per-agent `HookRegistry`, registers internal hooks, then loads plugin hooks resolved against the storage path (lines 132-144).
  4. `buildRuntime(config, hooks)` constructs `AgentRuntime` with current `safetySettings` snapshot (lines 381-391). Live edits to `currentSafetySettings` in `server/index.ts:49` propagate only at the next `start()`; running runtimes are not rebuilt.
  5. Creates `RunCoordinator` with a `runtimeFactory` that re-uses the parent hook registry for child runs (sub-agents — 6B).
  6. Wires `StreamProcessor`, `EventBridge`, and `runtime.setBroadcast()` (lines 172-179).
  7. Subscribes coordinator events to bump `lastActivity` (line 182).
  8. Registers the agent on `AgentCommBus` (lines 201-205, comms — 6B).
  9. Fire-and-forget `backfillInitialBreakdowns` for zero-turn sessions on disk (line 213).
  10. `persistConfig(config)` writes `<storagePath>/<agentName>/agent-config.json` (lines 394-403) — the file `restoreFromDisk()` reads on boot.
- Public API: `dispatch`, `wait`, `subscribe`, `abortRun`, `abort` (latest active), `destroy`, `has`, `listAgents`, `findAgentsByStorage`, `getStatus` (idle/running/error/not_found, line 319), `getBridge`, `seedSessionContext`, `manualCompact`, `addSocket`, `removeSocketFromAll`, `restoreFromDisk(storagePath)`, `shutdown()`.
- `restoreFromDisk` (line 407) reads every `<dir>/agent-config.json` under the storage path, in chunks of 50 (`Promise.all`), and calls `start()` on each. NOTE: this entry point is exported but `server/index.ts` does NOT call it on boot — agents are only re-started when a client opens chat. Verify before claiming "agents auto-restart on server restart".
- Update propagation: there is no `update(config)` method. Live config changes flow through `start(config)` which destroys and recreates the runtime; an in-flight run is torn down by `destroy()` (calls `runtime.abort()` indirectly via `runtime.destroy()` at line 285).
- Global hook registry singleton at `getGlobalHookRegistry()` (line 48) — fires `BACKEND_START`/`BACKEND_STOP` from `server/index.ts:851`/`873` only.

### Runtime Factory (`server/agents/runtime-factory.ts`)

- Just a type alias `RuntimeFactory = (config: AgentConfig) => AgentRuntime` (line 9).
- The "factory" is implemented inline in `AgentManager.start()` (lines 150-154): it calls `buildRuntime(childConfig, hooks)` and re-wires the broadcast function, sharing the parent's `HookRegistry`. Only consumed by `RunCoordinator.runChild()` for one-shot sub-agent runs (6B).

### Run Coordinator (`server/agents/run-coordinator.ts`)

- States: `'pending' | 'running' | 'completed' | 'error'` (`RunStatus`, line 74). The `WaitResult` adds `'timeout'` as an external phase but it is not a `RunRecord.status` value (line 543).
- `RunRecord` (lines 76-94) holds `runId`, agent/session keys, `transcriptPath`, `payloads`, `usage`, `error`, `abortController`, `timeoutTimer`, and a `pendingDiagnostic` for failure persistence.
- Transitions:
  - `pending` → set in `dispatch()` (line 294); record stored in `runs` map and `pendingParams` (lines 301-302).
  - `pending` → `running` in `executeRun()` (line 1405); fires `lifecycle:start` (line 1659).
  - `running` → `completed` in `finalizeRunSuccess()` (line 2404); `running` → `error` in `finalizeRunError()` (line 2443).
  - `pending` → `error` (synthetic) when `MESSAGE_RECEIVED` hook blocks (lines 316-329) or when `concurrency.abortPending()` removes a queued run (`abort()` at line 690).
- Queueing: `concurrency.enqueue(runId, sessionId)` returns a `QueueSnapshot` (sessionPosition, globalPosition) which is attached to the `RunRecord.queue` and broadcast via `lifecycle:queue:entered`/`queue:updated` events. `tryStartNextRun()` (line 998) drains exactly one run when no other is active.
- Persistence: every accepted run appends:
  - The user message via `persistUserMessage` (line 1540) into the JSONL transcript at `record.transcriptPath`.
  - Streamed assistant content via `transcriptManager.appendMessage` and out-of-band custom entries (e.g. compaction, sub-agent spawn, run diagnostic).
  - On error/abort/timeout/hook-blocked: `pendingDiagnostic` of type `RUN_DIAGNOSTIC_CUSTOM_TYPE` is appended (`appendPendingDiagnostic` in `finalizeTranscript`, line 1432).
  - Run records themselves are kept in memory for `RUN_RECORD_TTL_MS = 5 * 60 * 1000` (line 96) — there is NO separate run-records database; `wait()` after TTL returns "not found" via the error shape.
- Abort handling (`abort(runId)`, line 690):
  1. If `runId` matches a registered child abort (sub-agent), fire and return.
  2. If the run is `pending` in the queue: `concurrency.abortPending` removes it and emits `queue:left` with reason `'aborted'`. Record finalized via `finalizeRunError` with `{ code: 'aborted' }`.
  3. If the run is `running`: `record.abortController.abort()`, `runtime.abort()` (which calls `agent.abort()`), `runtime.cancelPendingHitl(...)` to clear HITL banners, then `finalizeRunError`.
- Stream idle timeout: `STREAM_IDLE_TIMEOUT_MS = 30_000` (line 98) — the coordinator aborts a run that does not produce a real token within 30s of `message_start`.
- Default wait timeout: `DEFAULT_WAIT_TIMEOUT_MS = 30_000` (line 97). Runs themselves use `params.timeoutMs ?? this.config.runTimeoutMs` (line 1667).
- Channel-mode dispatch (`dispatchChannel`, line 364) bypasses `executeRun` entirely; covered in 6B.

### Run Concurrency Controller (`server/agents/run-concurrency-controller.ts`)

- Per-process global serialization: `activeRunId` is a single string field (line 28). Only ONE run executes at a time across ALL agents in this server process. This is stricter than "per-agent serialization" — verify before documenting cross-agent parallelism.
- Per-session FIFO via `sessionQueues: Map<sessionId, runId[]>` (line 25), and a global FIFO via `globalQueue: string[]` (line 26).
- `drain()` (line 60): returns the first run in the global queue whose run is also at the head of its session queue. Combined with the single `activeRunId`, this means runs from different sessions of different agents are still strictly serialized.
- `start(runId, sessionId)` (line 78) shifts the session queue head, removes from global queue, sets `activeRunId` and `leasedSessionId`. Throws if invariants break.
- `abortPending(runId)` (line 105) removes a queued run; refuses if `activeRunId === runId` (use the runtime abort path instead).
- `release(runId, sessionId)` (line 128) clears the lease. Always paired with `tryStartNextRun()` in the coordinator.
- `destroy()` (line 140) returns the list of pending runIds so the coordinator can finalize them as aborted on agent destruction.

### Stream Processor (`server/agents/stream-processor.ts`)

- Subscribes to `coordinator.subscribeAll` (line 38) and re-emits transformed events to `EventBridge` listeners.
- Per-run `RunStreamContext` map (line 13) and per-run `ReplyFilter` (line 16) for state that must not leak across runs.
- Shared transforms (constructed once, lines 28-36): `ReasoningGate(showReasoning)`, `ToolSummaryCollector(verbose)`, `CompactionHandler`, `ReplyAssembler(showReasoning, verbose, callback)`. The `ReplyAssembler` callback writes assembled `payloads` and `usage` back to the coordinator via `setRunPayloads(runId, payloads, usage)` (line 33-35).
- Per-run transforms: `ReplyFilter` (built per `lifecycle:start`, cleared on `lifecycle:end`/`lifecycle:error`).
- Provider chunk → run event mapping is performed by pi-agent-core's `Agent.subscribe` (forwarded by `AgentRuntime.emit`); the StreamProcessor receives `CoordinatorEvent` (already lifted from raw `AgentEvent` inside the coordinator) and shapes them into client-facing `ServerEvent` (e.g. `agent:end`, `agent:error`, `context:usage`, `lifecycle:*`).
- Markdown block boundary detection lives in `ReplyAssembler` (not re-read here — payload shape is the `RunPayload[]` finalized into the run record).
- Tool-call extraction lives in `ToolSummaryCollector`.

### Stream Transforms (`server/agents/stream-transforms/`)

- `reasoning-gate.ts` — gates `thinking` content based on `config.showReasoning`. When false, drops thinking-only deltas; when true, passes through.
- `reply-filter.ts` — per-run filter that suppresses assistant text matching `NO_REPLY_PATTERN` (`/^no_reply$/i`, defined in coordinator) so silent turns don't surface as empty replies.
- `tool-summary-collector.ts` — accumulates tool-call name/args/result so the UI can render tool summary rows; respects `verbose` flag for argument expansion.
- `compaction-handler.ts` — translates context-engine compaction events into client-facing `agent:compacted` notices.
- `reply-assembler.ts` — assembles `RunPayload[]` (text, thinking, tools) and final `usage` into the run record via the callback wired in `StreamProcessor` line 33.
- `types.ts` — shared `StreamTransform` interface, `RunStreamContext` factory, `EmitFn`.

Each transform has a sibling `*.test.ts` co-located.

### Event Bridge (`server/agents/event-bridge.ts`)

- Pure WebSocket fan-out: a `Set<WebSocket>` of attached sockets and a single subscription to the upstream `StreamProcessor` (lines 10-20).
- `broadcast(event)` (line 45) JSON-stringifies once and `socket.send`s to every socket whose `readyState === OPEN`. No backpressure handling, no queueing, no reconnect/replay buffer — disconnected clients miss whatever fired while their socket was down.
- `addSocket`/`removeSocket` are called by `handleConnection` (`server/connections/ws-handler.ts`, not read here) on connect/disconnect.
- The `broadcast()` method is also exposed so the HITL `ask_user` tool can push events directly via `runtime.setBroadcast` (`server/runtime/agent-runtime.ts:409`) without going through the run-scoped stream.
- REST polling fallback for F-01 is NOT implemented inside this file. The path the client uses to catch up after WS reconnection lives in `server/agents/agent-manager.ts` -> `coordinator.wait()` and is exposed only through whatever HTTP routes mount it (none visible in `server/index.ts`). Flag for verification — there is no obvious `/api/agents/:id/runs/:runId` route in the read files.

### Agent Runtime (`server/runtime/agent-runtime.ts`) — THE LOOP

- Wraps pi-agent-core `Agent` (line 102, constructed at line 246). Decoupled from React.
- Construction inputs:
  - `config: AgentConfig`
  - `getApiKey(provider)` — closure reading from `ApiKeyStore` (env not read here; falls back inside specific tools).
  - Optional `getDiscoveredModel`, `hookRegistry`, `pluginRegistry`, `hitlRegistry`, `safetySettings`.
- Construction effects (lines 144-298):
  - Builds `MemoryEngine` if `config.memory` (line 150) — 6B.
  - Builds `ContextEngine` if `config.contextEngine` (line 155) — 6B.
  - Resolves tool names via `resolveToolNames(config.tools)` (`server/tools/tool-factory.ts`) and forces `ask_user`+`confirm_action` when `safetySettings.allowDisableHitl === false` (lines 172-175).
  - Wraps tools with hook adapters via `wrapToolsWithHooks` (line 503) — every tool execution fires `BEFORE_TOOL_CALL` then `AFTER_TOOL_CALL`. Blocks short-circuit to a "Blocked: ..." text result.
  - Resolves the system prompt via `resolveOutboundSystemPrompt` (line 220) — the same function the REST `/api/agents/:agentId/resolved-system-prompt` endpoint uses.
  - Calls `resolveRuntimeModel` (line 230) to materialize the pi-ai `Model<Api>`.
  - Constructs `Agent` with `streamFn: wrappedStreamFn`, `toolExecution: 'parallel'`, `transformContext: contextEngine.buildTransformContext()` (lines 246-291).
  - `onPayload` (line 258): tokenizes the outbound payload via `estimatePayloadBreakdown`, emits `context_usage_preview` with breakdown and the model's `contextWindow`. The coordinator turns this into a `context:usage` `ServerEvent`.
  - Forwards every pi-core `AgentEvent` to runtime listeners (line 294); emits a final `runtime_ready` (line 298).
- Iteration shape: pi-agent-core `Agent.prompt` runs the tool-call loop internally (the project does not own the loop). Each turn:
  1. `Agent.prompt(text, images?)` builds the next user message and starts streaming.
  2. `streamFn = wrappedStreamFn` calls pi-ai's `streamSimple`, intercepts `done` events, and rewrites unknown `finish_reason` values so the loop continues (see Stream Wrapper below).
  3. `onPayload` fires before the HTTP call (preview emit).
  4. Provider returns chunks; `Agent` emits AgentEvents which `AgentRuntime.emit` forwards.
  5. Tool calls in the assistant turn trigger parallel tool execution (`toolExecution: 'parallel'`) through the wrapped tool list.
  6. Loop continues until the assistant produces a final `stop` (no tool calls).
- Completion: `runWithFetchLogging` (line 625) restores `globalThis.fetch` in `finally`. After-turn bookkeeping calls `contextEngine.afterTurn(messages)` (line 712).
- Abort: `runtime.abort()` (line 769) calls `agent.abort()`. Coordinator additionally clears HITL state via `cancelPendingHitl` (line 419).
- Error: any throw from `agent.prompt()` is re-emitted as `runtime_error` then re-thrown so the coordinator's `executeRun` `catch` finalizes the run.
- Token-usage accounting:
  - Per-turn preview from `onPayload.estimatePayloadBreakdown` -> `context:usage` source `'preview'`.
  - Actual usage arrives in the assistant `message_end` event's `usage` field — collected by the coordinator's `applyAssistantUsage` (not read here, called at line 1637 for the synthetic-reply path) and merged into `record.usage`. The coordinator reuses non-message sections from the last preview (see `lastPreviewBreakdown` map, line 230) to keep the per-section gauge stable across `preview -> actual`.
  - `buildInitialBreakdown()` (line 338) seeds the per-section breakdown for sessions that have not yet run a turn.
- Auxiliary mutators called by the coordinator: `setSessionContext`, `setActiveSession`, `setCurrentSessionKey`, `setModel` (after `BEFORE_MODEL_RESOLVE`), `setSystemPrompt`/`getSystemPrompt` (after `BEFORE_PROMPT_BUILD`), `appendSystemPromptBlock` (channel mode), `addTools` (per-run tool injection — resets to `baseTools` first, line 467), `runContextCompaction` (manual compact endpoint).
- Reasoning drift warning: `warnIfReasoningSilentlyDropped` (line 735) logs when `thinkingLevel != 'off'` but the assistant turn produced no thinking content — a known OpenRouter routing pitfall.

### Stream Wrapper (`server/runtime/stream-wrapper.ts`)

- Wraps pi-ai's `streamSimple` and patches the `done` event when the provider's `finish_reason` was unknown to pi-ai's `mapStopReason` (lines 50-99).
- `mapUnknownFinishReason(raw, hasToolCalls)` (line 14):
  - `MAX_TOKENS` → `length`
  - `MALFORMED_FUNCTION_CALL`, `OTHER`, `FINISH_REASON_UNSPECIFIED`, `COMPLETE`, `FINISH` → `toolUse` if there are tool calls else `stop`
  - `TOOL_CALLS`, `TOOLS`, `FUNCTION_CALL` → `toolUse`
  - `SAFETY`, `RECITATION`, `CONTENT_FILTER`, `BLOCKED`, anything else → `null` (kept as `stopReason: 'error'`).
- Without this rewrite, Gemini-via-OpenRouter responses with unknown finish reasons cause pi-agent-core's loop to bail prematurely. Logs every rewrite (line 73).
- On upstream throw: pushes a synthetic `error` event to the downstream stream so pi-agent-core fails cleanly.

### Model Resolver (`server/runtime/model-resolver.ts`)

- `resolveRuntimeModel({ provider, runtimeProviderId, modelId, modelCapabilities, baseUrl?, getDiscoveredModel })` (line 35):
  1. Try pi-ai's built-in `getModel(runtimeProviderId, modelId)`. On hit: apply `modelCapabilities` overrides + optional `baseUrl`, return.
  2. Otherwise look up `getDiscoveredModel(pid, modelId)` (provider-fetched catalog) and clone the first template from `getModels(pid)`. Throws `"No model template available for provider: <pid>"` (line 56) when neither built-in nor template exists.
  3. Apply capability overrides (`reasoning`, `input`, `contextWindow`, `maxTokens`, `cost`) and `baseUrl`.
- API key precedence (resolved OUTSIDE this file, in `provider-auth.ts` referenced from `agent-runtime.ts:11`): `ApiKeyStore.get(pluginId)` (populated from `settings.apiKeys` via `PUT /api/settings`) is the primary source. Provider-specific env vars (e.g. `OPENROUTER_API_KEY`) are only consulted as fallbacks inside individual tool modules' `resolveContext` blocks. The `getApiKey` callback passed into `AgentRuntime` only reads from `ApiKeyStore` (`agent-manager.ts:384`).
- Invalid model id error shape: a thrown `Error` with the template-missing message above is the runtime-side surface. F-06 (UI handling of invalid model id) is fed by this throw being re-emitted as `runtime_error` and lifted into a `lifecycle:error` `StructuredError` in the coordinator. Verify the exact F-06 reproduction path against `executeRun`'s `catch` blocks (lines 1648, 1845).

### Resolve System Prompt (`server/runtime/resolve-system-prompt.ts`)

- Single source of truth used by both `AgentRuntime` (construction-time) and the REST preview endpoint (`/api/agents/:agentId/resolved-system-prompt`, `server/index.ts:203`).
- Pipeline (`resolveOutboundSystemPrompt`, line 67):
  1. `substituteBundledSkillsRoot` over both the assembled string and each section's content (lines 80-95).
  2. Rewrite `os=` field in the `runtime` section to `process.platform` so the agent sees the BACKEND OS, not the browser's `navigator.platform` (lines 15-19, 86-88).
  3. Workspace fallback: if no `Working directory:` line in the assembled prompt and `workspaceCwd` was supplied, append a `## Workspace` section (lines 102-111).
  4. HITL confirmation policy: when `confirm_action` or `ask_user` is in the resolved tool list (auto-injected when `allowDisableHitl === false`) AND `safetySettings.confirmationPolicy` is set, fill `{{READ_ONLY_TOOLS}}` / `{{STATE_MUTATING_TOOLS}}` / `{{DESTRUCTIVE_TOOLS}}` placeholders via `groupToolsByClassification` and append (lines 117-134).
- Returns `{ mode, sections, assembled, userInstructions }`. The sections list is what the UI's `SystemPromptPreview` renders.

### Payload Breakdown (`server/runtime/payload-breakdown.ts`)

- Consumed by `AgentRuntime.onPayload` to split outbound token estimates into four buckets (`systemPrompt`, `skills`, `tools`, `messages`) plus per-skill and per-tool entry breakdowns. Powers the `context:usage` UI panel.
- Skills are passed in separately because they are folded into the system prompt by `system-prompt-builder` on the client side, but the breakdown surfaces them as their own bucket. (Shape verified at `agent-runtime.ts:267` call site.)

### Runtime State (`server/runtime-state.ts`)

- Tracks one thing globally: the running server's PID at `<repo>/.sam/server.pid` (line 21).
- `writeServerPid(pid)` is called once after `httpServer.listen()` succeeds (`server/index.ts:849`). `clearServerPid()` is called from the SIGTERM/SIGINT shutdown path (line 887) and after a startup failure.
- The CLI `sam restart` reads this file (mirrored in `bin/lib/sam-paths.js`, per the file header) to find the previous PID for graceful termination before spawning a replacement.
- This file does NOT track live runtimes, queued runs, or any in-process state — that lives entirely on `AgentManager.agents` and `RunCoordinator.runs` and is lost on restart.

## End-to-End Test Scenarios

### TC6A.1 — Cold-start single message
- Goal: First user message after server boot drives the full lifecycle and persists.
- Pre-conditions: Server up, agent with `contextEngine` + `storage` configured, no prior session for this agent.
- Steps: open chat (auto-routes to a new session), send "hello".
- Expected: WS receives `lifecycle:start`, `context:usage` (preview), assistant `message_start`/`message_delta`/`message_end`, `lifecycle:end`. Transcript JSONL contains user + assistant message. `RunRecord.status === 'completed'`.
- Edge cases: Verify `context:usage` arrives BEFORE the first delta (preview is emitted in `onPayload` which fires before HTTP).

### TC6A.2 — Concurrent runs same session → strictly queued
- Goal: Second `dispatch()` while first is running enters the queue.
- Steps: Send msg-A; before A completes, send msg-B (same session).
- Expected: msg-B record has `status: 'pending'`, `queue.sessionPosition === 1` (or 2 depending on snapshot timing — confirm against `enqueue()` at controller line 31), client sees `lifecycle:queue:entered` for B. msg-A finishes, B starts via `tryStartNextRun`, B emits `lifecycle:queue:left` reason `'started'` then `lifecycle:start`.

### TC6A.3 — Concurrent runs different agents → also serialized
- Goal: Verify the controller's single `activeRunId` semantics.
- Steps: Two agents A and B in the same server process. Dispatch on A, then immediately on B.
- Expected: B is queued behind A globally. (This is stricter than "per-agent serialization, cross-agent parallel"; the implementation is process-global. Document this finding clearly.)

### TC6A.4 — Tool call iteration
- Goal: Multi-turn tool loop completes and surfaces all events.
- Steps: Send a prompt that requires e.g. `read_file` then a follow-up answer.
- Expected: Multiple `message_end` events (one per assistant turn), each with `tool_call` blocks; `BEFORE_TOOL_CALL`/`AFTER_TOOL_CALL` hooks fire per call; `ToolSummaryCollector` renders summary; final assistant turn has `stopReason: 'stop'`; `RunRecord.payloads` contains text + tool entries.

### TC6A.5 — Mid-stream abort
- Goal: `coordinator.abort(runId)` while streaming cleanly tears down.
- Steps: Send a long-running prompt; call abort midway.
- Expected: WS receives `lifecycle:error` with `code: 'aborted'`. Pending HITL prompts (if any) are cancelled (`cancelPendingHitl`). Run diagnostic appended to transcript. `concurrency.release` runs and `tryStartNextRun` drains anything queued. No further assistant events for this runId.

### TC6A.6 — Provider error: invalid model id (F-06)
- Goal: Cold runtime construction with a model id no provider knows.
- Steps: Create agent with `provider.pluginId='openai'`, `modelId='nonexistent-x9'`. Open chat (forces `start()` and runtime build).
- Expected: Either `resolveRuntimeModel` throws `"No model template available for provider: openai"` (when no template exists), or the model is built with bad id and the first request returns 4xx, captured via `runWithFetchLogging` → `lastApiError` → `runtime_error` event → `lifecycle:error` `StructuredError` (`code` likely `'internal'` from `classifyError` — verify). Client sees a clean error toast, not a hang.
- Edge cases: Confirm whether F-06 triggers on `start()` or only on first dispatch — the throw site differs.

### TC6A.7 — Provider 429 / rate-limit surfaces clean error
- Goal: Non-2xx provider response is captured as `lastApiError` and bubbled.
- Steps: Force a 429 (e.g. spam dispatches faster than provider quota).
- Expected: `runWithFetchLogging` parses the JSON error body, sets `runtime.lastApiError`, the agent throws, coordinator finalizes with `lifecycle:error`. The raw exchange is logged to the apiExchange log file.

### TC6A.8 — Runtime restart (`sam restart`) preserves persisted state
- Goal: Verify what survives a restart.
- Steps: Boot, dispatch msg-A, complete it, kill server, boot again.
- Expected SURVIVES: agent-config.json on disk (one per agent dir), session JSONL transcripts, session-store records, settings.json, graph.json, server.pid (rewritten on next listen).
- Expected LOST: in-memory `RunRecord` map (so `wait(runId)` after restart returns "not found"), live `ManagedAgent` map (agents must be re-`start()`ed — currently triggered on first chat open, not auto-restored; flag `restoreFromDisk` is exported but unused in `index.ts`).

### TC6A.9 — Reconnection mid-stream
- Goal: WS disconnect during streaming; client reconnects.
- Steps: Start a long stream; close WS; reconnect with same agentId.
- Expected: `EventBridge` has no replay buffer (line 9 onwards) — events emitted while disconnected are LOST. The client's catch-up mechanism must call `coordinator.wait()` (via whatever HTTP route mounts it) or refetch the transcript. Flag: there is no `/api/agents/:id/runs/:runId` REST route visible in the read files; document the actual catch-up route used in chat-and-sessions.

### TC6A.10 — Agent config update mid-run vs after run
- Goal: Verify config update semantics.
- Steps (mid-run): While a run is active, call `AgentManager.start(updatedConfig)`.
- Expected (mid-run): `start()` calls `destroy()` on the existing entry → `runtime.destroy()` → `agent.abort()` → in-flight run finalized as error. New runtime built; queued runs lost. (Verify against `agent-manager.ts:120-122`.)
- Steps (after run): Update config when idle.
- Expected (after run): Clean rebuild; `safetySettings` snapshot refreshes; running sessions re-routed when chat reopens.

### TC6A.11 — Hook blocks message_received
- Goal: Pre-run blocking hook short-circuits cleanly.
- Steps: Register a `BEFORE_MESSAGE_RECEIVED`-equivalent hook that sets `ctx.blocked = true`.
- Expected: `dispatch()` returns the runId, but the run is finalized as error with code `'aborted'` BEFORE entering the queue. A run diagnostic is appended; no provider call ever happens.

### TC6A.12 — Hook claims reply (synthetic)
- Goal: `BEFORE_AGENT_REPLY` synthetic reply path.
- Steps: Hook sets `claimed: true`, `syntheticReply: 'canned answer'`.
- Expected: Coordinator emits `lifecycle:start`, builds an assistant message with `provider/model` from config, persists it, emits a synthetic reply payload, finalizes success — without ever calling the provider. (Lines 1609-1645.)

### TC6A.13 — Run timeout
- Goal: `params.timeoutMs` (or `config.runTimeoutMs`) elapses.
- Steps: Dispatch with `timeoutMs: 1000`, induce a long stream.
- Expected: At 1s the timer fires (line 1668), `runtime.abort()`, `lifecycle:error` with `code: 'timeout'`, message `Run timed out after 1000ms`. Diagnostic appended.

### TC6A.14 — Stream idle timeout
- Goal: 30s pass without a real token after `message_start`.
- Steps: Force a provider that opens the stream then stalls.
- Expected: Coordinator's `STREAM_IDLE_TIMEOUT_MS` fires, run finalized as error. (Verify against the watchdog wiring inside `executeRun` — the constant is declared at line 98 but search for usage to confirm the trigger site.)

### TC6A.15 — Unknown finish_reason rewrite
- Goal: Stream wrapper keeps the loop alive on Gemini `MAX_TOKENS`.
- Steps: Use Gemini-via-OpenRouter on a prompt that hits length limit.
- Expected: `wrappedStreamFn` rewrites `MAX_TOKENS` → `length` (or to `toolUse` if there were tool calls in the truncated turn), pi-agent-core does NOT bail; transcript shows the truncated assistant turn; `lifecycle:end` fires normally. Log line "Rewrote provider finish_reason..." present.

### TC6A.16 — Backend OS rewrite in runtime section
- Goal: System prompt's `os=` reflects the server, not the browser.
- Steps: Open the system-prompt preview from a Mac client connected to a Windows server.
- Expected: Preview returned by `POST /api/agents/:id/resolved-system-prompt` contains `os=win32` (or whatever `process.platform` is on the server), and the assembled prompt matches what `AgentRuntime` cached in `initialSystemPrompt`. (`resolve-system-prompt.ts:80-88`.)

### TC6A.17 — Safety settings re-read on next start
- Goal: Toggling `allowDisableHitl` propagates to NEW agents only.
- Steps: With `allowDisableHitl: false`, start agent A. PUT settings to `true`. Start agent B with no HITL tools configured.
- Expected: A still has `ask_user`/`confirm_action` (was injected at construction); B does NOT auto-inject them. Confirm via the resolved-system-prompt endpoint and the actual tool list returned by `addTools([])` baseline.

### TC6A.18 — Manual compact via REST
- Goal: `POST /api/sessions/:agentId/:sessionKey/compact` runs context engine outside any run.
- Steps: With agent running and a non-trivial transcript, call the endpoint.
- Expected: `runtime.runContextCompaction(messages)` invoked; result persisted; `manualCompact` returns before/after token counts. Returns 400 if agent isn't running (`server/index.ts:343`).

### TC6A.19 — Concurrent dispatch then abort the queued one
- Goal: `abortPending` path on the controller.
- Steps: Dispatch A (running) and B (queued). Abort B before A finishes.
- Expected: B finalized as error with `code: 'aborted'`; controller emits `queue:left` reason `'aborted'` for B; affected runIds (those whose position shifted) get `queue:updated` events. A continues unaffected.

### TC6A.20 — `wait(runId, timeoutMs)` boundary
- Goal: External waiter respects timeout when the run never completes within window.
- Steps: Dispatch a run, then `wait(runId, 100)`.
- Expected: After 100ms, `WaitResult` returned with `status: 'timeout'`, `phase: record.status` (likely `'running'`), `payloads: []`. Subsequent `wait()` for the same run after it actually completes returns the real result while the record is still in the TTL window (5min, line 96).
