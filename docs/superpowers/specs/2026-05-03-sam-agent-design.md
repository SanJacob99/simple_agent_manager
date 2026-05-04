# SAMAgent Design

<!-- last-verified: 2026-05-04 -->

## Summary

SAMAgent is an in-app AI assistant that lives in the cream-island chat panel on the left of the canvas (`src/chat/SAMAgent.tsx`). It does two things:

1. **Answers documentation questions** about the Simple Agent Manager app, grounded in `docs/concepts/`, `README.md`, and `AGENTS.md`.
2. **Composes agent workflows on the canvas** by proposing graph patches the user can apply with one click, including multi-agent topologies that use `subAgents` and `agentComm`.

It runs through the existing server-side `AgentRuntime` via a new "configless" coordinator path, and reuses the configured provider system so the user picks which provider/model SAMAgent itself runs on.

## Goals

- A first-class assistant available immediately on launch — no graph setup required to use it.
- Canvas authority: SAMAgent can add, edit, and delete nodes and edges, including across multiple agents.
- Trustworthy mutations: every change is presented as an "Apply" card with a visible diff before anything touches the graph.
- Dedicated HITL behavior: SAMAgent can ask clarifying questions and request explicit confirmation through its own `samAgent:*` flow without depending on a graph agent's `ask_user` / `confirm_action` tools.
- Doc-grounded answers: SAMAgent reads concept docs on demand rather than hallucinating node behavior.
- Reuse the existing provider, model resolver, and `AgentRuntime` infrastructure rather than forking a parallel runtime.

## Non-goals (v1)

- Direct (no-confirmation) mutation mode.
- Image/file attachments in SAMAgent input.
- Per-graph SAMAgent transcripts. v1 ships a single global transcript.
- Reading or writing project files outside `docs/`.
- Triggering test runs, shell commands, or spawning sub-agents from SAMAgent.
- Multi-turn or staged approval flows ("apply just the agent now, edges later").
- Reading from `docs/superpowers/specs/` or `docs/superpowers/plans/` — those are internal design history that may diverge from shipped behavior.

## Architecture

### Configless agent path on the server

Today every chat is graph-coupled: an `agentNodeId` flows through `resolveAgentConfig()` and into `RunCoordinator`. SAMAgent has no node, so it gets a parallel path:

- `server/sam-agent/sam-agent-config.ts` — builds an `AgentConfig` from current settings (provider + model picked by user) plus a hardcoded SAMAgent system prompt and SAMAgent's tool list. Produces a valid `shared/agent-config.ts#AgentConfig` so downstream code is unchanged.
- `server/sam-agent/sam-agent-coordinator.ts` — sibling of `RunCoordinator`. Owns one `AgentRuntime`, one transcript store, no graph dependency. Exposes `dispatch(prompt, currentGraph)` and event emission.
- `server/sam-agent/sam-agent-tools.ts` — registers SAMAgent's private doc, patch, and HITL tools (see Tool Surface below) using the same `AgentTool` interface that `server/tools/tool-factory.ts` produces. The tools are **not** registered in the global tool registry — they are injected into `AgentRuntime` for SAMAgent only.
- `server/sam-agent/sam-agent-transcript.ts` — JSONL append store at `server/sam-agent/transcripts/default.jsonl`, modeled on `server/sessions/session-transcript-store.ts`. One file globally for v1.

SAMAgent is a special prebuilt agent, not a node on the canvas. It does not need a connected `contextEngine` or `storage` node to run. Its runtime config is assembled from Settings plus a fixed SAMAgent capability set, and it always has the server-side tools required to inspect docs, reason over the current graph snapshot, ask the user for input, and propose canvas patches.

