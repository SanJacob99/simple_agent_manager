# Connector Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Connector Node from inert scaffold into a working runtime feature by introducing a curated catalog (`shared/connectors/catalog.ts`) whose entries fold into the existing MCP runtime. v1 ships exactly one entry — GitHub via stdio MCP, authenticated by an env-var-named personal access token.

**Architecture:** A connector is a curated MCP preset. The catalog maps `connectorId` → `ConnectorDefinition` (server template + declared variables + `buildEnv`). At graph resolution, each connector node is folded into `AgentConfig.mcps[]` as a `ResolvedMcpConfig` with the connector node's id as `mcpNodeId`. The legacy `connectors[]` field on `AgentConfig` and `ResolvedConnectorConfig` interface go away. The MCP runtime, server-side spawn, and tool factory are untouched.

**Tech Stack:** TypeScript, React 19, Zustand (graph store), Vitest (colocated tests), `@xyflow/react` (canvas), MCP via existing `server/runtime/...`.

**Spec:** `docs/superpowers/specs/2026-05-06-connector-node-design.md`

---

## File Structure

**Created:**
- `shared/connectors/catalog.ts` — `ConnectorDefinition`, `ConnectorVariable`, `CONNECTOR_CATALOG` constant. Pure data + `buildEnv` reading `process.env`.
- `shared/connectors/catalog.test.ts` — unit tests for the catalog and `buildEnv`.

**Modified:**
- `src/types/nodes.ts` — replace `ConnectorsNodeData` shape (`connectorType` → `connectorId`).
- `shared/agent-config.ts` — drop `ResolvedConnectorConfig` interface and the `connectors` field on `AgentConfig`.
- `src/utils/default-nodes.ts` — new connector default (`connectorId: ''`, no `connectorType`).
- `src/utils/graph-to-agent.ts` — drop the `connectors` collection block; add a connectors→`mcps[]` fold; add validator codes.
- `src/utils/graph-to-agent.test.ts` — add resolver and validator tests.
- `src/panels/property-editors/ConnectorsProperties.tsx` — full rewrite (catalog dropdown + per-variable inputs).
- `docs/concepts/connector-node.md` — rewrite Configuration / Runtime Behavior / Example to match new schema.
- ~10 test/fixture files referencing `connectors: []` in `AgentConfig` literals — drop the line.

**Untouched (explicit):**
- `src/nodes/ConnectorsNode.tsx` (icon/base node only — no shape change).
- All `server/runtime/*.ts` files.
- All MCP node files.

---

## Task 1: Catalog module + verify GitHub MCP server invocation

**Files:**
- Create: `shared/connectors/catalog.ts`
- Test: `shared/connectors/catalog.test.ts`

This task is self-contained and lands a working catalog with exactly one entry, plus its tests, before any schema changes break the codebase. The implementer first **verifies** which GitHub MCP package/binary is canonical *today* and pins it.

- [ ] **Step 1: Verify the canonical GitHub MCP server invocation**

In a scratch terminal, set a real GitHub PAT and try the historical npm package:

```bash
export GITHUB_PERSONAL_ACCESS_TOKEN=ghp_yourtokenhere
npx -y @modelcontextprotocol/server-github
```

Observe stderr. Three possible outcomes:

