# Sandbox Node

> Defines the execution environment for code-running tools (`exec`, `code_execution`): an isolation backend, a resource ceiling, a filesystem scope, and a network egress policy. Adds execution safety alongside the Guardrails node (content safety) and the Budget node (cost safety).

<!-- source: src/types/nodes.ts#SandboxNodeData -->
<!-- last-verified: 2026-07-18 -->

## Overview

Agents that run code need isolation. The Sandbox node defines *where and how* the agent's shell/code commands execute so a bad (or hostile) command cannot exhaust the host, escape its working directory, or reach the open internet. It carries an `isolation` backend, per-command resource ceilings (CPU / memory / wall-clock / process count), a filesystem `workdir` scope, and a `networkPolicy` egress rule. It resolves into `AgentConfig.sandbox` and is meant to be consumed by the `exec` / `code_execution` tools in place of today's raw `workspacePath` + `sandboxWorkdir` pair, mirroring code-sandbox products like E2B, Modal, and Daytona.

At most one Sandbox node binds to an agent — it governs the single shared execution environment — so it resolves to a single optional value on `AgentConfig.sandbox` rather than a list (like Structured Output and Reflection). It completes the safety trio: **Guardrails** (content), **Budget** (cost), **Sandbox** (execution).

> **Status:** the node, resolved config, and engine are scaffolded and unit-tested. Wiring the sandbox into the `exec` / `code_execution` tools (`server/tools/builtins/`) — resolve the effective workdir, reject out-of-scope paths and disallowed hosts, translate the ceilings into container launch flags, and route observed usage through the violation policy — plus emitting a `sandbox:violation` event from `server/agents/run-coordinator.ts`, is the remaining integration step. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Sandbox"` | Human-readable label shown on the node. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the node is wired but code-running tools fall back to the raw workspace path with no sandbox. |
| `isolation` | `'none' \| 'workdir' \| 'container' \| 'microvm'` | `'workdir'` | Isolation backend. `container` runs each command in an ephemeral OCI container; `microvm` uses a Firecracker-style microVM. |
| `image` | `string` | `"python:3.12-slim"` | OCI image / microVM rootfs. Ignored for `none` / `workdir`. |
| `workdir` | `string` | `""` | Filesystem scope / working directory. Empty falls back to the agent's resolved workspace path. |
| `readOnlyRoot` | `boolean` | `false` | Mount the root filesystem read-only; writes are confined to `workdir` and `/tmp`. |
| `maxCpuCores` | `number` | `1` | CPU ceiling in cores (fractional allowed). `0` = unlimited. |
| `maxMemoryMb` | `number` | `512` | Memory ceiling in megabytes. `0` = unlimited. |
| `maxWallClockSec` | `number` | `30` | Per-command wall-clock ceiling in seconds. `0` = unlimited. |
| `maxProcesses` | `number` | `64` | Max concurrent processes/PIDs. `0` = unlimited. |
| `networkPolicy` | `'none' \| 'allowlist' \| 'full'` | `'none'` | Outbound egress policy for sandboxed commands. |
| `allowedHosts` | `string[]` | `[]` | Hosts reachable under `allowlist`. A leading `*.` matches any subdomain (`*.pypi.org`). |
| `onViolation` | `'block' \| 'warn'` | `'block'` | Behaviour when a ceiling, filesystem scope, or egress rule is violated. |
| `blockMessage` | `string` | `""` | Message surfaced when a `block` policy stops a command. Empty falls back to a generic notice. |

Properties are derived from `src/types/nodes.ts#SandboxNodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves the first connected Sandbox node into a `ResolvedSandboxConfig` on `AgentConfig.sandbox` (`shared/agent-config.ts`). Agents without one have `sandbox === null` and code-running tools use the raw `workspacePath` + `sandboxWorkdir` guard as before.

`server/runtime/sandbox-engine.ts` provides the pure, dependency-free decision substrate the tool layer calls:

- **`normalizeSandboxConfig(config)`** — clamps negative ceilings to `0` (unlimited), floors the process count, and trims/de-duplicates the host allowlist. Idempotent.
- **`resolveWorkdir(config, fallback)`** — the effective working directory (node `workdir`, else the fallback), with trailing slashes stripped.
- **`normalizePath(path)`** / **`isPathWithinScope(candidate, scopeRoot)`** — lexical `../` resolution and a containment check that guards against filesystem escapes (a hardened form of the exec tool's `sandboxWorkdir` flag).
- **`hostMatches(host, pattern)`** / **`isHostAllowed(config, host)`** — the egress decision: `none` blocks all, `full` allows all, `allowlist` matches `allowedHosts` (with `*.` subdomain wildcards).
- **`checkResourceUsage(config, usage)`** — compares observed usage against the ceilings and returns every ceiling exceeded (ceilings of `0` and unmeasured fields are skipped).
- **`toContainerLimits(config)`** — translates the ceilings + policy into Docker/Podman-style launch flags (`--cpus`, `--memory`, `--pids-limit`, `--network`, `--read-only`), omitting unlimited ones.
- **`decideViolation(config, violations)`** — applies the `onViolation` policy: `block` refuses/kills the command (with `blockMessage` or a generated summary), `warn` allows it while signalling a `sandbox:violation` event. A disabled sandbox never blocks.
- **`buildSandboxPromptSection(config, effectiveWorkdir)`** — an optional system-prompt note describing the constraints (offline egress, workdir, time/memory ceiling) so the agent writes code that fits them.

## Connections

Peripheral → Agent. At most one Sandbox node binds to a single Agent; the first connected node wins if more than one is wired. Pairs naturally with the [Budget node](budget-node.md) (cost safety) and the [Guardrails node](guardrails-node.md) (content safety).

## Example

```json
{
  "type": "sandbox",
  "label": "Untrusted code",
  "enabled": true,
  "isolation": "container",
  "image": "python:3.12-slim",
  "workdir": "/work",
  "readOnlyRoot": true,
  "maxCpuCores": 0.5,
  "maxMemoryMb": 256,
  "maxWallClockSec": 20,
  "maxProcesses": 32,
  "networkPolicy": "allowlist",
  "allowedHosts": ["*.pypi.org", "files.pythonhosted.org"],
  "onViolation": "block",
  "blockMessage": "That command exceeded the sandbox limits and was stopped."
}
```
