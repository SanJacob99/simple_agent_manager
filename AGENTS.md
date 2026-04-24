# AGENTS.md

## Project

Simple Agent Manager is a node-based visual AI agent builder. The React app lets users compose graphs on a canvas, resolve them into serializable `AgentConfig` JSON, and run them through a local Express + WebSocket backend.

Important current behavior:

- Interactive chat requires both a connected `contextEngine` node and a connected `storage` node.
- `src/runtime/` is browser-side support code. The actual agent runtime lives under `server/runtime/`.
- Some schema surfaces are ahead of product wiring. Verify `connectors`, `agentComm`, `vectorDatabase`, `cron`, and `mcp` behavior in code before documenting them as fully implemented.

## Architecture split

- `src/`: React UI, graph editor, chat drawer, settings workspace, browser-side clients, Zustand stores
- `shared/`: shared config/types, tool resolution, token estimation, and system prompt assembly
- `server/`: Express/WebSocket backend, agent manager, run coordinator, runtime engines, storage/session routing, hooks

## Key source files

| Purpose | File |
| --- | --- |
| Node type definitions | `src/types/nodes.ts` |
| Default node values | `src/utils/default-nodes.ts` |
| Graph-to-config resolution | `src/utils/graph-to-agent.ts` |
| Shared config interfaces | `shared/agent-config.ts` |
| Shared tool resolution | `shared/resolve-tool-names.ts` |
| Shared system prompt builder | `shared/system-prompt-builder.ts` |
| Browser storage/session client | `src/runtime/storage-client.ts` |
| Agent runtime | `server/runtime/agent-runtime.ts` |
| Memory engine | `server/runtime/memory-engine.ts` |
| Context engine | `server/runtime/context-engine.ts` |
| Tool factory | `server/tools/tool-factory.ts` |
| Tool adapter | `server/tools/tool-adapter.ts` |
| Built-in tools | `server/tools/builtins/` |
| Model resolver | `server/runtime/model-resolver.ts` |
| Storage engine | `server/storage/storage-engine.ts` |
| Session router | `server/sessions/session-router.ts` |
| Session transcript store | `server/sessions/session-transcript-store.ts` |
| Run coordination and queueing | `server/agents/run-coordinator.ts` |
| Hook lifecycle types | `server/hooks/hook-types.ts` |
| Node UI components | `src/nodes/` |
| Property editors | `src/panels/property-editors/` |
| Node registry | `src/nodes/node-registry.ts` |
| Graph store | `src/store/graph-store.ts` |
| Session store | `src/store/session-store.ts` |
| Agent connection store | `src/store/agent-connection-store.ts` |
| Model catalog store | `src/store/model-catalog-store.ts` |
| Settings store and sections | `src/settings/` |

## Current node types

The schema currently defines:

- `agent`
- `memory`
- `tools`
- `skills`
- `contextEngine`
- `agentComm`
- `connectors`
- `storage`
- `vectorDatabase`
- `cron`
- `provider`
- `mcp`

The default sidebar palette currently exposes all of the above except `cron`. Treat `cron` as partial/in-progress unless you confirm the entire execution path.

## Documentation maintenance

Concept docs live in `docs/concepts/` with one file per documented node type. The mapping is in `docs/concepts/_manifest.json`.

When you modify these areas, update the matching concept doc:

- `src/types/nodes.ts`: update the Configuration table for the affected node
- `src/utils/default-nodes.ts`: update documented defaults
- `src/utils/graph-to-agent.ts`: update how node config is resolved into `AgentConfig`
- `shared/agent-config.ts`: update resolved config shapes and terminology
- `shared/resolve-tool-names.ts`: update tool/profile/group resolution details
- `shared/system-prompt-builder.ts`: update prompt assembly behavior
- `server/runtime/*.ts`: update runtime behavior sections
- `server/agents/run-coordinator.ts`: update run lifecycle, queueing, and persistence behavior where relevant

Steps:

1. Read `docs/concepts/_manifest.json` to find the concept doc for the node you changed.
2. Update the relevant sections, such as Configuration, Defaults, Runtime Behavior, or Examples.
3. Update the `<!-- last-verified: YYYY-MM-DD -->` comment with today's date.
4. If you change `cron`, create `docs/concepts/cron-node.md` from `docs/concepts/_template.md` and add it to the manifest first. The schema includes `cron`, but the manifest does not yet.

## Conventions

- Node type keys use camelCase: `contextEngine`, `agentComm`, `vectorDatabase`
- `AgentConfig` in `shared/agent-config.ts` must remain serializable JSON
- Prefer `shared/agent-config.ts` over `src/runtime/agent-config.ts`; the `src/` file is only a compatibility re-export
- Runtime classes under `server/runtime/` must stay free of React dependencies
- All node data interfaces include a `[key: string]: unknown` index signature
- Peripheral nodes connect to agent nodes only, not to other peripheral nodes
- Tool resolution follows `profile -> groups -> enabledTools -> plugins` in `shared/resolve-tool-names.ts`
- `SkillsNode` entries and `ToolsNode.skills` are folded into system prompt content during `resolveAgentConfig()` and `buildSystemPrompt()`
- Shared types that must work on both client and server should live in `shared/`, even if that means duplicating lightweight type aliases instead of importing from `src/`
