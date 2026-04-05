# Structured System Prompt Design

> Align what "context" means for the agent node and how the context engine node manages it. The agent node owns building a structured, app-assembled system prompt. The context engine node manages token budgets and compaction only.

## Problem

Today the agent node's `systemPrompt` is a single user-authored textarea, and the context engine appends extra text via `systemPromptAdditions`. There is no structured assembly of the system prompt — no safety guardrails, no tooling section, no workspace/bootstrap file injection, no runtime metadata. The user has no visibility into what the model actually receives.

## Decisions

- **Agent node / graph resolution layer** owns building the structured system prompt (Approach B).
- **System prompt mode** on the agent node: `auto` (read-only, no user input), `append` (user appends instructions at the end), `manual` (user owns everything, zero app injection, with warning).
- **Always injected** (auto/append): Safety guardrails (from app settings), time/runtime metadata.
- **From graph nodes** (auto/append): Tools/skills sections (tools + skills nodes), workspace + bootstrap files (storage node).
- **TODO for later**: App Self-Update section (depends on incomplete app documentation).
- **Manual mode**: 100% user-controlled. No safety, no tooling, no time — nothing injected.
- **Context engine `systemPromptAdditions`**: Removed. Replaced by the structured prompt builder.

---

## 1. Data Model Changes

### AgentNodeData — new field

```ts
// SystemPromptMode is defined once in shared/agent-config.ts and imported here
import type { SystemPromptMode } from '../../shared/agent-config';

export interface AgentNodeData {
  // ... existing fields unchanged ...
  systemPromptMode: SystemPromptMode;  // NEW — default 'auto'
  systemPrompt: string;                // EXISTING — meaning changes per mode:
                                       //   auto: ignored (no textarea shown)
                                       //   append: user's appended instructions
                                       //   manual: the entire system prompt
}
```

### ResolvedSystemPrompt — new type in shared/agent-config.ts

```ts
export type SystemPromptMode = 'auto' | 'append' | 'manual';

export interface SystemPromptSection {
  key: string;          // 'safety' | 'tooling' | 'skills' | 'workspace' | 'time' | 'runtime' | 'userInstructions'
  label: string;        // "Safety Guardrails"
  content: string;
  tokenEstimate: number;
}

export interface ResolvedSystemPrompt {
  mode: SystemPromptMode;
  sections: SystemPromptSection[];
  assembled: string;          // final flattened string for the API
  userInstructions: string;   // raw user input preserved
}
```

### AgentConfig change

```ts
export interface AgentConfig {
  // ...
  systemPrompt: ResolvedSystemPrompt;  // was: string
  // ...
}
```

### Default safety guardrail text

Stored in app settings (configurable), not hardcoded in the builder. Default value:

```
## Safety

You have no independent goals: do not pursue self-preservation, replication,
resource acquisition, or power-seeking; avoid long-term plans beyond the user's
request.

Prioritize safety and human oversight over completion; if instructions conflict,
pause and ask; comply with stop/pause/audit requests and never bypass safeguards.
(Inspired by Anthropic's constitution.)

Do not manipulate or persuade anyone to expand access or disable safeguards.
Do not copy yourself or change system prompts, safety rules, or tool policies
unless explicitly requested.
```

### ContextEngineNodeData — changes

**New fields:**

```ts
export interface ContextEngineNodeData {
  // ... existing fields ...
  bootstrapMaxChars: number;       // NEW — default 20000, max per-file size
  bootstrapTotalMaxChars: number;  // NEW — default 150000, total across all files
}
```

**Removed field:** `systemPromptAdditions: string[]` — removed from both `ContextEngineNodeData` and `ResolvedContextEngineConfig`.

---

## 2. System Prompt Builder

A pure function in `shared/system-prompt-builder.ts`. No React, no runtime dependencies.

### Input shape

```ts
interface SystemPromptBuilderInput {
  mode: SystemPromptMode;
  userInstructions: string;           // agent node's systemPrompt field
  safetyGuardrails: string;           // from app settings
  toolsSummary: string | null;        // short tool list text from resolved tools config
  skillsSummary: string | null;       // formatted skills list from resolved skills
  workspacePath: string | null;       // from storage node
  bootstrapFiles: { name: string; content: string }[] | null;  // from storage node path
  bootstrapMaxChars: number;          // from context engine node (default 20000)
  bootstrapTotalMaxChars: number;     // from context engine node (default 150000)
  timezone: string | null;            // from app settings or detected
  runtimeMeta: {                      // always available
    host: string;
    os: string;
    model: string;
    thinkingLevel: string;
  };
}
```

### Behavior per mode

- **`auto`**: Builds all sections in order. `userInstructions` is ignored. No textarea shown in UI.
- **`append`**: Same as auto, plus a `## User Instructions` section appended at the very end.
- **`manual`**: Returns a single section `{ key: 'manual', content: userInstructions }`. No app sections.

