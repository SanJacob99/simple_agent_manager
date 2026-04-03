# CLAUDE.md

## Project

Simple Agent Manager is a node-based visual AI agent builder using React 19, TypeScript, @xyflow/react, and pi-agent-core. Users drag nodes onto a canvas, connect them, configure properties, and chat with agents. See README.md for full overview.

## Key Source Files

| Purpose | File |
|---------|------|
| Node type definitions | `src/types/nodes.ts` |
| Default node values | `src/utils/default-nodes.ts` |
| Resolved config interfaces | `src/runtime/agent-config.ts` |
| Graph-to-config resolution | `src/utils/graph-to-agent.ts` |
| Agent runtime | `src/runtime/agent-runtime.ts` |
| Memory engine | `src/runtime/memory-engine.ts` |
| Context engine | `src/runtime/context-engine.ts` |
| Tool factory | `src/runtime/tool-factory.ts` |
| Model resolver | `src/runtime/model-resolver.ts` |
| Node UI components | `src/nodes/` |
| Property editors | `src/panels/property-editors/` |
| Node registry | `src/nodes/node-registry.ts` |
| Stores | `src/store/` (graph-store, agent-runtime-store, chat-store, session-store, model-catalog-store) |

## Documentation Maintenance

Concept docs live in `docs/concepts/` with one file per node type. The mapping is in `docs/concepts/_manifest.json`.

**When you modify any of these files, update the corresponding concept doc:**

- `src/types/nodes.ts` — update the Configuration table in the affected concept doc
- `src/utils/default-nodes.ts` — update default values in the Configuration table
- `src/runtime/*.ts` — update the Runtime Behavior section of the affected concept doc

**Steps:**
1. Read `docs/concepts/_manifest.json` to find the concept doc for the changed node type
2. Update the relevant sections (Configuration table, Runtime Behavior, etc.)
3. Update the `<!-- last-verified: YYYY-MM-DD -->` comment with today's date
4. If adding a new `NodeType`, create a new doc using `docs/concepts/_template.md` and add it to the manifest

## Conventions

- Node type keys use camelCase: `contextEngine`, `agentComm`, `vectorDatabase`
- `AgentConfig` is serializable JSON — no class instances, no functions
- Runtime classes (`AgentRuntime`, `MemoryEngine`, `ContextEngine`) have no React dependency
- All node data interfaces include a `[key: string]: unknown` index signature
- Peripheral nodes connect to agent nodes only (not to each other)
- Tools: profile → groups → enabledTools → plugins resolution chain in `resolveToolNames()`
- Skills from `SkillsNode` are injected as system prompt content during config resolution
