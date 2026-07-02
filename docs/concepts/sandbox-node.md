# Sandbox Node

> Defines the isolated execution environment the `exec` / `code_execution` tools run inside: an isolation backend, resource ceilings, a network egress policy, and a filesystem scope — execution safety alongside Guardrails (content safety) and Budget (cost safety).

<!-- source: src/types/nodes.ts#SandboxNodeData -->
<!-- last-verified: 2026-07-02 -->

## Overview

Agents that run code need isolation. The Sandbox node makes the execution environment first-class: it declares the isolation backend (`local`, `container`, `microvm`, `gvisor`), per-execution resource ceilings (CPU / memory / wall-clock / processes), a network egress policy, and the filesystem scope the run may touch. This mirrors E2B / Modal / Daytona / Firecracker-microVM sandboxes and the OpenAI/Anthropic code-execution tools, and supersedes the ad-hoc `workspacePath` / `sandboxWorkdir` fields by attaching policy to them.

At most one Sandbox node binds to an agent — it defines the single execution environment — so it resolves to a single optional value on `AgentConfig.sandbox` rather than a list (like Structured Output and Reflection). It completes the safety trilogy: [Guardrails](guardrails-node.md) governs content, [Budget](budget-node.md) governs cost, and Sandbox governs execution.

> **Status:** the node, resolved config, and engine are scaffolded and unit-tested. Wiring the checks into `server/tools/tool-factory.ts` (gate the `exec` tool with `checkPath` / `checkEgress` / `checkResourceRequest`) and `server/agents/run-coordinator.ts` (provision the runtime on run start, emit `sandbox:violation` events, tear down on `terminate`) is the remaining integration step. Actually booting the container / microVM and enforcing ceilings at the OS level is the runtime's job. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Sandbox"` | Human-readable label shown on the node. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the node is wired but no isolation or policy is enforced (every check allows). |
| `runtime` | `'local' \| 'container' \| 'microvm' \| 'gvisor'` | `'container'` | Isolation backend. `local` is a constrained host workdir; the rest isolate harder. |
| `image` | `string` | `"python:3.12-slim"` | Container image / microVM template. Ignored when `runtime` is `local`. |
| `workdir` | `string` | `""` | Filesystem scope, absolute or relative to the workspace. Empty falls back to the agent's `workspacePath`. |
| `confineToWorkdir` | `boolean` | `true` | Reject any filesystem access resolving outside `workdir` (blocks `../` traversal). |
| `readOnlyFilesystem` | `boolean` | `false` | Mount the filesystem read-only; writes are violations. |
| `egressPolicy` | `'none' \| 'allowlist' \| 'all'` | `'none'` | Outbound network posture. |
| `egressAllowlist` | `string[]` | `[]` | Host patterns permitted when `egressPolicy` is `allowlist`. Supports exact hosts and a leading `*.` wildcard, e.g. `*.pypi.org`. |
| `maxCpuCores` | `number` | `2` | CPU core ceiling per execution. `0` means unlimited. |
| `maxMemoryMB` | `number` | `2048` | Memory ceiling in MB. `0` means unlimited. |
| `maxWallClockSec` | `number` | `120` | Wall-clock ceiling per execution in seconds. `0` means unlimited. |
| `maxProcesses` | `number` | `64` | Process/thread ceiling. `0` means unlimited. |
| `onViolation` | `'block' \| 'warn' \| 'terminate'` | `'block'` | What to do when an egress, resource, or path policy is violated. |

Properties are derived from `src/types/nodes.ts#SandboxNodeData` and defaults from `src/utils/default-nodes.ts`. The defaults are secure-by-default: no egress, confined to the workdir, and hard-block on violation.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves the first connected Sandbox node into a `ResolvedSandboxConfig` on `AgentConfig.sandbox` (`shared/agent-config.ts`). Agents without one have `sandbox === null` and the `exec` / `code_execution` tools run against the raw `workspacePath` with no isolation, resource, or egress policy — today's behaviour.

`server/runtime/sandbox-engine.ts` provides the policy substrate (dependency-free and pure, so it runs identically on any host):

- **`checkEgress(config, target)`** — decides whether the sandbox may reach a URL or host. `all` permits everything, `none` denies everything, `allowlist` permits only hosts matching `egressAllowlist` (`extractHost` + `matchHostPattern`, with `*.domain` matching the domain and its subdomains).
- **`checkResourceRequest(config, req)`** — verifies a requested `{ cpuCores, memoryMB, wallClockSec, processes }` envelope fits every ceiling; a ceiling of `0` is unlimited.
- **`checkPath(config, requested, mode, scopeRoot)`** — decides filesystem access: rejects writes on a read-only filesystem, and (when `confineToWorkdir`) rejects any path that escapes `workdir` (falling back to `scopeRoot`, typically the agent's `workspacePath`). Uses the pure `normalizePath` / `isPathWithinScope` helpers to resolve `..` traversal without touching disk.
- **`describeSandbox(config)`** — a one-line posture summary for logs and a live node status hint.

Each check returns a `SandboxDecision { allowed, action, reason }` whose `action` already folds in `onViolation`: `block` refuses just that operation, `warn` allows it but flags a `sandbox:violation` event, and `terminate` signals the runtime to kill the sandbox and fail the run.

## Connections

Peripheral → Agent. At most one Sandbox node binds to a single Agent; the first connected node wins if more than one is wired.

## Example

```json
{
  "type": "sandbox",
  "label": "Python compute",
  "enabled": true,
  "runtime": "container",
  "image": "python:3.12-slim",
  "workdir": "/work",
  "confineToWorkdir": true,
  "readOnlyFilesystem": false,
  "egressPolicy": "allowlist",
  "egressAllowlist": ["*.pypi.org", "files.pythonhosted.org"],
  "maxCpuCores": 2,
  "maxMemoryMB": 2048,
  "maxWallClockSec": 120,
  "maxProcesses": 64,
  "onViolation": "block"
}
```
