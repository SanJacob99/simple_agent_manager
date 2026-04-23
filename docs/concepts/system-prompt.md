# System Prompt

> How SAM assembles the system prompt that every agent run receives.

<!-- source: shared/system-prompt-builder.ts, server/runtime/resolve-system-prompt.ts -->
<!-- last-verified: 2026-04-23 -->

## Overview

Every agent run receives a SAM-authored system prompt. The prompt is **not** pi-coding-agent's default — SAM owns its structure and wording so the UI preview, the outbound payload to the LLM, and the transcript are always consistent.

The pipeline has two stages:

1. **Client-side assembly** (`shared/system-prompt-builder.ts`, called from `src/utils/graph-to-agent.ts`) produces a `ResolvedSystemPrompt` that is serialized into `AgentConfig.systemPrompt`.
2. **Server-side resolution** (`server/runtime/resolve-system-prompt.ts`, called by `server/runtime/agent-runtime.ts`) substitutes runtime placeholders and appends runtime-only sections before the prompt is sent to pi-ai.

The same `resolveOutboundSystemPrompt()` is used by both the runtime and the `SystemPromptPreview` REST endpoint, so the settings panel preview and the payload the model receives cannot drift.

## Modes

The Agent Node's `systemPromptMode` selects which assembly strategy the builder uses. Defined in [shared/agent-config.ts:8](shared/agent-config.ts#L8) as `'auto' | 'append' | 'manual'`.

| Mode | Behavior |
|------|----------|
| `auto` | Builds the full SAM section set. The user's `systemPrompt` field is **not** inserted; SAM sections are the whole prompt. |
| `append` | Builds the full SAM section set, then adds a final `## User Instructions` section containing the user's `systemPrompt` text. |
| `manual` | Discards SAM's sections. The user's `systemPrompt` text is the entire prompt, emitted as a single `manual` section. |

Use `append` when you want SAM's guardrails and runtime context plus your own instructions on top. Use `manual` when you need full control and are willing to forgo SAM's default guidance, tooling contract, safety block, and runtime metadata.

## Auto-assembled Sections

In `auto` and `append` modes, the builder emits these sections in order. Optional sections are skipped when their input is absent.

| Order | Section key | Emitted when | Contents |
|-------|-------------|--------------|----------|
| 1 | `identity` | Always | SAM brand, harness identity, "tool schemas are the contract" posture |
| 2 | `tooling` | `toolsSummary` is non-null | Structured-tool guidance + the comma-separated list of enabled tool names |
| 3 | `executionBias` | Always | Act-in-turn, continue-until-done, recover, verify |
| 4 | `safety` | Always | Default safety block, with `safetyGuardrails` user text appended when provided |
| 5 | `skills` | `skillsSummary` is non-null | Pre-built Skills section body (bundled/tags/inline mix) |
| 6 | `selfUpdate` | `selfUpdate.enabled` | Names the config-inspection/patch tools and the protected-paths list |
| 7 | `workspace` | `workspacePath` is non-null | Working directory and optional injected bootstrap files (per-file + total char caps) |
| 8 | `documentation` | `docsPath` is set | Local path to SAM docs |
| 9 | `sandbox` | `sandbox` is set | Sandbox mode, whether sandboxed, elevated exec availability, sandbox paths |
| 10 | `time` | `timezone` is non-null | ISO-8601 current time and IANA timezone |
| 11 | `replyTags` | `replyTags` is set | Whether the provider supports reply tags, with example |
| 12 | `heartbeats` | `heartbeats` is set | Heartbeat prompt/ack tokens, or an "heartbeats disabled" note |
| 13 | `runtime` | Always | One-line `Runtime: host=… \| os=… \| node=… \| model=… \| repo=…` |
| 14 | `reasoning` | Always | Reasoning visibility level and thinking-effort note |

### Why the Runtime line omits `thinking=<level>`

The Runtime section deliberately does not emit `thinking=<level>` or a prose reasoning directive. Some providers (notably Gemini 3) read plain-text thinking instructions literally and switch to a silent-thinking mode. The thinking level is passed to the provider via the API `reasoning.effort` parameter instead.

### Append mode adds one more section

When `mode === 'append'` and the user's `systemPrompt` is non-empty, a final `userInstructions` section is appended with the user's text under a `## User Instructions` heading.

## Server-side Resolution

After the client builds the prompt, `resolveOutboundSystemPrompt()` in `server/runtime/resolve-system-prompt.ts` takes the `ResolvedSystemPrompt` from `AgentConfig` and applies three runtime transformations:

1. **Bundled-skills-root substitution.** Any `{{BUNDLED_SKILLS_ROOT}}` placeholder in sections or the assembled string is replaced with the real server-side path. Token estimates are recomputed for any section whose content changed.
2. **Workspace fallback.** If the client-built prompt has no workspace section and the caller passed a `workspaceCwd`, a `workspace-runtime` section is appended with `## Workspace\n\nWorking directory: <cwd>`.
3. **Confirmation policy (HITL).** When either `ask_user` or `confirm_action` is in the resolved tool list, the configured safety `confirmationPolicy` is appended as a `confirmationPolicy` section. Placeholders are filled from the enabled tool set:
   - `{{READ_ONLY_TOOLS}}` → read-classified tools
   - `{{STATE_MUTATING_TOOLS}}` → state-mutating tools + any unclassified tools (safe default)
   - `{{DESTRUCTIVE_TOOLS}}` → destructive tools

   When `safetySettings.allowDisableHitl` is false (the default), `ask_user` and `confirm_action` are auto-injected into the tool list for placeholder filling so the policy reflects what the runtime will actually register.

The final `assembled` string is what `AgentRuntime` passes to pi-ai as the Agent's initial `systemPrompt`, and is cached on the runtime for the token-breakdown preview.

## Per-turn Overrides

`AgentRuntime.setSystemPrompt()` can swap the prompt for the next prompt call. This is used by the `before_model_resolve` hook pipeline. The `initialSystemPrompt` snapshot is kept so `buildInitialBreakdown()` can tokenize the original without reading from pi-core's per-turn Agent state.

## Data Shape

The resolved prompt is carried in `AgentConfig.systemPrompt` as a `ResolvedSystemPrompt`:

```ts
interface ResolvedSystemPrompt {
  mode: SystemPromptMode;           // 'auto' | 'append' | 'manual'
  sections: SystemPromptSection[];  // structured per-section view for the UI
  assembled: string;                // the exact string sent to the model
  userInstructions: string;         // original user text, preserved for round-trip
}

interface SystemPromptSection {
  key: string;          // stable identifier, e.g. 'identity', 'tooling'
  label: string;        // human-readable title for the preview UI
  content: string;      // the section's text
  tokenEstimate: number;
}
```

Keeping sections structured (rather than just the assembled string) lets the Settings panel render a per-section breakdown with token counts, and lets the server recompute estimates when it substitutes or appends content.

## Related Files

- `shared/system-prompt-builder.ts` — client-side assembly, owns SAM's static wording
- `shared/agent-config.ts` — `SystemPromptMode`, `SystemPromptSection`, `ResolvedSystemPrompt` types
- `server/runtime/resolve-system-prompt.ts` — server-side substitution + runtime sections
- `server/runtime/agent-runtime.ts` — caches the finalized prompt and exposes per-turn overrides
- `src/utils/graph-to-agent.ts` — invokes the builder during graph → `AgentConfig` resolution
- [agent-node.md](agent-node.md) — the node that owns `systemPrompt`, `systemPromptMode`, and related fields
