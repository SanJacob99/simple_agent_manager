# Sub-Agent Node Design

**Date:** 2026-04-30
**Scope:** New `SubAgentNode` peripheral, declarative sub-agent identities per main agent, parent-controlled per-call config overrides, strict one-shot semantics with parent-driven retry, and UI surfaces (inline card + history drawer).
**Builds on:** [2026-04-07-session-deferred-features-design.md](2026-04-07-session-deferred-features-design.md) (session tools + `SubAgentRegistry`), [2026-04-29-session-tools-yield-list-history-design.md](2026-04-29-session-tools-yield-list-history-design.md) (yield orchestration).

## Overview

Today the backend has working sub-agent plumbing — `SubAgentRegistry`, `sessions_spawn`, `sessions_yield`, async resume — but no graph-level way to declare *what* a sub-agent is. The current `sessions_spawn` either spawns the same agent into a `sub:*` session or routes to another declared agent via `coordinatorLookup` (gated). Neither path lets a graph author give the agent a roster of named, separately-configured one-shot helpers.

This spec adds a `SubAgentNode` peripheral that attaches to an `AgentNode` and declares a named sub-agent (e.g. `researcher`, `summarizer`) with its own system prompt, model, and tools. The parent agent calls `sessions_spawn({ subAgent: "researcher", message, overrides })` to dispatch one. **Each spawn is strictly one-shot:** the sub-agent runs a single round, returns its final assistant text to the parent, and the sub-session is sealed. There is no follow-up `sessions_send` against a sub-session, no parent↔sub conversation, no message-count cap to negotiate.

**Retry intelligence lives in the parent.** When a sub-agent's output is unsatisfactory (an error, an off-target answer, missing detail), the parent agent's own LLM is what reasons about the failure and tries again — by spawning a *fresh* sub-agent with adjusted overrides (different `modelId`, a `systemPromptAppend` that names what was wrong, a narrower `enabledTools` list). The previous sub-agent's tool result already sits in the parent's context window; that's the retry context. No special framework support beyond the one-shot spawn primitive is needed.

The parent may pass per-call config overrides, but only for fields the SubAgentNode lists in an explicit allowlist — the sub-agent author retains control over what is and isn't tunable from outside.

The user can watch every sub-agent run live in the parent's chat drawer (inline card with stop button) and inspect a sub-agent's full history (across all parent sessions) from a dedicated drawer opened off the SubAgentNode.

## Implementation guardrails from design review

These points are part of the design, not optional cleanup. They close gaps between the intended product behavior and the current code shape.

1. **Sub-agent execution must not deadlock the parent run.** The current `RunCoordinator` has a single active run slot (`RunConcurrencyController.activeRunId`). If `sessions_spawn({ wait: true })` dispatches the sub-agent through the same coordinator while the parent tool call is still waiting, the child run queues behind the parent and can only complete by timeout. Implementation must either:
   - run sub-agents through a per-spawn child executor/runtime that is not blocked by the parent run's active slot, or
   - remove/deprecate `wait` and require `sessions_yield` / async resume for sub-agent results.

   Preferred path: keep `wait`, but implement a child runtime/executor path so the one-shot helper can run immediately while the parent turn is suspended inside the tool call. The child executor must:
   - **Honor `coordinator.abort(childRunId)`** so the REST kill endpoint and the agent-facing `subagents({action: 'kill'})` tool both terminate the child immediately, regardless of the parent's run state.
   - **Emit run-events on the same event bus** that the parent's WebSocket subscription consumes, keyed by the child's `runId`. The inline-card subscription path is unchanged — it just filters the same stream by the child's `runId` rather than the parent's.
   - **Not occupy the parent's session-queue slot** in `RunConcurrencyController`. A child execution path that sits beside the queue (e.g. a dedicated child-executor pool with its own slot accounting, or an "inline child" mode that runs synchronously inside the parent's slot but accounts for it as nested work) is acceptable; what's not acceptable is the current `dispatch` path that enqueues children behind the parent.

2. **Build each sub-agent from a synthetic resolved config.** `ResolvedSubAgentConfig` should be converted into a runtime-ready `AgentConfig` for that spawn, rather than mutating the parent's already-constructed runtime in place. The synthetic config uses the sub-agent provider/model/prompt/tools/workspace, keeps storage/session routing under the parent agent, disables context-engine compaction, and handles memory explicitly. If memory is shared, that should be a deliberate runtime option instead of an accidental consequence of sharing storage.

