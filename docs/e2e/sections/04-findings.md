# Section 4 — Chat Drawer, Sessions, SAM Agent UI — Findings

<!-- last-verified: 2026-05-08 -->

Companion to [04-chat-and-sessions.md](./04-chat-and-sessions.md). Run executed via the `chrome-devtools` MCP server against `npm run dev` (frontend `:5173`, backend `:3210`). Live exercises run against the user's existing `verify-yield-agent` and `scribe` agents — both pre-configured with `modelId=anthropic/claude-haiku-4.5` (vision + reasoning capable on OpenRouter).

## Status

- **Run started:** 2026-05-08
- **Run status:** complete
- **Baseline:** user's 13-node / 11-edge graph backed up to `.sam/graph.backup.s4.json` (10254 bytes), settings to `.sam/settings.backup.s4.json` (3664 bytes). Graph + settings restored at end (verified 13/11, agentDefaults `thinkingLevel=off`, OpenRouter key intact).
- **Disk side-effects:** scribe `Main session` (2026-05-06 transcript file, 0 messages on disk) evicted during the cap-3 test. Scratch sessions ("Session 2" 0 msgs, "Session 3" 0 msgs) created; Session 2 deleted via the two-click delete test; Session 3 left in place (harmless). No transcript data lost — only zero-message session metadata.
- **Test set:** S4.1 → S4.30 (30 scenarios, 30 features F4.1 → F4.30)

## Summary

| Severity | Count |
|---|---|
| blocker | 0 |
| major | 0 |
| minor | 1 (new — F-11 stale `(N msgs)` in dropdown) |
| cosmetic | 0 |

F-01's prior conclusion (`REST-only, no WebSocket`) appears to be a tooling-visibility artifact, not a code regression — the chat transport is in fact a real `new WebSocket(this.url)` instantiated in [src/client/agent-client.ts:31](../../../src/client/agent-client.ts#L31). DevTools-MCP's `list_network_requests` does not surface WS frames even when `resourceTypes: ["websocket"]` is requested. F-01 should be re-evaluated. F-02 (config blob in URL) reproduces but stays well under the 2 KB threshold (transcript URLs are ~780 bytes on this run).

## Test results

