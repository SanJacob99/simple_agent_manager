# Section 4 — Chat Drawer, Sessions, SAM Agent UI

<!-- last-verified: 2026-05-08 -->

## Scope

Everything that surfaces to the user **inside** a chat experience:
the right-hand chat drawer for an agent node, its session selector,
streaming message rendering, the HITL banner, the context-usage panel,
the peer channels collapsible, and the in-app SAM Agent assistant
(left-side island). Out of scope: the runtime that drives the streams
(Section 6), the storage layer behind sessions (Section 7), and
property editors that produce the resolved AgentConfig (Section 2).

Primary files:

- `c:\Projects\simple_agent_manager\src\chat\ChatDrawer.tsx`
- `c:\Projects\simple_agent_manager\src\chat\ChatMessages.tsx`
- `c:\Projects\simple_agent_manager\src\chat\ChatInput.tsx`
- `c:\Projects\simple_agent_manager\src\chat\MessageBubble.tsx`
- `c:\Projects\simple_agent_manager\src\chat\HitlBanner.tsx`
- `c:\Projects\simple_agent_manager\src\chat\PeerChannelsSection.tsx`
- `c:\Projects\simple_agent_manager\src\chat\ContextUsagePanel.tsx`
- `c:\Projects\simple_agent_manager\src\chat\useChatStream.ts`
- `c:\Projects\simple_agent_manager\src\chat\useContextWindow.ts`
- `c:\Projects\simple_agent_manager\src\chat\useAgentRunner.ts`
- `c:\Projects\simple_agent_manager\src\chat\autoClose.ts`
- `c:\Projects\simple_agent_manager\src\chat\StreamingText.tsx`
- `c:\Projects\simple_agent_manager\src\chat\StreamingMarkdownRenderer.tsx`
- `c:\Projects\simple_agent_manager\src\chat\StreamingBlock.tsx`
- `c:\Projects\simple_agent_manager\src\chat\streaming-markdown-scanner.ts`
- `c:\Projects\simple_agent_manager\src\chat\markdown-components.tsx`
- `c:\Projects\simple_agent_manager\src\chat\markdown-rendering.ts`
- `c:\Projects\simple_agent_manager\src\chat\transcript-loading.ts`
- `c:\Projects\simple_agent_manager\src\chat\chat-connection-state.ts`
- `c:\Projects\simple_agent_manager\src\chat\SAMAgent.tsx`
- `c:\Projects\simple_agent_manager\src\chat\sam-agent-messages.tsx`
- `c:\Projects\simple_agent_manager\src\chat\sam-agent-apply-card.tsx`
- `c:\Projects\simple_agent_manager\src\store\session-store.ts`
- `c:\Projects\simple_agent_manager\src\store\context-usage-store.ts`
- `c:\Projects\simple_agent_manager\src\store\sam-agent-store.ts`
- `c:\Projects\simple_agent_manager\src\runtime\storage-client.ts`
- `c:\Projects\simple_agent_manager\shared\protocol.ts`
- `c:\Projects\simple_agent_manager\shared\session-routes.ts`

## Chat Drawer Shell

The drawer is a fixed, right-anchored panel
(`ChatDrawer.tsx`) opened by clicking "Open Chat" on an agent node.
That button is wired through `useAgentRunner.runAgent`, which calls
`useAgentConnectionStore.openChatDrawer(agentId)` to set
`chatAgentNodeId` in the connection store. The agent node only renders
the "Open Chat" button when its config resolves with a connected
context engine, storage, and provider — see the agent node's runtime
gating (Section 5/6 covers the agent node UI; here we only document
that the button does not appear without those connections). Width is
resizable via the left edge handle (`useRightAnchoredResize`,
360–960 px), persisted in `useUILayoutStore.chatDrawerWidth`.

Layout (top → bottom):
1. Header row: bot icon, agent name, `provider / modelId` subtitle,
   spinner when streaming, "Clear messages" trash icon (only if
   the active session has ≥1 message), close `X`.
2. Session selector row: "SESSION" label, dropdown with
   `displayName · {today HH:MM | MMM D}` (prefixed with `Main · ` for
   the implicit `:main` session), per-row delete (two-click confirm),
   and a `+` "New Session" button.
3. `PeerChannelsSection` — only renders when the resolved
   `AgentConfig.agentComm` contains a `direct`-protocol entry with a
   target agent.
4. `ChatMessages` — scrollable transcript, with sticky bottom for
   streaming. Blurs / disables pointer events when blocked or when a
   transcript is loading.
5. `HitlBanner` — only when a pending HITL prompt belongs to the
   active session.
