# Hooks & Plugin Lifecycle — Layer 4 Design

<!-- last-verified: 2026-04-06 -->

This is the fourth and final layer that implements the full agent loop architecture described in `notes/agent.md`. Layer 1 introduced run dispatch, lifecycle tracking, `wait()`, timeout/abort handling. Layer 2 added queued execution, per-session serialization, and session write leases. Layer 3 added multi-channel event streaming, reasoning gating, reply suppression, verbose tool summaries, and frontend stream adapters. Layer 4 adds a centralized hook registry — both internal backend hooks and plugin-defined lifecycle hooks — providing the extensibility layer that lets plugins observe, annotate, and intercept every phase of the agent loop.

## Layers Overview

1. Core Loop & Run Lifecycle
2. Concurrency & Session Serialization
3. Streaming & Reply Shaping
4. **Hooks & Plugin Lifecycle** (this spec)

## Problem

Layers 1-3 built a solid agent execution pipeline, but the system is closed:

- There is no way for external plugins to influence model selection, inject context before prompting, intercept tool calls, or transform replies before delivery.
- Internal subsystems (bootstrap file injection, command handling) have no formal hook point — they are hardcoded in the execution path.
- The `PluginDefinition` type in config only tracks `tools` and `skills` — no lifecycle hook bindings.
- There is no way to claim a turn and return a synthetic reply without going through the model.
- No session or backend lifecycle events exist for plugins to observe.

## Decisions

- **Approach:** Centralized `HookRegistry` with typed hook points. Plugins register handlers during agent `start()`. The coordinator and runtime call `HookRegistry.invoke(hookName, context)` at defined points in the execution pipeline.
- **Internal hooks first:** `agent:bootstrap` and command hooks are internal. They are registered by the runtime, not by plugins.
- **Plugin hooks are async waterfall:** Each handler receives the context, may mutate it, and passes it to the next handler. Handlers run in registration order. Any handler can short-circuit by setting a `claimed` flag.
- **Plugin manifest:** `PluginDefinition` in `AgentConfig` gains an optional `hooks` field mapping hook names to handler module paths. Handlers are loaded at agent start time.
- **Fail-open by default:** If a hook handler throws, the error is logged and the pipeline continues. A hook can opt into fail-closed behavior by setting `critical: true` in its registration.
- **No hot-reload:** Plugins are loaded at agent start and unloaded at destroy. Changing plugins requires an agent restart.
- **Context objects are hook-specific:** Each hook point defines a typed context interface. Contexts carry the minimum needed data for that phase plus a mutable `result` or `overrides` field for the handler to write output.
- **Core subset first:** 6 core hooks (`before_model_resolve`, `before_prompt_build`, `before_agent_reply`, `before_tool_call`/`after_tool_call`, `agent_end`) are fully wired; remaining hooks are scaffolded (types defined, invoke points marked).
- **`before_agent_reply` fires pre-first-call only:** Full mid-turn interception requires pi-agent-core changes. This layer fires the hook before the first LLM call, letting a plugin claim the turn and return a synthetic reply or silence the turn entirely.
- **`AgentRuntime` gains `setModel()` and `setSystemPrompt()`:** Minimal mutation methods so hooks can swap models/prompts without recreating the runtime.
- **Global `HookRegistry` for backend lifecycle:** `backend_start`/`backend_stop` use a global registry (not per-agent) since backend lifecycle isn't agent-scoped.

## Assumptions

- Layers 1-3 are stable and unchanged by this layer.
- Plugin handlers are JavaScript/TypeScript modules resolved from the filesystem relative to the agent's storage path or an absolute path.
- Plugins are trusted code — they run in the same process with full access. Sandboxing is out of scope.
- The backend remains single-process. Distributed hook execution is not required.

---

## 1. Architecture

### New Component: `HookRegistry` (`server/hooks/hook-registry.ts`)

The central hook system. One instance per managed agent, plus one global instance for backend lifecycle.

Responsibilities:
- Store handler registrations per hook name
- Invoke handlers in order (waterfall) with typed contexts
- Handle errors (log + continue, or throw if `critical`)
- Support both sync and async handlers
- Cleanup on destroy

```typescript
type HookHandler<TContext> = (context: TContext) => Promise<void> | void;

interface HookRegistration<TContext> {
  pluginId: string;              // 'internal' for built-in hooks
  handler: HookHandler<TContext>;
  priority: number;              // lower = earlier, default 100
  critical: boolean;             // if true, error in handler stops the pipeline
}

class HookRegistry {
  register<TContext>(
    hookName: string,
    registration: HookRegistration<TContext>,
  ): () => void;                 // returns unregister fn

  invoke<TContext>(
    hookName: string,
    context: TContext,
  ): Promise<TContext>;

  has(hookName: string): boolean;
  count(hookName: string): number;
  destroy(): void;
}
```

