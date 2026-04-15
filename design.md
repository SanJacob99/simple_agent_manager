# Design

This document describes the design of Simple Agent Manager: the visual language, the node-graph model, the interaction model, and how the UI maps onto the underlying architecture. It is a companion to [README.md](README.md) and [AGENTS.md](AGENTS.md) — the README explains *what* the project is, and this file explains *why* it looks and behaves the way it does.

---

## 1. Design goals

Simple Agent Manager is a tool for assembling AI agents visually. The design is shaped by three goals:

1. **The graph is the source of truth.** Everything a user configures on the canvas must resolve to a single serializable `AgentConfig` object. If it can't be expressed in JSON, it doesn't belong on the canvas.
2. **Configuration is composable, not modal.** Agents are built by connecting peripheral nodes (memory, tools, storage, context, skills, …) to an agent, not by opening deep dialog trees. Each node owns one concern.
3. **The runtime is invisible but honest.** The UI hides the Express/WebSocket backend during normal use, but the state of the underlying run (connecting, streaming, queued, errored) is always exposed through the chat drawer and agent node badges — never silently swallowed.

---

## 2. Visual language

### 2.1 Hex nodes

Every node on the canvas is a pointy-top hexagon rendered via a shared [HexNode](src/nodes/HexNode.tsx) primitive. The hex was chosen for three reasons:

- **Six natural edge sides** map to six peripheral connection points without crowding, which is a better fit than a rectangle for an agent surrounded by peripherals.
- **Non-rectangular silhouettes** make the graph instantly distinguishable from a generic flow-chart editor. A user can tell Simple Agent Manager from a screenshot.
- **Shared geometry** keeps every node type visually unified. Constants like `HEX_WIDTH`, `HEX_SIDE`, and `HEX_CORNER_RADIUS` live in one file, so every node type — agent, memory, tools, context, storage, skills, comms, connectors, vector DB, provider — inherits consistent proportions.

The [AgentNode](src/nodes/AgentNode.tsx) is the "primary" node: larger, with provider branding, run status, and a chat affordance. All other nodes derive from [BasePeripheralNode](src/nodes/BasePeripheralNode.tsx) and share layout, icon placement, and interaction rules.

### 2.2 Color as semantic accent, not decoration

The node palette assigns each node type its own accent color, defined centrally in [src/app.css](src/app.css) under the `--c-node-*` variables:

| Node | Accent | Role |
|---|---|---|
| `agent` | purple `#9e4ad8` | identity / the "self" of the agent |
| `memory` | green `#22c55e` | state that persists and grows |
| `tools` | orange `#f97316` | action / external effect |
| `skills` | purple `#a855f7` | language / prompt content |
| `contextEngine` | cyan `#06b6d4` | attention / budget |
| `agentComm` | pink `#ec4899` | message passing |
| `connectors` | yellow `#eab308` | external integration |
| `storage` | red `#ef4444` | persistence / retention (load-bearing, hence the warning hue) |
| `vectorDatabase` | teal `#14b8a6` | retrieval |
| `cron` | violet `#8b5cf6` | time-triggered behavior |
| `provider` | indigo `#6366f1` | model source |

Accent colors are the **only** identity cue that changes between node types — silhouette, typography, handle positions, and label placement are all shared. This makes a graph readable at a glance: you recognize a node by hue first, then confirm by icon.

### 2.3 Theming through CSS variables

The app is themable from a single file. Every color in the UI routes through a `--c-*` CSS variable in [src/app.css](src/app.css), and Tailwind's palette utilities (`bg-slate-900`, `text-blue-400`, …) are rewired to those variables via an `@theme inline` block. The consequence: the thousands of existing Tailwind class usages across the codebase do not need per-file edits to re-theme the app.

Two themes currently ship:

- **Dark (default):** cool slate neutrals on a deep blue-black canvas (`--c-canvas-bg: #0b1222`), saturated accents.
- **Light (`:root.theme-light`):** a warm stone/cream palette with the slate scale flipped *and* rehued toward ~75° (warm beige), so the default dark-optimized class names render as warm neutrals on cream — not clinical greys on white. Accents are nudged earthier (mossy greens, clay blues, deeper ambers) to sit on a warm canvas without vibrating.

This split exists because a node-graph canvas is high-contrast by nature, and a naive light mode would feel surgical. The warm-neutral approach keeps the tool feeling like a workbench in either mode.

### 2.4 Motion and streaming

Animations are reserved for moments that communicate runtime state, not for decoration. Two are defined globally:

- `streamCharFade` — fades individual characters in as the agent streams its response, giving the chat a tactile "typing into being" quality without blocking on full tokens.
- `streamBlockIn` — slides full blocks (code fences, tool calls, structured output) in together with a short upward translate, so the reader's eye can parse "a new chunk arrived" without re-reading the whole transcript.

Both are tuned short (200–320ms) so they never feel like a loading state.

---

## 3. The graph model

### 3.1 Agent + peripherals, not free-form

The graph is intentionally **not** a general flowchart. There is one kind of primary node (`agent`) and many kinds of peripheral nodes. Peripherals only connect to agents; they never connect to each other. This rule is enforced in [src/store/graph-store.ts](src/store/graph-store.ts) and documented in [CLAUDE.md](CLAUDE.md) under *Conventions*.

The reason: peripherals describe **capabilities an agent has**, not data that flows between components. A `memory` node wired to two agents means both agents share that memory configuration. A `tools` node wired to two agents means both agents expose those tools. There is no meaningful interpretation of a memory node connected to a tools node, so the editor refuses it.