6. `ChatInput` — text + optional image attach button (only if
   `modelCapabilities.inputModalities` includes `image`); Send swaps
   to a Stop button while streaming (and stays Send while a HITL
   prompt is open).

If any of `contextEngine`, `storage`, or `provider.pluginId` is
missing — or the websocket connection is `connecting` /
`reconnecting` / `disconnected` — a full-panel "Missing Peripherals"
overlay obscures the chat with a per-issue card. The list is built in
`ChatDrawer.missingPeripherals` plus `getChatConnectionIssue` from
`chat-connection-state.ts`. F-06 covers the orthogonal case where all
three peripherals are present but the chat still fails because the
default `agent.modelId` is invalid.

Closing (`X`) calls `destroyAgent(agentNodeId)` on the connection
store before clearing `chatAgentNodeId`, so a fresh agent is built on
next open.

## Features

### F4.1 — Sending a message (happy path)
Typing in `ChatInput`, pressing Enter (no Shift) or clicking Send,
fires `onSend(text, attachments)`. `ChatDrawer.handleSend`:
1. Appends a synthetic user message to the active session
   (`useSessionStore.addMessage`).
2. Calls `startAgent(agentNodeId, config)` to ensure a backend agent
   exists.
3. Calls `chatStream.sendMessage(text, activeSessionKey, attachments)`,
   which sets `isStreaming=true`, subscribes per-turn to
   `agentClient.onEvent`, and fires `sendPrompt` over the WS-style
   client. The UI flips Send→Stop while streaming.

If the user is mid-HITL (a `pendingHitl` exists for the active
session), the same Send routes through `chatStream.sendHitlResponse`
instead of starting a new turn (`hitl:respond` command).

### F4.2 — Streaming render pipeline
The streaming subscriber in `useChatStream.ts` consumes a `ServerEvent`
union from `shared/protocol.ts`:

| Event | UI effect |
|---|---|
| `message:start` | Creates a placeholder assistant `Message` with empty content. |
| `message:delta` | Buffers `delta` and flushes via `setTimeout(32ms)` into `assistantContentRef` and `updateMessage`. |
| `message:end` | Cancels timer, flushes any buffered text, stamps `usage` + `tokenCount`, then `flushSession`. |
| `reasoning:start/delta/end` | Mirrors message events but writes to `Message.thinking`; flush at 64ms. |
| `message:suppressed` | Sets `suppressedReply`, deletes the empty assistant placeholder. |
| `tool:start` | Inserts a `tool` role message keyed by `tool_${toolCallId}` with empty content. |
| `tool:end` | Updates the same row with `result`, `isError`, `images`, `audios`, token count. |
| `tool:summary` | Pushes into `toolSummaries` (currently unused by the chat UI; reserved for future surfacing). |
| `compaction:start/end` | Flips `compacting` flag for the in-thread "Compacting context…" pill. |
| `agent:end` / `lifecycle:end` | Drops the placeholder if still empty, clears flags, flushes session, unsubscribes. |
| `agent:error` / `lifecycle:error` | Inserts an `assistant` message starting with `Error: …`, clears flags, flushes, unsubscribes. |

A separate, persistent `useEffect` listens for `context:usage`,
`hitl:input_required`, `hitl:resolved`, and `hitl:list:result` outside
the per-turn subscription so banners survive across turns and
reconnects. On session change while connected, the drawer fires
`queryPendingHitl(activeSessionKey)` so a banner can rehydrate.

### F4.3 — Session list (per-agent, numbered, switching, creating, deleting)
- `getSessionsForAgent(agentId)` — sorted by `lastMessageAt` desc.
- New session uses `getNextSessionDisplayName` to pick `Session N` where
  N is `max(existing) + 1`. The implicit default uses `subKey: 'main'`
  with display name `Main session` and is the bootstrap session
  auto-created on first open if none exist.
- New session button enforces a hard cap of `3` per agent
  (`enforceSessionLimit(agentNodeId, 3)` plus a manual oldest-delete if
  still ≥3) — this is independent of the storage-side
  `sessionRetention` config that defaults to 50.
- Delete is two-click: first click sets `deleteConfirmId`; second
  invokes `deleteSession`. If the active session was deleted, the drawer
  picks the most recent remaining session, or auto-creates a new
  default if none remain.
- Session switch (`handleSwitchSession`) calls
  `destroyAgent(agentNodeId)` so the runtime rebuilds with the new
  session's history.
- Sessions are not renameable from the UI today (only the auto-numbered
  `Session N` / `Main session` labels are exposed). Rename happens via
  store/server APIs that the drawer doesn't surface.

