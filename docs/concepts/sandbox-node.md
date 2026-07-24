# Sandbox Node

> Defines the execution environment the agent's code-running tools operate inside — isolation level, resource ceilings, network egress, filesystem scope, and command allow/deny lists — as the execution-safety pillar alongside Budget (cost) and Guardrails (content).

<!-- source: src/types/nodes.ts#SandboxNodeData -->
<!-- last-verified: 2026-07-24 -->

## Overview

The Sandbox node constrains what an agent's code-running tools (`exec`, `code_execution`) are allowed to do. Where the Budget node bounds *cost* and the Guardrails node bounds *content*, the Sandbox node bounds *execution*: which commands may run, whether the process can reach the network, which parts of the filesystem it may read or write, and how much CPU / memory / wall-clock it may consume. This mirrors the isolation surfaces of E2B, Modal sandboxes, container-per-agent runtimes, and microVM (Firecracker) executors.

At most one Sandbox node binds to an agent — it describes the single boundary those tools run inside — so it resolves to a single optional value on `AgentConfig.sandbox` rather than a list (like Reflection and Structured Output). When no Sandbox node is attached, `sandbox === null` and the code-running tools run with today's unsandboxed behaviour.

> **Status:** the node, resolved config, and policy engine are scaffolded and unit-tested. Wiring the checks into `server/tools/tool-factory.ts` (gate the `exec` / `code_execution` adapters through the engine and apply each `SandboxDecision`) and provisioning the actual isolation boundary (container / microVM / constrained workdir) is the remaining integration step. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Sandbox"` | Human-readable label shown on the node. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the node is wired but no policy is enforced. |
| `isolation` | `'none' \| 'workdir' \| 'container' \| 'microvm'` | `'workdir'` | The isolation boundary the tools run inside. |
| `cpuLimit` | `number` | `0` | Max CPU cores. `0` disables this ceiling. |
| `memoryLimitMb` | `number` | `0` | Max resident memory in MB. `0` disables this ceiling. |
| `wallClockLimitMs` | `number` | `30000` | Max wall-clock per operation in ms. `0` disables this ceiling. |
| `networkPolicy` | `'none' \| 'allowlist' \| 'unrestricted'` | `'none'` | Network egress policy. |
| `allowedHosts` | `string[]` | `[]` | Host patterns permitted under `allowlist` (exact or a single leading `*.` wildcard). |
| `filesystemPolicy` | `'read_only' \| 'scoped' \| 'unrestricted'` | `'scoped'` | Filesystem access policy. |
| `mountPath` | `string` | `""` | Root the sandbox filesystem is scoped to under `scoped` / `read_only`. Empty inherits the agent's working directory. |
| `allowedCommands` | `string[]` | `[]` | Executable allowlist. Empty permits any command not on the denylist. |
| `blockedCommands` | `string[]` | `[]` | Executable denylist. A match always denies (wins over the allowlist). |
| `onViolation` | `'warn' \| 'block'` | `'block'` | What the runtime does when a request violates the policy. |

Properties are derived from `src/types/nodes.ts#SandboxNodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves the first connected Sandbox node into a `ResolvedSandboxConfig` on `AgentConfig.sandbox` (`shared/agent-config.ts`). Agents without one have `sandbox === null` and their code-running tools run unsandboxed.

`server/runtime/sandbox-engine.ts` provides the decision substrate (dependency-free; every check is a pure function of the config and the request):

- **`evaluateCommand(config, command)`** — decides whether a shell command may run. The denylist always wins; otherwise a non-empty allowlist admits only listed executables. Matching is on the executable name (`commandName()` strips directory and `FOO=bar` env prefixes).
- **`evaluateEgress(config, host)`** — decides an outbound connection: `none` blocks all, `unrestricted` permits all, `allowlist` admits hosts matching an `allowedHosts` entry (`hostMatches()` supports a single leading `*.` wildcard label).
- **`evaluatePath(config, targetPath, write)`** — decides a filesystem access: `read_only` blocks writes, and both `scoped` and `read_only` require the path to stay within `mountPath` (`pathWithin()` normalizes `.`/`..` without touching disk, so `../` escapes are rejected).
- **`evaluateResources(config, usage)`** — flags a sampled `ResourceSnapshot` that breaches any configured CPU / memory / wall-clock ceiling.

Each returns a `SandboxDecision` (`allowed`, `action` of `allow` / `warn` / `block`, and the `violations`). The `action` follows the node's `onViolation` policy: `block` denies the operation; `warn` allows it and surfaces a `sandbox:violation` event. `anyBlocked()` folds a batch of decisions into a single gate.

## Connections

Peripheral → Agent. At most one Sandbox node binds to a single Agent; the first connected node wins if more than one is wired. Pairs naturally with the [Budget node](budget-node.md) (cost safety) and [Guardrails node](guardrails-node.md) (content safety).

## Example

```json
{
  "type": "sandbox",
  "label": "Coding sandbox",
  "enabled": true,
  "isolation": "container",
  "cpuLimit": 2,
  "memoryLimitMb": 1024,
  "wallClockLimitMs": 60000,
  "networkPolicy": "allowlist",
  "allowedHosts": ["*.pypi.org", "registry.npmjs.org"],
  "filesystemPolicy": "scoped",
  "mountPath": "/workspace",
  "allowedCommands": ["git", "python", "node", "npm", "pip"],
  "blockedCommands": ["curl", "wget", "sudo"],
  "onViolation": "block"
}
```