3. **Canvas connection support is a real feature slice.** The current graph UI only accepts edges into `AgentNode`, and existing peripheral nodes expose source handles only. Implementing SubAgent-attached tools/providers/skills/MCPs requires explicit changes to connection validation, graph-store connection acceptance, and target handles on `SubAgentNode`.

4. **Sub-agent session tools are auto-enabled by `subAgents.length`, not by `ToolsNode.subAgentSpawning`.** Runtime injection should add `sessions_spawn`, `sessions_yield`, and `subagents` when the resolved parent config has at least one runnable sub-agent, even if the parent Tools node does not list those tools. `sessions_send`, `sessions_history`, `sessions_list`, and `session_status` remain governed by storage/session-tool availability. The deprecated `subAgentSpawning` / `maxSubAgents` fields must not be used as the runtime gate.

5. **Persist sub-agent metadata for history.** `SubAgentRegistry` is in-memory, so history drawer data that must survive restart or UI close needs durable storage. Add either a `subAgent` metadata block on `SessionStoreEntry` or a durable custom transcript entry at spawn time. It should include `subAgentId`, `subAgentName`, parent session key/id, status, applied overrides, model/provider used, and sealed/killed state.

6. **Account for stored session-key prefixes.** The logical sub-session key is `sub:<parentSessionKey>:<subAgentName>:<uuid>`, but persisted session keys are routed as `agent:<agentId>:<subKey>`. Any history filtering, `sessions_send` rejection check, or REST lookup must parse both forms rather than relying on `sessionKey.startsWith("sub:")`.

7. **Kill must preserve a killed terminal state and abort real work.** The user-visible kill path should abort the underlying run and mark the registry/session metadata as `killed`. Do not call `coordinator.abort()` in a way that first converts the record to generic `error` and then makes `kill()` a no-op. The agent-facing `subagents({ action: "kill" })` tool should use the same aborting path or clearly document that it is registry-only.

8. **Override validation must use effective tools.** Validate `overrides.enabledTools` against `resolveToolNames(subAgent.tools)`, not `subAgent.tools.resolvedTools`, because profiles, groups, aliases, and enabled plugins expand only through the shared resolver.

9. **Make `modelId` and `thinkingLevel` inheritance explicit, with the same convention.** Today's `modelId: ''` quietly means "inherit", and a default `thinkingLevel: 'off'` cannot distinguish "inherit from parent" from "force off". Both fields have the same problem and must use the same resolution convention so users don't have to learn two patterns. Pick one of:
   - **Empty-string sentinel** for both: `modelId: ''` and `thinkingLevel: ''` mean inherit; any other value is custom. Smaller schema, smaller UI, but inheritance is implicit.
   - **Explicit mode field** for both: `modelIdMode: 'inherit' | 'custom'` and `thinkingLevelMode: 'inherit' | 'custom'`, with the value field honored only when mode is `'custom'`. More discoverable in the UI (radio: *Inherit from parent / Custom*), but more schema surface.

   The implementation plan must pick one and apply it consistently across `SubAgentNodeData`, `ResolvedSubAgentConfig`, and the property panel. Splitting the convention between the two fields is the explicit anti-goal here.

10. **Treat MCP as schema-only unless runtime MCP work lands first.** The MCP node is currently resolved into config, but the concept doc says the runtime MCP client/tool exposure is not implemented. Sub-agent MCP merge behavior should be documented as deferred unless the runtime MCP manager ships in the same implementation slice.

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
  | 'enabledTools';