### New Component: `PluginLoader` (`server/hooks/plugin-loader.ts`)

Loads plugin modules from the filesystem and registers their hooks.

### New Component: `internal-hooks.ts` (`server/hooks/internal-hooks.ts`)

Registers built-in hooks (`agent:bootstrap`) at priority 10.

### Data flow

```
AgentManager.start()
  → creates HookRegistry
  → registers internal hooks (agent:bootstrap)
  → PluginLoader loads plugin hooks from config
  → stores registry on ManagedAgent

RunCoordinator.executeRun()
  → invoke('before_model_resolve', ctx)
  → invoke('before_prompt_build', ctx)     [with session messages]
  → invoke('before_agent_reply', ctx)      [before first LLM call — can claim turn]
  → runtime.prompt()
    → invoke('before_tool_call', ctx)      [per tool invocation, via wrapped tools]
    → invoke('after_tool_call', ctx)       [per tool invocation, via wrapped tools]
  → invoke('agent_end', ctx)               [on success/error]
```

---

## 2. Hook Points

### Core hooks (fully wired)

| Hook | When | Can Mutate |
|------|------|-----------|
| `before_model_resolve` | After session resolution, before model use | provider, modelId |
| `before_prompt_build` | After session load, before prompt finalized | system prompt, prepend/append context |
| `before_agent_reply` | Before first LLM call | claimed, syntheticReply, silent |
| `before_tool_call` | Before each tool execution | params, blocked |
| `after_tool_call` | After each tool execution | transformedResult |
| `agent_end` | After run completes | read-only |

### Scaffolded hooks (types defined, invoke points deferred)

| Hook | When |
|------|------|
| `tool_result_persist` | Before tool result written to transcript |
| `before_compaction` / `after_compaction` | Compaction cycles |
| `before_install` | Before skill/plugin install |
| `message_received` | On dispatch, before queueing |
| `message_sending` / `message_sent` | Before/after reply broadcast |
| `session_start` / `session_end` | Session lifecycle |
| `backend_start` / `backend_stop` | Server boot/shutdown (global) |
| `agent:bootstrap` | During bootstrap file injection |

---

## 3. Config Changes

### `PluginHookBinding` (new)

```typescript
export interface PluginHookBinding {
  hookName: string;
  handler: string;       // module path (relative to storage or absolute)
  priority?: number;     // default: 100
  critical?: boolean;    // default: false
}
```

### `PluginDefinition` (updated)

```typescript
export interface PluginDefinition {
  id: string;
  name: string;
  tools: string[];
  skills: string[];
  hooks?: PluginHookBinding[];   // NEW, optional for backwards compat
  enabled: boolean;
}
```

---

## 4. Files Changed / Created

### New files

| File | Purpose |
|------|---------|
| `server/hooks/hook-types.ts` | All hook context interfaces and constants |
| `server/hooks/hook-registry.ts` | Central registry class |
| `server/hooks/hook-registry.test.ts` | Registry unit tests |
| `server/hooks/plugin-loader.ts` | Filesystem-based plugin loading |
| `server/hooks/plugin-loader.test.ts` | Loader unit tests |
| `server/hooks/internal-hooks.ts` | Built-in hook registrations |

### Modified files

| File | Change |
|------|--------|
| `server/agents/agent-manager.ts` | Creates HookRegistry per agent, loads plugins, passes to runtime/coordinator, global registry |
| `server/agents/run-coordinator.ts` | Invokes before_model_resolve, before_prompt_build, before_agent_reply, agent_end, message_received, session_start |
| `server/runtime/agent-runtime.ts` | Adds setModel(), setSystemPrompt(), getSystemPrompt(), tool wrapping with hooks |
| `server/index.ts` | Global backend_start/backend_stop hooks |
| `shared/agent-config.ts` | Adds PluginHookBinding, updates PluginDefinition |
| `src/types/nodes.ts` | Mirrors PluginHookBinding and hooks field |

### Unchanged

| File | Reason |
|------|--------|
| `server/agents/run-concurrency-controller.ts` | Concurrency orthogonal |
| `server/agents/stream-processor.ts` | No changes needed for core subset |
| `server/agents/event-bridge.ts` | No changes needed for core subset |
| `server/agents/stream-transforms/*` | Stream transforms orthogonal |
| `shared/storage-types.ts` | No storage changes |