### 3.2 Resolution into `AgentConfig`

[graph-to-agent.ts](src/utils/graph-to-agent.ts) walks the graph and folds every connected peripheral into a single `AgentConfig` JSON object, defined in [shared/agent-config.ts](shared/agent-config.ts). The resolver is pure and runs in the browser — there is no server-side graph interpretation. This matters because:

- **The server never sees the graph.** It only sees the resolved config. That keeps the server-side runtime decoupled from the editor and makes `AgentConfig` the real contract between UI and runtime.
- **Import/export is trivial.** A graph is just nodes + edges + node data; the resolver turns it into a config whenever the server needs it.
- **Tool resolution is explicit.** [resolve-tool-names.ts](shared/resolve-tool-names.ts) layers tool sources in a fixed order: `profile → groups → enabledTools → plugins`. Later layers override earlier ones, so a user can start from a profile and override individual tools without ambiguity.
- **Skills become prompt content.** `SkillsNode` entries and `ToolsNode.skills` are folded into the system prompt during `resolveAgentConfig()` / `buildSystemPrompt()`. Skills are not a runtime concept — they are prompt text with a UI.

### 3.3 The hard requirement: context + storage

Interactive chat is blocked unless the agent has **both** a connected `contextEngine` and a connected `storage` node. This is not a gentle warning — the chat drawer refuses to open.

The reason is a design choice, not a technical one: an agent without a context engine has no defined token budget or compaction strategy, and an agent without storage has no session persistence, which means transcripts, retention, and the session router all become undefined. Rather than shipping "reasonable defaults" that silently hide the absence of these two nodes, the UI forces the user to place them deliberately. It costs two drags and makes the resulting config honest.

---

## 4. Information architecture

The app has three top-level surfaces:

1. **The canvas** — graph editing, the primary workspace. Sidebar on the left holds the draggable node palette ([Sidebar](src/components/)), properties panel on the right shows the selected node's editor from [src/panels/property-editors/](src/panels/property-editors/).
2. **The chat drawer** — opens from an agent node. Streams runs, shows transcripts, exposes session controls. Only available when the agent's config is valid.
3. **The settings workspace** — a separate full-screen view, not a modal. It holds *global* state that isn't per-agent: provider keys, model catalog, defaults, and data maintenance. See [src/settings/](src/settings/).

The split matters because provider credentials and model catalogs are **user-global**, while graphs are **project-local**. A modal would imply settings belong to the current graph; a separate workspace makes it clear they don't.

### 4.1 Property editor per node type

Every node type has a dedicated editor in [src/panels/property-editors/](src/panels/property-editors/). Editors are not generated from a schema — they are hand-written React components. This is deliberate: node configuration has enough variety (token sliders, tool profile pickers, retention policies, model selectors with live catalog sync) that a generic form renderer would either be too shallow or grow into its own DSL. Hand-written editors let each node present its concepts in its own terms while the `AgentConfig` contract keeps them in sync.

---

## 5. Runtime surface (what the UI promises)

The frontend talks to the backend through a narrow set of clients in [src/runtime/](src/runtime/), most notably [storage-client.ts](src/runtime/storage-client.ts). The actual agent runtime lives under [server/runtime/](server/runtime/) and must stay free of React imports — this is enforced as a convention in [CLAUDE.md](CLAUDE.md).

Key design rules for the client/server boundary:

- **Shared types live in [shared/](shared/), not `src/`.** If a type is used by both the React app and the Node server, it belongs in `shared/`, even if that means duplicating a lightweight alias rather than importing across the boundary. The `src/runtime/agent-config.ts` file exists only as a compatibility re-export of `shared/agent-config.ts` and should not be extended.
- **Runs stream over WebSocket.** The UI never polls. Every event a run emits — tool calls, partial content, errors, compaction, hook lifecycle — reaches the chat drawer as it happens.
- **Storage is the authority on sessions.** The [session-router](server/runtime/session-router.ts) and [session-transcript-store](server/runtime/session-transcript-store.ts) own persistence. The UI is a view over that state, not a cache.

---

## 6. What's intentionally absent

A few things the design deliberately does *not* do:

- **No drag-to-connect between peripherals.** (See §3.1.)
- **No inline prompt preview that diverges from the runtime prompt.** The system prompt is assembled by [system-prompt-builder.ts](shared/system-prompt-builder.ts), which is the same code the server uses. There is no second "preview" implementation to drift from reality.
- **No hidden defaults for context/storage.** (See §3.3.)
- **No cross-graph "libraries" of saved nodes.** Graph import/export works at the whole-graph level. A future design may add clip-level reuse, but today the unit of sharing is a full graph file.
- **No server-rendered graph state.** The canvas is client-authoritative; the server sees only resolved `AgentConfig` objects.

These absences are load-bearing — they are why the tool is `Simple` Agent Manager. Adding any of them without revisiting this document is a red flag.

---

## 7. When to update this document

Update `design.md` when you change:

- The visual language (new node shape, palette, theming approach, motion primitives)
- The graph model rules (what can connect to what, what resolution does)
- The hard requirements for running an agent
- The client/server boundary or the role of `shared/`
- What the settings workspace owns vs. what the graph owns

Do **not** update this document for per-node schema changes — those belong in [docs/concepts/](docs/concepts/) per [CLAUDE.md](CLAUDE.md).
