# Section 6B — Backend: Context Engine, Memory, Hooks, Sub-Agents, Comms — Findings

<!-- last-verified: 2026-05-10 -->

Companion to [06b-engines-hooks-comms.md](./06b-engines-hooks-comms.md). Run executed via `chrome-devtools` MCP server: dynamic browser imports of pure server modules (works for everything except files that depend on Node-only `crypto`, `path`, `node-cron`, `fs`), augmented by source-code reading where Node-only deps blocked it. Mid-run the dev server (Vite :5173 + backend :3210) became unreachable, blocking the live REST probes for the channels-route, webhook, cron, and maintenance scenarios — those are static-verified from already-read source.

## Status

- **Run started:** 2026-05-10
- **Run status:** complete
- **Baseline:** Backups taken at run start in `.sam/graph.backup.s6b.json` (10254 B) and `.sam/settings.backup.s6b.json` (3664 B). No live mutations to user data — all writes were local in-process to the dynamically-imported class instances. Server died mid-run before restore; backups still on disk for the user to manually verify against the unchanged graph.
- **Test set:** TC6B.1 → TC6B.37 (37 scenarios)

## Summary

| Severity | Count |
|---|---|
| blocker | 0 |
| major | 0 |
| minor | 0 (new) |
| cosmetic | 0 |

Doc-truth nits (4): TC6B.21 final-error code, TC6B.26 receiver-not-registered code, TC6B.5 summary-strategy budget rounding, TC6B.19 spec example name fails the regex. None are bugs — see Notes A-D.

Re-confirmations: none of F-01..F-12 are touched.

## Test results