export interface SubAgentNodeData {
  [key: string]: unknown;
  type: 'subAgent';
  name: string;                                 // identity used by parent; required, unique per agent
  description: string;                          // shown to parent in sessions_spawn schema
  systemPrompt: string;
  modelId: string;                              // empty = inherit parent's modelId at resolve time
  thinkingLevel: ThinkingLevel;
  modelCapabilities: ModelCapabilityOverrides;
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
  | 'modelId' | 'thinkingLevel' | 'systemPromptAppend' | 'enabledTools';

export interface ResolvedSubAgentConfig {
  name: string;
  description: string;
  systemPrompt: string;
  modelId: string;                              // resolved (own || parent.modelId)
  thinkingLevel: string;
  modelCapabilities: ModelCapabilityOverrides;
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
  },
  wait?: boolean,                        // default true; one-shot semantics favor returning the result
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
- `enabledTools`: each entry must be in the sub's *effective* tools (the result of `resolveToolNames(sub.tools)`, which expands profile + groups + plugins — not the raw `enabledTools` list). Unknown entries error out listing them.
- `modelId`: format-validated only here; resolver-level validity (the chosen model is reachable on the sub's resolved provider) surfaces at runtime as a normal run error.
- `thinkingLevel`: must be one of the literal enum values.
- `systemPromptAppend`: trimmed; empty string is treated as omitted.

The validated overrides are recorded on the `SubAgentRecord` as `appliedOverrides` for audit (rendered as chips in the inline card and history drawer).

### 3.3 Sub-session keys & registry record

- Session key: `sub:<parentSessionKey>:<subAgentName>:<shortUuid>`. The `<subAgentName>` segment lets the history drawer prefix-filter without a separate index.
- `SubAgentRecord` (in `server/agents/sub-agent-registry.ts`) gains:
  ```ts
  subAgentName: string;
  appliedOverrides: Record<string, unknown>;
  sealed: boolean;                 // true once the run reaches a terminal state (one-shot)
  ```
- Registry status enum: `'running' | 'completed' | 'error' | 'killed'`.
- `SubAgentRegistry` gains:
  - `seal(subAgentId): void` — idempotent; called by `onComplete`, `onError`, and `kill` to mark the sub-session done.
  - `isSealed(subAgentId): boolean`
  - `findBySessionKey(sessionKey: string): SubAgentRecord | undefined` — used by `sessions_send` to identify a sub-session for the rejection check.

### 3.4 One-shot semantics

Sub-agents are strictly one-shot. There is no parent↔sub conversation, no message-count cap to negotiate, and no follow-up sends from the parent into the same sub-session.

- **Spawn**: `appliedOverrides` recorded; sub run dispatched via `SubAgentExecutor`. `wait: true` is the typical mode — the spawn tool returns the sub's final assistant text inline.
- **Sub run reaches terminal state** (`completed` / `error` / `killed`) → registry `seal()` flips `sealed: true`. The transcript stays readable via `sessions_history` and the history drawer.
- **`sessions_send` to any `sub:*` key**: the tool detects the sub-session shape via `parseSubSessionKey`. If recognized, it returns a one-shot rejection:
  `Sub-agent sessions are one-shot and cannot be re-engaged with sessions_send; spawn a new sub-agent to continue.`
  This applies whether the sub is still running, already sealed, or terminal — `sessions_send` never targets a sub-session, period.

#### Parent-driven retry pattern (informational)

When the parent agent's intelligence wants to retry — because the sub returned a wrong answer, errored out, or didn't go deep enough — it does so by **spawning a fresh sub-agent**. The previous sub's tool result already sits in the parent's transcript; the parent's LLM reads it as context and crafts a new spawn with adjusted overrides:

- A `systemPromptAppend` that names what was wrong with the previous attempt (`"The previous attempt missed citations; this time include 3 sources per claim."`).
- A different `modelId` if the allowlist permits (`"Use a stronger model on the retry."`).
- A narrower `enabledTools` list if a tool failure was the cause.

No framework support is required beyond the one-shot spawn primitive — the retry is pure model intelligence operating over the parent's own context. This is intentional: it keeps the framework simple and lets each parent agent develop its own retry style.

### 3.5 Recursive spawning gate

When building a sub-agent's runtime tool surface in `RunCoordinator.executeRun`, given the sub's `recursiveSubAgentsEnabled`:

- `false` (default): `sessions_spawn` and `sessions_yield` are stripped from the sub-agent's tool list, regardless of what the sub's Tools node enables. `subagents` (list/status/kill) stays available for symmetry (the sub may have spawned things historically and want to inspect them, though in practice the list will be empty). The system-prompt-builder's auto-generated tool-list section reflects this stripped surface.
- `true`: the sub-agent inherits the parent agent's full `subAgents` list — same set of named SubAgentNodes the parent could call. No new sub-agents may be declared from inside a running sub; the graph is the only declaration site. The "Unstable" label in the UI is the only signal that recursion is in effect — recursion has no built-in depth cap, so unbounded fan-out is the implementer's risk to manage.

### 3.6 Working directory at runtime

When the sub's runtime is constructed, its `workspacePath` is `ResolvedSubAgentConfig.workingDirectory`. The exec/fs tools' existing path-policy (`sandboxWorkdir`) operates against this path unchanged. Directory creation is lazy — the first write by a tool creates the folder.

### 3.7 Cleanup on parent-run abort / coordinator destroy

- `RunCoordinator.destroy()` already calls `subAgentRegistry.cancelAllYields()`. It additionally walks `subAgentRegistry.listForParent(*)` for the coordinator's parent runs and aborts running sub-agent runs (delegating to `coordinator.abort(runId)`). Sealed records are left in place for history.

## 4. UI surfaces

### 4.1 SubAgentNode (canvas)

`src/nodes/SubAgentNode.tsx`. Compact body:

- Title row: 🤖 icon + `name` (or `"<unnamed>"` placeholder); status pill `running N` when any spawn is currently active for this sub-agent.
- Subtitle: resolved model id; greyed when inherited, normal when own.
- Footer chips: `tools: <count>`, optional `Unstable` chip when `recursiveSubAgentsEnabled`.
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
| **Model** | Two-radio mode: `Inherit from parent` / `Custom`. Custom reveals a `modelId` picker driven by sub's resolved provider — dedicated provider wins, else parent's. `thinkingLevel` follows the same inherit-vs-custom pattern. `modelCapabilities` snapshot subform reused from `AgentProperties` (custom mode only). |
| **Parent overrides** | `overridableFields` checkbox group (4 entries: `modelId`, `thinkingLevel`, `systemPromptAppend`, `enabledTools`). Empty = parent locked to node config. Section help: *"Fields the parent agent may override per-call via `sessions_spawn` overrides. The parent's intelligence uses these to retry by spawning fresh sub-agents with adjusted settings."* |
| **Working directory** | radio: `Derived (<parentCwd>/subagent/<name>)` (default) / `Custom`. Custom shows a path input. |
| **Advanced** | `recursiveSubAgentsEnabled` toggle, labeled *"Allow this sub-agent to spawn sub-agents"*; red **Unstable** badge plus inline warning about loop risk when enabled |
| **Parent's sub-agent tools** | Read-only info card with two groups: **(a) Auto-enabled by SubAgentNode presence**: `sessions_spawn`, `sessions_yield`, `subagents`. **(b) Already available when a Storage node is connected** (listed as relevant for managing sub-agents): `sessions_history` (inspect any session's transcript). Note: `sessions_send` does **not** target sub-sessions (one-shot — see §3.4). One-line summary each; link to the manage-sub-agents docs. **Not** a toggle surface. |

### 4.3 Inline sub-agent card (parent chat drawer)

`src/components/SubAgentInlineCard.tsx`. Rendered inside the parent's transcript wherever a `sessions_spawn` tool call is rendered.

- Header (collapsed):
  `▸ 🤖 <name> · <status> · ⏱ <elapsed> · [⏹ Stop]`
- Status pill values: `running`, `done`, `errored`, `killed`. (No `sealed` pill — sealing happens automatically on terminal status; the card just shows the terminal state itself.)
- Applied-overrides chips beside the header when non-empty (e.g., `model→opus`, `tools→[web_search]`).
- Expanded body: full sub-agent transcript using the same renderer components as the main chat (`MessageBubble`, `ToolCallBlock`, `AttachmentPreview`). No edit affordances.
- `Stop` button: enabled only while `status === 'running'`. Click → `POST /api/subagents/:subAgentId/kill`. The button shows a spinner until the response returns; on success the card flips to `killed`.
- Live updates: subscribes to the existing run-event WebSocket stream filtered by the sub's `runId` (same plumbing used by the main chat).
- One-shot: each `sessions_spawn` renders a *new* card. There is no in-place re-engagement; if the parent retries by spawning the same sub-agent name again, the result is a fresh card, not an update to the previous one. (This is what makes the parent-driven retry pattern visible: the user sees a sequence of cards, each a distinct attempt with potentially different overrides.)

### 4.4 Sub-agent history drawer

`src/components/SubAgentHistoryDrawer.tsx`. Reuses the existing chat-drawer chrome, opened from the SubAgentNode's `History` button.

- Source: existing storage list APIs, client-side filtered to `sessionKey.startsWith("sub:") && sessionKey.includes(":<name>:")` for the selected sub-agent. Cheap; sub-sessions are bounded.
- List view (newest-first), each row:
  - Short id (last 6 of uuid)
  - Parent session label (`displayName` or `sessionId` short form)
  - Started-at (relative)
  - Status: `done` / `error` / `killed` / `running`
  - Model used (if overridden, with a chip)
  - Applied-overrides chips
- Each row is a single one-shot invocation; no row aggregates multiple attempts — repeated retries by the parent appear as separate rows so the user can compare what changed across attempts.
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
| `GET` | `/api/subagents/:subAgentId` | Returns the registry record (status, sealed, applied overrides, run ids, parent session). Used by the inline card on initial render so the UI doesn't need to walk a list to find one record. |
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

8. `appliedOverrides` round-trips through `spawn` → `get`.
9. `kill()` flips status to `'killed'` and seals; idempotent.
10. `onError` after `kill` does NOT overwrite the killed status.
11. `findBySessionKey` returns the record for both raw and wrapped sub-session keys.

### 6.3 Session tools

`server/sessions/session-tools.test.ts` additions:

12. `sessions_spawn` rejects unknown `subAgent` name.
13. Override key not in allowlist → error message lists allowed fields.
14. `enabledTools` extras → error names the unknown tool (validated against effective tools, not raw `enabledTools` list).
15. `sessions_send` to any `sub:*` key returns the one-shot rejection text.
16. Removed `targetAgentId` parameter is not accepted.
17. `sessions_spawn` is not registered when `agentConfig.subAgents.length === 0`.

### 6.4 RunCoordinator

`server/agents/run-coordinator.test.ts` additions:

18. Sub-agent runtime built with resolved sub config (model, tools, prompt with optional append).
19. `sessions_spawn` stripped from sub's tool surface when `recursiveSubAgentsEnabled === false`.
20. Sub run completion seals the registry record (status `completed`, `sealed: true`).
21. cwd derived from `parent.workspacePath` and propagated to the sub-runtime.
22. Coordinator destroy aborts running sub-agent runs.

### 6.5 REST routes

`server/routes/subagents.test.ts` (new):

23. `POST /api/subagents/:id/kill` returns 200 and aborts a running sub; record ends `killed`.
24. Returns 404 for unknown id.
25. Returns 409 for already-terminal sub.
26. `GET /api/subagents/:id` returns the registry record shape.
27. `GET /api/subagents?parentSessionKey=...` filters correctly.

### 6.6 UI

28. `SubAgentNode.test.tsx`: renders `name` + status pill; shows red badge when no Tools node attached.
29. `SubAgentProperties.test.tsx`: allowlist multi-select round-trips (4 entries); inherit/custom mode radios for `modelId` and `thinkingLevel` round-trip; name regex surfaces inline.
30. `SubAgentInlineCard.test.tsx`: renders status states, disables Stop except when running, calls kill endpoint on click; one-shot — repeated spawns of the same name render distinct cards.

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
| `server/agents/sub-agent-registry.ts` | `subAgentName`, `appliedOverrides`, one-shot `sealed` flag, `'killed'` terminal status, `seal`, `isSealed`, `findBySessionKey` |
| `server/agents/run-coordinator.ts` | Build sub-agent runtime from `ResolvedSubAgentConfig` via `SubAgentExecutor`; recursive-tools strip; abort on destroy |
| `server/sessions/session-tools.ts` | Rewrite `createSessionsSpawnTool` for new schema; one-shot rejection in `sessions_send` for any `sub:*` key; conditional registration based on `subAgents.length` |
| `server/index.ts` | Mount `/api/subagents` routes |
| `src/runtime/agent-client.ts` (or equivalent) | Frontend client for kill / get / list endpoints |
| `src/store/session-store.ts` | Sub-agent live state subscription scoped by `runId`; status + sealed flag |
| `docs/concepts/agent-node.md` | Add Sub-Agent Node to Connections list |
| `docs/concepts/tool-node.md` | Deprecation note for `subAgentSpawning` / `maxSubAgents` |
| `docs/concepts/_manifest.json` | Register `sub-agent-node` entry |

## 8. Out of scope

Explicitly deferred so they don't accidentally creep in:

- **Cross-agent sub-agents** (a sub-agent that's a different declared agent in the graph). Stays gated behind `coordinatorLookup`.
- **Long-term / persistent memory inheritance to sub-agents.** Revisit when persistent memory ships.
- **Per-parent-turn fan-out quotas** (e.g. `maxConcurrentSpawns` to bound how many sub-agents the parent can launch in one turn). Add later if fan-out abuse appears in practice.
- **Framework-level retry orchestration.** Retries are explicitly model-driven (parent's LLM reasons over its own context and spawns again). The framework offers no retry primitive, no "auto-retry on error", no structured failure-context injection. If a use case demands deterministic retry orchestration, that becomes a new spec — and probably a new tool — rather than an extension of this one.
- **Top-level "Sub-agents" workspace page** across all agents. History stays accessible from each SubAgentNode.
- **A separate cap on internal LLM turns** within a single sub-agent run. The existing `runTimeoutMs` is the only safeguard today against runaway internal loops inside a sub-agent's run; a dedicated `subAgentInternalMaxTurns` cap can be added cleanly later as a new field on `ResolvedSubAgentConfig`.
