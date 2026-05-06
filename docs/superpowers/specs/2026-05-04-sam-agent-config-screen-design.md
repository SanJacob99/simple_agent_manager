# SAMAgent Config Screen + Powerful Default

<!-- last-verified: 2026-05-04 -->

## Problem

SAMAgent calls fail against models that require reasoning to be enabled (e.g. Gemini 3.1 Pro), because [server/sam-agent/sam-agent-config.ts](../../../server/sam-agent/sam-agent-config.ts) hardcodes `thinkingLevel: 'off'`. This serializes as `reasoning: "none"` to OpenRouter and the API returns 400 — the model never sees the prompt. Confirmed in `logs/api/2026-05-04T19-26-26-976Z-0001.txt`.

Adjacent UX issue: SAMAgent's model picker lives inline in the chat drawer ([src/chat/SAMAgent.tsx](../../../src/chat/SAMAgent.tsx)) rather than in the settings workspace where every other defaults-style configuration lives. There is no place to change `thinkingLevel` at all.

## Goals

- Default SAMAgent to powerful reasoning (`thinkingLevel: 'high'`) so it works out of the box with reasoning-required models.
- Expose `thinkingLevel` and the existing model selection in a dedicated **SAMAgent** section in the settings workspace.
- Remove the inline picker from the chat drawer; replace it with a read-only badge that opens the new section.

## Non-goals

- No system-prompt override, safety guardrails, or run-timeout knobs on the new screen — SAMAgent's behavior is intentionally fixed beyond model + thinking.
- No new agent-comm / multi-agent routing work. That is a separate gap (peer agents are forbidden by the validator) and is out of scope here.
- No changes to the `propose_workflow_patch` tool, validators, or runtime resolver.

## Design

### 1. Settings workspace integration

Add a new section id `'sam-agent'` to `SettingsSectionId` and `SETTINGS_SECTIONS` in [src/settings/types.ts](../../../src/settings/types.ts), positioned between `defaults` and `safety`. Wire it through [src/settings/SettingsWorkspace.tsx](../../../src/settings/SettingsWorkspace.tsx) like the other sections.

New component: `src/settings/sections/SamAgentSection.tsx`. Layout follows `DefaultsSection`'s card-per-field idiom.

Section metadata:
- `id: 'sam-agent'`
- `label: 'SAMAgent'`
- `description: 'Model and reasoning settings for the in-app assistant.'`

### 2. Data model — extend `SamAgentDefaults`

Today (`src/settings/types.ts`):

```ts
export interface SamAgentDefaults {
  modelSelection: { provider: {...}, modelId: string } | null;
}
export const DEFAULT_SAM_AGENT_DEFAULTS: SamAgentDefaults = { modelSelection: null };
```

After:

```ts
export interface SamAgentDefaults {
  modelSelection: { provider: {...}, modelId: string } | null;
  thinkingLevel: ThinkingLevel;
}
export const DEFAULT_SAM_AGENT_DEFAULTS: SamAgentDefaults = {
  modelSelection: null,
  thinkingLevel: 'high',
};
```

`useSettingsStore.setSamAgentDefaults` already accepts a partial — no signature change. The store's persisted-state hydration merges `DEFAULT_SAM_AGENT_DEFAULTS`, so users upgrading from a state without `thinkingLevel` land on `'high'` automatically.

### 3. Wire transport — pass `thinkingLevel` to the server

Extend `SamAgentModelSelection` ([server/sam-agent/sam-agent-config.ts](../../../server/sam-agent/sam-agent-config.ts) and its mirror on the client) to carry the level:

```ts
export interface SamAgentModelSelection {
  provider: ResolvedProviderConfig;
  modelId: string;
  thinkingLevel: ThinkingLevel;  // NEW
}
```

Client ([src/client/sam-agent-client.ts](../../../src/client/sam-agent-client.ts)) reads `samAgentDefaults.thinkingLevel` from the settings store and includes it in the `samAgent:prompt` payload.

Server ([server/sam-agent/sam-agent-config.ts](../../../server/sam-agent/sam-agent-config.ts)) — replace `thinkingLevel: 'off'` with `modelSelection.thinkingLevel ?? 'high'`. The `?? 'high'` guards against older clients that have not yet been updated.

### 4. Drawer changes

[src/chat/SAMAgent.tsx](../../../src/chat/SAMAgent.tsx):

- Remove the inline `<select>` block (~lines 217-231) and its handler (`handleModelChange`, ~lines 128-145).
- Replace with a compact badge that displays `<provider> · <modelId> · thinking <level>`. Clicking the badge calls the existing `onOpenSettings('sam-agent')` flow (currently the workspace is opened by the parent `App.tsx` with a section id; we add `'sam-agent'` to its accepted set).
- When `modelSelection` is null, the badge becomes a button labelled "Configure SAMAgent" that opens the same section.

### 5. Section UI

`SamAgentSection.tsx`:

| Field | Control | Source/sink |
|------|---------|------------|
| Model | provider+model `<select>` (re-use the same options builder as the current drawer picker) | `samAgentDefaults.modelSelection` |
| Thinking level | `<select>` with `off / low / medium / high` | `samAgentDefaults.thinkingLevel` |
| API key status | read-only line: "API key configured" (green) or "Missing API key for {provider} → Configure" (link to API Keys section) | `apiKeys[modelSelection.provider.pluginId]` |

Help text under thinking level:
> Higher levels improve reasoning quality but cost more and run slower. Some models (e.g. Gemini 3.1 Pro) require a non-`off` setting.

### 6. Tests

- **`src/settings/settings-store.test.ts`** — extend existing `samAgentDefaults` tests:
  - Default `thinkingLevel` is `'high'` after store init.
  - `setSamAgentDefaults({ thinkingLevel: 'low' })` updates only that field.
  - Hydration from a persisted state lacking `thinkingLevel` produces `'high'`.
- **`server/sam-agent/sam-agent-config.test.ts`** — assert `buildSamAgentConfig` reads `modelSelection.thinkingLevel` into the resulting `AgentConfig`, and falls back to `'high'` when the field is absent.
- **`src/settings/sections/SamAgentSection.test.tsx`** (new) — render the section, change the model and thinking selects, verify store updates; missing-API-key state shows the link.
- **Drawer regression** — `SAMAgent.test.tsx` (if it exists) should be updated or added so the badge renders the persisted selection and clicking it triggers the open-settings callback.

## Migration notes

- `samAgentDefaults` is persisted by zustand-persist. Existing values are `{ modelSelection: ... }` only. Default-merge during hydration injects `thinkingLevel: 'high'`.
- Server's `?? 'high'` fallback covers the racing case where an older browser tab sends a payload without the new field.

## Risks

- A model that does not support reasoning at all (some OpenRouter providers) may now get a `thinkingLevel: 'high'` request. The provider plugin's existing translation path treats unknown reasoning levels as best-effort; verify in `pi-ai` provider mapping that `'high'` on a non-thinking model is silently passed-through, not rejected. If it errors, expose `'off'` as a documented escape hatch in the section UI (already present in the dropdown).

## Out of scope (future work)

- Peer-agent connectivity (`agentComm` as edge target) — separate spec needed.
- Per-prompt override of thinking level from the chat drawer — only consider if user demand surfaces.