`AgentRuntime` itself is graph-agnostic (the coupling is in `RunCoordinator`'s setup and in the tool factory needing an agent config), so it can be reused. The implementation must provide a way to inject SAMAgent-only tools into the runtime, either through a constructor option or by resetting and adding those tools before each SAMAgent prompt.

### WebSocket protocol

A new namespace, `samAgent:*`, on the existing WebSocket connection (no second socket):

- `samAgent:start` — client signals it wants a session (loads transcript history from server, returns it).
- `samAgent:prompt { text, currentGraph }` — user sends a turn. `currentGraph` is a compact, redacted graph projection serialized client-side.
- `samAgent:abort` — user cancels in-flight turn.
- `samAgent:hitlRespond { requestId, answer }` — user answers a SAMAgent-owned HITL prompt.
- `samAgent:patchState { messageId, patchId, state }` — client persists Apply-card state changes (`applied`, `discarded`, `failed`) back to the SAMAgent transcript.
- `samAgent:event` — server-to-client streaming of shaped events equivalent to the existing `message:*`, `tool:*`, `lifecycle:*`, and HITL events, wrapped in the SAMAgent namespace. This is not the raw provider/runtime `text_delta` stream.
- `samAgent:clear` — wipe transcript (header "Clear conversation" button).

A namespaced channel keeps SAMAgent independent of `agent:*` (no `agentId` to route on, no risk of cross-talk) and lets the implementation be replaced wholesale without touching graph chat.

### Graph context for the model

When the user sends a prompt, the client serializes the current graph as a compact redacted projection and attaches it to the WS message. It includes ids, node types, display labels, connection-relevant config, and edge endpoints. It omits React Flow positions and masks secret-like fields such as API keys, MCP env values, headers, and token fields. The server injects it into the system prompt for that turn under a `<current_graph>` block. The model always knows what's on the canvas without spending a tool call.

`read_doc` and `search_docs` are tool-based because docs are large and only sometimes relevant. The graph is small and almost always relevant, so it's frontloaded.

### SAMAgent HITL

SAMAgent has its own HITL behavior rather than borrowing a graph agent's `ask_user` / `confirm_action` tools. The dedicated SAMAgent HITL surface is used for:

- clarifying underspecified workflow requests before proposing a patch;
- confirming ambiguous destructive intent, such as deleting existing nodes or replacing an agent's provider/model;
- pausing a turn when the model cannot safely choose between materially different canvas designs.

Apply cards remain the confirmation gate for graph mutation. Even when SAMAgent receives a HITL confirmation during the conversation, the graph still does not change until the user clicks **Apply** on the patch card.

## Tool Surface

SAMAgent tools execute server-side. Only `propose_workflow_patch` produces UI side-effects.

### `list_docs()`
Returns the parsed `docs/concepts/_manifest.json` plus the static entries `[README.md, AGENTS.md]`. Lightweight orientation; the model usually calls this once per session.

### `read_doc(path: string)`
Reads a markdown file. Server-side allowlist:
- `docs/concepts/*.md`
- `README.md`
- `AGENTS.md`

Any path outside this set returns an error result. No traversal allowed.

### `search_docs(query: string)`
ripgrep across the same allowlist. Returns up to 30 hits as `[{ path, line, snippet }]`. For when the user's question doesn't map cleanly to one node type.

### `propose_workflow_patch(patch: WorkflowPatch)`
The only mutating tool. The model emits one patch describing all changes for one user turn:

```ts
interface WorkflowPatch {
  add_nodes: Array<{
    tempId: string;        // model-chosen, used by add_edges to refer to new nodes
    type: NodeType;        // 'agent' | 'provider' | 'storage' | ...
    position?: { x: number; y: number };  // optional; layout helper picks if absent
    data: Partial<FlowNodeData>;          // shallow-merged onto defaults from default-nodes.ts
  }>;
  update_nodes: Array<{
    id: string;            // existing node id from current_graph
    dataPatch: Partial<FlowNodeData>;     // shallow-merged onto existing data
  }>;
  remove_nodes: string[];
  add_edges: Array<{
    source: string;        // node id OR tempId from add_nodes
    target: string;
  }>;
  remove_edges: string[];  // edge ids
  rationale: string;       // user-facing summary, shown on the Apply card
}
```

The tool body validates server-side and returns either:

```ts
{ ok: true, patch: WorkflowPatch }
// or
{ ok: false, errors: Array<{ code: string; message: string; path?: string }> }
```

Validation rules:
- All `update_nodes.id` and `remove_nodes` and `remove_edges` exist in the current graph.
- All `add_edges.source` / `.target` resolve to either an existing node id or a `tempId` declared in `add_nodes`.
- Edges respect the connection rules from `src/store/graph-store.ts#onConnect`: peripherals connect to `agent` or `subAgent` nodes only; for `subAgent` targets, only `tools`, `provider`, `skills`, `mcp` sources are allowed.
- For each canvas `agent` touched (newly added or updated), the resulting graph must be runnable for interactive chat: exactly one connected provider with a non-empty `pluginId`, one connected storage node, and one connected context engine node. This is stricter than "serializable `AgentConfig`" because SAMAgent's job is to build usable workflows, not partial graph fragments.
- For each touched canvas `agent`, the resulting graph must resolve to a valid `AgentConfig` via the same checks `resolveAgentConfig()` performs for runtime, plus the runnable-chat checks above. (Re-use existing resolver behavior where possible; do not let invalid sub-agent nodes silently disappear from validation.)
- For each touched `subAgent`, the resulting parent config must include it in `subAgents`; missing required sub-agent peripherals such as a dedicated Tools node are validation errors.
- Node `type` values are known.

When validation fails, the error result feeds back to the model in the same turn so it can correct itself. If the model still produces an invalid patch after one retry, the Apply card surfaces the errors and disables Apply.

## System Prompt

Hand-written, ~1.5k tokens. Sections:

1. **Identity** — who SAMAgent is, what it can and can't do, propose-and-apply contract.
2. **Node-type cheat sheet** — one-paragraph summary per node type (agent, provider, storage, contextEngine, tools, skills, memory, subAgent, agentComm, vectorDatabase, mcp, connector, cron). Compressed from `docs/concepts/`. Includes which peripherals each agent typically wires up.
3. **Connection rules** — peripherals connect to `agent` or `subAgent` only; sub-agent peripherals limited to `tools`, `provider`, `skills`, `mcp`; storage + contextEngine + provider required for canvas agents that should run interactive chat.
4. **Multi-agent patterns** — sub-agent (parent owns children, fan-out via `subAgents`) vs. peer messaging (`agentComm`); when to use each.
5. **Patch authoring guidance** — use `tempId`s for new nodes, prefer minimal patches, always set a `rationale`.
6. **HITL guidance** — ask a SAMAgent HITL question when the user's requested workflow is underspecified or the patch would delete/replace important existing graph elements.
7. **Doc-reading guidance** — call `read_doc` for specifics before authoring patches that touch unfamiliar node types.

The current graph snapshot is appended per-turn under `<current_graph>...</current_graph>`.

## UI

### SAMAgent panel (`src/chat/SAMAgent.tsx`)

Replaces the current stub. Cream island, `rounded-[44px]`, `ISLAND_SHADOW`, stone palette — kept verbatim.

- **Header**
  - "SAMAgent" title.
  - Model picker (small dropdown) reading from `useModelCatalogStore`, filtered to providers with configured keys in `useSettingsStore`. Default selection priority: previously chosen `samAgent.modelSelection` from settings, else first Anthropic model available, else first model in the catalog.
  - "Clear conversation" overflow button.
  - Collapse button (existing).
- **Transcript** — `useSamAgentStore` (own messages, own streaming state). Reuses `ChatMessages`-style bubble rendering for visual consistency, but as its own component to avoid coupling to graph-bound chat.
- **Tool-call rendering**
  - `read_doc` / `search_docs` / `list_docs` collapse to a one-line chip: `📖 read agent-node.md`. Click to expand the result.
  - `propose_workflow_patch` results render as an Apply card (below).
- **Input** — text only for v1. Same send affordance as `ChatDrawer`.
- **No-provider state** — input disabled, panel body shows "Configure a provider in Settings" with a button that switches `appView` to settings.

### Apply card

When the assistant message contains a `propose_workflow_patch` tool result:

- One-line summary derived from `rationale`.
- Expandable diff list:
  - `+ Agent "Researcher" (anthropic/claude-sonnet-4-6)` — adds
  - `~ MyAgent: model → claude-haiku-4-5` — edits (per-field)
  - `- StorageNode storage_abc12` — deletes
  - `+ edge: Researcher → ResearcherProvider`
- **Apply** and **Discard** buttons.
- On Apply: client calls `graphStore.applyPatch(patch)` which batches all mutations atomically (see Graph Store changes below). Card transitions to "Applied ✓" with disabled buttons.
- On Discard: card transitions to "Discarded" with disabled buttons. Stays in transcript for context.
- Cards persist in the transcript across reloads with their resolved state (applied / discarded / pending). Pending cards from previous sessions become stale and show "Stale — graph changed" with disabled buttons if the referenced node ids no longer exist.

### Stores

- `src/store/sam-agent-store.ts` (new) — messages, streaming state, current model, connection status.
- `src/client/sam-agent-client.ts` (new) — small client wrapping `agentClient.ts` for the `samAgent:*` namespace.

## Graph Store changes

Add one method to `src/store/graph-store.ts`:

```ts
applyPatch(patch: WorkflowPatch): { ok: true } | { ok: false; error: string }
```

Behavior:
- Snapshot `nodes` and `edges` before applying.
- Resolve `tempId`s in `add_edges` against `add_nodes`.
- Apply in order: `add_nodes` → `update_nodes` → `add_edges` → `remove_edges` → `remove_nodes` (delete last so we don't break references mid-apply).
- All mutations in a single `set()` call so React Flow renders one frame.
- On any throw, restore from snapshot and return `{ ok: false, error }`.
- Triggers the existing 500ms debounced auto-save to server.
- **Bypasses the agent-deletion confirmation dialog** that `removeNode` triggers for agent nodes (`requestDeleteAgent`). The user already confirmed by clicking Apply on the card; a second modal would be redundant. `applyPatch` performs the underlying removal directly (clear active session, destroy agent connection, filter nodes/edges).

`addNode` / `updateNodeData` / `onConnect` are not changed — `applyPatch` calls into the same internal logic where it can. `removeNode` is bypassed for agents as noted above.

## Persistence

- **Transcript** — JSONL at `server/sam-agent/transcripts/default.jsonl`. One global file for v1. New entries appended on each user turn and assistant final message.
- **Apply-card state** — encoded into the transcript message that holds the tool result, so a reload reconstructs whether each card is pending / applied / discarded. State changes after the assistant turn use `samAgent:patchState` so the server transcript remains authoritative.
- **Selected model** — stored in `useSettingsStore` under a new `samAgent.modelSelection` field containing provider identity plus `modelId`, persisted via the existing settings server route.
- **Graph state** — unchanged. Patches go through the existing graph save flow.

## Data Flow (one turn)

1. User types prompt → `samAgentClient.sendPrompt({ text, currentGraph })`.
2. Server `SamAgentCoordinator.dispatch()`:
   - Loads transcript history from JSONL.
   - Builds messages: system prompt + transcript + new user turn.
   - Injects `<current_graph>` block in system content for this turn only.
3. `AgentRuntime.prompt()` streams runtime events; `SamAgentCoordinator` maps them into `samAgent:event` shaped events for the UI.
4. Tool calls execute server-side:
   - `read_doc` / `search_docs` / `list_docs` — filesystem.
   - `propose_workflow_patch` — validate → return result.
5. Client `useSamAgentStore` updates incrementally as events arrive. Apply cards render the moment a `propose_workflow_patch` result arrives.
6. Server appends user + assistant turns to JSONL on `lifecycle:end`.
7. On Apply click: `graphStore.applyPatch(patch)` runs locally; the client then sends `samAgent:patchState` so apply state is persisted into the assistant message's stored tool result.

## Error Handling

- **No provider configured** — panel shows "Configure a provider in Settings" with a deep link, input disabled.
- **Model call fails** — error bubble in transcript with retry button. Transcript stays intact.
- **SAMAgent HITL pending** — input switches into answer mode for the pending SAMAgent request. Aborting the turn cancels the HITL request and records it as cancelled in the transcript.
- **Patch validation fails** — tool result returns `{ ok: false, errors }` to the model so it can correct itself in the same turn. If still invalid after one retry, surface in the Apply card with Apply disabled.
- **Apply fails mid-batch** — `graphStore.applyPatch` is transactional (snapshot before, restore on throw). Card shows "Apply failed: <error>", transcript continues.
- **WS disconnect** — same reconnect behavior as `agentClient.ts`. In-flight turn is marked aborted in the transcript.
- **Doc allowlist violation** — `read_doc` returns an error result; model self-corrects.

## Testing

- **Unit** — `src/store/graph-store.applyPatch` (atomic apply, rollback on failure, tempId resolution, multi-agent patches with cross-edges).
- **Unit** — patch validator: good/bad patches, edge rules, `AgentConfig` resolvability checks, unknown node types, dangling edges.
- **Unit** — SAMAgent HITL registry: creates requests, resolves answers, cancels on abort, and records transcript state.
- **Unit** — system prompt builder: deterministic output for a fixed set of inputs.
- **Unit** — manifest-backed doc allowlist: traversal attempts (`../`, absolute paths) are rejected.
- **Integration** — `SamAgentCoordinator` end-to-end with a stubbed provider that returns canned tool-call sequences (one for "build a single agent", one for "add a sub-agent to existing agent", one for "delete unused storage"). Asserts events emitted, transcript appended, no graph state touched server-side.
- **No UI snapshot tests** — matches existing project conventions.

## File Layout

New:

```
server/sam-agent/
  sam-agent-config.ts
  sam-agent-coordinator.ts
  sam-agent-tools.ts
  sam-agent-hitl.ts
  sam-agent-transcript.ts
  sam-agent-system-prompt.ts
  sam-agent-validators.ts
  transcripts/
    .gitkeep

shared/sam-agent/
  workflow-patch.ts          # WorkflowPatch type, shared client/server

src/chat/
  SAMAgent.tsx               # rewrite stub
  sam-agent-messages.tsx     # transcript renderer
  sam-agent-apply-card.tsx   # Apply card

src/client/
  sam-agent-client.ts

src/store/
  sam-agent-store.ts
```

Modified:

```
src/store/graph-store.ts                # + applyPatch
src/settings/                           # + samAgent.modelSelection field + UI
server/index.ts (or wherever WS routes) # + samAgent:* handlers
```

## Open questions resolved during brainstorming

- **Capability scope** — full graph authority (add + edit + delete), confirmed by the user.
- **Multi-agent workflows** — first-class; system prompt covers `subAgents` and `agentComm`.
- **Runtime location** — server-side, reuses provider system; user picks which provider/model SAMAgent runs on.
- **Doc scope** — concepts + README + AGENTS.md only. `docs/superpowers/` excluded.
- **Tool granularity** — one `propose_workflow_patch` covering all five op types.
- **Per-graph vs global transcript** — global, one transcript for v1.
- **HITL behavior** — SAMAgent has its own HITL flow instead of borrowing graph-agent `ask_user` / `confirm_action`.
- **Patch validation target** — SAMAgent itself is prebuilt and not graph-bound, but the canvas workflows it proposes should validate as runnable interactive chat agents, not merely serializable configs.

## Implementation order (rough)

1. `WorkflowPatch` shared type + validators (testable in isolation).
2. `applyPatch` on graph store (testable with stub patches).
3. `SamAgentCoordinator` + transcript + tools + system prompt (testable with stubbed provider).
4. WS protocol routes.
5. `useSamAgentStore` + `sam-agent-client.ts`.
6. UI: `SAMAgent.tsx` rewrite, message rendering, Apply card.
7. Settings: `samAgent.modelSelection` + provider gate.
8. End-to-end manual test against a real provider.
