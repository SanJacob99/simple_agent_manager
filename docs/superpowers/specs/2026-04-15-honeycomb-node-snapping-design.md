# Honeycomb Node Snapping Design

Date: 2026-04-15
Status: Draft approved in conversation, written for review

## Summary

Make canvas nodes feel like they seat into the honeycomb background instead of resting at arbitrary positions.

Nodes should still move freely while the user drags them. The only behavior change is at the end of the interaction:

- dropping a new node from the sidebar snaps it to the nearest honeycomb cell
- releasing an existing node after dragging snaps it to the nearest honeycomb cell
- the snap happens instantly, with no settling animation

The snap target is the center of the nearest visible honeycomb cell, not the node's rectangular top-left anchor.

## Goals

- Preserve freeform dragging while the pointer is down.
- Snap new and existing nodes using the same honeycomb math.
- Align node placement to the current honeycomb background rather than replacing the background.
- Keep the snap behavior deterministic across pan and zoom levels.
- Keep the implementation small and easy to test.

## Non-Goals

- Do not add drag-time magnetism.
- Do not animate the snap.
- Do not introduce socket occupancy, collision avoidance, or nearest-empty-cell search.
- Do not redesign the background art or switch to a rectangular grid.
- Do not move this behavior into server/runtime code or shared config schemas.

## Current Constraints

- New nodes are created through `useDragAndDrop()` and inserted into the graph store with a final position immediately.
- Existing nodes are positioned by React Flow and currently keep whatever position they are released at.
- The background is custom-rendered in `src/canvas/HoneycombBackground.tsx`.
- Node visuals are hex-shaped, with geometry defined in `src/nodes/HexNode.tsx`.
- The graph store currently acts as persisted graph state and should stay decoupled from one specific canvas background pattern.

These constraints favor a canvas-owned snapping behavior with shared geometry helpers instead of store-driven or schema-driven snapping.

## Product Decisions Captured From Conversation

- Apply the behavior to both new node drops and existing node drag releases.
- Keep node movement free while dragging.
- Snap only when the interaction ends.
- Snap instantly.
- Keep the true honeycomb background and make node placement match it.
- Use the nearest honeycomb cell as the placement target.

## Geometry Model

The current background and node art already imply a pointy-top hex grid:

- node width comes from `HEX_WIDTH`
- node height comes from `HEX_HEIGHT`
- background cell spacing is derived from `HEX_SIDE`

The snap behavior should treat the visual center of the node as the thing that belongs inside the socket.

That means the algorithm needs to:

1. take the node's top-left React Flow position
2. convert it to a visual center using half the node width and height
3. find the nearest honeycomb center in flow coordinates
4. convert that snapped center back into the top-left position React Flow stores

This preserves the existing React Flow position model while making the rendered hex appear centered inside the background cell.

## Snap Algorithm

Use one shared pure helper for honeycomb snapping. It should operate only on flow-space coordinates, so it stays independent from screen pixels, pan offsets, and zoom.

Recommended shape:

```ts
interface Point {
  x: number;
  y: number;
}

function snapNodePositionToHoneycomb(position: Point): Point;
```

Internally, the helper should:

- derive the node center from the incoming top-left position
- convert center coordinates into pointy-top axial or cube hex coordinates
- round to the nearest hex cell using standard cube-rounding logic
- convert the rounded hex back into a flow-space center point
- subtract half the node width and height to return a snapped top-left position

Important consideration:
The background renderer and the snap helper must share the same spacing model. If the math diverges even slightly, the node will appear almost aligned while still feeling wrong.

## Architecture

Use a shared canvas geometry helper plus two call sites.

### Shared Helper

Add a small pure helper dedicated to honeycomb math. Its responsibilities:

- define the honeycomb spacing model used by the canvas
- expose a pure `snapNodePositionToHoneycomb()` function
- avoid React, Zustand, and DOM dependencies

This helper is the primary test surface for the feature.

### New-Node Drop Path

Update the sidebar drop flow so the drop position is converted to flow coordinates first, then snapped before the new node is inserted into the store.

Effect:

- the node appears directly in the nearest honeycomb socket
- new-node creation and existing-node release use the same final position rules

### Existing-Node Drag Path

Handle node drag end in the canvas and replace the released node position with the snapped position.

Effect:

- while dragging, the node still follows the pointer freely
- on release, the node jumps to the nearest honeycomb cell center

## State Ownership

Keep snapping out of the graph store.

Why:

- the store should stay focused on graph data and persistence
- honeycomb placement is a canvas interaction rule, not an intrinsic property of every node consumer
- keeping the logic at the canvas layer avoids coupling imports, migrations, and store tests to one visual layout decision

The store should continue to accept final positions. The canvas should decide what those final positions are.

## Data Flow

### New Node

`drag event`
-> `screenToFlowPosition(...)`
-> `snapNodePositionToHoneycomb(...)`
-> `addNode(nodeType, snappedPosition)`

### Existing Node

`drag end`
-> released node position from React Flow
-> `snapNodePositionToHoneycomb(...)`
-> update that node's stored position

## Edge Cases

### Multiple Nodes In The Same Cell

Out of scope for this change. If two nodes are released into the same socket, they may overlap.

This is acceptable for the first pass because it keeps the interaction predictable and avoids turning a simple snap feature into a collision-management system.

### Pan And Zoom

Snapping should happen in flow coordinates after React Flow has already converted from screen space. This keeps the result consistent regardless of viewport transform.

### Near-Boundary Drops

Nodes released near the boundary between two cells should round to the mathematically nearest honeycomb center, even if that produces an immediate visible jump.

### Non-Hex Node Bounds

React Flow still stores rectangular positions. That is fine as long as the snap helper aligns the node's visual center, not its bounding-box corner.

## Testing Strategy

Prioritize pure geometry tests over broad UI mocks.

### Unit Tests

Add tests for the shared snap helper covering:

- exact center hits remain in the same cell
- positions near neighboring cells round to the expected neighbor
- negative coordinates still round correctly
- top-left input is converted through center alignment correctly

### Integration Coverage

Add targeted behavior tests only where needed to prove:

- a dropped node is inserted at a snapped position
- a dragged node is rewritten to a snapped position on release

Most correctness should still live in the pure helper tests.

### Manual Verification

Verify these flows in the app:

- drag a new node from the sidebar and drop it between cells
- drag an existing node across multiple cells and release it
- repeat while zoomed and panned
- confirm the hex visually sits inside the honeycomb socket after each release

## Implementation Outline

1. Extract or add a shared honeycomb geometry helper for snap math.
2. Make the background renderer and snap helper use the same spacing assumptions.
3. Snap sidebar drop positions before calling `addNode(...)`.
4. Handle node drag end in the canvas and snap the released node position.
5. Add pure unit tests for honeycomb snapping.
6. Add narrow integration coverage for the drop and drag-end call sites.
7. Manually verify free-drag plus instant snap behavior in the running app.

## Risks

- If the background and snap helper do not share identical math, the feature will feel visually broken even if tests pass.
- If the snap is implemented in the graph store, unrelated graph operations may accidentally inherit canvas-only behavior.
- If drag-end handling rewrites positions too aggressively, it may interfere with React Flow's expected node interaction lifecycle.
- If test coverage focuses only on UI mocks, the geometry bugs most likely to matter could slip through.

## Recommendation

Proceed with a shared pure honeycomb snap helper and keep the behavior canvas-owned.

This is the smallest design that matches the requested interaction exactly:

- free drag
- instant snap on release
- true honeycomb sockets
- one geometry model reused by both new and existing node placement
