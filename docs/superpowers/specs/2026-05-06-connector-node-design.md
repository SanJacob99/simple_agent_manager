# Connector Node - Design Spec

**Date:** 2026-05-06
**Status:** Draft (pre-implementation)
**Branch:** `feat/connector-node`
**Supersedes:** stub scaffold in `src/types/nodes.ts#ConnectorsNodeData`, `shared/agent-config.ts#ResolvedConnectorConfig`, `src/utils/graph-to-agent.ts` (currently resolves but is unused at runtime), `src/panels/property-editors/ConnectorsProperties.tsx` (freeform key/value editor)

## 1. Purpose

Wire the Connector Node from inert scaffold into a working runtime feature. A connector is a curated, named integration ("GitHub", "Slack", "Linear", ...) that resolves into an MCP server config under the hood — modeled on Claude's Connectors UX, but tools surface through the existing in-app tool factory so the experience is independent of the LLM provider the agent runs on.

This fills a gap in the system: today the user can configure a raw MCP server via the MCP node, but there is no friendly catalog of "named integrations" and no path for the runtime to act on the existing connector node.

## 2. Non-goals (v1)

- OAuth flows of any kind (auth is API key / personal token, supplied via the server's environment)
- Additional catalog entries beyond GitHub
- A user-editable or remotely-fetched catalog
- In-app secret storage (tokens always live in process env, never in the graph file)
- Live connection-status indicator on the Connector node UI (deferred — MCP node already has the infra; reuse can come later)
- Touching, renaming, or deprecating the existing MCP node
- Preserving any data from the legacy `connectorType` / freeform `config` fields (no working runtime to lose)

## 3. Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Connector ↔ MCP relationship | **Connectors are curated MCP presets** | Mirrors Claude's Connectors model. Reuses existing MCP runtime end-to-end; no new server code. |
| `AgentConfig` resolved shape | **Drop `connectors[]`; fold into `mcps[]`** | One source of truth. The connector node's id becomes the `mcpNodeId`, so existing `mcp:status` events still correlate back to the node in the UI. |
| Credential model | **Env-var name only; secret read at resolution time** | Graph file never contains a token. Implementation reuses the MCP server's existing `env` field on `ResolvedMcpConfig`. |
| Catalog source | **Hardcoded in `shared/connectors/catalog.ts`** | v1 ships a single entry; no need for dynamic loading. |
| v1 catalog entry | **GitHub via the official GitHub MCP server** | Universally relatable. PAT-based auth is the simplest possible end-to-end path. |
| Migration of existing graphs | **Drop legacy fields; reset `connectorId` to `''`** | No real config existed; freeform `connectorType` strings don't map onto catalog IDs. |

## 4. Architecture

Two new pieces; no new runtime code.

1. **Catalog** — `shared/connectors/catalog.ts` defines a typed map `Record<string, ConnectorDefinition>`. Each definition declares: human label, description, MCP server template (transport + command/args/url), declared variables (e.g. `tokenEnvVar`), default tool prefix, and a `buildEnv` function that maps variable values into the MCP server's `env` map.
2. **Resolver** — inline in `src/utils/graph-to-agent.ts`, alongside the existing MCP block. Iterates connector nodes, looks up catalog entries, applies user variable overrides, and emits `ResolvedMcpConfig` entries appended to `mcps[]`.

The MCP runtime (`server/runtime/...`) handles spawn, tool registration, env injection, status events. None of that changes.

## 5. Schema changes

### 5.1 `src/types/nodes.ts#ConnectorsNodeData`

Replace:

```ts
export interface ConnectorsNodeData {
  [key: string]: unknown;
  type: 'connectors';
  label: string;
  connectorType: string;          // freeform, removed
  config: Record<string, string>; // freeform, removed
}
```

with:

```ts
export interface ConnectorsNodeData {
  [key: string]: unknown;
  type: 'connectors';
  label: string;
  /** Catalog ID, e.g. 'github'. Empty string means "not yet selected". */
  connectorId: string;
  /** Per-instance overrides for variables declared by the catalog entry.
   *  Keys are catalog-defined; values are strings (env var names, etc.). */
  config: Record<string, string>;
}
```

### 5.2 `shared/agent-config.ts`

- Drop the `ResolvedConnectorConfig` interface.
- Drop the `connectors: ResolvedConnectorConfig[]` field from `AgentConfig`.
- All test fixtures that initialize `connectors: []` are updated to remove the field.

### 5.3 Default node (`src/utils/default-nodes.ts`)

```ts
case 'connectors':
  return {
    type: 'connectors',
    label: 'Connector',
    connectorId: '',
    config: {},
  };
```

### 5.4 `validateAgentRuntimeGraph` (`src/utils/graph-to-agent.ts`)

Extend `AgentGraphValidationError['code']` with two new codes:

- `'unknown_connector'` — `connectorId` is set but not present in `CONNECTOR_CATALOG`.
- `'unselected_connector'` — `connectorId === ''` (default state, never picked).

The validator iterates connector nodes connected to the agent and pushes errors as appropriate. The error structure (`code`, `message`) matches the existing pattern.

## 6. Catalog v1

```ts
// shared/connectors/catalog.ts

import type { McpTransport } from '../agent-config';

export interface ConnectorVariable {
  key: string;          // e.g. 'tokenEnvVar'
  label: string;        // shown in the property editor
  default: string;      // default value
  description: string;  // help text
}

export interface ConnectorDefinition {
  id: string;
  label: string;
  description: string;
  mcp: {
    transport: McpTransport;
    command?: string;
    args?: string[];
    url?: string;
  };
  variables: ConnectorVariable[];
  toolPrefix: string;
  /** Maps resolved variable values into the MCP server's env map.
   *  Reads process.env to materialize the secret; the graph never sees it. */
  buildEnv(values: Record<string, string>): Record<string, string>;
}

export const CONNECTOR_CATALOG: Record<string, ConnectorDefinition> = {
  github: {
    id: 'github',
    label: 'GitHub',
    description: 'Read repos, search code, manage issues and PRs.',
    mcp: {
      transport: 'stdio',
      // Canonical package name is pinned at implementation time after
      // verifying the current official server (see Open questions §13).
      command: 'npx',
      args: ['-y', '<canonical-github-mcp-package>'],
    },
    variables: [
      {
        key: 'tokenEnvVar',
        label: 'Token environment variable',
        default: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        description: 'Name of the env var holding your GitHub personal access token.',
      },
    ],
    toolPrefix: 'github_',
    buildEnv(values) {
      const name = values.tokenEnvVar || 'GITHUB_PERSONAL_ACCESS_TOKEN';
      const token = process.env[name];
      return token ? { [name]: token } : {};
    },
  },
};
```

The token is read from `process.env` at resolution time. The graph file stores only the env-var *name*. If the env var is not set when resolution runs, `env` ends up empty and the MCP server will fail at spawn — surfaced through the existing MCP status events, not as a new error path.

## 7. UI

### 7.1 `src/panels/property-editors/ConnectorsProperties.tsx`

Replace the freeform key/value editor with:

- Label input (unchanged).
- Connector dropdown — populated from `Object.keys(CONNECTOR_CATALOG)`, value is `connectorId`. Empty option ("Pick a connector...") appears when `connectorId === ''`.
- Read-only description for the selected catalog entry.
- One labeled input per declared variable, defaulted from `variable.default`. Updates write to `data.config[variable.key]`.

No live status indicator in v1 (deferred per §2).

### 7.2 `src/nodes/ConnectorsNode.tsx`

No structural change. The icon, base node, and label rendering stay as-is.

## 8. Resolution flow

In `src/utils/graph-to-agent.ts`:

1. Existing MCP node collection runs as today (~line 392).
2. **New** connector collection: for each connector node connected to the agent:
   - Look up `CONNECTOR_CATALOG[node.data.connectorId]`. If `connectorId === ''` or unknown, the resolver **skips** the node — surfacing the problem is the validator's job (see §5.3a). The resolver does not throw on user-error inputs; it follows the existing pattern of using `throw new Error('unreachable')` only for type-narrowing impossibilities.
   - Materialize variable values: for each declared variable, take `data.config[variable.key] ?? variable.default`.
   - Call `definition.buildEnv(values)` to get the `env` map.
   - Emit a `ResolvedMcpConfig`:
     - `mcpNodeId` = connector node id (so `mcp:status` events correlate)
     - `label` = node's display label
     - `transport`, `command`, `args`, `url` from `definition.mcp` (with `args` and `url` defaulted to `[]` / `''` as needed)
     - `env` = output of `buildEnv`
     - `headers = {}`, `cwd = ''`
     - `toolPrefix` = `definition.toolPrefix`
     - `allowedTools = []` (no whitelist in v1)
     - `autoConnect = true`
3. Append the resulting entries to the same `mcps[]` already returned by the function.
4. Remove the existing connector block that produced `connectors[]` entries; that field no longer exists on `AgentConfig`.

The resolution function runs in the resolution pipeline that ends server-side, so `process.env` reads in `buildEnv` resolve against the SAM server process — the correct boundary. (Implementation step verifies this; if any client-side call site invokes the resolver expecting a final `AgentConfig`, that call site is the bug, not the design.)

## 9. Migration

On graph load (existing schema-versioning mechanism, if any; otherwise on first read of a connector node):

- If a node has the legacy `connectorType` field, drop it.
- If `connectorId` is missing, set it to `''`.
- Reset `config` to `{}` if it contains keys that aren't variables of any catalog entry (the old freeform values won't match new catalog keys anyway).