### F4.4 — Transcript persistence and load on open
On mount the drawer constructs a `StorageClient(config.storage,
agentName, agentNodeId)`, calls `init()` (POST `/api/storage/init`),
then `loadSessionsFromDisk()` which `GET`s
`/api/sessions/{nodeId}` (the session list). The active session's
transcript is loaded by `flushSession(sessionKey)` which calls
`getTranscript()` (GET `/api/sessions/{nodeId}/{sessionId}/transcript`)
and `getSession()` in parallel and replaces in-memory messages.
`transcriptStatus[sessionKey]` cycles `idle → loading → ready`;
`shouldShowTranscriptLoading` (in `transcript-loading.ts`) decides when
to swap in the spinner card vs. show the messages.

### F4.5 — Context usage panel
`ContextUsagePanel.tsx` reads:
- `useContextWindow(config)` — picks window size in this priority:
  `modelCapabilities.contextWindow` (override) → catalog metadata →
  `128_000` default. The pill next to the donut shows which source
  was used.
- `useSessionContextUsage(sessionKey, contextWindow, sessionMeta)` —
  subscribes to `useContextUsageStore.usageBySessionKey[sessionKey]`,
  hydrating from `SessionStoreEntry.contextTokens / breakdown` on
  first render so the gauge has a value before any new turn.

The donut wedges by `breakdown.systemPrompt | skills | tools |
messages` when a breakdown is available, otherwise a single Used /
Available split. Expanding (chevron) shows per-section rows and "Top
skills" / "Top tools" lists capped at `ENTRY_DISPLAY_CAP=8`. A "preview"
or "last known" pill renders next to the totals, sourced from
`ContextUsage.source` (`actual` / `preview` / `persisted`). Compaction
events are *not* surfaced in this panel — the in-thread
`compaction:start/end` pill in `ChatMessages` is the only visual
indicator.

### F4.6 — HITL banner
Triggered by `hitl:input_required` events for the active session.
`HitlBanner.tsx` shows the question, a live remaining-time tag (ticks
every 500 ms against `createdAt + timeoutMs`), and either Yes/No
buttons (`kind === 'confirm'`) or a "type your answer below" hint
(`kind === 'text'`). Clicking Yes/No appends a synthetic user message
and calls `chatStream.sendHitlResponse(sessionKey, toolCallId,
'confirm', 'yes'|'no')`. Typing a text answer and pressing Send
follows the same code path because `ChatDrawer.handleSend` checks
`pendingHitl.sessionKey === activeSessionKey` first. While a HITL is
pending, the input stays enabled and the Send button stays visible
(see `ChatInput.inputDisabled` logic). Resolution is signalled by
`hitl:resolved` (with `outcome: 'answered' | 'cancelled'`); the banner
clears.

There is **no tool-lock toggle in the chat drawer**. Permission /
tool-lock UI lives elsewhere (Safety settings or property editors,
Section 2/3) — within the chat drawer, the only HITL surface is this
banner. Tests should not assert a tool-lock control inside the drawer.

### F4.7 — Peer channels (`PeerChannelsSection`)
Only mounts when the resolved config has at least one
`agentComm[].protocol === 'direct'` entry with a `targetAgentNodeId`.
Collapsed by default; on expand fetches
`GET /api/agents/{agentId}/channels` via
`useSessionStore.listPeerChannels`. Each row shows peer name, turn
count, sealed badge (`sealedReason` ∈ `max_turns_reached |
token_budget_exceeded | manual`), and relative last activity. Clicking
a row opens a modal that fetches
`GET /api/agents/{agentId}/channels/{channelKey}/transcript?limit=100`
and dumps the raw JSON event list — there is no rich rendering of peer
transcripts today; this is read-only diagnostics. Sending peer-to-peer
messages does *not* happen from this drawer; it's emitted by tools
during a normal turn.

