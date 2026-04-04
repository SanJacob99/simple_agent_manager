# Frontend-Backend Architecture Split

<!-- last-verified: 2026-04-04 -->

## Problem

Simple Agent Manager currently runs agent execution (`AgentRuntime`, `pi-agent-core`) inside the browser. This prevents agents from accessing server-side capabilities (filesystem, shell, databases), makes agent execution fragile (closing a tab kills the agent), and exposes API keys in `localStorage`.

## Goals (priority order)

1. **Capability** — Agents need server-side tool access (fs, shell, databases, long-running processes)
2. **Reliability** — Agents survive tab close, keep running, user reconnects to see results
3. **Security** — API keys stay server-side, never in the browser
4. **Multi-user readiness** — Single-user now, but the architecture shouldn't preclude future multi-user deployment

## Approach

Expand the existing Express server (`server/index.ts`) into the full backend. Add a WebSocket layer alongside existing storage REST routes. The frontend becomes a pure UI client that sends commands and renders events — no `pi-agent-core` dependency.

## Project Structure

Three zones with clear boundaries:

```
simple_agent_manager/
├── server/                         # Backend (Node/Express + WebSocket)
│   ├── index.ts                    # Entry point: Express app, WS upgrade, route mounting
│   ├── connections/
│   │   ├── ws-handler.ts           # WebSocket lifecycle (connect, disconnect, reconnect)
│   │   └── protocol.ts             # Re-exports from shared/ + server-side message helpers
│   ├── agents/
│   │   ├── agent-manager.ts        # Registry of live AgentRuntime instances + lifecycle
│   │   ├── event-bridge.ts         # Subscribes to RuntimeEvents, forwards to WS clients
│   │   └── config-receiver.ts      # Validates incoming AgentConfig from frontend
│   ├── auth/
│   │   └── api-keys.ts             # Server-side API key storage and retrieval
│   └── runtime/                    # Moved from src/runtime/ — untouched internals
│       ├── agent-runtime.ts
│       ├── memory-engine.ts
│       ├── context-engine.ts
│       ├── tool-factory.ts
│       ├── model-resolver.ts       # Drops useModelCatalogStore dependency
│       ├── storage-engine.ts
│       └── token-estimator.ts
│
├── shared/                         # Types shared between frontend and backend
│   ├── protocol.ts                 # WebSocket message types (commands + events)
│   └── agent-config.ts             # AgentConfig interface (used by both sides)
│
├── src/                            # Frontend (Vite/React) — pure UI client
│   ├── client/
│   │   └── agent-client.ts         # WebSocket connection, sends commands, receives events
│   ├── store/
│   │   └── agent-connection-store.ts  # Replaces agent-runtime-store
│   ├── chat/                       # ChatDrawer — talks to backend via AgentClient
│   ├── nodes/                      # Unchanged
│   ├── panels/                     # Unchanged
│   └── ...
```

Server folders grouped by responsibility:
- `connections/` — transport layer
- `agents/` — agent lifecycle and event bridging
- `auth/` — secrets management
- `runtime/` — relocated engine code (as-is)

## WebSocket Protocol

Single WebSocket connection at `ws://localhost:3210/ws`. All agent control flows through it.

### Commands (frontend → backend)

| Command | Payload | Purpose |
|---------|---------|---------|
| `agent:start` | `{ agentId, config: AgentConfig }` | Create/replace an agent runtime from resolved config |
| `agent:prompt` | `{ agentId, sessionId, text }` | Send a user message to a running agent |
| `agent:abort` | `{ agentId }` | Abort the current turn |
| `agent:destroy` | `{ agentId }` | Tear down an agent runtime |
| `agent:sync` | `{ agentId }` | Request current agent state (for reconnection) |

### Events (backend → frontend)

| Event | Payload | Purpose |
|-------|---------|---------|
| `agent:ready` | `{ agentId, config }` | Agent runtime created successfully |
| `agent:error` | `{ agentId, error }` | Runtime-level error |
| `message:start` | `{ agentId, message: { role } }` | Assistant message began |
| `message:delta` | `{ agentId, delta }` | Text chunk streamed |
| `message:end` | `{ agentId, message: { role, usage? } }` | Message complete with token usage |
| `tool:start` | `{ agentId, toolCallId, toolName }` | Tool execution began |
| `tool:end` | `{ agentId, toolCallId, toolName, result, isError }` | Tool execution finished |
| `agent:end` | `{ agentId }` | Turn complete |
| `agent:state` | `{ agentId, status, messages }` | Full state snapshot (response to `agent:sync`) |

## Agent Lifecycle

### AgentManager

Central registry holding live agents:

```typescript
interface ManagedAgent {
  runtime: AgentRuntime
  config: AgentConfig
  status: "idle" | "running" | "error"
  connectedSockets: Set<WebSocket>
  activeSessionId: string
  lastActivity: number
}
```

`StorageEngine` is the source of truth for messages — no duplicate `messageHistory` in memory.

### Lifecycle flow

1. **`agent:start`** — AgentManager creates `AgentRuntime` from config, subscribes via `EventBridge`. If one exists for that `agentId`, destroys the old one first. Saves `agent-config.json` to disk.
2. **`agent:prompt`** — Looks up agent, sets status to `"running"`, calls `runtime.prompt(text)`. Events flow through `EventBridge` to all connected sockets AND get appended to `StorageEngine`. On `agent_end`, status returns to `"idle"`.
3. **`agent:abort`** — Calls `runtime.abort()`, status to `"idle"`.
4. **`agent:destroy`** — Calls `runtime.destroy()`, removes from map, notifies sockets.
5. **`agent:sync`** — Looks up agent, reads messages from `StorageEngine`, sends `agent:state`. Adds socket to `connectedSockets` so it receives live events.
6. **Socket disconnect** — Socket removed from `connectedSockets`. Agent keeps running.
7. **Idle cleanup** — Optional: agents with no sockets and no activity for N minutes get destroyed.