The property editor renders the empty dropdown when `connectorId === ''` and prompts the user to pick. No data is preserved because the previous shape had no working runtime to lose.

## 10. Documentation

Per CLAUDE.md "Documentation Maintenance":

- `docs/concepts/connector-node.md` — rewrite Configuration table (`connectorId`, `config`), rewrite Runtime Behavior section (now folds into `mcps[]`), update example to use `connectorId: 'github'`.
- Bump `<!-- last-verified: 2026-05-06 -->`.
- `docs/concepts/_manifest.json` — already lists connector-node, no manifest entry change.

## 11. Tests

All in existing test files, additive:

- **`src/utils/graph-to-agent.test.ts`** (file already exists):
  - Resolver: connector node with `connectorId: 'github'` and `tokenEnvVar` set, with the env var present in `process.env`, resolves into a `ResolvedMcpConfig` in `mcps[]` with the expected `command`, `args`, `env`, `toolPrefix`, and `mcpNodeId`.
  - Resolver: same node with the env var **absent** → `env` is empty; resolution still succeeds (failure is the MCP server's job at spawn).
  - Resolver: unknown `connectorId` → node is skipped; not in `mcps[]`.
  - Resolver: empty `connectorId` (default state) → node is skipped; not in `mcps[]`.
  - Validator: unknown `connectorId` → `validateAgentRuntimeGraph` returns an `unknown_connector` error.
  - Validator: empty `connectorId` → `validateAgentRuntimeGraph` returns an `unselected_connector` error.
- **Migration test** — a graph fixture with the legacy `connectorType` field loads without crashing and produces a node with `connectorId: ''`.
- All existing test fixtures that build an `AgentConfig` literal — drop `connectors: []` (now an unknown property).

End-to-end verification against a real running GitHub MCP server is verification work, executed manually during implementation, not a unit test.

## 12. Files touched (estimated)

**Modified:**
- `src/types/nodes.ts` — `ConnectorsNodeData` shape
- `src/utils/default-nodes.ts` — connector default
- `src/utils/graph-to-agent.ts` — resolver: drop `connectors[]`, append to `mcps[]`
- `src/panels/property-editors/ConnectorsProperties.tsx` — full rewrite (catalog dropdown + variable inputs)
- `shared/agent-config.ts` — remove `ResolvedConnectorConfig`, remove `connectors` field
- `docs/concepts/connector-node.md` — rewrite per §10
- ~10 test files referencing `connectors: []` in `AgentConfig` literals — drop the field

**Added:**
- `shared/connectors/catalog.ts` — `ConnectorDefinition`, `ConnectorVariable`, `CONNECTOR_CATALOG`

**Untouched (explicit):**
- `src/nodes/ConnectorsNode.tsx`
- All `server/runtime/*.ts` files
- All MCP node files

## 13. Open questions (resolved at implementation time)

- **Canonical GitHub MCP package.** The npm `@modelcontextprotocol/server-github` package was deprecated in favor of a Go-based `github/github-mcp-server`. The implementation step picks the current canonical server (preferring stdio+npx for portability) and pins the package/binary in `CONNECTOR_CATALOG.github.mcp`. This is a docs-research step, not a design decision.
- **Where exactly resolution executes today.** §8 assumes resolution ends server-side so `process.env` reads work. The implementation step verifies this by tracing call sites of the resolver; if any caller is purely client-side, the secret read moves to a server-side post-step (still no schema change).