### Section ordering (auto/append)

1. **Safety** — guardrail text from app settings
2. **Tooling** — tool list + short descriptions
3. **Skills** — available skills list with paths
4. **Workspace** — working directory + bootstrap files (truncated per limits)
5. **Current Date & Time** — timezone only (cache-stable)
6. **Runtime** — host, OS, model, thinking level (one line)
7. **User Instructions** — append mode only

### Bootstrap file handling

Each file is truncated to `bootstrapMaxChars` with a `[truncated]` marker. Total injected content across all files is capped at `bootstrapTotalMaxChars`. Bootstrap files are:

- AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, USER.md, HEARTBEAT.md
- MEMORY.md (or memory.md as lowercase fallback)

These come from the storage node's workspace path.

### File reading responsibility

The builder is a pure function — it does not read from disk. The caller is responsible for reading bootstrap files and passing their content in. During graph resolution (`resolveAgentConfig` on the server), the server reads files from the storage node's workspace path. For the live preview panel (client-side), the client requests the file contents from the server via an API call.

### Call site

`resolveAgentConfig()` in `src/utils/graph-to-agent.ts` calls `buildSystemPrompt(input)`. Result goes into `AgentConfig.systemPrompt` as a `ResolvedSystemPrompt`. The preview panel can call the same function independently for live preview.

---

## 3. Runtime Changes

### AgentRuntime constructor (server/runtime/agent-runtime.ts)

- `config.systemPrompt` (was string) becomes `config.systemPrompt.assembled`
- Remove the `getSystemPromptAddition()` append block — now baked into `assembled`

### ContextEngine class (server/runtime/context-engine.ts)

- Remove `getSystemPromptAddition()` method
- Remove `systemPromptAdditions` from the config it reads
- `assemble()` return shape simplifies: `{ messages, estimatedTokens }` (no `systemPromptAddition`)
- Compaction, `buildTransformContext`, `afterTurn` — unchanged

### graph-to-agent.ts (src/utils/graph-to-agent.ts)

- Current skill injection and context engine addition append blocks (lines 155-166) replaced by a single `buildSystemPrompt()` call
- The builder receives data from already-resolved node configs

---

## 4. UI Changes

### Agent Properties Panel (src/panels/property-editors/AgentProperties.tsx)

**New: Mode selector** — `<select>` for `systemPromptMode`, positioned where "System Prompt" currently is.

**Per-mode rendering:**

- **`auto`**: Section summary (section names + token estimates, read-only) + "View full prompt" button opening dedicated preview panel. No textarea.
- **`append`**: Same summary + "View full prompt" button + textarea labeled "Your Instructions".
- **`manual`**: Warning banner (amber/yellow) + full textarea. No summary.

### New: System Prompt Preview Panel (src/panels/SystemPromptPreview.tsx)

Dedicated panel accessible via "View full prompt" button. Shows:

- **Collapsed view (default)**: Section name + token estimate per row, total at bottom.
- **Expanded view**: Click a section to expand its full content, or "Expand all" for complete prompt.

Calls `buildSystemPrompt()` with current graph state for live preview.

### Context Engine Properties Panel (src/panels/property-editors/ContextEngineProperties.tsx)

- **Remove**: "System Prompt Additions" section (lines 262-294)
- **Add**: Two numeric fields for `bootstrapMaxChars` and `bootstrapTotalMaxChars` under "Bootstrap Limits"

### Context Engine Node face (src/nodes/ContextEngineNode.tsx)

No change — already shows strategy + budget.

---

## 5. Migration & Backwards Compatibility

### Existing graphs (on load)

- If `systemPromptMode` is missing from an agent node:
  - If `systemPrompt` is the unchanged default (`"You are a helpful assistant."`): default to `'auto'`
  - Otherwise: default to `'append'` (preserves the user's existing text as appended instructions)

### AgentConfig consumers

- Everything reading `config.systemPrompt` as a string updates to read `.assembled`
- Config export/import: old imports with a plain string are wrapped into `{ mode: 'manual', sections: [], assembled: theString, userInstructions: theString }`

### Context Engine migration

- Existing nodes with non-empty `systemPromptAdditions`: migrate content into the agent node's `systemPrompt` field, switch mode to `'append'`, drop the field
- New fields `bootstrapMaxChars` / `bootstrapTotalMaxChars` default to `20000` / `150000` if missing

### Config version bump

`AgentConfig.version`: `2` -> `3`

---

## Out of Scope

- **App Self-Update section** — depends on incomplete app documentation (TODO)
- **Memory node** — memory tools and daily file memories are out of scope
- **RAG injection into system prompt** — context engine RAG settings exist but don't affect prompt assembly yet
- **Context panel slash commands** (`/status`, `/context list`, `/context detail`, `/usage tokens`, `/compact`) — future work