## Server-Restart Resilience

Uses existing `StorageEngine` infrastructure. The only new persisted artifact is a config snapshot:

```
{storagePath}/{agentName}/
├── sessions/                   # Already exists (StorageEngine)
├── memory/                     # Already exists (StorageEngine)
├── agent-config.json           # NEW: last resolved AgentConfig
```

### Persistence triggers

- `agent:start` — save `agent-config.json`
- `agent:start` with new config — overwrite

Messages already persisted per-turn by `StorageEngine`.

### Recovery on server boot

1. Scan `{storagePath}/*/agent-config.json`
2. For each: create `ManagedAgent` with fresh `AgentRuntime` from saved config
3. Load active session messages from `StorageEngine`, feed into runtime context
4. Set status to `"idle"` — even if it was running when server died
5. Agent waits for client `agent:sync`

### What's NOT recoverable

- A turn in-flight when the server crashed (last completed turn is the recovery point)
- Tool execution state mid-turn

## Connection Management & Reconnection

### Frontend: AgentClient

Singleton WebSocket manager, instantiated at app boot:

```typescript
class AgentClient {
  connect(): void
  disconnect(): void
  send(command: Command): void
  onEvent(handler: (event: ServerEvent) => void): () => void
  get status(): "connecting" | "connected" | "disconnected"
}
```

### Reconnection

- Exponential backoff: 1s, 2s, 4s, 8s, max 30s
- On reconnect: re-send `agent:sync` for all agents the user has open
- Backend replies with `agent:state` containing full message history and current status

### Scenarios

| Scenario | Behavior |
|----------|----------|
| User sends prompt, closes tab | Backend finishes turn, persists to StorageEngine. User reopens, syncs, sees result. |
| Network blip mid-stream | Client reconnects, syncs, gets current state. Streaming resumes. |
| Server restart (clean) | Config snapshots on shutdown. On boot, agents restored. Client reconnects, syncs. |
| Server crash (unclean) | Last `agent-config.json` + last completed turn in StorageEngine. In-flight turn lost. |

## Frontend Refactor

### Removed

- `pi-agent-core` dependency from frontend bundle
- `src/runtime/` directory (moved to `server/runtime/`)
- `useAgentRuntimeStore` (replaced by `AgentConnectionStore`)
- `model-catalog-store` runtime dependency — the store stays on the frontend for the agent node UI (model picker), but `model-resolver.ts` on the server no longer imports it. Instead, model metadata is included in the `AgentConfig` sent via `agent:start` (the `modelCapabilities` field already carries this)

### New

**`src/client/agent-client.ts`** — WebSocket connection manager (singleton)

**`src/store/agent-connection-store.ts`** — Replaces `agent-runtime-store`:

```typescript
interface AgentConnectionStore {
  agents: Map<string, {
    status: "connecting" | "idle" | "running" | "error" | "disconnected"
    messages: Message[]
  }>
  startAgent: (agentId: string, config: AgentConfig) => void
  sendPrompt: (agentId: string, sessionId: string, text: string) => void
  abortAgent: (agentId: string) => void
  destroyAgent: (agentId: string) => void
  syncAgent: (agentId: string) => void
}
```

### ChatDrawer changes

Swap the source, keep the UI:

| Current (browser runtime) | New (backend via WebSocket) |
|---|---|
| `getOrCreateRuntime(nodeId, config, getApiKey)` | `agentClient.send({ type: "agent:start", ... })` |
| `runtime.subscribe((event) => ...)` | Store reactively updates from WS events |
| `runtime.prompt(text)` | `agentClient.send({ type: "agent:prompt", ... })` |
| `runtime.abort()` | `agentClient.send({ type: "agent:abort", ... })` |
| `destroyRuntime(nodeId)` | `agentClient.send({ type: "agent:destroy", ... })` |

Rendering logic (message list, markdown, token badges, session selector) stays untouched.

### API Keys

- Frontend settings UI still collects keys from user
- Keys sent to backend via a `config:setApiKeys` command
- Backend stores in memory (single user, not persisted to disk)
- On server restart, user re-enters keys

### Unchanged

- Graph editor, all node components, property editors
- `graph-store`, `session-store`
- `resolveAgentConfig()` — runs on frontend, sends result to backend
- Storage REST routes

## Server Entry Point

### Transport setup

```
HTTP :3210
├── /api/storage/*              # Existing REST routes (unchanged)
├── /api/health                 # Health check
└── Upgrade: websocket → /ws    # WebSocket handler
```

### Startup sequence

1. Express app initializes, mounts storage routes
2. `AgentManager` initializes, scans for persisted configs, restores idle agents
3. HTTP server starts on port 3210
4. `ws.Server` attaches to HTTP server at path `/ws`
5. On WebSocket connection, `ws-handler.ts` routes commands to `AgentManager`

### Graceful shutdown

On `SIGTERM` / `SIGINT`:
1. Stop accepting new WebSocket connections
2. Abort running agents, snapshot configs to disk
3. Close sockets with code `1001` (going away)
4. Close HTTP server

### Dev workflow

Existing script unchanged:

```json
"dev": "concurrently \"vite\" \"tsx watch server/index.ts\""
```

## Not In Scope

- Container orchestration or multi-process workers
- Authentication / authorization
- Multi-socket conflict resolution
- Persistent API key storage (encrypted file)
- Mid-turn recovery after crash