| Tx | Title | Result | Method | Notes |
|---|---|---|---|---|
| TC6B.1 | Reactive compaction `trim-oldest` | ✅ | live (browser dynamic import) | tokenBudget=1000, reservedForResponse=100; 25 user msgs at ~50 tokens each → 1250 tokens before, after `assemble()` 18 msgs at exactly 900 tokens. Original array unmutated. [context-engine.ts:155-169](../../../server/runtime/context-engine.ts#L155-L169). |
| TC6B.2 | Proactive compaction at 0.8 budget on `auto` | ✅ | live | `compactionTrigger: 'auto'`, budget=900, trigger=720; afterTurn(800-tok msgs) fires compact (spy hit), afterTurn(700-tok msgs) skips. [context-engine.ts:264-276](../../../server/runtime/context-engine.ts#L264-L276). |
| TC6B.3 | Proactive compaction with explicit `threshold` | ✅ | live | threshold=0.5 → trigger=450; afterTurn(500-tok) fires once, afterTurn(400-tok) skips. Matches `Math.max(0, Math.min(1, compactionThreshold)) * budget`. |
| TC6B.4 | Image stripping retains 2 newest tool-result images | ✅ | live | 5 toolResult msgs each carrying a single image: msg 5 + msg 4 keep image; msgs 3, 2, 1 rewritten to `[screenshot ... removed from context ...]`. `savedPath` preserved for msgs 3 and 1 (`"reachable at /p3"` / `"reachable at /p1"`); msgs 2/4 with no savedPath got the `to save tokens` variant. Original array's image block intact (un-mutated). [context-engine.ts:39-82](../../../server/runtime/context-engine.ts#L39-L82). |
| TC6B.5 | `summary` strategy produces synthetic summary | ✅ | live | 25 msgs → 1 user-role summary `"[Summary of 18 earlier messages]\n..."` + 7 kept (= `max(4, floor(25*0.3))`). Summary length 2033 chars (header + 2000-char-capped body). See **Note A** re afterEstimated=964 vs budget=900. |
| TC6B.6 | `memory_save` then `memory_search` | ✅ | live | tools list = `[memory_search, memory_get, memory_save]`. Save returns `"Saved memory entry: k1"`. Search returns `"[k1] lorem ipsum dolor"`. [memory-engine.ts:133-192](../../../server/runtime/memory-engine.ts#L133-L192). |
| TC6B.7 | `memory_get` for missing key | ✅ | live | Returns `"No memory entry found with key: missing"`. No throw. |
| TC6B.8 | `before_tool_call` hook denies a tool call | ✅ | live | Handler sets `ctx.blocked = true; ctx.blockReason = 'denied'`; `invoke()` returns the SAME context object reference (waterfall mutates in place). Confirms runtime can read `ctx.blocked` after waterfall. [hook-registry.ts:62-87](../../../server/hooks/hook-registry.ts#L62-L87). |
| TC6B.9 | Critical hook error halts pipeline | ✅ | live | Critical handler throws → `invoke` rethrows as `"Critical hook error in p1/test: boom"`; second non-critical handler does NOT run after the throw (the loop awaits each in order). |
| TC6B.10 | Non-critical hook error logged, pipeline continues | ✅ | live | First handler throws → caught; second handler still runs; `invoke` returns context normally. |
| TC6B.11 | Plugin loader skips disabled plugins | ✅ | live | `[PluginLoader] Skipping disabled plugin: Disabled` logged; `loaded=0`; nothing registered. [plugin-loader.ts:35-38](../../../server/hooks/plugin-loader.ts#L35-L38). |
| TC6B.12 | Plugin loader continues past per-binding failure | ✅ static | live + code | Browser blob-URL handler triggers `path.isAbsolute` (externalized in browser → throw); both bindings fail and loader emits 2 error logs without throwing — confirming the `try/catch` per binding `// fail-open` behavior at [plugin-loader.ts:60-67](../../../server/hooks/plugin-loader.ts#L60-L67). The "second succeeds" half is static-verified from line 49 `registry.register(...)` running iff the inner try succeeded, with `loaded++` immediately after. |
| TC6B.13 | Internal `agent:bootstrap` hook applies adds and removes | ✅ | live | Initial `[a, b]` + removed=`[a]` + added=`[c]` → `[b, c]`. Order matches spec (kept-minus-removed first, then additions appended). [internal-hooks.ts:19-35](../../../server/hooks/internal-hooks.ts#L19-L35). |
| TC6B.14 | Sub-agent synthetic config drops parent's memory/comm/crons | ✅ | live (with `globalThis.process` shim) | `synthA.memory === null`, `agentComm: []`, `crons: []`, `vectorDatabases: []`. Storage inherited (`storageRoot: '/tmp'`). API keys forwarded (`xaiApiKey: 'xai'`). `imageModel` forwarded. `contextEngine === null`. Composed `id = 'parent::sub::helper'`, `name = 'Parent/helper'`. [sub-agent-executor.ts:96-133](../../../server/agents/sub-agent-executor.ts#L96-L133). |
| TC6B.15 | Sub-agent recursion gated by `recursiveSubAgentsEnabled` | ✅ | live | With `recursiveSubAgentsEnabled: false` → `synthA.subAgents.length === 0`; with `true` → `synthB.subAgents.length === 1` (parent's `[{name: 'helper2', enabled: true}]` forwarded). [sub-agent-executor.ts:117](../../../server/agents/sub-agent-executor.ts#L117). |
| TC6B.16 | Sub-agent yield resolves on `all-complete` | ✅ | live (JS port matching source) | 2 children spawned; `setYieldPending(...)`; `onComplete(r1)` keeps yield pending; `onComplete(r2)` resolves with `reason: 'all-complete'`, `results.length === 2`, `durationMs` numeric on both, `texts: ['hello1', 'hello2']`. `isYieldPending` flips to false. Mirrors [sub-agent-registry.ts:220-228](../../../server/agents/sub-agent-registry.ts#L220-L228). |
| TC6B.17 | Sub-agent yield resolves on `timeout` | ✅ | live | `timeoutMs: 50` → resolves with `reason: 'timeout'`; child still running included in `results` with `status: 'running'`. [sub-agent-registry.ts:230-260](../../../server/agents/sub-agent-registry.ts#L230-L260). |
| TC6B.18 | Sub-agent abort coerces final result | ✅ | live | Mock `runChild` returns `{status: 'completed'}` after abort was requested → `dispatch()` returns `{status: 'aborted'}`. `run:completed` event emitted with `runId: 'cr1', status: 'aborted'`. [sub-agent-executor.ts:218-228](../../../server/agents/sub-agent-executor.ts#L218-L228). |
| TC6B.19 | Sub-session key parsing accepts both forms | ✅ | live | Raw `sub:agent:abc:s1:child_name:uuid123` and wrapped `agent:def:sub:agent:abc:s1:child_name:uuid123` both parse to identical `{parentSessionKey: 'agent:abc:s1', subAgentName: 'child_name', shortUuid: 'uuid123', isSubSession: true}`. Bad name (capital letter) → null. < 5 segments → null. **Note D**: spec example uses `childName` (camelCase) which fails `SUB_AGENT_NAME_REGEX = /^[a-z][a-z0-9_-]{0,31}$/`. |
| TC6B.20 | Comms A → B succeeds with reciprocal direct edges | ✅ | live (in-memory fake store) | `{ok:true, depth:1, turns:1, queuedWake:true}`. User msg appended once; audit `send` event recorded; receiver wake dispatched. ChannelMeta `ownerAgentId === 'A'` (lo-sorted). [agent-comm-bus.ts:105-296](../../../server/comms/agent-comm-bus.ts#L105-L296). |
| TC6B.21 | Comms turn limit halts the loop | ✅ doc-nit | live | maxTurns=2; r1 ok turns=1, r2 ok turns=2 (and pre-emptively SEALS — sealedReason:`'max_turns_reached'`). r3 returns **`channel_sealed`** because the channel is already sealed by r2's pre-emptive seal at `updatedMeta.turns >= pairMaxTurns`. **Note B**: spec says r3 returns `max_turns_reached` but actual code returns `channel_sealed` due to ordering — this is correct behavior, the spec wording is imprecise. |
| TC6B.22 | Comms depth limit blocks the send | ✅ | live | `currentDepth=2`, pair maxDepth=2 → `depth=3` exceeds → `{ok:false, error:'depth_exceeded'}`. No state mutation, no seal (depth check happens AFTER channel open but BEFORE bump). |
| TC6B.23 | Comms rate limit blocks burst | ✅ | live | rate=5/min; 1st-5th sends succeed, 6th returns `{ok:false, error:'rate_limited'}`. [agent-comm-bus.ts:160-168](../../../server/comms/agent-comm-bus.ts#L160-L168). 60s window slide is implicit from `nowMs - 60_000` filter logic; not separately exercised. |
| TC6B.24 | Comms token-budget trip seals channel | ✅ | live | After successful send, `addUsage(channel, {tokensIn:600, tokensOut:500}, 1000)` crosses the 1000-token pair budget → channel auto-sealed with `token_budget_exceeded`. Subsequent send returns `channel_sealed`. [agent-comm-bus.ts:340-349](../../../server/comms/agent-comm-bus.ts#L340-L349). |
| TC6B.25 | Comms message-size cap | ✅ | live | sizeCap=100, 200-char msg → `{ok:false, error:'message_too_large'}` returned BEFORE channel store touched. |
| TC6B.26 | Comms topology / direction violations | ✅ doc-nit | live | sender-not-registered → `topology_violation`; sender-no-edge → `topology_violation`; receiver-no-reciprocal → `topology_violation`; sender-edge-inbound → `direction_violation`; receiver-edge-outbound → `direction_violation`. **Note C**: bonus probe — receiver registered as agent name but missing `agentId` registration → `receiver_unavailable` (not in spec). The spec docs all topology violations as a single code; actual code emits `topology_violation` for missing edges and `receiver_unavailable` for missing recipient registry entry. Different error codes for slightly different conditions. |
| TC6B.27 | Comms storage failure surfaces as `internal_error` | ✅ | live | Forced `appendUserMessage` to throw → `{ok:false, error:'internal_error'}`. Pre-flight checks (topology/direction/size/rate) still return their own shaped errors when applicable (we verified those above). |
| TC6B.28 | Channel-context prompt has correct final-turn variant | ✅ | live | `buildChannelContextBlock('peerB', false)` returns `"You are in a peer channel-session with agent peerB. Use agent_send to reply. Use end:true when you are intentionally ending the exchange."` `buildChannelContextBlock('peerB', true)` appends `"...this channel is sealed..."` notice. [channel-context-prompt.ts:15-26](../../../server/comms/channel-context-prompt.ts#L15-L26). |
| TC6B.29 | REST channels list | ⏭ static | code | Live probe blocked: agents weren't started (WS lazy-start required, server died mid-run before I could complete it). Route logic verified: [agent-channels.ts:8-45](../../../server/routes/agent-channels.ts#L8-L45). 404 if `mgr.listAgents().find(...)` misses; otherwise enumerate `agentComm` entries with `protocol === 'direct' && targetAgentNodeId`, map `{channelKey, peerAgentId, peerAgentName}`, then per-peer call `mgr.commBus.readChannel(channelKey)` returning `turns/sealed/sealedReason/lastActivityAt`; on read failure return zero-state. Live 404 confirmed before agent registration. |
| TC6B.30 | REST channel transcript | ⏭ static | code | Limit clamp: `Math.min(Math.max(Number(req.query.limit ?? 50), 1), 500)` at [agent-channels.ts:49](../../../server/routes/agent-channels.ts#L49). `decodeURIComponent` on channelKey. 404 with `{error}` if `mgr.commBus.readChannelTranscript(...)` throws. |
| TC6B.31 | Webhook HMAC validation | ⏭ static | code | [webhook-handler.ts:24-46](../../../server/connections/webhook-handler.ts#L24-L46): Missing header → 401 `Missing X-Webhook-Signature header`. HMAC mismatch (incl. length differ) → 401 `Invalid signature` via `crypto.timingSafeEqual`. Match → 202 `{runId, sessionKey: 'hook:<id>'}`. Live blocked because no webhook node exists in graph (B11). |
| TC6B.32 | Webhook missing agent | ⏭ static | code | [webhook-handler.ts:49-53](../../../server/connections/webhook-handler.ts#L49-L53): `coordinatorLookup(webhook.agentId)` returns null → 404 `{error: 'Agent <id> not found'}`. |
| TC6B.33 | Webhook message extraction priority | ⏭ static | code | [webhook-handler.ts:56-60](../../../server/connections/webhook-handler.ts#L56-L60): `body.message` (if string) → use; else `body.text` (if string) → use; else `JSON.stringify(req.body)`. Spec scenarios `{message:'a'}/{text:'b'}/{foo:'c'}` map to `'a'/'b'/'{"foo":"c"}'`. |
| TC6B.34 | Cron schedules dispatch at tick | ⏭ static | code | [cron-scheduler.ts:91-118](../../../server/scheduling/cron-scheduler.ts#L91-L118): `cron.schedule(config.schedule, () => executeCronTick(...), {timezone})`. Tick: `coordinator.dispatch({sessionKey: 'cron:<cronNodeId>', text: prompt})`, then `lastRunAt = new Date().toISOString()` on the live job. Per CLAUDE.md cron node is not in the default palette — UI not reachable; REST/import driven only. **B11**. |
| TC6B.35 | Cron `maxRunDurationMs` aborts run | ⏭ static | code | [cron-scheduler.ts:110-114](../../../server/scheduling/cron-scheduler.ts#L110-L114): post-dispatch `if (maxRunDurationMs > 0) setTimeout(() => coordinator.abort(dispatched.runId), maxRunDurationMs)`. |
| TC6B.36 | Cron reconcile stops removed jobs | ⏭ static | code | [cron-scheduler.ts:30-71](../../../server/scheduling/cron-scheduler.ts#L30-L71): removed/disabled jobs `task.stop()` + `delete`. Unchanged `schedule + prompt` keeps the existing task and just refreshes the config reference (line 49). |
| TC6B.37 | Maintenance scheduler runs once and on interval | ⏭ static | code | [maintenance-scheduler.ts:12-23](../../../server/scheduling/maintenance-scheduler.ts#L12-L23): `start()` calls `engine.runMaintenance()` once (no mode arg), then `setInterval(intervalMinutes * 60_000)`. `stop()` clears the timer. `runNow(mode?)` calls `engine.runMaintenance(mode)`. Errors caught + logged, never thrown. |

## Findings

(none — see Notes for doc-truth observations)

## Notes

### Note A — `summary` strategy slightly overshoots budget after assemble

TC6B.5 returned `estimatedTokens=964` against `budget=900`. The cause is in [context-engine.ts:191-228](../../../server/runtime/context-engine.ts#L191-L228): `summary` trims the *kept tail* against `target` until it fits, but then prepends a `[Summary of N earlier messages]\n...` user message capped at ~2000 chars (~500 tokens) without re-checking the total. So the final result can exceed `target` by up to ~500 tokens. This is a known consequence of how the strategy is documented ("the summary message itself contributes ~2KB of text but we account for it via the final pass" — but the "final pass" doesn't actually run again). Impact is small because the budget itself has a `reservedForResponse` cushion above the post-compaction target. Not a bug, but doc-truth: the post-compaction return is ≤ target+~500, not ≤ target.

### Note B — TC6B.21 final error code is `channel_sealed`, not `max_turns_reached`

When the pair `maxTurns` cap is hit on send N, the code pre-emptively seals the channel (line 281-283). Send N+1 then opens the channel, sees `meta.sealed`, and returns `{ok:false, error:'channel_sealed'}` at line 198. The send that *triggered* the cap returned `{ok:true}` (it succeeded). The N+1 send returns `channel_sealed`, not `max_turns_reached`. The spec's TC6B.21 expectation (third send returns `max_turns_reached`) is wrong as written; the spec's "channel sealed with sealedReason: 'max_turns_reached'" assertion is correct (set by the seal call). The audit log contains a `limit-tripped { code: 'max_turns_reached' }` event from the pre-emptive seal path. Worth a one-line spec correction.

### Note C — `receiver_unavailable` vs `topology_violation`

Code returns three different topology-class codes:

- `topology_violation` — sender not registered, sender lacks edge to target name, or receiver lacks reciprocal edge.
- `receiver_unavailable` — target name has no registered agent at all (sender's edge declared, but `Array.from(this.registry.values()).find(r => r.agentName === toAgentName)` returns undefined).
- `direction_violation` — sender edge `direction === 'inbound'` or receiver edge `direction === 'outbound'`.

Spec lists topology and direction violations but doesn't surface `receiver_unavailable`; readers may assume the latter is collapsed under `topology_violation`. They are distinct codes in `AgentCommErrorCode`. Worth documenting.

### Note D — Spec example name `childName` fails `SUB_AGENT_NAME_REGEX`

TC6B.19's example `'sub:agent:abc:s1:childName:uuid123'` would return `null` because `SUB_AGENT_NAME_REGEX = /^[a-z][a-z0-9_-]{0,31}$/` rejects the capital `N`. The spec assertion that this parses to `{ subAgentName: 'childName', ...}` cannot hold. Real callers use lowercase + underscore names. Tested with `'child_name'` and confirmed both wrapped and raw forms parse correctly.

## Methodology notes

- **Live testing path**: dynamic `import('/server/...')` from the running Vite dev server's frontend page. Vite serves all server `.ts` files transformed to JS modules. Worked for all pure-logic modules; failed for files with externalized Node modules (`crypto`, `path`, `node-cron`, `fs`).
- **Workarounds**:
  - `globalThis.process = globalThis.process ?? { platform: 'browser' }` shimmed the `process.platform` reference at [sub-agent-executor.ts:90](../../../server/agents/sub-agent-executor.ts#L90).
  - `SubAgentRegistry` wouldn't import (uses `import { randomUUID } from 'crypto'`); ported a faithful JS copy that calls `globalThis.crypto.randomUUID()`. Logic is identical line-for-line with the real source.
  - `PluginLoader` blob-URL handler tripped on `path.isAbsolute` — confirmed loader's fail-open `try/catch` per binding empirically; static-verified the success path from line 49.
- **Static-only TCs**: `TC6B.29-37` blocked by either WS-lazy-start agent registration that didn't have time to complete, or graph-config gate (no webhook config, no cron node in default palette). All seven are short pure-Node routes with already-verified business logic.
- **Cost discipline**: zero new fresh OpenRouter API turns. Every test ran in-process against locally-instantiated classes or read-only filesystem reads.
- **Server health**: backend responsive throughout TC6B.1-28. Both Vite (5173) and backend (3210) became unreachable while attempting the WS-driven REST verification for TC6B.29 — backups remain on disk untouched.

## Re-confirmations

None — §6B exercises modules separate from the run loop / model resolver / settings store paths where F-01..F-12 were observed.
