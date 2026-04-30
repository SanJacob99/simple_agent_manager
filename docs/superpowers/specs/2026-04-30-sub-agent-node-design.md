# Sub-Agent Node Design

**Date:** 2026-04-30
**Scope:** New `SubAgentNode` peripheral, declarative sub-agent identities per main agent, parent-controlled per-call config overrides, round-trip cap, and UI surfaces (inline card + history drawer).
**Builds on:** [2026-04-07-session-deferred-features-design.md](2026-04-07-session-deferred-features-design.md) (session tools + `SubAgentRegistry`), [2026-04-29-session-tools-yield-list-history-design.md](2026-04-29-session-tools-yield-list-history-design.md) (yield orchestration).

## Overview

Today the backend has working sub-agent plumbing — `SubAgentRegistry`, `sessions_spawn`, `sessions_yield`, async resume — but no graph-level way to declare *what* a sub-agent is. The current `sessions_spawn` either spawns the same agent into a `sub:*` session or routes to another declared agent via `coordinatorLookup` (gated). Neither path lets a graph author give the agent a roster of named, separately-configured one-shot helpers.

This spec adds a `SubAgentNode` peripheral that attaches to an `AgentNode` and declares a named sub-agent (e.g. `researcher`, `summarizer`) with its own system prompt, model, tools, and limits. The parent agent calls `sessions_spawn({ subAgent: "researcher", message, overrides })` to dispatch one. Sub-agents act in a one-shot pattern by default, with up to 6 total parent↔sub messages before the sub-session is sealed.

The parent may pass per-call config overrides, but only for fields the SubAgentNode lists in an explicit allowlist — the sub-agent author retains control over what is and isn't tunable from outside.

The user can watch every sub-agent run live in the parent's chat drawer (inline card with stop button) and inspect a sub-agent's full history (across all parent sessions) from a dedicated drawer opened off the SubAgentNode.

## Architecture summary

```
AgentNode "main"  ──────────────────────────────────────┐
   ├── ProviderNode (parent's provider)                 │
   ├── ToolsNode (parent's tools)                       │
   ├── StorageNode (parent's storage; hosts sub-sessions)
   ├── ContextEngineNode, MemoryNode, ...               │
   │                                                    │
   ├── SubAgentNode "researcher" ────┐                  │
   │      ├── ToolsNode (REQUIRED, dedicated)           │
   │      ├── ProviderNode (optional, overrides parent) │
   │      ├── SkillsNode(s) (optional, override by id)  │
   │      └── MCPNode(s) (optional, override by id)     │
   │                                                    │
   └── SubAgentNode "summarizer"     ─┘                 ┘
          └── ...
```

Inheritance, at a glance:

| Resource | Behavior |
|---|---|
| Provider | Inherit parent's; dedicated `ProviderNode` on the SubAgent wins |
| Tools | **Required** dedicated `ToolsNode`; never inherited |
| Storage | Inherited; sub-sessions live under parent's storage as `sub:<parentSessionKey>:<subAgentName>:<uuid>` |
| Context Engine | None — sub-agents are one-shot; no compaction |
| Memory | Sub-sessions share the parent's `MemoryEngine` instance (because they live under the parent's storage); the sub-session's own message history starts empty per spawn. The parent's transcript is not pre-loaded into the sub's context. |
| Skills | Union of parent's + dedicated; dedicated wins on `id` collision |
| MCP | Union of parent's + dedicated; dedicated wins on `mcpNodeId` collision |
| Connectors / Vector DB / AgentComm / Cron | Never apply to sub-agents |

## 1. Data model

### 1.1 `SubAgentNodeData`

