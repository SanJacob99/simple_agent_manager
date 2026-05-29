# Section 6A — Backend: Run Coordination & Agent Runtime — Findings

<!-- last-verified: 2026-05-08 -->

Companion to [06a-runtime-coordination.md](./06a-runtime-coordination.md). Run executed via the `chrome-devtools` MCP server + REST against the running backend (`:3210`) and source code reading. §6A is server-side internals — most assertions are statically verified against the running code (cited line numbers below) plus three live REST/WS probes (TC6A.16, TC6A.18, TC6A.20-style endpoint search).

## Status

- **Run started:** 2026-05-08
- **Run status:** complete
- **Baseline:** No backend was killed or restarted. Graph + settings unchanged. The backend was running throughout the §1-§5 runs and continues here.
- **Test set:** TC6A.1 → TC6A.20 (20 scenarios)

## Summary

| Severity | Count |
|---|---|
| blocker | 0 |
| major | 0 |
| minor | 1 (new — F-12 `restoreFromDisk` is exported but never called on boot) |
| cosmetic | 0 |

Re-confirmations: F-01 (no REST catch-up route exists for runs — see TC6A.9), F-06 (invalid model id error path).

## Test results

| Tx | Title | Result | Method | Notes |
|---|---|---|---|---|
| TC6A.1 | Cold-start single message | ✅ | live (carry-over) | §4 S4.1 already evidenced full lifecycle: `lifecycle:start` → `context:usage` (preview, source `last known` then `actual`) → assistant `message_*` → `lifecycle:end`. Transcript JSONL has user + assistant entries; `record.status === 'completed'` (implied by absence of error). Preview emit DOES arrive before the first delta — observed in scribe's panel showing `last known` 2.7K BEFORE the first turn rendered. |
| TC6A.2 | Concurrent runs same session — strictly queued | ✅ static | code | [run-concurrency-controller.ts:31-54](../../../server/agents/run-concurrency-controller.ts#L31-L54) `enqueue` builds session + global queues; [start():78-86](../../../server/agents/run-concurrency-controller.ts#L78-L86) throws if `activeRunId` is set. Coordinator emits `lifecycle:queue:entered` per [run-coordinator.ts:294-302]. Reproduction path is unambiguous from the code. |
| TC6A.3 | Concurrent runs different agents — also serialized | ✅ static | code | [run-concurrency-controller.ts:28](../../../server/agents/run-concurrency-controller.ts#L28) `private activeRunId: string \| null = null` is a single PROCESS-WIDE field; `start()` throws with `"Cannot start ${runId}; ${this.activeRunId} is already active"` regardless of which agent owns the run. **Confirmed: cross-agent runs in one process are strictly serialized**, not parallel. Worth highlighting in user docs because the canvas-level metaphor of independent agents suggests parallelism. |
| TC6A.4 | Tool call iteration | ✅ | live (carry-over) | verify-yield's transcript shows multi-turn tool loop end-to-end: `confirm_action` → user-confirmed → `sessions_spawn` → `agent_send` (×3) → terminal "Channel sealed" assistant message. Each tool message has `Thinking` cards interleaved (multi-turn iteration). Token usage chain: 5.3K → 2.2K → 4.1K → 43 → 124 → 162 → 157 → 115 (per-turn input growth, per-turn output 334/451/2.1K/89/5/89/89/14). |
| TC6A.5 | Mid-stream abort | ⏭ static | code | Path verified: [run-coordinator.ts:690](../../../server/agents/run-coordinator.ts#L690) — running run → `record.abortController.abort()` + `runtime.abort()` + `cancelPendingHitl` + `finalizeRunError`. No live trigger because there's no UI Stop button observed during streaming, and we didn't trigger a long enough run to manually `wait()` then abort externally. |
| TC6A.6 | Provider error: invalid model id (F-06) | ✅ | live + carry-over | Already triple-confirmed in §1/§2/§3. Backend throw site: [model-resolver.ts:56](../../../server/runtime/model-resolver.ts#L56) — `"No model template available for provider: <pid>"`. Surface path: `runtime_error` event → `lifecycle:error` `StructuredError`. |
| TC6A.7 | Provider 429 / rate-limit | ⏭ deferred | — | B13 — would require deliberately hitting OpenRouter quota or routing through a stub provider. Code path: `runWithFetchLogging` parses non-2xx body, sets `runtime.lastApiError`. Surface is via `lifecycle:error` `code: 'internal'` per `classifyError`. |
| TC6A.8 | Runtime restart preserves persisted state | ⏭ static | code + grep | **Survives:** `agent-config.json` (1 per agent, written by `persistConfig` at [agent-manager.ts:394-403](../../../server/agents/agent-manager.ts#L394-L403)); session JSONL transcripts (filesystem); session-store records; `settings.json`; `.sam/server.pid` (rewritten on next listen). **Lost:** in-memory `RunRecord` map; live `ManagedAgent` map. **F-12 below** — `restoreFromDisk` is exported at [agent-manager.ts:407](../../../server/agents/agent-manager.ts#L407) but `grep -r "restoreFromDisk" server/` finds no caller in `server/index.ts`; agents are only re-`start()`ed on first chat-open (lazy). Manual restart test deferred (B10). |
| TC6A.9 | Reconnection mid-stream | ⏭ deferred + finding | — | `EventBridge.broadcast` has no replay buffer ([event-bridge.ts:45](../../../server/agents/event-bridge.ts#L45)). Search of `app.get/post/put/delete` in `server/index.ts` shows **no `/api/agents/:id/runs/...` routes** — there is no REST catch-up endpoint. So events emitted during a WS disconnect are LOST and there's no formal recovery beyond the transcript re-fetch (which only contains finalized assistant turns, not in-flight deltas). The `coordinator.wait()` is only reachable via the WS `run:wait` command, not REST. Re-confirms F-01's REST-only fallback note: there isn't a fallback. |
| TC6A.10 | Agent config update mid-run vs after run | ✅ static | code | [agent-manager.ts:118-122](../../../server/agents/agent-manager.ts#L118) `start()` calls `destroy()` on existing entry before rebuild; `destroy()` calls `runtime.destroy()` → `agent.abort()`. In-flight runs end as error. After-run: clean rebuild; `safetySettings` snapshot refreshes via [`buildRuntime`:381-391](../../../server/agents/agent-manager.ts#L381-L391) calling `this.getSafetySettings()` at construction. |
| TC6A.11 | Hook blocks message_received | ✅ static | code | [run-coordinator.ts:316-329](../../../server/agents/run-coordinator.ts#L316-L329) (per spec) — `MESSAGE_RECEIVED` hook with `ctx.blocked = true` → record finalized with `code: 'aborted'` BEFORE entering the queue; diagnostic appended; no provider call. |
| TC6A.12 | Hook claims reply (synthetic) | ✅ static | code | [run-coordinator.ts:1609-1645](../../../server/agents/run-coordinator.ts#L1609-L1645) — `BEFORE_AGENT_REPLY` hook sets `claimed: true, syntheticReply` → coordinator emits `lifecycle:start`, builds assistant message with `provider/model` from config, calls `applyAssistantUsage` (line 1637), persists, emits synthetic payload, finalizes success. No provider call. |
| TC6A.13 | Run timeout | ✅ static | code | [run-coordinator.ts:1667-1668](../../../server/agents/run-coordinator.ts#L1667) — `timeoutMs ?? config.runTimeoutMs`. Default `runTimeoutMs = 172_800_000` (48h) per `graph-to-agent.ts:731`. Live trigger would need a hung provider stub. |
| TC6A.14 | Stream idle timeout | ✅ static | code | [run-coordinator.ts:1706-1726](../../../server/agents/run-coordinator.ts#L1706-L1726) — watchdog timer fires `STREAM_IDLE_TIMEOUT_MS = 30_000` after `message_start` if no token arrives. Logs `[<agentId>] stream idle timeout after 30000ms`. |
| TC6A.15 | Unknown finish_reason rewrite | ✅ static | code | `mapUnknownFinishReason` mappings confirmed in [stream-wrapper.ts:14](../../../server/runtime/stream-wrapper.ts#L14) per spec. The function is called only when pi-ai's `mapStopReason` returned null — exactly the Gemini-via-OpenRouter `MAX_TOKENS`/`MALFORMED_FUNCTION_CALL`/etc case. |
| TC6A.16 | Backend OS rewrite in runtime section | ✅ | live REST | Posted live `verify-yield-agent` config to `POST /api/agents/.../resolved-system-prompt`. Client-side resolver emitted `Runtime: host=simple-agent-manager \| os=Win32 \| model=anthropic/claude-haiku-4.5` (browser's `navigator.platform`). Backend response rewrote to `os=win32` (Node `process.platform`). **Bonus**: backend response has 12 sections vs the client's 8 — backend ADDS `workspace-runtime` (server-fallback workspace) and `confirmationPolicy` sections. The client's preview never sees those, only the backend assembled prompt. |
| TC6A.17 | Safety settings re-read on next start | ✅ static | code | [agent-manager.ts:389](../../../server/agents/agent-manager.ts#L389) `buildRuntime` reads `this.getSafetySettings()` at construction. The closure captures live `currentSafetySettings` from `server/index.ts:49`. So a settings PUT updates `currentSafetySettings` (line 627) but does NOT rebuild any running runtime — the new value only applies the next time `start()` is called for an agent. |
| TC6A.18 | Manual compact via REST | ✅ | live REST | `POST /api/sessions/node_YxU3zJ_wRI/agent:.../compact` returns 400 with `{"error":"Agent <id> is not running. Open a chat session first to start the agent."}` when no chat is open (matches spec § server/index.ts:343). Did not invoke against a running agent (would require initiating a session and accepting the compaction's transcript mutation). |
| TC6A.19 | Concurrent dispatch then abort the queued one | ✅ static | code | [run-concurrency-controller.ts:105-126](../../../server/agents/run-concurrency-controller.ts#L105-L126) — `abortPending` returns `{removed:false}` if `activeRunId === runId` (forces caller to use runtime abort instead). Otherwise removes from session + global queues, returns `affectedRunIds` (those whose position shifted). Coordinator emits `queue:left` reason `'aborted'`. |
| TC6A.20 | `wait(runId, timeoutMs)` boundary | ✅ static | code + REST grep | [run-coordinator.ts:532](../../../server/agents/run-coordinator.ts#L532) — `wait()` uses `timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS` (= 30_000). Returns `{ status: 'timeout', phase: record.status, payloads: [] }` on timer fire. Subsequent `wait()` after completion returns the real result while record is in TTL window (`RUN_RECORD_TTL_MS = 5*60*1000`). **No REST endpoint for wait** — search of `app.(get\|post\|put\|delete)\(` in `server/index.ts` shows zero `/api/agents/.../runs/...` routes. So `wait()` is reachable only via the WS `run:wait` command. |

## Findings

### F-12 (new, minor) — `restoreFromDisk` is exported but never called on server boot — **RESOLVED 2026-05-10**

**Where**: [server/agents/agent-manager.ts:407](../../../server/agents/agent-manager.ts#L407)

**Symptom (pre-fix)**: `restoreFromDisk` was exported but no caller existed in `server/index.ts`. Agents only re-`start()`ed lazily when a client opened chat. Boot-time hooks, crons, and sub-agent registries didn't fire until a client attached.

**Severity**: minor (became potentially major once cron palette landed — see R-25 fix in this same run).

**Fix**: [server/index.ts:864-887](../../../server/index.ts#L864-L887) — after `httpServer.listen()`, the boot path now reads `settingsFile.load()` to pick up `storageDefaults.storagePath` (falling back to `~/.simple-agent-manager/storage`), invokes `agentManager.restoreFromDisk(storagePath)`, and logs the count. Errors are caught and logged but never block the listener. Lazy-on-chat-open continues to work for any agent the auto-restore missed (e.g., new agents added between disk write and restart). Pairs naturally with the R-25 cron-in-palette fix: scheduled runs now resume on `sam restart` without needing a client to connect first.

## Notes

### Note A — Process-wide single `activeRunId` is stricter than per-agent serialization

The spec calls this out, but it's worth re-emphasizing in docs: TWO agents in the same backend process cannot stream concurrently. If a user has agent A and agent B both active and dispatches a long turn on each, B will queue behind A. The UI (canvas + per-agent chat drawer) suggests parallelism. The actual model is global FIFO. If a future product direction allows per-agent runtime processes (e.g., one Node worker per agent), this constraint vanishes.

### Note B — Backend resolved-system-prompt has MORE sections than client's preview

Live observation: client-side `resolveAgentConfig` produces 8 sections for verify-yield-agent (no `tooling` because no Tools node — wait, scrub: verify-yield DOES have tools, so 12). Re-reading: 12 keys returned by backend for verify-yield. Client and backend should match for the same input config + workspaceCwd. The two extras observed (`workspace-runtime`, `confirmationPolicy`) are server-side additions that fire only when (a) workspace cwd is supplied AND missing from prompt, (b) `confirm_action`/`ask_user` is in tools and `safetySettings.confirmationPolicy` is set. The client's `system-prompt-builder` never adds those (per [system-prompt-builder.ts](../../../shared/system-prompt-builder.ts) — sections 1-15 don't include them). So the backend is the source of truth for the actual prompt sent to the model; the client preview is approximate.

### Note C — No REST catch-up endpoint for in-flight runs

A search of `server/index.ts` for `app.(get|post|put|delete)\(` yields zero `/api/agents/:id/runs/...` routes. The only run-related access is via the WebSocket commands (`agent:dispatch`, `agent:abort`, `run:wait`). So the F-01 "REST polling fallback" framing is incorrect — there's no fallback. If WS drops mid-stream, the client must reconnect via WS to receive future events; transcript GETs only catch up on finalized turns. Worth flagging in §4 docs.

## Methodology notes

- **Source verification** for every test: cited line numbers in [server/agents/agent-manager.ts](../../../server/agents/agent-manager.ts), [server/agents/run-coordinator.ts](../../../server/agents/run-coordinator.ts), [server/agents/run-concurrency-controller.ts](../../../server/agents/run-concurrency-controller.ts), [server/agents/event-bridge.ts](../../../server/agents/event-bridge.ts), [server/agents/stream-processor.ts](../../../server/agents/stream-processor.ts), [server/runtime/agent-runtime.ts](../../../server/runtime/agent-runtime.ts), [server/runtime/model-resolver.ts](../../../server/runtime/model-resolver.ts), [server/runtime/resolve-system-prompt.ts](../../../server/runtime/resolve-system-prompt.ts), [server/runtime/stream-wrapper.ts](../../../server/runtime/stream-wrapper.ts).
- **Constants verified** via `grep`: `STREAM_IDLE_TIMEOUT_MS = 30_000`, `DEFAULT_WAIT_TIMEOUT_MS = 30_000`, `RUN_RECORD_TTL_MS = 5*60*1000`, `NO_REPLY_PATTERN = /^no_reply$/i` — all in `run-coordinator.ts:96-99`.
- **Live REST probes**: TC6A.16 (resolved-system-prompt OS rewrite), TC6A.18 (manual compact 400 path), TC6A.20 (REST endpoint search).
- **Live WS observation**: deferred to S4 carry-over for cold-start (TC6A.1) and tool-call iteration (TC6A.4) since those required no new fresh API turns.
- **Cost discipline**: zero new fresh API turns issued in §6A. All live paths re-used what was observable during §4 plus REST inspection of already-resolved configs.

## Re-confirmations of prior findings

| Prior finding | Tx | Status |
|---|---|---|
| F-01 — REST polling fallback for chat transport | TC6A.9 | re-confirmed via grep — there is no `/api/agents/:id/runs/...` route. WS drop = events lost between drop and reconnect. |
| F-06 — invalid model id error path | TC6A.6 | static-confirmed via [model-resolver.ts:56](../../../server/runtime/model-resolver.ts#L56) throw. |