1. Server starts and prints something like `GitHub MCP Server running on stdio`. Pin `command: 'npx'`, `args: ['-y', '@modelcontextprotocol/server-github']`.
2. Server prints a deprecation notice pointing at a successor package (e.g., `@github/github-mcp`, `@modelcontextprotocol/server-github-v2`, etc.). Pin the successor's stdio invocation.
3. Package is gone entirely. Fall back to the official Go binary `github-mcp-server` (https://github.com/github/github-mcp-server) using its `stdio` mode and pin `command: 'github-mcp-server'`, `args: ['stdio']` (assumes the binary is on PATH).

Whichever route works, **record the exact `command` and `args`** before writing the test. The plan below uses `'@modelcontextprotocol/server-github'` as the placeholder; substitute the verified value.

- [ ] **Step 2: Write the failing catalog test**

Create `shared/connectors/catalog.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { CONNECTOR_CATALOG } from './catalog';

describe('CONNECTOR_CATALOG', () => {
  it('contains the github entry with the verified stdio invocation', () => {
    const github = CONNECTOR_CATALOG.github;
    expect(github).toBeDefined();
    expect(github.id).toBe('github');
    expect(github.label).toBe('GitHub');
    expect(github.mcp.transport).toBe('stdio');
    expect(github.mcp.command).toBe('npx');
    expect(github.mcp.args).toEqual(['-y', '@modelcontextprotocol/server-github']);
    expect(github.toolPrefix).toBe('github_');
  });

  it('declares a tokenEnvVar variable with sensible defaults', () => {
    const github = CONNECTOR_CATALOG.github;
    expect(github.variables).toHaveLength(1);
    const tokenVar = github.variables[0];
    expect(tokenVar.key).toBe('tokenEnvVar');
    expect(tokenVar.default).toBe('GITHUB_PERSONAL_ACCESS_TOKEN');
  });
});

describe('CONNECTOR_CATALOG.github.buildEnv', () => {
  const ORIGINAL_ENV = process.env;

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns the token env entry when the named env var is set', () => {
    process.env = { ...ORIGINAL_ENV, GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_abc123' };
    const env = CONNECTOR_CATALOG.github.buildEnv({ tokenEnvVar: 'GITHUB_PERSONAL_ACCESS_TOKEN' });
    expect(env).toEqual({ GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_abc123' });
  });

  it('returns an empty env when the named env var is not set', () => {
    const env = { ...ORIGINAL_ENV };
    delete env.GITHUB_PERSONAL_ACCESS_TOKEN;
    delete env.MISSING_TOKEN_VAR;
    process.env = env;
    const result = CONNECTOR_CATALOG.github.buildEnv({ tokenEnvVar: 'MISSING_TOKEN_VAR' });
    expect(result).toEqual({});
  });

  it('falls back to GITHUB_PERSONAL_ACCESS_TOKEN when tokenEnvVar value is empty', () => {
    process.env = { ...ORIGINAL_ENV, GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_default' };
    const result = CONNECTOR_CATALOG.github.buildEnv({ tokenEnvVar: '' });
    expect(result).toEqual({ GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_default' });
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

```bash
npm run test:run -- shared/connectors/catalog.test.ts
```

Expected: failure with `Cannot find module './catalog'` or similar.

- [ ] **Step 4: Implement the catalog module**

Create `shared/connectors/catalog.ts`:

```ts
import type { McpTransport } from '../agent-config';

export interface ConnectorVariable {
  /** Stable key, e.g. 'tokenEnvVar'. Used as a key in the connector node's `config` map. */
  key: string;
  /** Label shown in the property editor. */
  label: string;
  /** Default value when the user has not set this variable. */
  default: string;
  /** Help text shown next to the input. */
  description: string;
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
  /** Tool name prefix passed through to the MCP runtime. */
  toolPrefix: string;
  /**
   * Map resolved variable values into the MCP server's env map. Reads
   * `process.env` to materialize the secret; the graph file never contains it.
   */
  buildEnv(values: Record<string, string>): Record<string, string>;
}

export const CONNECTOR_CATALOG: Record<string, ConnectorDefinition> = {
  github: {
    id: 'github',
    label: 'GitHub',
    description: 'Read repos, search code, manage issues and PRs.',
    mcp: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
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

If Step 1 verified a different package or binary, substitute the verified `command` / `args` here **and** update the test from Step 2 to match.

- [ ] **Step 5: Run the test to confirm it passes**

```bash
npm run test:run -- shared/connectors/catalog.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add shared/connectors/catalog.ts shared/connectors/catalog.test.ts
git commit -m "feat(connectors): add catalog module with GitHub entry"
```

---

## Task 2: Schema migration + fixture cleanup

This task is mechanical, atomic, and intentionally large: drop `connectors[]` and `ResolvedConnectorConfig` everywhere they appear, replace `ConnectorsNodeData`, update the default. After this task the resolver no longer collects connectors at all (Task 3 reintroduces them via the `mcps[]` fold).

**Files:**
- Modify: `src/types/nodes.ts`
- Modify: `shared/agent-config.ts`
- Modify: `src/utils/default-nodes.ts`
- Modify: `src/utils/graph-to-agent.ts`
- Modify: 10 fixture files listed below

- [ ] **Step 1: Replace `ConnectorsNodeData` in `src/types/nodes.ts`**

Find the block at `src/types/nodes.ts` around line 305:

```ts
// --- Connectors Node ---

export interface ConnectorsNodeData {
  [key: string]: unknown;
  type: 'connectors';
  label: string;
  connectorType: string;
  config: Record<string, string>;
}
```

Replace with:

```ts
// --- Connectors Node ---

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

- [ ] **Step 2: Drop `ResolvedConnectorConfig` and the `connectors` field in `shared/agent-config.ts`**

In `shared/agent-config.ts` around line 303, delete the entire `ResolvedConnectorConfig` interface:

```ts
export interface ResolvedConnectorConfig {
  label: string;
  connectorType: string;
  config: Record<string, string>;
}
```

In the same file around line 151, remove the line:

```ts
connectors: ResolvedConnectorConfig[];
```

from the `AgentConfig` interface.

- [ ] **Step 3: Update `src/utils/default-nodes.ts`**

Find the block around line 158:

```ts
case 'connectors':
  return {
    type: 'connectors',
    label: 'Connector',
    connectorType: 'rest-api',
    config: {},
  };
```

Replace with:

```ts
case 'connectors':
  return {
    type: 'connectors',
    label: 'Connector',
    connectorId: '',
    config: {},
  };
```

- [ ] **Step 4: Drop the connectors block from `src/utils/graph-to-agent.ts`**

In `src/utils/graph-to-agent.ts` around lines 293–303, delete the block:

```ts
// --- Connectors ---
const connectors = connectedNodes
  .filter((n) => n.data.type === 'connectors')
  .map((n) => {
    if (n.data.type !== 'connectors') throw new Error('unreachable');
    return {
      label: n.data.label,
      connectorType: n.data.connectorType,
      config: n.data.config,
    };
  });
```

Then in the same file, delete the `connectors,` line from the returned object (around line 565). After deletion the surrounding return-object lines should be:

```ts
contextEngine,
agentComm,
storage,
```

(no `connectors,` between `contextEngine` and `agentComm`).

Also remove the now-unused `ResolvedConnectorConfig` import if it appears in this file (it does not currently — verify).

- [ ] **Step 5: Drop `connectors: []` from existing fixtures**

The following 9 files initialize `AgentConfig` literals with `connectors: []`. Remove that line from each:

- `server/sam-agent/sam-agent-config.ts`
- `server/runtime/agent-runtime.test.ts`
- `server/comms/agent-comm-integration.test.ts`
- `server/agents/run-coordinator.test.ts`
- `server/agents/agent-manager.test.ts`
- `server/sessions/session-tools.test.ts`
- `server/agents/sub-agent-executor.ts`
- `server/agents/sub-agent-executor.test.ts`
- `server/agents/stream-processor.test.ts`
- `server/agents/openrouter.integration.test.ts`
- `server/runtime/resolve-system-prompt.test.ts`

Recipe per file: search for `connectors: [],` and delete the matching line. The line is always inside an object literal that builds a synthetic `AgentConfig`.

To find them all in one shot:

```bash
npm run test:run -- --reporter=basic 2>&1 | head -50
```

…will fail with TS errors at each remaining occurrence after Step 2. Faster: grep the codebase first.

```bash
```

Use the editor's project-wide find/replace or Edit tool calls per file.

- [ ] **Step 6: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors. If there are errors, they are almost certainly fixture sites missed in Step 5 — fix them and re-run.

- [ ] **Step 7: Run the full test suite to confirm green**

```bash
npm run test:run
```

Expected: all tests pass. The connector-related tests (Task 1) still pass; nothing else regresses because the connector node had no working runtime behavior to break.

- [ ] **Step 8: Commit**

```bash
git add src/types/nodes.ts shared/agent-config.ts src/utils/default-nodes.ts src/utils/graph-to-agent.ts server/ shared/
git commit -m "refactor(connectors): drop ResolvedConnectorConfig and connectors[] field"
```

---

## Task 3: Resolver fold — connectors become MCP entries

**Files:**
- Modify: `src/utils/graph-to-agent.ts`
- Test: `src/utils/graph-to-agent.test.ts`

- [ ] **Step 1: Write the failing resolver test**

Append to `src/utils/graph-to-agent.test.ts`:

```ts
import { CONNECTOR_CATALOG } from '../../shared/connectors/catalog';

describe('resolveAgentConfig — connectors fold into mcps[]', () => {
  const ORIGINAL_ENV = process.env;
  afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

  function agentNode() {
    return {
      id: 'agent-1',
      type: 'agent',
      position: { x: 0, y: 0 },
      data: {
        type: 'agent',
        name: 'Agent',
        nameConfirmed: true,
        systemPrompt: 'Test',
        systemPromptMode: 'manual' as const,
        modelId: 'claude-sonnet-4-20250514',
        thinkingLevel: 'off',
        description: '',
        tags: [],
        modelCapabilities: {},
      },
    };
  }

  it('resolves a connector node with connectorId=github into mcps[]', () => {
    process.env = { ...ORIGINAL_ENV, GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_test' };
    const config = resolveAgentConfig(
      'agent-1',
      [
        agentNode(),
        {
          id: 'conn-1',
          type: 'connectors',
          position: { x: -200, y: 0 },
          data: {
            type: 'connectors',
            label: 'My GitHub',
            connectorId: 'github',
            config: { tokenEnvVar: 'GITHUB_PERSONAL_ACCESS_TOKEN' },
          },
        },
      ] as any,
      [{ id: 'e1', source: 'conn-1', target: 'agent-1', type: 'data' }] as any,
    );

    expect(config?.mcps).toHaveLength(1);
    const mcp = config!.mcps[0];
    expect(mcp.mcpNodeId).toBe('conn-1');
    expect(mcp.label).toBe('My GitHub');
    expect(mcp.transport).toBe('stdio');
    expect(mcp.command).toBe(CONNECTOR_CATALOG.github.mcp.command);
    expect(mcp.args).toEqual(CONNECTOR_CATALOG.github.mcp.args);
    expect(mcp.env).toEqual({ GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_test' });
    expect(mcp.toolPrefix).toBe('github_');
    expect(mcp.autoConnect).toBe(true);
    expect(mcp.allowedTools).toEqual([]);
    expect(mcp.cwd).toBe('');
    expect(mcp.headers).toEqual({});
    expect(mcp.url).toBe('');
  });

  it('skips a connector node when connectorId is empty', () => {
    const config = resolveAgentConfig(
      'agent-1',
      [
        agentNode(),
        {
          id: 'conn-1',
          type: 'connectors',
          position: { x: -200, y: 0 },
          data: { type: 'connectors', label: 'Empty', connectorId: '', config: {} },
        },
      ] as any,
      [{ id: 'e1', source: 'conn-1', target: 'agent-1', type: 'data' }] as any,
    );
    expect(config?.mcps).toHaveLength(0);
  });

  it('skips a connector node when connectorId is unknown', () => {
    const config = resolveAgentConfig(
      'agent-1',
      [
        agentNode(),
        {
          id: 'conn-1',
          type: 'connectors',
          position: { x: -200, y: 0 },
          data: { type: 'connectors', label: 'Bogus', connectorId: 'does-not-exist', config: {} },
        },
      ] as any,
      [{ id: 'e1', source: 'conn-1', target: 'agent-1', type: 'data' }] as any,
    );
    expect(config?.mcps).toHaveLength(0);
  });

  it('coexists with an MCP node — both end up in mcps[]', () => {
    process.env = { ...ORIGINAL_ENV, GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_test' };
    const config = resolveAgentConfig(
      'agent-1',
      [
        agentNode(),
        {
          id: 'conn-1',
          type: 'connectors',
          position: { x: -200, y: 0 },
          data: {
            type: 'connectors',
            label: 'GH',
            connectorId: 'github',
            config: { tokenEnvVar: 'GITHUB_PERSONAL_ACCESS_TOKEN' },
          },
        },
        {
          id: 'mcp-1',
          type: 'mcp',
          position: { x: -200, y: 200 },
          data: {
            type: 'mcp',
            label: 'Custom',
            transport: 'stdio',
            command: 'node',
            args: ['custom.js'],
            env: {},
            cwd: '',
            url: '',
            headers: {},
            toolPrefix: 'custom_',
            allowedTools: [],
            autoConnect: true,
          },
        },
      ] as any,
      [
        { id: 'e1', source: 'conn-1', target: 'agent-1', type: 'data' },
        { id: 'e2', source: 'mcp-1', target: 'agent-1', type: 'data' },
      ] as any,
    );
    const ids = (config?.mcps ?? []).map((m) => m.mcpNodeId).sort();
    expect(ids).toEqual(['conn-1', 'mcp-1']);
  });
});
```

Add the `afterEach` import at the top of the file if it isn't already imported (the existing import is `import { describe, expect, it } from 'vitest';` — change to include `afterEach`).

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm run test:run -- src/utils/graph-to-agent.test.ts
```

Expected: 4 new tests fail because connectors aren't folded into `mcps[]` yet.

- [ ] **Step 3: Implement the connectors→mcps fold**

In `src/utils/graph-to-agent.ts`, find the existing MCP block around line 396:

```ts
// --- MCP Servers ---
const mcps = connectedNodes
  .filter((n) => n.data.type === 'mcp')
  .map((n) => {
    if (n.data.type !== 'mcp') throw new Error('unreachable');
    return {
      mcpNodeId: n.id,
      label: n.data.label,
      transport: n.data.transport,
      command: n.data.command,
      args: n.data.args,
      env: n.data.env,
      cwd: n.data.cwd,
      url: n.data.url,
      headers: n.data.headers,
      toolPrefix: n.data.toolPrefix,
      allowedTools: n.data.allowedTools,
      autoConnect: n.data.autoConnect,
    };
  });
```

Replace with:

```ts
// --- MCP Servers ---
const mcpsFromMcpNodes: ResolvedMcpConfig[] = connectedNodes
  .filter((n) => n.data.type === 'mcp')
  .map((n) => {
    if (n.data.type !== 'mcp') throw new Error('unreachable');
    return {
      mcpNodeId: n.id,
      label: n.data.label,
      transport: n.data.transport,
      command: n.data.command,
      args: n.data.args,
      env: n.data.env,
      cwd: n.data.cwd,
      url: n.data.url,
      headers: n.data.headers,
      toolPrefix: n.data.toolPrefix,
      allowedTools: n.data.allowedTools,
      autoConnect: n.data.autoConnect,
    };
  });

// --- Connectors (fold into MCP) ---
// Each connector node is a curated MCP preset. The catalog entry supplies
// the server template and a buildEnv() that materializes secrets from
// process.env at resolve time. Unknown / unselected connectorIds are
// skipped here; they are surfaced separately by validateAgentRuntimeGraph.
const mcpsFromConnectors: ResolvedMcpConfig[] = [];
for (const n of connectedNodes) {
  if (n.data.type !== 'connectors') continue;
  const def = CONNECTOR_CATALOG[n.data.connectorId];
  if (!def) continue;
  const values: Record<string, string> = {};
  for (const v of def.variables) {
    values[v.key] = (n.data.config?.[v.key] ?? v.default);
  }
  mcpsFromConnectors.push({
    mcpNodeId: n.id,
    label: n.data.label,
    transport: def.mcp.transport,
    command: def.mcp.command ?? '',
    args: def.mcp.args ?? [],
    env: def.buildEnv(values),
    cwd: '',
    url: def.mcp.url ?? '',
    headers: {},
    toolPrefix: def.toolPrefix,
    allowedTools: [],
    autoConnect: true,
  });
}

const mcps = [...mcpsFromMcpNodes, ...mcpsFromConnectors];
```

Add the import at the top of the file (alongside other shared/ imports):

```ts
import { CONNECTOR_CATALOG } from '../../shared/connectors/catalog';
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npm run test:run -- src/utils/graph-to-agent.test.ts
```

Expected: all tests pass (existing storage/agent tests + 4 new connector tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/graph-to-agent.ts src/utils/graph-to-agent.test.ts
git commit -m "feat(connectors): fold connector nodes into AgentConfig.mcps via catalog"
```

---

## Task 4: Validator surfaces unselected and unknown connectorIds

**Files:**
- Modify: `src/utils/graph-to-agent.ts`
- Test: `src/utils/graph-to-agent.test.ts`

- [ ] **Step 1: Write the failing validator test**

Append to `src/utils/graph-to-agent.test.ts`:

```ts
describe('validateAgentRuntimeGraph — connector validation', () => {
  function providerNodeFor(agentId: string) {
    // Provider is required by validateAgentRuntimeGraph; without it every
    // call returns a missing_provider error and shadows our connector errors.
    return {
      id: 'prov-1',
      type: 'provider',
      position: { x: 0, y: 200 },
      data: { type: 'provider', label: 'Provider', pluginId: 'anthropic' },
    };
  }

  function agentNode() {
    return {
      id: 'agent-1',
      type: 'agent',
      position: { x: 0, y: 0 },
      data: {
        type: 'agent', name: 'A', nameConfirmed: true,
        systemPrompt: '', systemPromptMode: 'manual' as const,
        modelId: 'm', thinkingLevel: 'off',
        description: '', tags: [], modelCapabilities: {},
      },
    };
  }

  it('returns unselected_connector when connectorId is empty', () => {
    const errors = validateAgentRuntimeGraph(
      'agent-1',
      [
        agentNode(),
        providerNodeFor('agent-1'),
        {
          id: 'conn-1', type: 'connectors', position: { x: 0, y: 0 },
          data: { type: 'connectors', label: 'X', connectorId: '', config: {} },
        },
      ] as any,
      [
        { id: 'e1', source: 'prov-1', target: 'agent-1', type: 'data' },
        { id: 'e2', source: 'conn-1', target: 'agent-1', type: 'data' },
      ] as any,
    );
    expect(errors.find((e) => e.code === 'unselected_connector')).toBeDefined();
  });

  it('returns unknown_connector when connectorId is not in the catalog', () => {
    const errors = validateAgentRuntimeGraph(
      'agent-1',
      [
        agentNode(),
        providerNodeFor('agent-1'),
        {
          id: 'conn-1', type: 'connectors', position: { x: 0, y: 0 },
          data: { type: 'connectors', label: 'X', connectorId: 'nope', config: {} },
        },
      ] as any,
      [
        { id: 'e1', source: 'prov-1', target: 'agent-1', type: 'data' },
        { id: 'e2', source: 'conn-1', target: 'agent-1', type: 'data' },
      ] as any,
    );
    expect(errors.find((e) => e.code === 'unknown_connector')).toBeDefined();
  });

  it('returns no connector errors when connectorId is in the catalog', () => {
    const errors = validateAgentRuntimeGraph(
      'agent-1',
      [
        agentNode(),
        providerNodeFor('agent-1'),
        {
          id: 'conn-1', type: 'connectors', position: { x: 0, y: 0 },
          data: { type: 'connectors', label: 'GH', connectorId: 'github', config: {} },
        },
      ] as any,
      [
        { id: 'e1', source: 'prov-1', target: 'agent-1', type: 'data' },
        { id: 'e2', source: 'conn-1', target: 'agent-1', type: 'data' },
      ] as any,
    );
    expect(errors.find((e) => e.code === 'unknown_connector')).toBeUndefined();
    expect(errors.find((e) => e.code === 'unselected_connector')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm run test:run -- src/utils/graph-to-agent.test.ts
```

Expected: the two error-finding tests fail because `validateAgentRuntimeGraph` does not yet emit those codes.

- [ ] **Step 3: Extend `AgentGraphValidationError` and validator**

In `src/utils/graph-to-agent.ts` around line 717, change:

```ts
export interface AgentGraphValidationError {
  code: 'missing_provider' | 'duplicate_provider' | 'empty_plugin_id';
  message: string;
}
```

to:

```ts
export interface AgentGraphValidationError {
  code:
    | 'missing_provider'
    | 'duplicate_provider'
    | 'empty_plugin_id'
    | 'unselected_connector'
    | 'unknown_connector';
  message: string;
}
```

Then in the same `validateAgentRuntimeGraph` function (just before the `return errors;`), insert the connector validation block:

```ts
  for (const n of connectedNodes) {
    if (n.data.type !== 'connectors') continue;
    if (!n.data.connectorId) {
      errors.push({
        code: 'unselected_connector',
        message: `Connector node "${n.data.label}" has no connector selected.`,
      });
    } else if (!CONNECTOR_CATALOG[n.data.connectorId]) {
      errors.push({
        code: 'unknown_connector',
        message: `Connector node "${n.data.label}" references unknown connector "${n.data.connectorId}".`,
      });
    }
  }
```

The `CONNECTOR_CATALOG` import was added in Task 3 — no new import needed.

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npm run test:run -- src/utils/graph-to-agent.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/graph-to-agent.ts src/utils/graph-to-agent.test.ts
git commit -m "feat(connectors): validator surfaces unselected/unknown connectorId"
```

---

## Task 5: Property editor rewrite

**Files:**
- Modify: `src/panels/property-editors/ConnectorsProperties.tsx`

This task is a UI rewrite, not strict TDD. Property editors in this codebase don't have unit tests (verify by globbing — none of the other `*Properties.tsx` files have `.test.tsx` siblings). Verification is manual via the running app.

- [ ] **Step 1: Replace the file contents**

Replace the entire contents of `src/panels/property-editors/ConnectorsProperties.tsx` with:

```tsx
import { useGraphStore } from '../../store/graph-store';
import type { ConnectorsNodeData } from '../../types/nodes';
import { CONNECTOR_CATALOG } from '../../../shared/connectors/catalog';
import { Field, inputClass, selectClass } from './shared';

interface Props {
  nodeId: string;
  data: ConnectorsNodeData;
}

const CATALOG_IDS = Object.keys(CONNECTOR_CATALOG);

export default function ConnectorsProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);
  const definition = data.connectorId ? CONNECTOR_CATALOG[data.connectorId] : undefined;

  return (
    <div className="space-y-1">
      <Field label="Label">
        <input
          className={inputClass}
          value={data.label}
          onChange={(e) => update(nodeId, { label: e.target.value })}
        />
      </Field>

      <Field label="Connector">
        <select
          className={selectClass}
          value={data.connectorId}
          onChange={(e) => update(nodeId, { connectorId: e.target.value })}
        >
          <option value="">Pick a connector...</option>
          {CATALOG_IDS.map((id) => (
            <option key={id} value={id}>
              {CONNECTOR_CATALOG[id].label}
            </option>
          ))}
        </select>
      </Field>

      {definition && (
        <>
          <p className="text-xs text-slate-400 px-1">{definition.description}</p>
          {definition.variables.map((v) => (
            <Field key={v.key} label={v.label}>
              <input
                className={inputClass}
                value={data.config?.[v.key] ?? ''}
                placeholder={v.default}
                onChange={(e) =>
                  update(nodeId, {
                    config: { ...data.config, [v.key]: e.target.value },
                  })
                }
              />
              <p className="text-[10px] text-slate-500 mt-0.5">{v.description}</p>
            </Field>
          ))}
        </>
      )}

      {data.connectorId && !definition && (
        <p className="text-xs text-amber-400 px-1">
          Unknown connector id: <code>{data.connectorId}</code>. Pick one from the list.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Manual smoke test**

```bash
npm run dev
```

In the browser:
1. Drop a Connector node onto the canvas.
2. Open the Properties panel.
3. Confirm the dropdown shows "Pick a connector..." and "GitHub".
4. Pick "GitHub". Confirm the description appears and a "Token environment variable" input appears with placeholder `GITHUB_PERSONAL_ACCESS_TOKEN`.
5. Type a different env var name; confirm it persists across canvas re-renders.

Stop the dev server (Ctrl+C in the terminal) before continuing.

- [ ] **Step 4: Commit**

```bash
git add src/panels/property-editors/ConnectorsProperties.tsx
git commit -m "feat(connectors): catalog-driven property editor"
```

---

## Task 6: Documentation

**Files:**
- Modify: `docs/concepts/connector-node.md`

- [ ] **Step 1: Replace the file contents**

Replace the contents of `docs/concepts/connector-node.md` with:

```markdown
# Connector Node

> Attaches a curated external integration to an agent — a named entry from the connector catalog that resolves into an MCP server under the hood.

<!-- source: src/types/nodes.ts#ConnectorsNodeData -->
<!-- last-verified: 2026-05-06 -->

## Overview

The Connector Node is a curated MCP preset. Each connector is a named entry in the catalog (`shared/connectors/catalog.ts`) that knows how to launch a specific MCP server, what variables the user needs to provide, and where to read secrets from. The user picks an entry by `connectorId` (currently: `github`) and the runtime translates the node into a `ResolvedMcpConfig` appended to `AgentConfig.mcps[]`.

This is distinct from the MCP node, which lets power users wire arbitrary MCP servers directly. Both kinds of nodes coexist and end up in the same `mcps[]` collection at runtime.

Multiple Connector Nodes can connect to a single agent — each one launches its own MCP server.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Connector"` | Display label on the canvas (also passed through to MCP `label`). |
| `connectorId` | `string` | `""` | Catalog ID. Empty means "not yet selected"; surfaces a validation error. |
| `config` | `Record<string, string>` | `{}` | Per-instance overrides for variables declared by the catalog entry. Keys are catalog-defined (e.g. `tokenEnvVar`). |

Defaults come from `src/utils/default-nodes.ts`.

## Runtime Behavior

During config resolution (`src/utils/graph-to-agent.ts`), each connector node connected to the agent is:

1. Looked up in `CONNECTOR_CATALOG` by `connectorId`. Unknown / empty IDs are skipped here and surfaced separately by `validateAgentRuntimeGraph` as `unknown_connector` / `unselected_connector` errors.
2. Materialized into a `ResolvedMcpConfig`:
   - `mcpNodeId` = the connector node's id.
   - `transport`, `command`, `args`, `url` = the catalog entry's `mcp` template.
   - `env` = output of the catalog entry's `buildEnv(values)` — typically reads a token from `process.env` and returns `{ <ENV_VAR_NAME>: <token> }`. Secrets are never persisted in the graph file.
   - `toolPrefix` = the catalog entry's `toolPrefix` (e.g. `github_`).
   - `allowedTools` = `[]` (no whitelist).
   - `autoConnect` = `true`.
3. Appended to the same `mcps[]` the MCP node populates. The MCP runtime under `server/runtime/...` handles spawn, tool registration, and `mcp:status` events.

The connector node has no live connection-status indicator yet.

## Catalog (v1)

| ID | Description | Variables |
|----|-------------|-----------|
| `github` | Read repos, search code, manage issues and PRs. | `tokenEnvVar` (default `GITHUB_PERSONAL_ACCESS_TOKEN`) |

To use the GitHub connector, set the env var on the SAM server process before starting it:

```bash
export GITHUB_PERSONAL_ACCESS_TOKEN=ghp_...
npm run dev
```

## Connections

- **Sends to**: Agent Node
- **Receives from**: None
- Multiple Connector Nodes can connect to the same agent.

## Example

```json
{
  "type": "connectors",
  "label": "My GitHub",
  "connectorId": "github",
  "config": {
    "tokenEnvVar": "GITHUB_PERSONAL_ACCESS_TOKEN"
  }
}
```
```

- [ ] **Step 2: Commit**

```bash
git add docs/concepts/connector-node.md
git commit -m "docs(connector-node): document catalog model and v1 GitHub entry"
```

---

## Task 7: End-to-end smoke verification

**Files:** none modified.

This task confirms the GitHub MCP server actually starts, registers tools, and the agent can call them. It is verification, not code.

- [ ] **Step 1: Set the token in the server's environment**

```bash
export GITHUB_PERSONAL_ACCESS_TOKEN=ghp_yourrealtokenhere
```

Use a token with at least `public_repo` scope so simple read calls succeed.

- [ ] **Step 2: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 3: Build a test graph in the canvas**

In the browser:
1. Drop an Agent node, a Provider node (configure with any provider you have credentials for), and a Connector node.
2. Connect Provider → Agent and Connector → Agent.
3. Open the Connector node's properties; pick "GitHub". Leave the env var name at its default.
4. Open the chat drawer and send: `Use a github tool to fetch information about the octocat/hello-world repo.`

- [ ] **Step 4: Confirm tool registration in server logs**

Watch the dev server's stderr. You should see:
- An MCP spawn line for the connector node id.
- `mcp:status connected` (or equivalent) for that node id.
- The agent's tool list includes entries prefixed with `github_`.

If the spawn fails ("ENOENT npx", "package not found", etc.), the catalog entry's `command` / `args` are stale — go back to Task 1 Step 1, re-verify the canonical package, and update the catalog.

- [ ] **Step 5: Confirm the agent successfully calls a github tool**

The agent's response should include data from the live GitHub API (repo description, default branch, etc.). If it doesn't, check:
- Token is set in the *server* process env, not just the shell that opened the browser.
- Token has `public_repo` scope.
- The MCP server log shows the tool call coming through.

- [ ] **Step 6: Stop the dev server**

Ctrl+C in the dev server terminal.

- [ ] **Step 7: No commit needed**

This task produces no files. If any tweaks were needed (e.g., a different `command` / `args` in the catalog), commit those under Task 1's umbrella with a follow-up commit:

```bash
git add shared/connectors/catalog.ts shared/connectors/catalog.test.ts
git commit -m "fix(connectors): pin verified GitHub MCP server invocation"
```

---

## Self-Review

**1. Spec coverage** — checked each section of `2026-05-06-connector-node-design.md`:

- §3 decisions (connectors-as-MCP-presets, fold into `mcps[]`, env-var auth, hardcoded catalog, GitHub v1, drop legacy fields) → Tasks 1–4.
- §4 architecture (catalog + resolver, no new runtime) → Tasks 1, 3.
- §5.1 `ConnectorsNodeData` → Task 2 Step 1.
- §5.2 drop `ResolvedConnectorConfig` and `connectors[]` → Task 2 Steps 2, 5.
- §5.3 default node → Task 2 Step 3.
- §5.4 validator codes → Task 4.
- §6 catalog v1 → Task 1.
- §7.1 property editor → Task 5.
- §7.2 `ConnectorsNode.tsx` untouched → confirmed in File Structure.
- §8 resolution flow → Task 3.
- §9 migration via existing `migrateGraph` default-merge → no explicit task; relies on `default-nodes.ts` change in Task 2 Step 3 to supply `connectorId: ''`. Legacy `connectorType` decays via `[key: string]: unknown`. Documented here so the implementer doesn't add code that isn't needed.
- §10 docs → Task 6.
- §11 tests → Tasks 1, 3, 4.
- §13 open question (canonical GitHub MCP package) → Task 1 Step 1, Task 7 Step 4.

**2. Placeholder scan** — `<canonical-github-mcp-package>` from the spec became a concrete `'@modelcontextprotocol/server-github'` default in Task 1, with explicit verification instructions in Task 1 Step 1 and a fix path in Task 7 Step 4. No "TBD" / "implement later" / "appropriate error handling" patterns.

**3. Type consistency** — `ConnectorDefinition` interface defined in Task 1 is the same shape used by Tasks 3, 4, 5. `connectorId` and `config` keys consistent across schema, default, resolver, validator, and property editor. `ResolvedMcpConfig` fields populated in Task 3 match the existing interface exactly (verified against `shared/agent-config.ts`).

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-06-connector-node.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
