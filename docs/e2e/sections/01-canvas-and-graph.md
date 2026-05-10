# Section 1 — Canvas, Graph Editor & Connections

<!-- last-verified: 2026-05-08 -->

## Scope

Covers everything related to **building a graph in the UI**: the React Flow canvas, the node palette/sidebar, node creation and deletion, edge wiring rules, hex-grid snapping, drag-and-drop, multi-agent layout, panel resizing, and the graph-level pre-flight that gates chat readiness. Per-node property editors are deferred to **§2 Property Editors**, the chat surface (drawer, transcripts, missing-peripheral overlay UX) to **§4 Chat Drawer**, and the full graph-to-`AgentConfig` resolution to **§5 Resolution**. SAMAgent-driven graph patches (`applyPatch`) are touched only enough to describe how programmatic node addition reuses the same snap and persistence machinery.

## Features

### F1.1 — Hex-shaped canvas with React Flow
- **What it does**: Renders an `xyflow` `ReactFlow` canvas occupying the main app area, with a custom honeycomb pattern background, custom hex-shaped node renderers, hex-shaped MiniMap nodes, bottom-right Controls, and a default `'data'` animated edge type.
- **Where it lives**: [FlowCanvas](src/canvas/FlowCanvas.tsx#L68), [HoneycombBackground](src/canvas/HoneycombBackground.tsx#L13), [HexMiniMapNode](src/canvas/FlowCanvas.tsx#L36), [HexNode](src/nodes/HexNode.tsx#L72).
- **Inputs / Triggers**: Mounting the `<FlowCanvas/>` while `appView === 'canvas'` ([App](src/App.tsx#L115)). Re-renders are driven by Zustand subscriptions to `nodes` / `edges` in `useGraphStore`.
- **Outputs / Effects**: Calls `fitView` on first paint, applies viewport-aware honeycomb pattern (`HoneycombBackground` reads `useStore(transformSelector)` so the pattern translates with pan/zoom), uses CSS variable colors via `cssVar`.
- **Dependencies**: `useGraphStore`, `useReactFlow`, `nodeTypes` from [node-registry](src/nodes/node-registry.ts#L15), `edgeTypes` from [DataEdge](src/edges/DataEdge.tsx#L86).
- **Failure modes**: A node whose `data.type` isn't in `NODE_COLORS` would crash MiniMap rendering ([line 162](src/canvas/FlowCanvas.tsx#L162)) — only matters if the graph is loaded with a node `type` not in the registry.

### F1.2 — Empty-canvas first-run state
- **What it does**: When `nodes.length === 0`, the canvas overlays a Lottie squid animation rotated 45° plus the prompt "Drag an agent onto the canvas to get started".
- **Where it lives**: [FlowCanvas empty overlay](src/canvas/FlowCanvas.tsx#L170).
- **Inputs / Triggers**: `nodes.length === 0` (initial boot before hydration completes, after `clearGraph()`, or if storage holds an empty graph).
- **Outputs / Effects**: Pointer-events disabled, the overlay disappears the moment any node is added.
- **Failure modes**: Briefly visible during the boot window before `hydrateGraph()` resolves the server copy, even when local/server state is non-empty.

### F1.3 — Sidebar palette with two sections (Core, Peripherals)
- **What it does**: A left-edge collapsible "island" sidebar with a stack of draggable hex tiles. Hovering expands the panel from 84px to 256px and reveals labels.
- **Where it lives**: [Sidebar](src/panels/Sidebar.tsx#L166), `CORE_ITEMS` ([line 51](src/panels/Sidebar.tsx#L51)), `PERIPHERAL_ITEMS` ([line 58](src/panels/Sidebar.tsx#L58)).
- **Inputs / Triggers**: Pointer hover; `appView` controls whether canvas palette or settings sections are shown.
- **Outputs / Effects**: Items currently shown for canvas view (in this exact order): `agent`, `memory`, `tools`, `skills`, `contextEngine`, `agentComm`, `connectors`, `storage`, `vectorDatabase`, `mcp`, `provider`, `subAgent`. Note `cron` is in the registry and `getDefaultNodeData` but is **not** in the palette — only addable programmatically (e.g. via `applyPatch`).
- **Dependencies**: `chatPanelOpen` from `useUILayoutStore` shifts the sidebar's `left` so it sits to the right of the SAMAgent island.
- **Failure modes**: With chat panel open AND properties panel open AND a narrow viewport, sidebar may overlap; behavior unclear at small widths.

### F1.4 — Drag-and-drop a palette node onto the canvas
- **What it does**: Each palette tile sets `application/reactflow` to its `NodeType` on `dragstart`; the canvas's `onDragOver`/`onDrop` decode this, snap-to-hex around the cursor, and call `addNode`.
- **Where it lives**: [`DraggableItem.onDragStart`](src/panels/Sidebar.tsx#L82), [`useDragAndDrop`](src/canvas/useDragAndDrop.ts#L11), `addNode` in [graph-store](src/store/graph-store.ts#L312).
- **Inputs / Triggers**: HTML5 native drag-and-drop. Drag image is a hidden hex preview rendered inline at the current viewport zoom ([line 87](src/panels/Sidebar.tsx#L87)).
- **Outputs / Effects**: Adds a node with default data via `getDefaultNodeData`, position derived from `screenToFlowPosition` then offset by `HEX_WIDTH/2, HEX_HEIGHT/2` then snapped to the nearest free hex cell.
- **Dependencies**: `useReactFlow().screenToFlowPosition`, `buildOccupiedCellSet`, `snapNodePositionToFreeCell`.
- **Failure modes**: If `dataTransfer.getData('application/reactflow')` is empty (drop from outside), the handler returns early. If the cursor is dropped on a populated cell, `findNearestFreeCell` walks rings up to radius 32 — no UI feedback if the search runs out, which `findNearestFreeCell` would silently treat by returning the original cell.

### F1.5 — Hex-grid snap with live preview ("SnapHighlight")
- **What it does**: While dragging an existing node, an overlay highlights the hex cell the node will snap to on drop, colored by node type. On drag-stop, the node position commits to that cell.
- **Where it lives**: [SnapHighlight](src/canvas/SnapHighlight.tsx#L16), `onNodeDrag` ([line 92](src/canvas/FlowCanvas.tsx#L92)), `onNodeDragStop` ([line 104](src/canvas/FlowCanvas.tsx#L104)).
- **Inputs / Triggers**: `ReactFlow` `onNodeDrag` events stream while dragging.
- **Outputs / Effects**: `snapPreview` state holds `{ center, color }`; rendered as a translucent rounded hex via SVG. On drop, `onNodesChange` issues a `position` change to the snapped top-left.
- **Dependencies**: `nodeTopLeftToAxial`, `findNearestFreeCell`, `axialToPixel`, `axialToNodeTopLeft`, `NODE_COLORS`.
- **Failure modes**: Snap radius capped at 32 rings ([findNearestFreeCell](src/utils/hex-snap.ts#L100)) — a ridiculously dense graph could theoretically fall back to the target cell despite collisions.

### F1.6 — Node-type registry mapping types to renderers
- **What it does**: Maps each `NodeType` to its custom React Flow node component, used by both the canvas (`<ReactFlow nodeTypes=…>`) and indirectly by the MiniMap (only for color lookup).
- **Where it lives**: [node-registry](src/nodes/node-registry.ts#L15).
- **Inputs / Triggers**: Static module export, consumed once at canvas mount.
- **Outputs / Effects**: 13 entries: `agent`, `memory`, `tools`, `skills`, `contextEngine`, `agentComm`, `connectors`, `storage`, `vectorDatabase`, `cron`, `provider`, `mcp`, `subAgent`.
- **Failure modes**: Any node whose `data.type` doesn't match a registry key won't render (React Flow falls back to default node).

### F1.7 — Generic peripheral node renderer (`BasePeripheralNode`)
- **What it does**: Most peripheral types render via `BasePeripheralNode`, which wraps `HexNode`, displays the node's color stripe, an icon, the type's label, and a single `source` handle anchored at `Position.Right`.
- **Where it lives**: [BasePeripheralNode](src/nodes/BasePeripheralNode.tsx#L15).
- **Inputs / Triggers**: Receives `nodeType`, `label`, `icon`, `selected`, `hints` from the wrapping node component (e.g. [StorageNode](src/nodes/StorageNode.tsx#L40)).
- **Outputs / Effects**: Right-only source handle; cannot be a target. This is what implements the "peripheral → agent only" wiring rule on the source side.

### F1.8 — Agent node renderer with chat button + dynamic hints
- **What it does**: Renders `agent` nodes with the SAM logo, the agent's `name`, a target handle on the left, a corner chat button, and up to three `HexHint` badges (Provider plugin, LLM brand, Thinking level).
- **Where it lives**: [AgentNode](src/nodes/AgentNode.tsx#L78), `HexHint` corner indicators ([line 98](src/nodes/AgentNode.tsx#L98)).
- **Inputs / Triggers**: Node `data` (`name`, `modelId`, `thinkingLevel`); `useGraphStore` is queried inline to find an inbound provider edge for brand display.
- **Outputs / Effects**: Click on chat button → `useAgentConnectionStore.openChatDrawer(id)`; pulsing green dot when this agent is the active chat target.
- **Dependencies**: `useAgentConnectionStore`, `useGraphStore`, `PROVIDER_BRANDS`, `LLM_BRANDS`, `THINKING_COLORS`.
- **Failure modes**: If `modelId` is empty, no LLM brand hint shows. Brand resolution falls back to first 1-2 chars upper-cased.

### F1.9 — Sub-agent node has both target and source handles
- **What it does**: `subAgent` nodes carry a left target handle (so dedicated `tools`/`provider`/`skills`/`mcp` peripherals can connect into them) AND a right source handle (so the sub-agent itself connects up to its parent agent).
- **Where it lives**: [SubAgentNode](src/nodes/SubAgentNode.tsx#L29).
- **Inputs / Triggers**: Drag-from-handle in either direction.
- **Outputs / Effects**: Hint badge surfaces name validation state (`!`, `X`) or model mode (`INH`/`CUS`).
- **Failure modes**: Sub-agent without a confirmed name renders as "Sub-Agent" with a red `!` hint; runtime validity is enforced separately.

### F1.10 — Connection rule: `peripheral → agent` only (`isValidConnection`)
- **What it does**: While the user drags an edge, ReactFlow consults `isValidConnection`, which only accepts connections whose target is an `agent` node.
- **Where it lives**: [FlowCanvas.isValidConnection](src/canvas/FlowCanvas.tsx#L83).
- **Inputs / Triggers**: Drag from a source handle onto a target handle.
- **Outputs / Effects**: Disallows: agent → agent, peripheral → peripheral, anything → subAgent **at this layer**. Note this is stricter than `onConnect` — see F1.11.
- **Failure modes**: **Inconsistency**: `isValidConnection` only accepts `agent` targets, but the store's `onConnect` ([graph-store line 283](src/store/graph-store.ts#L283)) also accepts `subAgent` targets when the source is `tools`/`provider`/`skills`/`mcp`. Behavior unclear: the visual drag indicator may reject the drop while a programmatic `onConnect` would accept it. Verify how sub-agent peripherals are actually wired in the UI (likely via `applyPatch` rather than drag).

### F1.11 — Connection finalization (`onConnect`) with sub-agent allow-list
- **What it does**: Builds and adds a `data`-typed animated edge with id `edge_<source>_<target>`. Rejects if target is neither agent nor sub-agent. For sub-agent targets, only sources of type `tools`, `provider`, `skills`, `mcp` are accepted.
- **Where it lives**: [graph-store.onConnect](src/store/graph-store.ts#L283).
- **Inputs / Triggers**: ReactFlow's `onConnect` callback after a successful drop.
- **Outputs / Effects**: Edge appended to `edges` via `addEdge`; default styling `{ type: 'data', animated: true }`. Edge id is **deterministic** by `source_target` — connecting the same pair twice produces a duplicate-id edge (xyflow's `addEdge` will deduplicate).
- **Failure modes**: Two edges between the same source and same target (different handles) collide on id. Multiple peripherals of the same type can connect to a single agent — duplicate detection happens later in `validateAgentRuntimeGraph` (see F1.27 for the provider-specific duplicate check).

### F1.12 — Edge styling and per-edge delete affordance (`DataEdge`)
- **What it does**: Custom edge component renders a bezier path stroked in the source node's color (`NODE_COLORS[sourceNodeType]`), with an inline `X` button at the midpoint that becomes visible on hover.
- **Where it lives**: [DataEdge](src/edges/DataEdge.tsx#L18).
- **Inputs / Triggers**: Hovering the edge to reveal the delete button; click removes the edge via `setEdges`.
- **Outputs / Effects**: Edge removed from React Flow state via `useReactFlow().setEdges`. **This bypasses the Zustand store** — the change still flows through `onEdgesChange` because xyflow's controlled flow propagates removals as `EdgeChange` events.
- **Dependencies**: `useStore(s => s.nodeLookup)` to read source node type.
- **Failure modes**: If the source node has no entry in `NODE_COLORS`, edge falls back to slate-600. Hover-to-reveal logic uses inline opacity toggling on `mouseenter`/`mouseleave` plus a CSS sibling selector — the two paths can fight on edge selection state.

### F1.13 — Node movement (drag) with snapping
- **What it does**: Users can drag any node by clicking-and-holding its body; on drop, position commits to the nearest free hex cell.
- **Where it lives**: [onNodeDrag](src/canvas/FlowCanvas.tsx#L92), [onNodeDragStop](src/canvas/FlowCanvas.tsx#L104).
- **Inputs / Triggers**: Pointer drag on the node body (handles use the `nodrag` class to avoid conflict).
- **Outputs / Effects**: Position updated via `onNodesChange([{ type: 'position', ... }])` only when the snapped position differs from the current.
- **Failure modes**: If the user drags a node onto a cell that's already its own (excluded via `buildOccupiedCellSet(nodes, node.id)`), the snap returns the same cell — no-op.

### F1.14 — Node selection (single, click)
- **What it does**: Clicking a node sets `selectedNodeId`; clicking the empty pane (`onPaneClick`) clears it.
- **Where it lives**: [FlowCanvas.onNodeClick](src/canvas/FlowCanvas.tsx#L131), [onPaneClick](src/canvas/FlowCanvas.tsx#L134), `setSelectedNode` in [graph-store](src/store/graph-store.ts#L520).
- **Inputs / Triggers**: Click on a node body OR background pane.
- **Outputs / Effects**: Updates `selectedNodeId`, **closes the chat drawer** on selection (`closeChatDrawer()` is called for any non-null id). Drives whether `<PropertiesPanel/>` renders ([App line 126](src/App.tsx#L126)).
- **Dependencies**: `useAgentConnectionStore.closeChatDrawer`.
- **Failure modes**: No multi-select wired through `useGraphStore` — even if React Flow's built-in shift/ctrl multi-select fires `selected` flags on multiple nodes, the store only tracks one id.

### F1.15 — Node deletion via React Flow's default keyboard shortcut
- **What it does**: ReactFlow's default behavior fires a `remove` change for selected nodes when Delete/Backspace is pressed, which `onNodesChange` intercepts.
- **Where it lives**: [graph-store.onNodesChange](src/store/graph-store.ts#L256).
- **Inputs / Triggers**: Delete key with a node selected.
- **Outputs / Effects**: For non-agent nodes: clears any active session for that id, destroys any agent runtime, and applies the remove to nodes. Edges that referenced the removed node are NOT explicitly filtered here — relies on React Flow's built-in cascade for edge cleanup. (`removeNode` in [line 330](src/store/graph-store.ts#L330) does explicitly filter edges, but it's only called from explicit code paths, not the keyboard delete path.)
- **Failure modes**: Behavior unclear: keyboard-delete of a peripheral node may leave dangling edges briefly until React Flow's auto-cleanup applies them through `onEdgesChange`.

### F1.16 — Agent deletion is intercepted with a confirmation dialog
- **What it does**: When an agent node is the target of a `remove` change, the change is intercepted (skipped from `applyNodeChanges`) and `requestDeleteAgent` is called, which sets `pendingDeleteAgent`. The `<AgentDeleteDialog/>` then prompts the user to either delete with data, delete without data, or cancel.
- **Where it lives**: [onNodesChange interception](src/store/graph-store.ts#L260), [AgentDeleteDialog](src/nodes/AgentDeleteDialog.tsx), [confirmDeleteAgent](src/store/graph-store.ts#L220).
- **Inputs / Triggers**: Removing an agent node (keyboard or programmatic). Only fires when the agent has a `name` set.
- **Outputs / Effects**:
  - **Yes, delete data**: Destroys runtime, clears active session, runs `StorageClient.deleteAgentData()` async (best-effort), removes node + edges, deletes all session-store entries for the agent.
  - **No, keep data**: Same teardown but skips the storage HTTP DELETE and `deleteAllSessionsForAgent`.
  - **Cancel**: Restores `pendingDeleteAgent` to null with no graph mutation.
- **Dependencies**: `useAgentConnectionStore.destroyAgent`, `useSessionStore.clearActiveSession` / `deleteAllSessionsForAgent`, `StorageClient`, `resolveAgentConfig` (to find the storage config to talk to).
- **Failure modes**: Comments at line 224 warn that runtime destroy must precede HTTP DELETE so transcripts don't recreate the directory; keep-data path skips `deleteAllSessionsForAgent` so transcripts in the session store survive but the canvas no longer has an owning node.

### F1.17 — Agent without name is force-named on creation (`AgentNameDialog`)
- **What it does**: Adding an agent sets `pendingNameNodeId` to that node's id; `<App/>` renders `<AgentNameDialog/>` modally. The dialog enforces validation (length 2-40, no `: / \\` chars, unique among existing agents), and on confirm sets `name` + `nameConfirmed: true`. Cancel removes the node (which is non-agent path because `nameConfirmed` is false).
- **Where it lives**: [addNode triggers pendingNameNodeId](src/store/graph-store.ts#L323), [AgentNameDialog.validate](src/nodes/AgentNameDialog.tsx#L25), [App handlers](src/App.tsx#L67).
- **Inputs / Triggers**: Drag-and-drop agent OR programmatic `addNode('agent', …)`.
- **Outputs / Effects**: Modal blocks until the user confirms or cancels. Cancellation calls `removeNode` — since `nameConfirmed` is still false at that point, the path through `removeNode` ([line 330](src/store/graph-store.ts#L330)) DOES NOT trigger the delete-confirmation dialog (because the check is `if (agentName)` — empty name skips it).
- **Failure modes**: Behavior unclear: if `applyPatch` adds an agent (which seeds `nameConfirmed: false` but with a server-supplied name), the naming dialog won't open because `pendingNameNodeId` is not set in that path. So programmatically-added agents bypass the naming UX.

### F1.18 — Agent name uniqueness check (`isAgentNameTaken`)
- **What it does**: Validates that no other agent (by `nameConfirmed: true` AND `name.toLowerCase()`) shares the proposed name.
- **Where it lives**: [graph-store.isAgentNameTaken](src/store/graph-store.ts#L536). Note `AgentNameDialog` reimplements this check inline ([line 36](src/nodes/AgentNameDialog.tsx#L36)) without filtering by `nameConfirmed` — slight semantic drift between the two.
- **Inputs / Triggers**: Each keystroke + on submit.
- **Outputs / Effects**: Submit blocks with red error if taken.
- **Failure modes**: The dialog's check ignores `nameConfirmed`, so two unconfirmed agents (e.g. via patch) with identical names would both block each other. Probably not reachable in normal UI flow.

### F1.19 — Agents are not renamable after confirmation
- **What it does**: Once `nameConfirmed: true`, there is no UI to change `name`. The dialog is one-shot at creation.
- **Where it lives**: Implicit — no rename code paths exist. The dialog explicitly warns "the agent name **cannot be changed** later" ([line 109](src/nodes/AgentNameDialog.tsx#L109)).
- **Inputs / Triggers**: N/A.
- **Outputs / Effects**: To rename, user must delete and recreate the agent (which the dialog explicitly warns about).

### F1.20 — Multi-agent canvas (multiple agents coexist)
- **What it does**: Any number of agent nodes can live on the same canvas; each has its own selection state, its own naming dialog flow when added, its own delete dialog, its own chat drawer trigger.
- **Where it lives**: `useGraphStore.nodes` — no cardinality cap. `getAgentNames` ([graph-store line 547](src/store/graph-store.ts#L547)) returns all confirmed names.
- **Inputs / Triggers**: Repeated drag-from-palette of agent.
- **Outputs / Effects**: Pruning of orphan sessions runs on every change of `nodes.length` ([App line 60](src/App.tsx#L60)). Each agent has independent peripheral wiring.
- **Failure modes**: Two agents may share a peripheral (one peripheral connects to multiple agents — allowed by `onConnect`). Verify `resolveAgentConfig` honors per-target lookups (covered in §5).

### F1.21 — Programmatic node addition via `applyPatch` (SAMAgent)
- **What it does**: Accepts a `WorkflowPatch` (`add_nodes`, `update_nodes`, `remove_nodes`, `add_edges`, `remove_edges`) and applies it atomically with rollback on throw. Maps tempIds to real ids, anchors new positions near the existing graph's bounding box, snaps each new node to a free hex cell.
- **Where it lives**: [applyPatch](src/store/graph-store.ts#L362), `computeLayoutOrigin` ([line 44](src/store/graph-store.ts#L44)), `isReasonablePosition` ([line 61](src/store/graph-store.ts#L61)).
- **Inputs / Triggers**: SAMAgent chat (`workflow-patch` over WS).
- **Outputs / Effects**: New nodes get `getDefaultNodeData` then `add.data` overlay; positions are clamped to "reasonable" (within 800px of the bbox) else cascaded in a 4-column grid. Persists immediately via `saveGraph` + `saveGraphToServer` (does not wait for debounce). On error, both `nodes` and `edges` revert to pre-patch.
- **Dependencies**: `redactGraphSnapshot`, `getDefaultNodeData`, `buildOccupiedCellSet`, `snapNodePositionToFreeCell`.
- **Failure modes**: If a patch removes a node mid-transaction, `destroyAgent`/`clearActiveSession` for that id is called AFTER the `set()` — the comment at line 445 explicitly notes this is irreversible if commit subsequently throws (it shouldn't, but).

### F1.22 — Graph autosave (debounced) to localStorage + backend
- **What it does**: A subscriber on `useGraphStore` debounces 500ms after any change and writes the graph to both `localStorage[agent-manager-graph]` and `PUT /api/graph`.
- **Where it lives**: [auto-persist subscription](src/store/graph-store.ts#L605), [saveGraph](src/store/storage.ts#L52), [saveGraphToServer](src/store/storage.ts#L115).
- **Inputs / Triggers**: Any state change in `useGraphStore` after `isHydrated` is set.
- **Outputs / Effects**: Persisted blob is `{ id: 'default', version: 2, graph, updatedAt }`. Backend errors are silently swallowed; localStorage caches survive offline boots.
- **Dependencies**: `fetch('/api/graph')` server contract.
- **Failure modes**: High-frequency drag updates flush every 500ms. If the backend is down, the localStorage cache stays current and the server side falls behind — boot logic in `hydrateGraph` will then re-seed the server from local on next online boot. Hydration gate prevents stomp during initial render.

### F1.23 — Graph hydration on boot (server-wins, local fallback)
- **What it does**: On module load, applies the localStorage graph immediately (paint), then fetches `/api/graph`. If server has nodes, server wins and overwrites local. If server is empty but local has nodes, pushes local up to seed the server. Sets `isHydrated = true` to enable autosave.
- **Where it lives**: [hydrateGraph](src/store/graph-store.ts#L622).
- **Inputs / Triggers**: Module-load side effect (`void hydrateGraph()`).
- **Outputs / Effects**: Both stores converge; user sees the cached graph immediately and the authoritative one within one network round-trip.
- **Failure modes**: If both `local.graph.nodes.length === 0` and `server.graph.nodes.length === 0`, the canvas stays empty (first-run state). If the server returns an error, only local is used.

### F1.24 — Graph migrations on load
- **What it does**: `loadGraph` and `migrateGraph` apply backwards-compatible patches: ensures all nodes have current default-data fields, marks legacy named agents as `nameConfirmed: true`, migrates `contextEngine.systemPromptAdditions` into the connected agent's `systemPrompt` (append mode), drops obsolete `bootstrapMaxChars` / `bootstrapTotalMaxChars`, seeds `postCompactionTokenTarget: 50000`.
- **Where it lives**: [graph-store.loadGraph](src/store/graph-store.ts#L559), [migrateGraph](src/store/storage.ts#L33).
- **Inputs / Triggers**: Boot or any explicit `loadGraph` call.
- **Outputs / Effects**: Mutates node data in place during migration. Returns nothing.
- **Failure modes**: Mutation through `as any` on shared store state — if a migration runs twice, repeated `+= '\n\n' + additions.join(…)` would NOT happen because additions are deleted after migration. Behavior unclear if a migration partially fails — node may end up with both old and new shape.

### F1.25 — Apply settings defaults to existing nodes
- **What it does**: `applyAgentDefaultsToExistingAgents` and `applyStorageDefaultsToExistingNodes` overwrite the relevant fields on all matching nodes with current settings values.
- **Where it lives**: [graph-store lines 476, 494](src/store/graph-store.ts#L476).
- **Inputs / Triggers**: Called from settings UI (out of scope for §1).
- **Outputs / Effects**: Rewrites `modelId`/`thinkingLevel` for agents, `storagePath` for storage nodes. Does NOT touch description, tags, or any other fields.

### F1.26 — Settings-aware node defaults at creation
- **What it does**: `buildNodeData` ([graph-store line 75](src/store/graph-store.ts#L75)) overlays each `getDefaultNodeData` result with values from `useSettingsStore` for these types: `agent`, `provider`, `storage`, `contextEngine`, `memory`, `cron`, `agentComm`. Other types use defaults verbatim.
- **Where it lives**: [buildNodeData](src/store/graph-store.ts#L75).
- **Inputs / Triggers**: Internally invoked by `addNode`. Not used by `applyPatch` (which uses raw `getDefaultNodeData` + patch overlay).
- **Outputs / Effects**: Newly dragged agents get the user's preferred default model / thinking level / system prompt; storage nodes get the user's preferred storage path; etc.
- **Failure modes**: If settings haven't loaded from server yet, the in-memory defaults from `settings-store` are used (the loader runs on app mount, see [App](src/App.tsx#L36)).

### F1.27 — Pre-flight graph validation (`validateAgentRuntimeGraph`)
- **What it does**: Exposes a function that returns an array of `AgentGraphValidationError` for an agent. Currently checks: missing provider, duplicate provider, empty `pluginId` on the provider, unselected connector id, unknown connector id.
- **Where it lives**: [validateAgentRuntimeGraph](src/utils/graph-to-agent.ts#L747).
- **Inputs / Triggers**: Called by chat surface and elsewhere (mostly outside the canvas — this section just notes that the canvas itself doesn't currently surface these errors as banners or inline indicators).
- **Outputs / Effects**: Returns errors with codes: `missing_provider` | `duplicate_provider` | `empty_plugin_id` | `unselected_connector` | `unknown_connector`.
- **Failure modes**: Behavior unclear: the canvas doesn't visually surface validation errors except indirectly through the chat blocked-state overlay (see F1.28). Connector validation only fires for connected connectors; orphan/disconnected connectors aren't flagged.

### F1.28 — Chat-readiness gating: requires `contextEngine` + `storage` + provider
- **What it does**: Chat opening surfaces a "missing peripherals" overlay if any of `contextEngine`, `storage`, `provider.pluginId` are absent in the resolved `AgentConfig`. Each missing prerequisite shows a description and a hint to drag the right node onto the canvas.
- **Where it lives**: [ChatDrawer.missingPeripherals](src/chat/ChatDrawer.tsx#L315).
- **Inputs / Triggers**: Opening the chat drawer for an agent whose graph is incomplete.
- **Outputs / Effects**: `isBlocked` toggles transcript loading off and shows the overlay. (Full UX is documented in §4 — included here only to point at the canvas-side cause: missing edges/nodes.)
- **Failure modes**: Connector errors (from `validateAgentRuntimeGraph`) are NOT part of this readiness check — they're surfaced separately. So a graph could pass chat-ready but fail connector validation.

### F1.29 — `clearGraph` action (full reset)
- **What it does**: Wipes `nodes`, `edges`, `selectedNodeId`, `pendingNameNodeId` to empty. Triggers debounced autosave which propagates the empty state to localStorage and backend.
- **Where it lives**: [clearGraph](src/store/graph-store.ts#L511).
- **Inputs / Triggers**: Not directly wired into a UI button in `src/canvas/`. Verify which surface invokes this — likely settings or test fixtures.
- **Outputs / Effects**: Returns to first-run state; squid overlay reappears.
- **Failure modes**: Behavior unclear: `clearGraph` does **not** call `destroyAgent` for any agents on the canvas. If runtimes were active, they may continue running on the server until they timeout. Compare to `confirmDeleteAgent` which explicitly tears down.

### F1.30 — MiniMap with hex-shaped nodes
- **What it does**: Renders a bottom-right minimap; node markers are drawn as rounded hex paths via `HexMiniMapNode`. Nodes are colored by `NODE_COLORS[data.type]`.
- **Where it lives**: [MiniMap](src/canvas/FlowCanvas.tsx#L160), [HexMiniMapNode](src/canvas/FlowCanvas.tsx#L36).
- **Inputs / Triggers**: Always rendered; reflects `nodes` state.
- **Outputs / Effects**: Click-to-pan on minimap (xyflow default).

### F1.31 — Controls (zoom in/out, fit-view, lock)
- **What it does**: Bottom-right xyflow Controls component with the default buttons; positioned at `bottom: 168` to clear other floating UI.
- **Where it lives**: [Controls](src/canvas/FlowCanvas.tsx#L155).

### F1.32 — Properties panel resize (right-anchored)
- **What it does**: A draggable resize handle on the left edge of the right-side properties panel. Width persists to `agent-manager-ui-layout` in localStorage. Width is clamped to `[minWidth, min(maxWidth, window.innerWidth - 160)]`.
- **Where it lives**: [PanelResizeHandle](src/panels/PanelResizeHandle.tsx#L6), [useRightAnchoredResize](src/panels/useRightAnchoredResize.ts#L27), `propertiesPanelWidth` in [ui-layout-store](src/store/ui-layout-store.ts#L56).
- **Inputs / Triggers**: Pointer drag on the handle.
- **Outputs / Effects**: Live width updates via rAF during drag, commits on mouseup. Persists to localStorage on every change.
- **Dependencies**: `useUILayoutStore.setPropertiesPanelWidth`.
- **Failure modes**: Default `propertiesPanelWidth = 288`. On viewport resize, the stored width is re-clamped via `clampRightAnchoredPanelWidth`.

### F1.33 — Chat drawer width persistence (sister of F1.32)
- **What it does**: Similar resize/persistence for the chat drawer width. `chatDrawerWidth`, `chatPanelOpen` are stored in the same `ui-layout-store`.
- **Where it lives**: [ui-layout-store](src/store/ui-layout-store.ts#L8).
- **Inputs / Triggers**: Resize and toggle actions on the chat drawer (covered in §4).
- **Outputs / Effects**: Sidebar `left` offset is computed from `chatPanelOpen` ([Sidebar line 171](src/panels/Sidebar.tsx#L171)).

### F1.34 — Pane click clears selection (and side-effects properties panel)
- **What it does**: Clicking the empty canvas calls `setSelectedNode(null)`, which ALSO calls `closeChatDrawer()` (no-op if not open), and side-effects the right-side properties panel to unmount.
- **Where it lives**: [setSelectedNode](src/store/graph-store.ts#L520).
- **Inputs / Triggers**: `onPaneClick` from xyflow.
- **Outputs / Effects**: `<PropertiesPanel/>` only renders when `selectedNodeId && !chatAgentId` ([App line 126](src/App.tsx#L126)).

### F1.35 — Selecting a node closes the chat drawer
- **What it does**: `setSelectedNode(id)` calls `closeChatDrawer()` whenever id is non-null. The two surfaces are mutually exclusive.
- **Where it lives**: [setSelectedNode](src/store/graph-store.ts#L520), [App right panel logic](src/App.tsx#L126).
- **Inputs / Triggers**: Click any node body.
- **Outputs / Effects**: Chat drawer immediately collapses; properties panel takes its place.
- **Failure modes**: Behavior unclear: if the user is mid-message and clicks a node, the drawer closes without warning. The `agent-connection-store` may still hold the active runtime — re-opening should restore state.

### F1.36 — Settings button (top-right) switches `appView`
- **What it does**: A small Settings button at top-right of the canvas switches the app to the Settings workspace; FlowCanvas unmounts and SettingsWorkspace takes over the main area.
- **Where it lives**: [App settings button](src/App.tsx#L106).
- **Failure modes**: Switching back via `onExit` returns to canvas; the graph is preserved (Zustand state).

### F1.37 — Per-agent connection store integration
- **What it does**: `useAgentConnectionStore` tracks live runtimes per agent node id. Removing an agent node calls `destroyAgent(nodeId)` to terminate the runtime cleanly. The chat button on AgentNode checks `chatAgentNodeId === id` to render the pulsing "active" dot.
- **Where it lives**: Used in [graph-store onNodesChange](src/store/graph-store.ts#L271), [confirmDeleteAgent](src/store/graph-store.ts#L228), [AgentNode](src/nodes/AgentNode.tsx#L80).
- **Outputs / Effects**: On delete, the WS client is torn down before any storage HTTP call (race comment at line 224).

### F1.38 — Orphan session pruning
- **What it does**: On mount and on every `nodes.length` change, `pruneOrphanSessions(agentIds)` removes any session entries whose agent id is no longer in the graph.
- **Where it lives**: [App.useEffect](src/App.tsx#L60).
- **Inputs / Triggers**: Mount + node-count changes.
- **Outputs / Effects**: Cleans up `useSessionStore` after deletes that didn't fully cascade.
- **Failure modes**: Triggered only on `nodes.length` change — adding a node and removing one in the same tick may not refire if length is unchanged. (Probably acceptable since `confirmDeleteAgent` already calls `clearActiveSession`/`deleteAllSessionsForAgent` directly.)

### F1.39 — `cron` node type addable only programmatically
- **What it does**: `cron` exists in the registry, has defaults, and is fully addable via `applyPatch`, but is **not** in the sidebar palette so it cannot be dragged onto the canvas.
- **Where it lives**: [Sidebar PERIPHERAL_ITEMS](src/panels/Sidebar.tsx#L58) (no cron entry), [node-registry](src/nodes/node-registry.ts#L25), [getDefaultNodeData cron case](src/utils/default-nodes.ts#L196).
- **Failure modes**: A graph loaded with cron nodes from a previous session renders fine, but the user cannot create new ones from the canvas UI.

### F1.40 — Deterministic edge ids enable stable removal
- **What it does**: Edge id format `edge_<source>_<target>` makes removal idempotent — `removeNode` filters edges by source/target id without needing to look up edge ids.
- **Where it lives**: [onConnect line 305](src/store/graph-store.ts#L305), [applyPatch line 426](src/store/graph-store.ts#L426).
- **Failure modes**: Two parallel edges between the same pair (e.g. via different handles) collide. Currently the only valid wiring (peripheral → agent on a single Right→Left handle pair) makes this irrelevant.

### F1.41 — Default edge marker/animation
- **What it does**: All edges created via `onConnect` are typed `'data'` and `animated: true`, picked up by `defaultEdgeOptions` on the canvas.
- **Where it lives**: [FlowCanvas line 142](src/canvas/FlowCanvas.tsx#L142), [DataEdge](src/edges/DataEdge.tsx).

### F1.42 — Snap-collision behavior at hex-cell boundary
- **What it does**: `findNearestFreeCell` walks rings outward; the cell containing the dragged node is excluded from `occupied` via `excludeId`. So a node "dropped on itself" is still considered free.
- **Where it lives**: [hex-snap.findNearestFreeCell](src/utils/hex-snap.ts#L100), [buildOccupiedCellSet](src/utils/hex-snap.ts#L137).

## End-to-End Test Scenarios

### TC1.1 — First-run empty canvas
- **Goal**: Verify squid empty-state and that no graph state leaks between sessions.
- **Pre-conditions**: Clear `localStorage` keys `agent-manager-graph` and `agent-manager-ui-layout`; backend `/api/graph` returns empty.
- **Steps**:
  1. Open the app.
  2. Confirm the squid Lottie is visible with the prompt text.
  3. Drag the agent palette tile to anywhere on the canvas.
- **Expected**: Squid disappears as soon as the agent node is added; the naming dialog (F1.17) modally blocks input.
- **Edge cases / variants**: Slow backend → cached empty local + slow server response should still show empty state without flicker.

### TC1.2 — Drag every palette node onto the canvas
- **Goal**: Each of 11 sidebar items adds a unique node type with correct defaults.
- **Pre-conditions**: Empty canvas; provider registry / settings loaded so default overrides apply.
- **Steps**:
  1. Drag one tile of each `CORE_ITEMS + PERIPHERAL_ITEMS` (agent + 10 peripherals + subAgent — naming dialog will block on the agent).
  2. Confirm/cancel the agent naming dialog as appropriate.
  3. Inspect each new node's data via the properties panel (peeking; deeper editor coverage in §2).
- **Expected**: Each node appears at the correct hex cell, with its `NodeType` color stripe and label. Settings-aware defaults applied (F1.26) for `agent`/`provider`/`storage`/`contextEngine`/`memory`/`cron`/`agentComm`.
- **Edge cases / variants**: Drop inside an occupied cell snaps to the next free hex (F1.4). Cron is **not** in the palette so cannot be tested here.

### TC1.3 — Hex-grid snap visual + commit
- **Goal**: The `SnapHighlight` overlay tracks the cursor and the node commits to the highlighted cell.
- **Pre-conditions**: At least one node on the canvas.
- **Steps**:
  1. Begin dragging a node.
  2. Slowly move it across cells; observe the colored hex outline shifts cell by cell.
  3. Drop in an empty cell; drop again over an occupied cell.
- **Expected**: Drop in empty cell → node sits exactly at that cell. Drop on occupied cell → node displaces to the nearest free ring (F1.5, F1.42).
- **Edge cases / variants**: At extreme zoom levels, snap calculations should still align with the on-screen overlay.

### TC1.4 — Connect peripheral to agent (happy path)
- **Goal**: A `provider` source handle connects to an `agent` target handle and the resulting edge is colored, animated, and deletable.
- **Pre-conditions**: One agent node + one provider node on the canvas, no edges.
- **Steps**:
  1. Drag from the provider's right handle onto the agent's left handle.
  2. Hover the edge midpoint and click the X delete button.
- **Expected**: Edge has id `edge_<provider-id>_<agent-id>`, type `data`, animated, stroked in `NODE_COLORS.provider`. Delete X removes it cleanly (F1.12).
- **Edge cases / variants**: Drag onto agent body (not a handle) should fail silently per xyflow defaults.

### TC1.5 — Reject peripheral-to-peripheral connections
- **Goal**: `isValidConnection` blocks invalid drags before commit.
- **Steps**:
  1. Add a provider and a memory node.
  2. Try to drag the provider's source handle onto the memory node (which has no target handle anyway).
  3. Try to drag from one peripheral source to another peripheral's edge area.
- **Expected**: No edge is created. `isValidConnection` returns false because target is not `agent` (F1.10).
- **Edge cases / variants**: Verify the visual rejection cue (xyflow's red drop indicator).

### TC1.6 — Sub-agent peripheral allow-list
- **Goal**: Only `tools`/`provider`/`skills`/`mcp` can connect into a sub-agent target; sub-agent itself can connect to its parent agent.
- **Steps**:
  1. Add an agent + a sub-agent + a tools node + a memory node.
  2. Connect tools → sub-agent. Try to connect memory → sub-agent.
  3. Connect sub-agent → agent.
- **Expected**: Tools→sub-agent edge created via `onConnect`. Memory→sub-agent rejected at `onConnect` (F1.11). Sub-agent→agent succeeds.
- **Edge cases / variants**: **Inconsistency**: `isValidConnection` (F1.10) only allows agent targets — verify whether the visual drag indicator allows the user to even drop onto a sub-agent. Behavior unclear; document actual UX outcome.

### TC1.7 — Multiple peripherals to one agent — provider duplication detected by validator
- **Goal**: Two providers connected to the same agent triggers `duplicate_provider` validation error.
- **Steps**:
  1. Add an agent + two provider nodes + a context engine + a storage.
  2. Connect both providers to the agent, plus context engine and storage.
  3. Open chat for the agent.
- **Expected**: Chat opens (because `contextEngine` and `storage` are present, see F1.28), but the resolved config or banner reflects the duplicate-provider issue from `validateAgentRuntimeGraph` (F1.27). Behavior unclear: the canvas itself may not visualize this error — verify whether the chat overlay surfaces it.
- **Edge cases / variants**: Same agent name conflict on two agents — confirm the first one's confirmed name blocks the second from confirming (F1.18).

### TC1.8 — Agent naming dialog: validation rules
- **Goal**: Names enforce length 2-40, exclude `: / \\`, and are unique among agents.
- **Steps**:
  1. Drag an agent.
  2. Try empty submit; submit with single character; submit with 41-char name; submit with `bad/name`; submit with the name of an already-confirmed agent.
- **Expected**: Each invalid case shows an inline red error and the Confirm button stays disabled or rejects on submit.
- **Edge cases / variants**: Cancel removes the node entirely (F1.17). Pressing Enter triggers submit. Whitespace-only is treated as empty.

### TC1.9 — Agent delete dialog: three branches
- **Goal**: Each of "delete with data", "keep data", "cancel" routes through the right teardown.
- **Pre-conditions**: An agent with an active session (storage configured).
- **Steps**:
  1. Select the agent and press Delete.
  2. Click "Yes, delete agent and data" → verify storage deletion HTTP call fires and the session-store entries clear (F1.16).
  3. Recreate; press Delete; click "No, keep data" → verify node removed but storage HTTP delete does NOT fire.
  4. Recreate; press Delete; click Cancel → verify node remains.
- **Expected**: Runtime destroy fires before storage delete in branch 1 (race comment at graph-store line 224). Branches 2 and 3 leave storage untouched.
- **Edge cases / variants**: Agent without `name` (e.g. cancelled naming) is removed without the dialog (F1.17 cancel path).

### TC1.10 — Properties panel resize persists across reload
- **Goal**: Width changes survive page reload.
- **Steps**:
  1. Select any node to open the properties panel.
  2. Drag the resize handle to ~600px.
  3. Reload the page, select a node again.
- **Expected**: Panel reopens at 600px (F1.32). `localStorage['agent-manager-ui-layout']` contains `propertiesPanelWidth: 600` (clamped to viewport - 160px max).
- **Edge cases / variants**: Resize the browser to 700px — width re-clamps to ≤540px (700 - 160).

### TC1.11 — Hover sidebar to expand and reveal labels
- **Goal**: Sidebar collapsed/expanded state is hover-only; no click-to-pin.
- **Steps**:
  1. Place mouse outside the sidebar — expect 84px width, icons only.
  2. Hover into the sidebar — expect 256px width, labels visible.
  3. Move mouse out — collapses back.
- **Expected**: CSS hover transition on `aside.group` (F1.3). No persisted "pinned-open" state.

### TC1.12 — Drop drag image matches viewport zoom
- **Goal**: The hex preview attached as drag image scales with the current React Flow zoom.
- **Steps**:
  1. Zoom the canvas to 50% and 200%.
  2. Begin a palette drag and observe the drag image size.
- **Expected**: Drag image renders at `HEX_WIDTH * zoom` × `HEX_HEIGHT * zoom` (F1.4 / Sidebar line 87).
- **Edge cases / variants**: At very small zooms, the drag image may become hard to see — verify minimum size is acceptable.

### TC1.13 — Autosave debounce + offline cache + server hydration
- **Goal**: Edits save within ~500ms; offline edits are recovered; server copy wins on conflict.
- **Steps**:
  1. Make a change (drag a node).
  2. Wait 600ms; verify localStorage has the new node.
  3. Take the server offline. Make further edits. Reload.
  4. Bring the server back online and reload again with a different graph in the backend.
- **Expected**: After step 2, both local and server (when reachable) match (F1.22). After step 3, local survives, server stays at the last successful save. After step 4, server graph overwrites local (F1.23).
- **Edge cases / variants**: First-ever boot with empty backend but populated local → local pushed up to seed server.

### TC1.14 — Chat-readiness gating from the canvas perspective
- **Goal**: Removing a `contextEngine` or `storage` connection blocks chat with the right overlay.
- **Pre-conditions**: An agent with a working chat (provider + context engine + storage all wired).
- **Steps**:
  1. Open chat — verify ready state.
  2. Close chat. Delete the context engine edge (hover X). Reopen chat.
  3. Reconnect; delete the storage edge; reopen chat.
- **Expected**: Each scenario triggers the corresponding "Required" card in the missing-peripherals overlay (F1.28). Hint text directs the user to the right palette tile.
- **Edge cases / variants**: Provider with empty `pluginId` (somehow set by raw store edit) triggers the provider card.

### TC1.15 — Multi-agent canvas independence
- **Goal**: Two agents on one canvas operate independently.
- **Steps**:
  1. Create agent A and agent B with separate provider/storage/context-engine sets.
  2. Open chat on A; click on B's body.
  3. Open chat on B from its corner button.
- **Expected**: Selection click on B closes A's chat (F1.35) and opens B's properties panel. Chat button on B opens B's chat without affecting A's session state.
- **Edge cases / variants**: Single peripheral connected to both agents (allowed) — verify resolution per-agent works (covered in §5).

### TC1.16 — Drag a node to overlap with another (snap behavior)
- **Goal**: The hex-grid prevents two nodes from occupying the same cell.
- **Steps**:
  1. Place two nodes in adjacent cells.
  2. Drag node A on top of node B.
  3. Release.
- **Expected**: Node A snaps to the nearest free cell ring around B's cell (F1.5). Node B is not displaced.
- **Edge cases / variants**: Dragging a node onto its own current cell is a no-op.

### TC1.17 — `applyPatch` add-and-rollback transaction
- **Goal**: Programmatic patch atomically commits or rolls back.
- **Pre-conditions**: SAMAgent capability available (or call `useGraphStore.getState().applyPatch(patch)` from devtools).
- **Steps**:
  1. Construct a valid patch with `add_nodes` + `add_edges`.
  2. Apply it; verify all new nodes and edges show up at sensible positions.
  3. Construct a patch that throws (e.g. references a non-existent node id in `update_nodes`).
- **Expected**: Step 2 succeeds and persists immediately (F1.21). Step 3 leaves nodes/edges unchanged from before the call. New positions are within 800px of the bbox; otherwise cascaded into a 4-column grid below the existing graph.
- **Edge cases / variants**: A patch that adds an agent — the naming dialog does NOT open because `pendingNameNodeId` isn't set in this code path (F1.17 behavior-unclear note).

### TC1.18 — Edge animation and color match source
- **Goal**: Each edge's stroke matches `NODE_COLORS[sourceType]` and is animated.
- **Steps**:
  1. Wire one each of provider, memory, tools, storage to an agent.
  2. Inspect the edges visually.
- **Expected**: 4 distinctly-colored animated edges (F1.12, F1.41).

### TC1.19 — Pane click hides properties panel
- **Goal**: Clicking the empty canvas dismisses the right-side panel and clears selection.
- **Steps**:
  1. Click any node — properties panel opens.
  2. Click the canvas background.
- **Expected**: Properties panel unmounts (F1.34). `selectedNodeId` is null.

### TC1.20 — Settings → Canvas round-trip preserves graph
- **Goal**: Switching `appView` to settings and back doesn't drop or reorder nodes/edges.
- **Steps**:
  1. Build a non-trivial graph.
  2. Click the Settings cog.
  3. Click "Exit" or equivalent on the settings workspace.
- **Expected**: All nodes, edges, selection cleared, exact positions preserved (F1.36). Autosave was not retriggered if no edits happened.

### TC1.21 — Reload reproduces server state, not stale local state
- **Goal**: When server has a newer graph, it wins on hydration.
- **Steps**:
  1. Start with a 5-node graph synced both locally and on the backend.
  2. From a second browser tab (or via API), `PUT /api/graph` with a different 3-node graph.
  3. Reload the original tab.
- **Expected**: Original tab's canvas now shows the 3-node server graph; localStorage is also overwritten (F1.23).
- **Edge cases / variants**: Server returns 500 → local cache wins (no overwrite).

### TC1.22 — Clear graph resets to empty (verify side-effects)
- **Goal**: `clearGraph` empties the canvas and disposes UI selection.
- **Pre-conditions**: A populated canvas with at least one agent that has a runtime open.
- **Steps**:
  1. Invoke `clearGraph` (e.g. from devtools `useGraphStore.getState().clearGraph()`).
- **Expected**: Empty state restored (F1.29). Behavior unclear: agent runtimes are NOT torn down — verify whether the WS connection persists on the server until session timeout.

### TC1.23 — Cron node import (no palette path)
- **Goal**: Cron nodes loaded from a saved graph render correctly even though the palette can't add new ones.
- **Steps**:
  1. Pre-seed `localStorage['agent-manager-graph']` with a graph containing a cron node.
  2. Load the app.
- **Expected**: Cron node renders via [CronNode](src/nodes/CronNode.tsx) using its registered renderer (F1.39). User cannot drag a new cron from the sidebar.

### TC1.24 — Edge-delete X visibility on hover
- **Goal**: The X button on an edge is hidden by default and visible on hover.
- **Steps**:
  1. Wire an edge.
  2. Hover the edge path; un-hover.
- **Expected**: X button fades in on hover, fades out on leave (F1.12). Both the inline mouseenter/leave and the CSS sibling selector contribute — verify no stuck-visible state on rapid in/out.

### TC1.25 — `isValidConnection` vs `onConnect` behavior parity
- **Goal**: Document the inconsistency in F1.10/F1.11 with concrete observed behavior.
- **Steps**:
  1. Drag from a tools node's right handle toward a sub-agent's left handle.
  2. Note whether the visual drop indicator allows the connection.
  3. Drop and check whether the edge actually committed.
- **Expected**: Behavior unclear at time of writing — `isValidConnection` rejects (target type !== `'agent'`), but `onConnect` would accept. Verify which surface wins in the user's perception.