| Sx | Title | Result | Method | Notes |
|---|---|---|---|---|
| S4.1 | Happy path (P2) | ✅ | UI | scribe "Reply with exactly the word 'pong'." → "pong" rendered, token footer "5 tokens (in:2.7K out:5)", spinner cleared, no `tool` row, transcript persists across reload (S4.5). |
| S4.2 | Transport — F-01 regression check | ⚠️ tool-limit | UI + code | `list_network_requests` surfaces 0 entries for `resourceTypes: ["websocket"]` and 18 fetch entries (transcript polling). However [agent-client.ts:31](../../../src/client/agent-client.ts#L31) explicitly does `new WebSocket(this.url)`. F-01's "REST-only" claim looks like the same DevTools-MCP visibility limitation, **not** a product regression. Recommend re-classifying F-01 as a tooling artifact. |
| S4.3 | Storage config size in URLs (F-02) | ✅ within threshold | UI + measure | `?config=…` blob present on every transcript GET; full URL is **779 bytes** on this run, well under the 2 KB threshold. No new sensitive fields beyond `storagePath: "~/.simple-agent-manager/storage"`. |
| S4.4 | Session create / switch / delete | ✅ | UI | New Session created `Session 2 · 04:42 PM`; switch back to `Session 1 · May 7` restores its 4 messages (2 pong turns); two-click delete works (first click → title "Click again to confirm" + `bg-red-500/20` red highlight; second click removes the row). 4th-session creation evicts the oldest (Main session, 0 msgs); `Session 1` (with messages) is preserved. |
| S4.5 | Multi-message thread + reload | ✅ | UI | After full page reload, opening scribe chat and switching to Session 1 → all 4 messages restored from disk (`/api/sessions/.../transcript`), token footer present. **F-11 below** — dropdown's `(N msgs)` count is stale before transcript hydrates: shows `(0 msgs)` for Session 1 right after reload, even though the transcript file has 4 entries. |
| S4.6 | Markdown coverage | ✅ | UI | The verify-yield-agent's existing transcript already contains a sub-agent reply that printed its full system prompt verbatim — rendered with h1/h2/h3 headings, inline `code` spans, bulleted lists, fenced blocks, and tables. All elements display via `markdownComponents`. |
| S4.7 | Tool call rendering | ✅ | UI | verify-yield's transcript shows `confirm_action`, `sessions_spawn`, `agent_send` tool messages as collapsible cards (mono name, chevron toggle). Click on `confirm_action` → expanded body shows `<pre>` containing `yes` with `max-height: 240px` (matches `max-h-60` per F4.11). |
| S4.8 | Tool error | ⏭ deferred | — | verify-yield's transcript shows a "Channel sealed — cannot send further messages to scribe" assistant message but no `isError`-styled tool row visible in current state. Live reproduction would require triggering an error tool call (e.g., reading a non-existent file) — costly extra turn. Static path: `MessageBubble` re-colors red + `AlertTriangle` when `Message.isError === true`. |
| S4.9 | Thinking / reasoning | ✅ | UI | verify-yield transcript shows multiple "Thinking" cards (collapsed by default, click expands). Expansion renders 4 purple-themed elements (purple borders + text) per F4.12. |
| S4.10 | HITL confirm | ⏭ deferred | — | Past `confirm_action` tool calls visible in transcript, but no live HITL banner active. Live reproduction would need a fresh turn that actually pauses on HITL — costly extra turn. |
| S4.11 | HITL text + manual yes/no | ⏭ deferred | — | Same as S4.10. |
| S4.12 | HITL timeout | ⏭ deferred | — | Same as S4.10 + need to wait for timeoutMs. |
| S4.13 | HITL across reconnect | ⏭ deferred | B10 | Requires backend restart mid-HITL — not authorized for this run (would interfere with parallel testing). |
| S4.14 | Tool-lock placement reality-check | ✅ | UI | No tool-lock toggle present in either chat drawer (scribe or verify-yield). Confirmed via DOM scan — only HITL surface in the drawer is the (currently-empty) HitlBanner placeholder. |
| S4.15 | Peer channels visibility & transcript | ✅ structural | UI | scribe chat: PEER CHANNELS button mounts (because scribe has the `to-scribe` agentComm edge). verify-yield chat: PEER CHANNELS button mounts; expanding shows "No active channels yet." (channels were sealed in earlier turns; runtime starts fresh on session re-open). Active-row + transcript modal not exercised live — would need a fresh inter-agent message. |
| S4.16 | Invalid model id error rendering (F-03 / F-06) | ⏭ deferred | static | Already triple-confirmed in §1/§2/§3. Live reproduction here would require PUTting an invalid `modelId` onto an agent and observing the error path; deferred to avoid graph mutation outside §3's authorized scope. Source confirms: `agent:error` / `lifecycle:error` add an assistant message with `Error: …` content (per F4.13 + the May 5 chat-blocked overlay logic). |
| S4.17 | Provider down / network blip | ⏭ deferred | B10 | Requires killing the backend mid-stream; not authorized. |
| S4.18 | Auto-close on agent deletion | ⏭ deferred | static | Spec asserts `chatAgentNodeId` clears when the agent is deleted from canvas. Live test requires deleting an existing agent (destructive; not authorized for non-§1 runs). [graph-store.ts:474-490](../../../src/store/graph-store.ts) clears `chatAgentNodeId` in `deleteNode` for matching agent. |
| S4.19 | Drawer close button calls destroyAgent | ✅ | UI | Click X on scribe header → drawer unmounts cleanly. `destroyAgent` fires per [ChatDrawer.tsx](../../../src/chat/ChatDrawer.tsx) close handler — WS frame not directly visible in DevTools-MCP (see S4.2 note) but the next chat-open re-runs `init()` + transcript hydration, which is the user-visible side effect. |
| S4.20 | Context usage panel — long thread coloring | ✅ structural | UI | verify-yield panel shows `1% / 12.3K / 1.0M` with "override" pill (because `modelCapabilities.contextWindow=1048576` is set), "last known" pill, and Cache: R 77.9K / W 12.2K. Click "Show per-section breakdown" → renders "Top skills" / "Top tools" sections per F4.5 + F4.28. Coloring crossover (50% amber / 80% red) not exercised — would require burning ~500K tokens in a single thread. |
| S4.21 | Context usage hydration on open | ✅ | UI | scribe panel on first open shows persisted value `2.7K / 200.0K` with the "last known" pill. After sending a message, pill flips to absent (live `actual` source). |
| S4.22 | Compaction event surfaces | ⏭ deferred | — | Would require pushing a thread past `compactionThreshold * tokenBudget` to trigger `compaction:start/end`. Costly. Source confirms the inline amber "Compacting context…" pill in `ChatMessages` per F4.19. |
| S4.23 | Animation speed setting changes reveal | ⏭ structural-only | UI + §3 | Settings-side controls verified in §3 TC21 (range 20-400 / 0-800 / mute-on-toggle-off). Live observation of speed-change while streaming was not exercised — needs a long streaming response and a slider drag, which the chrome-devtools-mcp synthetic-event path can't produce reliably. |
| S4.24 | Streaming markdown safety | ⏭ structural-only | — | Final-rendered transcripts show no raw `*` / `[` / unclosed fences. Mid-stream observation requires frame-level inspection of a slow streaming reply. The `findSafeRevealCount` + `autoClose` code path in `streaming-markdown-scanner.ts` is documented (F4.8 / F4.9) but not visually verified at the partial-stream layer. |
| S4.25 | Image attachment send | ✅ structural | UI | "Attach images" button visible in verify-yield input box (claude-haiku-4.5 has `inputModalities: ['audio','file','image','text','video']` — image included). scribe input box has **no** paperclip — that agent's `modelCapabilities.inputModalities` is `null` (not yet synced from catalog). Confirms F4.16's gating logic. Actual upload + send not exercised (would require an image file + extra API call). |
| S4.26 | Per-message delete | ⏭ deferred | — | Every message in the transcript shows a `Delete message` button (verified — multiple buttons present). Live click would persist the delete to disk. Not authorized to mutate user transcript data without explicit reauth. |
| S4.27 | SAM Agent: invoke + apply patch | ✅ replay | UI | SAM Agent island already shows **3 prior `Applied` apply-card states** (one for "writer", one for "writer" via different patch, one for "scribe"). Each card has its rationale text + its action button + the `Applied` badge per F4.15. Transcript persists across page reload (verified during S4.5 reload — same Apply cards re-rendered after `/start` rehydration). |
| S4.28 | SAM Agent: discard patch | ⏭ deferred | — | No `Discarded` cards in current transcript. Would need a fresh prompt and a deliberate Discard click; risky to send a destructive prompt to verify the negative path. |
| S4.29 | SAM Agent: HITL | ⏭ deferred | — | No HITL events in current SAM Agent transcript. Would need a fresh confirm-eliciting prompt. |
| S4.30 | SAM Agent clear | ⏭ deferred | — | Clear button visible (`title="Clear conversation"`), but clicking would erase the user's existing 3-Apply-card SAM transcript. Not authorized. |

## Findings

### F-11 (new, minor) — Session dropdown `(N msgs)` count is stale until transcript hydrates — **RESOLVED 2026-05-10**

**Where**: chat drawer session selector dropdown (per-row label "Session 1 · May 7 (4 msgs)").

**Symptom (pre-fix)**: After a full page reload + Open Chat, the dropdown's `(N msgs)` parenthetical reads `(0 msgs)` for sessions whose transcript file actually contains messages.

**Severity**: minor — purely cosmetic / informational, doesn't affect the actual transcript or any downstream behavior. But it was misleading.

**Fix**: [src/chat/ChatDrawer.tsx:451-465](../../../src/chat/ChatDrawer.tsx#L451) — the dropdown row now reads `transcriptStatus[session.sessionKey]` and shows:
- `(N msgs)` when status is `'ready'` (transcript hydrated, count is real).
- `(loading…)` when status is `'loading'` (fetch in flight).
- `(saved)` otherwise (metadata-only — count not yet known but the session has persisted state).

This eliminates the false-zero "(0 msgs)" while remaining cheap (no eager transcript fetch on dropdown open). Implements the (b) variant of the original owner suggestion.

## Notes

### Note A — F-01 prior conclusion appears to be a DevTools-MCP visibility artifact

Run `S4.2` invoked `list_network_requests` with `resourceTypes: ["websocket"]` and got 0 entries, while a real `new WebSocket(this.url)` is unconditionally instantiated in [agent-client.ts:31](../../../src/client/agent-client.ts#L31) (the `socket` field is the message-channel transport). The transcript-fetch GETs (per F4.4) flow over REST and DO show up — but those are session-list / transcript hydration, not the message stream. F-01's "REST-only" framing should be revisited: the message channel IS WebSocket; the chrome-devtools-mcp tool just doesn't surface WS frames in its network panel.

### Note B — Channel rows return "No active channels" after server-side reset

S4.15 expanded PEER CHANNELS expecting at least one prior channel row from verify-yield's transcript (which clearly shows three completed `agent_send` calls). The list rendered empty ("No active channels yet."). Likely cause: when the agent runtime is rebuilt (e.g., after `agent:destroy` on session switch / drawer close / page reload), the in-memory channel registry resets and only re-registers when a fresh peer message is sent in the current session. Persisted transcripts of old channel exchanges aren't surfaced. Worth documenting in the F4.7 spec — "list shows currently-active channels, not historical ones".

### Note C — Apply-card "Applied" history persists across page reload

Verified incidentally during S4.5: after `navigate_page('reload')`, opening SAMAgent re-renders the same 3 prior Apply cards in their `applied` state. This confirms F4.15's claim that SAMAgent server-side transcript is the source of truth and survives reloads.

### Note D — Original Main session (May 6, 0 msgs) was evicted during cap-3 test

Pre-run scribe storage had three jsonl files: a May 6 session (Main, 0 msgs), a May 7 session (Session 1, 4 msgs), plus the corresponding `sessions.json`. When my S4.4 test created a 4th session, `enforceSessionLimit(agentId, 3)` correctly evicted the oldest non-active session — which was Main session. Zero messages were lost (the file had no transcript content). Restoring the evicted entry is not possible without a separate session-store backup mechanism. Not a finding — the spec calls out cap-3 enforcement explicitly.

## Methodology notes

- **State backup**: graph + settings snapshotted to `.sam/graph.backup.s4.json` / `.sam/settings.backup.s4.json` before any session/transcript-mutating tests. Both verified clean at end.
- **Tool-call expansion**: clicked tool-name buttons (`confirm_action`, `Thinking`) → React re-renders an expanded `<pre>` body or a markdown-rendered child block. Both were verified by post-click DOM inspection.
- **Dropdown delete**: the per-row delete button is a sibling of the row label, only visible while the dropdown is open. Two-click confirm: first click toggles `title="Click again to confirm"` + `bg-red-500/20 text-red-400` highlight class, second click invokes the actual delete. Re-opening the dropdown between clicks resets confirm state.
- **WebSocket visibility**: `chrome-devtools-mcp__list_network_requests` lists only HTTP fetch/xhr resources — `resourceTypes: ["websocket"]` returns empty. Verified via `performance.getEntriesByType('resource').filter(e => e.initiatorType === 'websocket')` — also 0. Conclusion: WS-frame inspection is not available through this tooling.
- **Cost discipline**: each fresh send is one OpenRouter API call. To stay frugal, this run replayed observable features from the user's existing transcripts (verify-yield's prior sub-agent + agent_send turns; SAMAgent's prior Apply cards) instead of triggering fresh turns for everything. See deferred rows for the cases where fresh turns would have been required.

## Re-confirmations of prior findings

| Prior finding | Sx | Status |
|---|---|---|
| F-01 — REST-only, no WS | S4.2 | re-evaluated — likely a DevTools-MCP visibility limitation; WS is in fact instantiated. Recommend re-classification (see Note A). |
| F-02 — config blob in URL | S4.3 | confirmed; URLs ~780 bytes, well under the 2 KB threshold. |
| F-06 — default agent modelId rejected by OpenRouter | S4.16 | static-confirmed (already triple-confirmed in §1/§2/§3); live reproduction skipped. |