### F4.8 — Auto-close behavior
`autoClose.ts` despite its name is **not** about closing the drawer —
it is the streaming-markdown helper that auto-closes unbalanced
inline markdown tokens (`**foo`, `*bar`, `__baz`, `~~qux`, `[link`)
and unclosed code fences while a block is mid-stream. `findSafeRevealCount`
finds the largest prefix free of unclosed inline tokens (or open math
delimiters) so the reveal cursor never displays raw `*` or `[` glyphs.
For `code_fence` blocks inline parsing is inert — the cursor reveals
linearly and a closing ` ``` ` is appended on demand.

The drawer itself does not auto-close on outside click or focus loss;
it closes only via the `X` button (which calls `destroyAgent`), or
when `chatAgentNodeId` is cleared elsewhere (e.g. agent deletion).

### F4.9 — Streaming markdown scanner
`streaming-markdown-scanner.ts` produces an ordered list of `Block`s
(`paragraph | heading | code_fence | blockquote | list | list_item |
table | table_row | hr | image | setext_heading`) with status
`tentative | open | closed`. State only mutates on newline-terminated
lines; tentative classification (e.g. table-header candidates) commits
after a 150 ms idle timer or when the next line resolves the type.
Setext headings retroactively promote a paragraph when a `===`/`---`
underline arrives. The scanner is consumed by
`StreamingMarkdownRenderer` only when the user-side
`chatUIDefaults.textRevealStructure === 'blocks'`.

### F4.10 — Streaming text reveal animation
Two renderers selected by `chatUIDefaults.textRevealStructure`:

- `StreamingText` (default `'inline'` / non-block path) — char-by-char
  fade reveal driven by `requestAnimationFrame` at
  `chatUIDefaults.textRevealCharsPerSec` chars/sec. Uses an initial
  buffer of 14 chars OR 220 ms before unblocking, then strict-linear
  advance regardless of incoming delta speed (no burst on backlog).
  `textRevealFadeMs` controls the `--stream-fade-ms` CSS variable for
  the per-char fade-in.
- `StreamingMarkdownRenderer` (`'blocks'`) — drives one
  `StreamingBlock` per scanner block; each block reveals at
  `textRevealCharsPerSec` and shells out to `findSafeRevealCount` +
  `autoClose` so the partially-revealed substring is always
  well-formed for ReactMarkdown.

When `textRevealEnabled === false`, both renderers fast-forward to
full text immediately. After streaming ends, `MessageBubble` swaps the
streaming renderer for a static `ReactMarkdown` once
`onRevealComplete` fires.

### F4.11 — Tool call / tool result rendering
`MessageBubble` renders tool messages as a left-aligned collapsible
card (not a chat bubble). Default appearance: wrench icon
(pulses while waiting for `tool:end`), tool name (mono font), token
badge, chevron toggle. Errors recolor to red with an
`AlertTriangle` icon. Expanded body shows the result as
`<pre>` with `max-h-60 overflow-y-auto`. Inline images
(`msg.images`) and audios (`msg.audios`) render above the result body;
audios get a full `AudioAttachment` widget that wraps raw PCM in a WAV
header on the fly, exposes a "download raw" button, and shows
diagnostics (header dump, MIME, payload signature) when the browser
fails to play.

### F4.12 — Thinking / reasoning rendering
For assistant messages with `thinking` content (or while
`isReasoningThis` is true), `MessageBubble` renders a purple
"Thinking" card above the bubble. Collapsed by default; pulses the
brain icon while reasoning is mid-stream. Expanded body uses a
purple-themed `ReactMarkdown` (`thinkingMarkdownComponents`) once
reasoning is complete; while still streaming, it renders the
in-progress reasoning as a `<pre>` so partial markdown doesn't render
raw `*`s.

### F4.13 — Error rendering
- `agent:error` / `lifecycle:error` add a single assistant message
  with content `Error: {error.message ?? error}`. No special styling
  beyond the default assistant bubble; the leading `Error:` is the
  only visual marker. F-03 / F-06 are reproductions of this path
  triggered by an invalid model id at the provider level.
- Connection-level issues (WS not yet connected, reconnecting, lost)
  render the chat-blocked overlay built by `getChatConnectionIssue`.
- Missing peripherals (context engine, storage, provider) also render
  the chat-blocked overlay.
- F-07 surfaced that `validateAgentRuntimeGraph` errors are *not*
  rendered anywhere in the drawer today — that is a separate gap, not
  a chat-rendering feature.

### F4.14 — Per-message context (tokens, usage, source)
`MessageBubble` shows a small footer under the bubble with
`{tokens} tokens (in:X out:Y)` derived from `Message.tokenCount` and
`Message.usage`. Tool messages show only a token count badge inline.
Hover reveals a delete (trash) button on each message; clicking calls
`useSessionStore.deleteMessage(sessionKey, messageId)` which removes
in-memory immediately and persists via `StorageClient.deleteMessage`.
The drawer does not surface latency or model-source per message.

### F4.15 — In-app SAM Agent assistant
`SAMAgent.tsx` is a left-side floating "island" panel
(`CHAT_PANEL_OPEN_WIDTH=360 / CLOSED=56`) toggled by
`useUILayoutStore.toggleChatPanel`. Distinct from the right-side per-agent
chat drawer — SAM Agent is a *meta* assistant that helps the user
build their workflow.

- **Invocation:** click the power-icon button at the bottom of the
  panel. There is no keyboard shortcut or command palette in the code
  today.
- **Provider config:** SAM Agent reads `samAgentDefaults.modelSelection`
  + `apiKeys[pluginId]` from `useSettingsStore`. If either is missing,
  the panel shows a "Configure SAMAgent" CTA that calls
  `onOpenSettings('sam-agent')`. Thinking level is set in settings
  too (`samAgentDefaults.thinkingLevel`, default `high`).
- **Lifecycle:** on open, subscribes to raw WS events; if the WS is
  already connected and transcript not loaded, immediately fires
  `samAgentClient.start()` (`samAgent:start` command). On every
  reconnect, retries `start()` to survive boot-time races. The server
  responds with a `samAgent:transcript` event populating
  `useSamAgentStore.messages`; subsequent `samAgent:event` envelopes
  feed `handleEvent` which mirrors the same protocol shape as the main
  chat (`message:start/delta/end`, `tool:start/end`, `lifecycle:end/error`,
  `hitl:input_required/resolved`).
- **Sending:** Enter or click Send in the input box → if HITL pending,
  routes through `samAgentClient.hitlRespond` (auto-mapping `y…` →
  `yes`); otherwise appends a local user message and calls
  `samAgentClient.prompt(text, buildGraphSnapshot(), {...modelSelection,
  thinkingLevel})`. The current canvas snapshot is sent every prompt so
  the assistant has full context.
- **Apply-card flow:** when the assistant calls the
  `propose_workflow_patch` tool, the result lands as a tool entry
  rendered by `SamAgentApplyCard`. Card states: `pending | applied |
  discarded | failed`. Pending shows summary text (rationale, or
  `N adds, N edits, N deletes`), an expand toggle that lists each
  add/update/remove operation, and Apply / Discard buttons. Apply
  invokes `useGraphStore.applyPatch(patch)` — on success the patch is
  persisted into the canvas state and the card flips to `applied`,
  also informing the server via `samAgentClient.patchState`. Failure
  flips to `failed`. Discard only updates state without applying.
  Malformed JSON or `parsed.ok === false` short-circuits to a
  red-bordered "Patch invalid" card.
- **Streaming:** the assistant message body streams as plain text via
  `whitespace-pre-wrap` — no markdown reveal animation, no thinking
  card. Tool entries other than `propose_workflow_patch` render as a
  small grey label.
- **Clear:** the trash button calls `samAgentClient.clear()` and
  `useSamAgentStore.clearLocal()` — wipes the local view. Server-side
  clear is the source of truth (the next `start()` will pull a fresh
  transcript).

### F4.16 — Image attachments (vision input)
`ChatInput` shows the paperclip icon only when
`config.modelCapabilities.inputModalities` contains `'image'`. Picked
files become base64 `ImageAttachment[]` (data + mimeType) sent
alongside the text on `agent:prompt`. Previews render above the input
with hover-X to remove.

### F4.17 — "Working silently" / "Agent is thinking" indicator
`ChatMessages.showThinkingIndicator` turns on when `isStreaming` is
true but no assistant content/thinking is visible yet AND
`compacting`/`isReasoning` are off. Renders a blue pulsing
hexagon with "Agent is thinking…". Suppressed once the first delta
lands.

### F4.18 — "Agent chose not to reply"
When `message:suppressed` fires (reason: `no_reply` or
`messaging_tool_dedup`), the placeholder is deleted and a small italic
slate pill is rendered: "Agent chose not to reply". Only shown after
streaming ends.

### F4.19 — Compacting indicator
On `compaction:start`, an amber pill "Compacting context…" with a
spinning refresh icon renders inline at the bottom of the message
list. `compaction:end` removes it. There is no after-compaction summary
or token-delta UI in the drawer.

### F4.20 — Markdown rendering (post-stream)
`MessageBubble` swaps to a static `ReactMarkdown` once reveal is done
(`!isStreamingThis && revealComplete`). Plugins:
`remarkGfm` (tables, strikethrough, task lists), `remarkMath` +
`rehypeKatex` (math). Custom component overrides live in
`markdown-components.tsx`. To preserve scroll perf with long
transcripts, only the most recent
`EAGER_MARKDOWN_ASSISTANT_COUNT = 6` assistant messages render as
rich markdown immediately; older messages render as plain text and
upgrade in batches of 4 (`MARKDOWN_BATCH_SIZE`) on a 16 ms
`setTimeout` schedule (`ChatMessages.useEffect` over
`assistantIdKey`).

### F4.21 — Auto-scroll behavior
`ChatMessages` keeps the viewport pinned to bottom unless the user
scrolls up >80 px. Switching sessions or finishing a transcript-load
re-pins to bottom on the next layout effect. New messages while
scrolled-up still trigger a scroll; streaming deltas while scrolled-up
do not.

### F4.22 — Clear messages (per session)
Trash icon in the header (only when ≥1 message) calls
`clearSessionMessages(activeSessionKey)`, which calls
`StorageClient.resetSession` (POST
`/api/sessions/{nodeId}/{sessionId}/reset`) and re-reads the session
metadata.

### F4.23 — Diagnostic messages
Custom session entries with `customType === RUN_DIAGNOSTIC_CUSTOM_TYPE`
are converted by `toStoredMessage` into assistant messages with
`kind: 'diagnostic'` — these render with an amber-bordered bubble
in `MessageBubble`.

### F4.24 — Empty state
With 0 messages and no streaming: "Send a message to start the
conversation". If `config.tools` is empty, an additional tip is shown
suggesting connecting a Tools node.

### F4.25 — Math rendering
KaTeX via `rehypeKatex` + `remarkMath`. Streaming math is deferred —
`findSafeRevealCount` treats `$…$` and `$$…$$` as opaque so partial
LaTeX never renders raw.

### F4.26 — Inline audio playback
Tool messages with `audios` render an `<audio controls>` per clip.
Raw PCM mime types are wrapped in a synthesized WAV header
(`wrapPcmAsWav`) and exposed via a `Blob` URL. A
"download raw" link returns the original bytes (no wrap). Failure
states show a hex/MIME/format diagnostic block (`inspectAudioHeader`).

### F4.27 — Inline tool images
Tool messages with `images` render `<img>` tags using
`data:{mimeType};base64,{data}` URLs at `max-h-96 object-contain`.
User messages do **not** render their image attachments — they are
sent to the agent only.

### F4.28 — Token-budget hot zone coloring
The percent label inside the donut in `ContextUsagePanel` recolors at
`>50%` (amber-400) and `>80%` (red-400). The wedges themselves do not
change color.

### F4.29 — Per-session storage engines
`SessionStore.storageEngines` is keyed by `agentId`, so multiple
chat drawers (or transient ones) each retain their own
`StorageClient`. The single `storageEngine` field is the
last-bound one and only used as a fallback. Closing a drawer calls
`unbindStorage()` which clears `storageEngine` but leaves the
per-agent entry in `storageEngines`.

### F4.30 — Session limit hard cap (drawer-side)
`handleNewSession` enforces `enforceSessionLimit(agentId, 3)` plus a
manual oldest-delete if still ≥3, separate from the
storage-side `sessionRetention`. Tests should verify both: storage
retention may be configured to 50 but the drawer still caps the
selector at 3 visible sessions.

## End-to-End Test Scenarios

### S4.1 — Happy path (P2)
1. Build (or use existing) graph: Agent + Provider + Storage +
   Context Engine.
2. Click "Open Chat" on the agent node.
3. Confirm header shows agent name and `provider / modelId`.
4. Type "Reply with exactly the word 'pong'." Send.
5. Observe: spinner, "Agent is thinking…", `message:start` placeholder,
   streaming reveal, final `pong` rendered as markdown, token footer.
6. Verify a `tool` message did not appear (text-only reply).
7. Refresh the page; reopen chat; transcript is restored from disk.

### S4.2 — Transport verification (F-01 regression check)
1. Open DevTools → Network → WS filter while opening a chat and
   sending a message.
2. Expected per current code: a WS upgrade to the agent-server
   endpoint is established and `agent:prompt` / `message:delta`
   travel over it (`agentClient.send` / `agentClient.onEvent` are
   websocket-based — see `useChatStream.ts`).
3. F-01 reported observation contradicts this and called out only
   REST polling on `/api/sessions/.../transcript`. Test should
   capture both: the WS frames AND the REST calls (REST is used for
   session listing, transcript hydration on open, and post-turn
   `flushSession`). If WS frames are absent at runtime, file as
   regression.

### S4.3 — Storage config size in URLs (F-02)
1. Open chat, send a message.
2. In DevTools Network, inspect any
   `GET /api/sessions/.../transcript` URL.
3. Confirm the `?config=…` blob is present.
4. Note the URL byte length; flag a regression if it grows past
   ~2 KB or new sensitive fields (paths, secrets) appear.

### S4.4 — Session create / switch / delete
1. With chat open, click `+` to create `Session 2`.
2. Observe `destroyAgent` was called (next message rebuilds runtime).
3. Send "hi" in `Session 2`. Switch to `Main session`. Verify it shows
   prior history, not Session 2's `hi`.
4. Switch back to `Session 2`; verify message persists.
5. Click trash on `Session 2`; second click confirms; verify it's
   removed and active session falls back to `Main`.
6. Try to create a 4th session: verify the oldest non-active session
   is deleted to keep ≤3.

### S4.5 — Multi-message thread + reload
1. Send 6+ assistant exchanges in one session.
2. Reload the page; reopen the chat.
3. Verify the transcript loads with the spinner card briefly, then
   all messages display in order.
4. Verify only the most recent 6 assistant messages render rich
   markdown immediately; older ones may be plain text for the first
   ~50 ms then upgrade in batches of 4.

### S4.6 — Markdown coverage
1. Prompt: "Reply with: a level-2 heading, a bulleted list of 3 items,
   a numbered list of 3 items, a fenced code block in TypeScript, a
   table with 2 columns and 2 rows, a link to https://example.com,
   a strikethrough word, and an inline `code` span."
2. After streaming completes, verify all elements render via
   `markdownComponents` and links open with target `_blank`.

### S4.7 — Tool call rendering
1. Prompt the agent to call a built-in tool that the agent has access
   to (e.g. `read_file` with a known path).
2. Verify a `tool` row appears with the wrench pulsing, then resolves
   with token count.
3. Click the chevron; verify result body expands with a `<pre>` block
   and `max-h-60` scroll if long.

### S4.8 — Tool error
1. Prompt the agent to read a nonexistent file.
2. Verify the tool row recolors red with the `AlertTriangle` icon and
   `isToolError` styling. Result expands to show the error string.

### S4.9 — Thinking / reasoning
1. With a reasoning-capable model (e.g. an Anthropic thinking variant
   or OpenAI o-series), prompt: "Think step-by-step, then answer 7×8."
2. Verify the purple Thinking card appears above the bubble, brain
   pulses, expand shows in-progress text as `<pre>`.
3. After `reasoning:end`, expanding shows the same content rendered
   via `thinkingMarkdownComponents`.

### S4.10 — HITL confirm
1. Configure or call a tool that triggers `hitl:input_required` with
   `kind: 'confirm'` (e.g. `ask_user` with confirm shape).
2. Verify amber HITL banner with the question, Yes / No buttons, and
   ticking remaining-time.
3. Click "Yes". Verify a synthetic user message `yes` is appended and
   the agent resumes.

### S4.11 — HITL text + manual yes/no parsing
1. Trigger a `kind: 'confirm'` HITL.
2. Instead of the buttons, type `maybe` in the input and Send.
3. Verify the server returns an `agent:error` ("non-yes/no answer") and
   the banner remains open.
4. Type `yes` and Send. Verify it succeeds.

### S4.12 — HITL timeout
1. Trigger any HITL with a short `timeoutMs` (e.g. 10 s).
2. Wait. Verify banner countdown reaches 0 and `hitl:resolved` with
   `outcome: 'cancelled', reason: 'timeout'` clears the banner.

### S4.13 — HITL across reconnect
1. Trigger a HITL.
2. Toggle the WS (kill backend briefly, restart).
3. On reconnect, confirm the drawer issues `hitl:list` for the active
   session and the banner re-renders without a new tool call.

### S4.14 — Tool-lock placement reality-check
1. Open chat. Verify there is **no** tool-lock toggle in the drawer
   itself.
2. Locate tool-lock controls in the Safety settings section or property
   editor (Section 2/3 scope).

### S4.15 — Peer channels visibility & transcript
1. Build an agent with an `agentComm` direct edge to another agent.
2. Open chat → confirm the "Peer channels" collapsible appears below
   the session selector.
3. Trigger an inter-agent message via tools.
4. Expand "Peer channels"; confirm a row for the peer with turn count.
5. Click the row; verify the modal renders the raw JSON event list.
6. Confirm a non-comm agent does NOT show this section.

### S4.16 — Invalid model id error rendering (F-03 / F-06)
1. Drag a fresh Agent + Provider (OpenRouter) + Storage + Context
   Engine. Do not change the default `modelId`
   (`anthropic/claude-sonnet-4-20250514`).
2. Open chat, send any message.
3. Verify an assistant message renders prefixed with
   `Error: …is not a valid model ID`.
4. Verify the error is **not** automatically pruned and persists in
   the transcript across reload (F-03).
5. Change the model to a valid one and verify subsequent turns
   succeed; the historical error remains visible (today's behavior).

### S4.17 — Provider down / network blip
1. Mid-stream, kill the backend.
2. Verify `connectionStatus` flips to `connecting` then `disconnected`
   and the chat-blocked overlay surfaces "Reconnecting" / "Connection
   Lost".
3. Restart backend. Verify overlay clears and a new prompt can be
   sent.

### S4.18 — Auto-close drawer on agent deletion
1. With chat open on agent A, delete agent A from the canvas.
2. Verify `chatAgentNodeId` clears and the drawer unmounts.

### S4.19 — Drawer close button calls destroyAgent
1. Open chat, send one message.
2. Click `X`. Verify the WS receives `agent:destroy` and the in-memory
   runtime is torn down (next open will rebuild fresh).

### S4.20 — Context usage panel: long thread
1. Send messages until used tokens cross 50 % then 80 % of the window.
2. Verify the donut percent label recolors amber then red.
3. Expand the panel; verify per-section bars (system prompt, skills,
   tools, messages) and the entry caps (≤8) on top-skills/top-tools.

### S4.21 — Context usage hydration on open
1. Use a session with a known last-known `contextTokens` saved on disk.
2. Reopen chat without sending a message.
3. Verify the panel shows the persisted value with the "last known"
   pill, then on the next turn flips to "preview" and finally `actual`
   (no pill).

### S4.22 — Compaction event surfaces
1. Force a compaction via a long thread or a tool invocation that
   triggers it.
2. Verify the inline amber "Compacting context…" pill appears between
   `compaction:start` and `compaction:end`, and disappears after.
3. Verify there is no separate "compacted N tokens" UI today.

### S4.23 — Animation speed setting changes reveal
1. In Settings → Appearance, set `textRevealCharsPerSec` to a low
   value (e.g. 30).
2. Send a long response. Confirm reveal is slower.
3. Toggle `textRevealEnabled` off; confirm content snaps to full text.
4. Toggle `textRevealStructure` between `inline` and `blocks`; confirm
   the renderer swap (StreamingText vs StreamingMarkdownRenderer).

### S4.24 — Streaming markdown safety
1. Prompt: "Stream this with delays so I can see partial state:
   `**bold**`, then ``` `code` ``` , then a fenced code block with a
   nested asterisk."
2. While streaming, take screenshots; verify no raw `*` / `[` / unclosed
   ` ``` ` glyphs are ever displayed.

### S4.25 — Image attachment send
1. Use a vision-capable model (e.g. an OpenAI gpt-4o or Anthropic
   Claude vision).
2. Verify the paperclip icon appears in the input.
3. Attach 2 images, type "describe", Send.
4. Verify the previews are removed from the input post-send.
5. Verify the agent's reply references both images.

### S4.26 — Per-message delete
1. Send a few messages.
2. Hover over a message, click the trash icon.
3. Verify `deleteMessage` is fired (REST DELETE to
   `/api/sessions/.../messages/{id}`) and the row disappears
   immediately, even if the network call is slow.

### S4.27 — SAM Agent: invoke + apply patch
1. Click the SAM Agent power-icon to open the panel.
2. If a CTA shows "Configure SAMAgent", set provider + API key in
   Settings → SAMAgent, return.
3. Type "Add a Memory node and connect it to my agent". Send.
4. Observe the streaming text reply.
5. When a `propose_workflow_patch` apply card appears, click the
   summary to expand the diff.
6. Click Apply. Verify the canvas updates (new node, new edge) and
   the card flips to "Applied".
7. Reload page; verify SAM Agent transcript is restored on next open.

### S4.28 — SAM Agent: discard patch
1. Repeat S4.27 to step 5.
2. Click Discard. Verify the canvas does not change and the card
   flips to "Discarded". Server is informed via `samAgent:patchState`.

### S4.29 — SAM Agent: HITL
1. Ask SAM Agent something that triggers `hitl:input_required` (e.g.
   request a destructive action wired to `confirm`).
2. Verify the amber banner above the SAM input shows
   "Confirm: …" or "SAMAgent asks: …".
3. Type `y…` or `n…` and Send. Verify
   `samAgentClient.hitlRespond({kind:'confirm', answer:'yes'|'no'})`
   is dispatched.

### S4.30 — SAM Agent clear
1. With messages present, click the trash button in SAM Agent.
2. Verify local view clears immediately.
3. Reopen the SAM panel after a reconnect; verify the server-side
   transcript was cleared (no historical messages reload).