```ts
// src/types/nodes.ts

export type SubAgentOverridableField =
  | 'modelId'
  | 'thinkingLevel'
  | 'systemPromptAppend'
  | 'enabledTools'
  | 'maxMessages';

export interface SubAgentNodeData {
  [key: string]: unknown;
  type: 'subAgent';
  name: string;                                 // identity used by parent; required, unique per agent
  description: string;                          // shown to parent in sessions_spawn schema
  systemPrompt: string;
  modelId: string;                              // empty = inherit parent's modelId at resolve time
  thinkingLevel: ThinkingLevel;
  modelCapabilities: ModelCapabilityOverrides;
  maxMessages: number;                          // 1..6, default 6
  overridableFields: SubAgentOverridableField[]; // default []
  workingDirectoryMode: 'derived' | 'custom';   // default 'derived'
  workingDirectory: string;                     // honored only when workingDirectoryMode === 'custom'
  recursiveSubAgentsEnabled: boolean;           // default false; UI shows "Unstable" badge when true
}
```

`NodeType` gains `'subAgent'`. `FlowNodeData` union gains `SubAgentNodeData`.

### 1.2 Defaults (`src/utils/default-nodes.ts`)

```ts
case 'subAgent':
  return {
    type: 'subAgent',
    name: '',
    description: '',
    systemPrompt: 'You are a focused assistant. Complete the parent agent\'s task and report back concisely.',
    modelId: '',                  // inherit
    thinkingLevel: 'off',
    modelCapabilities: {},
    maxMessages: 6,
    overridableFields: [],
    workingDirectoryMode: 'derived',
    workingDirectory: '',
    recursiveSubAgentsEnabled: false,
  };
```

### 1.3 Connection rules

- `SubAgentNode` connects only to a single `AgentNode` (peripheral→agent edge), like other peripherals.
- `SubAgentNode` *receives* edges from peripherals attached to it: required `ToolsNode` (one), optional `ProviderNode` (one), optional `SkillsNode` (many), optional `MCPNode` (many). All other peripheral types are forbidden as inputs to a `SubAgentNode`.
- `SubAgentNode → SubAgentNode` edges are forbidden (one level of nesting; recursive spawning is enabled per-node by `recursiveSubAgentsEnabled`, not by chaining nodes).
- `name` validation: `/^[a-z][a-z0-9_-]{0,31}$/`. Used as a session-key segment and a folder name.
- `name` uniqueness: enforced per parent agent. **On duplicate name, all conflicting SubAgentNodes are excluded from `agentConfig.subAgents`** and a single diagnostic names the conflict — fail closed so an unintended graph mistake doesn't silently dispatch to the wrong sub-agent.

## 2. Config resolution

### 2.1 Resolved shape (`shared/agent-config.ts`)

```ts
export type SubAgentOverridableField =
  | 'modelId' | 'thinkingLevel' | 'systemPromptAppend' | 'enabledTools' | 'maxMessages';

export interface ResolvedSubAgentConfig {
  name: string;
  description: string;
  systemPrompt: string;
  modelId: string;                              // resolved (own || parent.modelId)
  thinkingLevel: string;
  modelCapabilities: ModelCapabilityOverrides;
  maxMessages: number;
  overridableFields: SubAgentOverridableField[];
  workingDirectory: string;                     // resolved (derived or custom)
  recursiveSubAgentsEnabled: boolean;

  provider: ResolvedProviderConfig;             // dedicated wins; else inherits parent
  tools: ResolvedToolsConfig;                   // dedicated; required
  skills: SkillDefinition[];                    // parent ∪ dedicated; dedicated wins by id
  mcps: ResolvedMcpConfig[];                    // parent ∪ dedicated; dedicated wins by mcpNodeId
}

export interface AgentConfig {
  // ...existing fields
  subAgents: ResolvedSubAgentConfig[];
}
```

Sub-agents do not carry `memory`, `contextEngine`, `storage`, `connectors`, `agentComm`, `crons`, or `vectorDatabases` of their own — those are either inherited at runtime via the parent's runtime instances (memory, storage) or unavailable (the rest).

### 2.2 Resolution algorithm in `resolveAgentConfig()`

For each `SubAgentNode` connected to the agent:

1. Walk `edges.target === subAgentNodeId` to find peripherals attached to this SubAgentNode.
2. **Tools (required)**: must have exactly one `ToolsNode` attached. If missing or duplicated, the sub-agent is **excluded** from `agentConfig.subAgents` and a graph-validation diagnostic is emitted (`"Sub-agent '<name>' is missing a Tools node"` or `"Sub-agent '<name>' has multiple Tools nodes"`). The parent agent's overall config still resolves; only that sub-agent is unrunnable.
3. **Provider**: dedicated `ProviderNode` if present, else inherit `parent.provider`.
4. **Model fields**: `modelId`, `thinkingLevel`, `modelCapabilities` use sub's values when non-empty / non-default; else inherit parent's.
5. **Skills**: produce the parent's resolved skill list, then append/replace by `id` with the sub-agent's dedicated skills (including dedicated SkillsNodes and inline tool-skill overrides recomputed against the sub's *own* Tools node settings).
6. **MCPs**: same merge strategy, dedup by `mcpNodeId`.
7. **Working directory**: `workingDirectoryMode === 'custom'` → use `workingDirectory` verbatim; else `path.posix.join(parent.workspacePath ?? '', 'subagent', name)`. Empty parent workspace → empty sub workspace (server falls back to `process.cwd()`).
8. **Validation**: name regex, uniqueness, recursive-spawning warning. All collected into the existing graph diagnostics surface.

### 2.3 Skill / MCP override semantics

When parent and dedicated nodes declare entries with the same id, the dedicated entry wins — the sub-agent fully shadows the parent's version. This is intentional (lets a sub override guidance for a tool the parent also uses) and is documented in the SubAgent concept doc as a known footgun.

## 3. Runtime behavior

### 3.1 `sessions_spawn` schema rewrite

When `agentConfig.subAgents.length > 0`, the parent's `sessions_spawn` schema is:

```ts
{
  subAgent: enum(<sub-agent names>),     // required
  message: string,
  overrides?: {
    modelId?: string,
    thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh',
    systemPromptAppend?: string,
    enabledTools?: string[],
    maxMessages?: number,
  },
  wait?: boolean,
  timeoutMs?: number,
}
```

When `agentConfig.subAgents.length === 0`, `sessions_spawn` (and `sessions_yield`, `subagents`) are **not** registered on the parent's tool surface. The presence of any SubAgentNode is the new source of truth for sub-agent capability.

The legacy `targetAgentId` parameter is **removed**. The previous "self-spawn into a `sub:*` session" path is dropped — it had no product use case once sub-agents become declarative. Cross-agent dispatch (a different declared agent) is unaffected because that path was always behind `coordinatorLookup` and remains gated.

`ToolsNode.subAgentSpawning` and `ToolsNode.maxSubAgents` are **deprecated**. The fields stay in the schema for back-compat reads, but the runtime ignores them. The Tools-node concept doc gets a deprecation note pointing at `SubAgentNode`.

### 3.2 Override validation

In `createSessionsSpawnTool.execute`, before any dispatch:

- Reject any key in `overrides` not present in `subAgent.overridableFields`. Error text:
  `Override "<field>" is not in the sub-agent "<name>" allowlist (allowed: <list>).`
- `enabledTools`: each entry must be in the sub's resolved `tools.resolvedTools`. Unknown entries error out listing them.
- `maxMessages`: must be in `[1, subAgent.maxMessages]` (parent can only tighten). Out-of-range errors out.
- `modelId`: format-validated only here; resolver-level validity (the chosen model is reachable on the sub's resolved provider) surfaces at runtime as a normal run error.
- `thinkingLevel`: must be one of the literal enum values.
- `systemPromptAppend`: trimmed; empty string is treated as omitted.

The validated overrides are recorded on the `SubAgentRecord` as `appliedOverrides` for audit (rendered as chips in the inline card and history drawer).

### 3.3 Sub-session keys & registry record

- Session key: `sub:<parentSessionKey>:<subAgentName>:<shortUuid>`. The `<subAgentName>` segment lets the history drawer prefix-filter without a separate index.
- `SubAgentRecord` (in `server/agents/sub-agent-registry.ts`) gains:
  ```ts
  subAgentName: string;
  messageCount: number;            // initialized to 1 on spawn (the spawn message)
  maxMessages: number;             // resolved cap for this spawn (sub.maxMessages or override)
  appliedOverrides: Record<string, unknown>;
  sealed: boolean;                 // becomes true once messageCount >= maxMessages
  ```
- `SubAgentRegistry` gains:
  - `incrementMessageCount(runIdOrSubAgentId): { sealed: boolean; messageCount: number }`
  - `isSealed(subAgentId): boolean`
  - `seal(subAgentId): void` (idempotent; called when `messageCount >= maxMessages`)

### 3.4 Cap enforcement

- **Spawn**: `messageCount = 1`; `appliedOverrides` recorded; sub run dispatched.
- **Sub final reply persisted** (via the same hook used by `RunCoordinator.finalizeRunSuccess` for `sub:` keys): `messageCount += 1`; if `messageCount >= maxMessages` → `seal()`.
- **`sessions_send` to a `sub:*` key**: before dispatch, the runtime resolves the sub-agent record from the sessionKey, checks `isSealed`. Sealed → tool returns:
  `Sub-agent session sealed (reached maxMessages=N); spawn a new sub-agent to continue.`
  Otherwise dispatch proceeds and `messageCount += 1` immediately. Sub's reply increments again on completion.
- After seal, the transcript stays readable via `sessions_history` and the history drawer; no further sends accepted on that sub-session.

### 3.5 Recursive spawning gate

When building a sub-agent's runtime tool surface in `RunCoordinator.executeRun`, given the sub's `recursiveSubAgentsEnabled`:

- `false` (default): `sessions_spawn` and `sessions_yield` are stripped from the sub-agent's tool list, regardless of what the sub's Tools node enables. `subagents` (list/status/kill) stays available for symmetry (the sub may have spawned things historically and want to inspect them, though in practice the list will be empty). The system-prompt-builder's auto-generated tool-list section reflects this stripped surface.
- `true`: the sub-agent inherits the parent agent's full `subAgents` list — same set of named SubAgentNodes the parent could call. No new sub-agents may be declared from inside a running sub; the graph is the only declaration site. The "Unstable" label in the UI is the only signal that recursion is in effect — there is no separate cap on recursion depth, since the per-spawn `maxMessages` and the parent's own `maxMessages` provide bounds.

### 3.6 Working directory at runtime

When the sub's runtime is constructed, its `workspacePath` is `ResolvedSubAgentConfig.workingDirectory`. The exec/fs tools' existing path-policy (`sandboxWorkdir`) operates against this path unchanged. Directory creation is lazy — the first write by a tool creates the folder.

### 3.7 Cleanup on parent-run abort / coordinator destroy

- `RunCoordinator.destroy()` already calls `subAgentRegistry.cancelAllYields()`. It additionally walks `subAgentRegistry.listForParent(*)` for the coordinator's parent runs and aborts running sub-agent runs (delegating to `coordinator.abort(runId)`). Sealed records are left in place for history.

## 4. UI surfaces

### 4.1 SubAgentNode (canvas)

`src/nodes/SubAgentNode.tsx`. Compact body:

- Title row: 🤖 icon + `name` (or `"<unnamed>"` placeholder); status pill `running N` when any spawn is currently active for this sub-agent.
- Subtitle: resolved model id; greyed when inherited, normal when own.
- Footer chips: `tools: <count>`, `max: <maxMessages>`, optional `Unstable` chip when `recursiveSubAgentsEnabled`.
- A `History` button on the body opens the SubAgentHistoryDrawer for this sub-agent.
- Validation badges:
  - Red: no `ToolsNode` attached.
  - Red: `name` is empty or fails the regex.
  - Amber: name conflicts with a sibling.

### 4.2 Property panel (`src/panels/property-editors/SubAgentProperties.tsx`)

Sections, in order:

| Section | Fields |
|---|---|
| **Identity** | `name` (regex-validated inline), `description` (multiline) |
| **Prompt** | `systemPrompt` (textarea) |
| **Model** | `modelId` (picker driven by sub's resolved provider — dedicated provider wins, else parent's provider); `thinkingLevel`; `modelCapabilities` snapshot subform reused from `AgentProperties`. Empty `modelId` shows a hint: *"Inherits parent's model: `<modelId>`"* |
| **Limits** | `maxMessages` slider 1–6 (default 6) with tooltip *"Total parent↔sub-agent messages before the sub-session is sealed"* |
| **Parent overrides** | `overridableFields` checkbox group (5 entries). Empty = parent locked to node config. Section help: *"Fields the parent agent may override per-call via `sessions_spawn` overrides."* |
| **Working directory** | radio: `Derived (<parentCwd>/subagent/<name>)` (default) / `Custom`. Custom shows a path input. |
| **Advanced** | `recursiveSubAgentsEnabled` toggle, labeled *"Allow this sub-agent to spawn sub-agents"*; red **Unstable** badge plus inline warning about loop risk when enabled |
| **Parent's sub-agent tools** | Read-only info card with two groups: **(a) Auto-enabled by SubAgentNode presence**: `sessions_spawn`, `sessions_yield`, `subagents`. **(b) Already available when a Storage node is connected** (listed as relevant for managing sub-agents): `sessions_send` (re-engage a sub-session), `sessions_history` (inspect any session's transcript). One-line summary each; link to the manage-sub-agents docs. **Not** a toggle surface. |

### 4.3 Inline sub-agent card (parent chat drawer)

`src/components/SubAgentInlineCard.tsx`. Rendered inside the parent's transcript wherever a `sessions_spawn` tool call is rendered.

- Header (collapsed):
  `▸ 🤖 <name> · <status> · ⏱ <elapsed> · <messageCount>/<maxMessages> msgs · [⏹ Stop]`
- Status pill values: `running`, `done`, `errored`, `killed`, `sealed`.
- Applied-overrides chips beside the header when non-empty (e.g., `model→opus`, `max→2`).
- Expanded body: full sub-agent transcript using the same renderer components as the main chat (`MessageBubble`, `ToolCallBlock`, `AttachmentPreview`). No edit affordances.
- `Stop` button: enabled only while `status === 'running'`. Click → `POST /api/subagents/:subAgentId/kill`. The button shows a spinner until the response returns; on success the card flips to `killed`.
- Live updates: subscribes to the existing run-event WebSocket stream filtered by the sub's `runId` (same plumbing used by the main chat).
- Re-engagement: parent calling `sessions_send` against this sub-session does not create a new card; the existing card's transcript continues to grow and `messageCount` ticks up.
- Sealing: when `messageCount >= maxMessages`, the card flips to `sealed` and any subsequent attempted send is shown as a small inline error note inside the card.

### 4.4 Sub-agent history drawer

`src/components/SubAgentHistoryDrawer.tsx`. Reuses the existing chat-drawer chrome, opened from the SubAgentNode's `History` button.

- Source: existing storage list APIs, client-side filtered to `sessionKey.startsWith("sub:") && sessionKey.includes(":<name>:")` for the selected sub-agent. Cheap; sub-sessions are bounded.
- List view (newest-first), each row:
  - Short id (last 6 of uuid)
  - Parent session label (`displayName` or `sessionId` short form)
  - Started-at (relative)
  - Status: `done` / `error` / `killed` / `sealed` / `running`
  - Message count `(N/max)`
  - Model used (if overridden, with a chip)
  - Applied-overrides chips
- Click a row → opens the read-only transcript using the existing transcript renderer; same multimodal trace as the inline card.
- Bulk action: `Clear history` (delete all `sub:` entries for this sub-agent name across all parent sessions; uses existing storage maintenance API path; confirm dialog).
- Per-row delete: trash icon on hover; confirms once.

### 4.5 Multimodal trace

No new plumbing. Sub-agent runs flow through `RunCoordinator.executeRun` → `SessionTranscriptStore`, which already records assistant text + tool calls + tool-result attachment payloads (images, audio) + custom diagnostic entries (system prompt, model/thinking changes). Both the inline card and the history drawer point at the sub's transcript file via the same renderers used in the main chat.

## 5. REST surface

A small new module, `server/routes/subagents.ts`, mounted by `server/index.ts`:

| Method | Path | Behavior |
|---|---|---|
| `POST` | `/api/subagents/:subAgentId/kill` | (a) Looks up the record, (b) calls `coordinator.abort(record.runId)` to actually terminate the sub-run, (c) calls `subAgentRegistry.kill(subAgentId)` to mark the registry status. Returns `200 { killed: true }` on success, `404` if id unknown, `409 { reason: 'not-running' }` if the sub-agent is already terminal. |
| `GET` | `/api/subagents/:subAgentId` | Returns the registry record (status, messageCount, applied overrides, run ids, parent session). Used by the inline card on initial render so the UI doesn't need to walk a list to find one record. |
| `GET` | `/api/subagents?parentSessionKey=...` | Returns all sub-agent records for a given parent session. Used to hydrate the inline card list when the user reopens an old session. |

The kill behavior is the meaningful change: today's `subAgentRegistry.kill` only flips the registry record's status — it does **not** abort the underlying run. The new REST handler combines registry-mark and `coordinator.abort` so a kill request actually stops work. (`subAgentRegistry.kill` is left in place for callers that want only the registry-side mark; the REST handler is the canonical user-visible path.)

These endpoints are reachable from any HTTP client; the frontend uses them but must not be the only consumer. (Backend independence — the agent server keeps running and remains controllable when the UI is closed.)

## 6. Tests

### 6.1 Resolution

`src/utils/graph-to-agent.test.ts` additions:

1. Sub-agent with required Tools node resolves; missing Tools node yields a graph diagnostic and excludes the sub from `subAgents`.
2. Provider inheritance vs dedicated.
3. Skills + MCP dedup-by-id with sub-agent's entry winning.
4. cwd derived as `subagent/<name>`; custom mode uses `workingDirectory` verbatim.
5. Duplicate names → validation diagnostic.
6. Invalid name regex → validation diagnostic.
7. `subAgents` array order is stable (matches edge-iteration order).

### 6.2 Registry

`server/agents/sub-agent-registry.test.ts` additions:

8. `messageCount` initialized to 1 on `spawn`.
9. `incrementMessageCount` on parent-send and sub-reply paths.
10. `seal()` triggers when `messageCount >= maxMessages`; idempotent.
11. `appliedOverrides` round-trips through `spawn` → `get`.

### 6.3 Session tools

`server/sessions/session-tools.test.ts` additions:

12. `sessions_spawn` rejects unknown `subAgent` name.
13. Override key not in allowlist → error message lists allowed fields.
14. `enabledTools` extras → error names the unknown tool.
15. `maxMessages` outside `[1, sub.maxMessages]` → error.
16. `sessions_send` to a sealed `sub:*` key → sealed-error message.
17. Removed `targetAgentId` parameter is not accepted.
18. `sessions_spawn` is not registered when `agentConfig.subAgents.length === 0`.

### 6.4 RunCoordinator

`server/agents/run-coordinator.test.ts` additions:

19. Sub-agent runtime built with resolved sub config (model, tools, prompt with optional append).
20. `sessions_spawn` stripped from sub's tool surface when `recursiveSubAgentsEnabled === false`.
21. Sub run completion increments parent's registry `messageCount`.
22. cwd derived from `parent.workspacePath` and propagated to the sub-runtime.
23. Coordinator destroy aborts running sub-agent runs.

### 6.5 REST routes

`server/routes/subagents.test.ts` (new):

24. `POST /api/subagents/:id/kill` returns 200 and aborts a running sub.
25. Returns 404 for unknown id.
26. Returns 409 for already-terminal sub.
27. `GET /api/subagents/:id` returns the registry record shape.
28. `GET /api/subagents?parentSessionKey=...` filters correctly.

### 6.6 UI

29. `SubAgentNode.test.tsx`: renders `name` + status pill; shows red badge when no Tools node attached.
30. `SubAgentProperties.test.tsx`: allowlist multi-select round-trips; `maxMessages` bounded 1–6; name regex surfaces inline.
31. `SubAgentInlineCard.test.tsx`: renders status states, disables Stop except when running, calls kill endpoint on click.

## 7. Files touched

### New

| File | Responsibility |
|---|---|
| `src/nodes/SubAgentNode.tsx` | Canvas node component |
| `src/nodes/SubAgentNode.test.tsx` | Canvas tests |
| `src/panels/property-editors/SubAgentProperties.tsx` | Property editor |
| `src/panels/property-editors/SubAgentProperties.test.tsx` | Property editor tests |
| `src/components/SubAgentInlineCard.tsx` | Inline card in parent chat drawer |
| `src/components/SubAgentInlineCard.test.tsx` | Inline card tests |
| `src/components/SubAgentHistoryDrawer.tsx` | History drawer |
| `server/routes/subagents.ts` | REST endpoints (kill, get, list-by-parent) |
| `server/routes/subagents.test.ts` | REST tests |
| `docs/concepts/sub-agent-node.md` | Concept doc |

### Modified

| File | Change |
|---|---|
| `src/types/nodes.ts` | Add `'subAgent'` to `NodeType`; `SubAgentNodeData`, `SubAgentOverridableField`; extend `FlowNodeData` |
| `src/utils/default-nodes.ts` | Sub-agent defaults |
| `src/utils/graph-to-agent.ts` | Resolution per Section 2 |
| `src/nodes/node-registry.ts` | Register the canvas component |
| `shared/agent-config.ts` | `ResolvedSubAgentConfig`, `SubAgentOverridableField`, `AgentConfig.subAgents` |
| `server/agents/sub-agent-registry.ts` | `subAgentName`, `messageCount`, `maxMessages`, `appliedOverrides`, `sealed`; `incrementMessageCount`, `isSealed`, `seal` |
| `server/agents/run-coordinator.ts` | Build sub-agent runtime from `ResolvedSubAgentConfig`; cap-aware `sessions_send`; recursive-tools strip; abort on destroy |
| `server/sessions/session-tools.ts` | Rewrite `createSessionsSpawnTool` for new schema; cap gate in `sessions_send` for `sub:*` keys; conditional registration based on `subAgents.length` |
| `server/index.ts` | Mount `/api/subagents` routes |
| `src/runtime/agent-client.ts` (or equivalent) | Frontend client for kill / get / list endpoints |
| `src/store/session-store.ts` | Sub-agent live state subscription scoped by `runId`; messageCount + sealed flag |
| `docs/concepts/agent-node.md` | Add Sub-Agent Node to Connections list |
| `docs/concepts/tool-node.md` | Deprecation note for `subAgentSpawning` / `maxSubAgents` |
| `docs/concepts/_manifest.json` | Register `sub-agent-node` entry |

## 8. Out of scope

Explicitly deferred so they don't accidentally creep in:

- **Cross-agent sub-agents** (a sub-agent that's a different declared agent in the graph). Stays gated behind `coordinatorLookup`.
- **Long-term / persistent memory inheritance to sub-agents.** Revisit when persistent memory ships.
- **Per-parent-turn sub-agent quotas** beyond `maxMessages` (e.g. `maxConcurrentSpawns`). Add later if fan-out abuse appears in practice.
- **Top-level "Sub-agents" workspace page** across all agents. History stays accessible from each SubAgentNode.
- **A separate cap on internal LLM turns** within a single sub-agent run. The existing `runTimeoutMs` is the only safeguard today against runaway internal loops inside a sub-agent's run; a dedicated `subAgentInternalMaxTurns` cap can be added cleanly later as a new field on `ResolvedSubAgentConfig`.
