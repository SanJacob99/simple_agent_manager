# Section 3 — Settings Workspace

<!-- last-verified: 2026-05-08 -->

## Scope

Covers the Settings workspace shell and its eight sections, the persisted
`useSettingsStore`, the `useModelCatalogStore` and `useProviderRegistryStore`
flows, the in-app SAMAgent *configuration* surface (its UI usage is Section 4),
the color override system, and the Data & Maintenance toolbar.

NOT covered here: chat drawer rendering of HITL banners, agent runtime
behavior, graph editing, property editors. Those are referenced where they
are downstream consumers of a setting.

Sources audited:

- `src/settings/SettingsWorkspace.tsx`
- `src/settings/types.ts`
- `src/settings/settings-store.ts`
- `src/settings/color-config.ts`
- `src/settings/sections/*.tsx`
- `src/store/model-catalog-store.ts`
- `src/store/provider-registry-store.ts`
- `src/store/sam-agent-store.ts`
- `shared/model-catalog.ts`
- `shared/sam-agent/protocol-types.ts`
- `server/index.ts` (settings + provider catalog routes)
- `server/providers/plugins/index.ts`
- `src/runtime/provider-model-options.ts`
- `src/App.tsx`, `src/panels/Sidebar.tsx`
- `src/store/graph-store.ts` (apply-defaults helpers)

## Workspace Shell

### How it opens

- **Cog button**: top-right of the canvas (visible when `appView === 'canvas'`)
  in `src/App.tsx` flips `appView` to `'settings'`. There is no modal — the
  workspace replaces the canvas in the main pane.
- **SAMAgent deep links**: the SAMAgent island in `src/chat/SAMAgent.tsx`
  passes `onOpenSettings(section)` which both sets `activeSettingsSection` and
  flips view. SAMAgent calls it with `'sam-agent'` from two spots.
- **Sidebar**: when `appView === 'settings'`, `src/panels/Sidebar.tsx` (lines
  203-225) renders the section list using `SETTINGS_SECTIONS` from
  `src/settings/types.ts`. The active section is highlighted (blue) and
  clicking calls `onSettingsSectionChange`.

### Layout

- Header band: section `label`, `description`, and a "Return to Canvas" button.
- Body: scrollable; one section component is mounted at a time
  (`SettingsWorkspace.tsx` lines 45-65).
- The sidebar is auto-collapsed; section labels appear on hover (`group-hover`
  in Sidebar.tsx line 204).

### Persistence and dirty state

- `activeSettingsSection` is React state in `App.tsx`, not persisted; it
  resets to `'api-keys'` on full reload.
- All persisted settings live in `useSettingsStore`. There is **no explicit
  Save button** for most fields: every setter calls `saveSettings()` which
  POSTs `PUT /api/settings` immediately. The server writes a single JSON file
  via `settingsFile.save()` (server/index.ts:613-636).
- Exceptions:
  - **Confirmation policy textarea** in Safety holds a local draft until
    "Save policy" is clicked (see SafetySection.tsx:9, 12, 140).
  - **API key inputs** save on every keystroke (no debounce).
- If `PUT /api/settings` fails the error is swallowed (`saveSettings`'s
  `catch` in settings-store.ts:97-99). Risk: silent loss of writes when the
  backend is down.

### Bootstrap

- `App.tsx` calls `loadFromServer`, `loadProviders`, `loadToolCatalog` on
  mount.
- After load, if an `openrouter` API key is present it triggers
  `loadOpenRouterCatalog` to seed the cached catalog (App.tsx:51-57).

## Sections

### 1. Providers & API Keys

**Source**: `src/settings/sections/ProvidersApiKeysSection.tsx`

A static list of 13 provider cards merged with backend-registered "plugin
providers". The hardcoded `KNOWN_PROVIDERS` array defines:

| id | label | "Get key" link |
|---|---|---|
| `openai` | OpenAI | platform.openai.com |
| `anthropic` | Anthropic | console.anthropic.com |
| `google` | Google AI Studio | aistudio.google.com |
| `google-vertex` | Google Vertex AI | console.cloud.google.com |
| `openrouter` | OpenRouter | openrouter.ai |
| `azure-openai-responses` | Azure OpenAI | ai.azure.com |
| `groq` | Groq | console.groq.com |
| `xai` | xAI | console.x.ai |
| `mistral` | Mistral | console.mistral.ai |
| `cerebras` | Cerebras | cloud.cerebras.ai |
| `minimax` | MiniMax | platform.minimaxi.com |
| `vercel-ai-gateway` | Vercel AI Gateway | vercel.com docs |
| `ollama` | Ollama (local) | none — local daemon |

**This is the 13 figure referenced by F-04 area.** Plus any extras the backend
provider plugin registry exposes that aren't in the hardcoded list (rendered
with a "Plugin provider" pill).

Per-row UI:

- Password input (`type="password"`) by default. Eye/EyeOff toggle reveals
  cleartext. Visibility state is component-local; closing/reopening the
  section re-masks.
- `onChange` writes to `useSettingsStore.apiKeys[id]` immediately and PUTs
  the full settings blob.
- "Get key" anchor opens vendor key page in a new tab when `keyUrl` is set.
- Ollama row shows "Not required for local" hint.
- Footer: "Keys are saved to a local settings file on this machine."

**Storage**: server-side JSON file via `PUT /api/settings`; the in-memory
`apiKeys` map (server/index.ts:622-623) is also kept in sync so the runtime
can resolve keys at agent start.

**Validation**: none. Keys are stored as typed.

**Failure modes**:

- Server unreachable → save call swallows error; in-memory store still
  reflects change but a reload will re-fetch the stale server value.
- Empty string treated as "no key": `getApiKey` returns `undefined` when the
  value is falsy.
- Pasting a key with leading/trailing whitespace is *not* trimmed for storage,
  but `SamAgentSection.buildModelOptions` does trim before deciding if a
  provider has a key (line 26-28 in SamAgentSection.tsx).
- No "remove" button — clearing the input string acts as removal but the
  empty entry remains in the persisted map.

---

### 2. Model Catalog

**Source**: `src/settings/sections/ModelCatalogSection.tsx`,
`src/store/model-catalog-store.ts`, `shared/model-catalog.ts`,
`server/index.ts:692-765`

Targets the **default provider** (`providerDefaults.pluginId` from the
Defaults section). The catalog is per-provider and per-`baseUrl` keyed by
`buildProviderCatalogKey({pluginId, baseUrl})` → `"<pluginId>::<baseUrl|default>"`.

UI panes:

- **Header banner**: status text — "no provider", "no API key", error, or
  "Cached <provider> catalog last updated <time>" / "Discovered N <provider>
  models".
- **Sync Models button**: enabled only when `canSync = pluginId && apiKey &&
  currentProvider.supportsCatalog`. POSTs
  `/api/providers/catalog/refresh` with the `ProviderCatalogRequest`.
  Response is `{models, userModels, syncedAt, userModelsRequireRefresh}`.
- **View toggle**: "My Enabled Models" vs "All Models" — only shown when the
  provider returned a non-empty `userModels` map or signaled
  `userModelsRequireRefresh`.
- **Search field**: client-side substring filter on `model.id`.
- **Pagination**: 10 per page (`ITEMS_PER_PAGE`).
- **Table columns**: Model ID, Reasoning (Yes/-), Modalities, Context window,
  Cost / 1M (input / output) — formatted USD.
- **Click row** → `ModelDetailsModal` (`src/settings/sections/ModelDetailsModal.tsx`)
  with full metadata + raw JSON toggle.

Server endpoints (server/index.ts):

- `POST /api/providers/catalog/load` — returns cached snapshot or refreshes if
  none. Caller may pass `apiKeyFingerprint` to detect key change.
- `POST /api/providers/catalog/refresh` — always fetches fresh from the plugin.
- `POST /api/providers/catalog/clear` — clears one (with `request`) or all
  (no body) cached catalogs.

**Side effects**:

- `Sync Models` makes a network call to the provider plugin (currently only
  `openrouter` is implemented in `server/providers/plugins/index.ts`). For
  other providers, `currentProvider?.supportsCatalog` is presumably false so
  the button is disabled.
- App boot auto-loads OpenRouter catalog when an OpenRouter key is configured
  (App.tsx:51-57).
- "Reset Everything" / "Clear App Settings" in Data & Maintenance call
  `clearAllCatalogs()` which POSTs `clear` with no body and resets the store.

**Cache freshness**: there is **no automatic TTL or revalidation**; users
must click Sync. `userModelsRequireRefresh` is set when the API key
fingerprint changes server-side.

**Fallback for non-OpenRouter providers**: the section table is empty for
providers without `supportsCatalog`. Static lists for picker fallback live in
`src/runtime/provider-model-options.ts` `STATIC_MODELS` — these are consumed
by `ProviderModelPicker` and `SamAgentSection.buildModelOptions`, NOT
displayed in this section.

**Failure modes**:

- Plugin not loaded server-side → 400 "Plugin has no catalog".
- No API key on server → 400 "No API key available".
- Network/parse error → in-store `errors[key]` rendered as a red banner.
- "My Enabled Models" auto-fallback: if the toggle disappears (e.g. cache
  cleared), the effect at line 96-100 forces `viewMode='all'`.
- Stale catalog after key swap: `userModelsRequireRefresh` shows an amber
  banner urging refresh.

---

### 3. Defaults

**Source**: `src/settings/sections/DefaultsSection.tsx`

A tabbed area with seven sub-tabs (`DefaultsSubTab`):

| Sub-tab | Store field | Default value (types.ts) |
|---|---|---|
| Agent | `agentDefaults` | `DEFAULT_AGENT_DEFAULTS` (modelId `anthropic/claude-sonnet-4-6`, thinking `off`, mode `append`, prompt and safetyGuardrails text) |
| Provider | `providerDefaults` | pluginId `openrouter`, authMethodId `api-key`, envVar `OPENROUTER_API_KEY`, baseUrl `''` |
| Storage | `storageDefaults` | path `~/.simple-agent-manager/storage`, retention 50, memory on, `warn`, prune 30d |
| Context Engine | `contextEngineDefaults` | tokenBudget 128000, reservedForResponse 4096, summary @ 0.8, RAG off, topK 5, minScore 0.7 |
| Memory | `memoryDefaults` | backend `builtin`, max 100 msgs, no persist across sessions, no compaction |
| Cron | `cronDefaults` | `0 9 * * *`, persistent, timezone `local`, 5min run, 7d retention |
| Agent Comm | `agentCommDefaults` | maxTurns 10, depth 3, tokenBudget 100k, rate 30/min, sizeCap 16000 chars, bidirectional |

These values populate **new** nodes when dragged from the sidebar (per
`src/utils/default-nodes.ts` reading from this store).

**Special features**:

- **Agent → Model** uses `ProviderModelPicker` against the discovered models
  for `providerDefaults.pluginId`.
- **Agent → System Prompt Mode** has two modes:
  - `append` (default): app-injected sections first, user instructions last.
  - `manual`: full user-controlled prompt with no injected guardrails (red
    warning banner).
- **Agent → Safety Guardrails**: large textarea, hint says "Injected into
  every agent's system prompt in append mode."
- **Agent → "Apply to existing agents" button**: confirms via `window.confirm`
  then calls `useGraphStore.applyAgentDefaultsToExistingAgents()` which
  rewrites every agent node's `modelId` and `thinkingLevel` (graph-store.ts:476).
  Does NOT change name, description, tags, system prompts, capabilities, or
  peripheral links.
- **Provider → Provider Plugin** dropdown is sourced from the backend
  registry (`useProviderRegistryStore`); selecting one auto-fills `authMethodId`
  and `envVar` from the plugin's first auth method.
- **Storage → "Apply to existing storage nodes" button** calls
  `applyStorageDefaultsToExistingNodes()` → rewrites only `storagePath`.
- **Context Engine → RAG fields** appear conditionally when `ragEnabled`.
- Agent Comm sub-tab is fully wired to `agentCommDefaults`.

**Failure modes**:

- Number inputs use `parseInt`/`parseFloat` with hardcoded fallbacks; an
  empty string yields the fallback (e.g. 50, 30, 128000). No validation on
  upper bounds or NaN beyond browser min/max attributes.
- If the backend hasn't loaded providers yet, the Provider dropdown shows
  the current `pluginId` as a single disabled option.
- `setAgentCommDefaults` defensively re-defaults to
  `DEFAULT_AGENT_COMM_DEFAULTS` if the existing field is missing (handles
  migrating from older persisted blobs).

---

### 4. SAMAgent

**Source**: `src/settings/sections/SamAgentSection.tsx`, `src/store/sam-agent-store.ts`,
`shared/sam-agent/protocol-types.ts`

Configures the **in-app assistant** that sits as the leftmost chat island
in canvas view. (Its message UI and patch-acceptance flow are Section 4.)

Fields:

- **Model dropdown** — combined options from:
  1. `STATIC_MODELS[pluginId]` for every pluginId with a non-empty API key
     (plus `ollama` always).
  2. Discovered catalog models for those same providers.
  Options dedupe on `pluginId::baseUrl::modelId` and sort by pluginId then
  modelId. Display label is `"<pluginId> / <modelId>"`.
- **Thinking level**: `off` | `minimal` | `low` | `medium` | `high` (default) | `xhigh`.
  Hint warns that some models (e.g. Gemini 3.1 Pro) reject `off`.
- **Amber warning** if the chosen provider has no API key configured.

**Storage**: `samAgentDefaults` in `useSettingsStore`, persisted via
`PUT /api/settings`. Shape is
`{ modelSelection: { provider: { pluginId, authMethodId, envVar, baseUrl }, modelId } | null, thinkingLevel }`.

**Side effects**: Selecting a model writes a new `modelSelection`. The
SAMAgent component reads `samAgentDefaults` directly when issuing requests
(SAMAgent.tsx:35, 40-41). Changes are picked up on the next user turn — no
restart needed.

**Failure modes**:

- "No providers configured" placeholder when `modelOptions.length === 0`.
- Selecting a model whose provider's key is later cleared shows the amber
  banner but the selection is preserved.
- `authMethodId`/`envVar` are inferred from the **registry** at selection time;
  if the registry hasn't loaded yet, `authMethodId` falls back to `'api-key'`
  and `envVar` to `''`.

---

### 5. Safety

**Source**: `src/settings/sections/SafetySection.tsx`

Two controls:

- **Dangerous Fully Auto** checkbox (`safety.allowDisableHitl`).
  - First click shows an inline red confirmation card ("You're about to
    remove the human-oversight guardrail"). User must click "I understand,
    enable" to flip the bit. Cancel returns to off.
  - Default: `false` — locks `ask_user` and `confirm_action` ON in every
    Tools node.
  - When `true`, the Tools-node HITL checkboxes become unlockable per agent.
- **Confirmation policy textarea**.
  - Has unsaved-draft semantics: changes track `localPolicy`; the "Save
    policy" button is disabled until dirty, and an amber "Unsaved changes"
    label appears next to it.
  - "Reset" button (top-right) reverts to `DEFAULT_CONFIRMATION_POLICY` and
    saves immediately.
  - Three runtime placeholders: `{{READ_ONLY_TOOLS}}`,
    `{{STATE_MUTATING_TOOLS}}`, `{{DESTRUCTIVE_TOOLS}}` — filled by the
    runtime per agent.

**Storage**: `safety` in settings store; PUT `/api/settings` updates the
in-memory `currentSafetySettings` mirror server-side (server/index.ts:626-631)
so AgentManager reads current values at every `agent:start`.

**Cross-link**: HITL banner rendering and tool-lock UI live in the Tools node
(Section 4 / property editors).

**Failure modes**:

- Pasting a multi-megabyte policy: not bounded; will inflate every system
  prompt.
- Removing all three placeholders: still saves; runtime falls back to
  hard-coded text per `shared/system-prompt-builder.ts`.
- Unsaved policy is lost on section change — the local draft is component
  state, not persisted.

---

### 6. Appearance

**Source**: `src/settings/sections/AppearanceSection.tsx`

Controls the assistant chat text-reveal animation.

| Field | Type | Default | Range |
|---|---|---|---|
| Streaming layout | radio: `blocks` \| `flat` | `blocks` | — |
| Enable reveal animation | checkbox | `true` | — |
| Reveal speed | number (chars/sec) | 90 | 20–400, step 5 |
| Per-character fade | number (ms) | 320 | 0–800, step 20 |

Reset-to-defaults button restores `DEFAULT_CHAT_UI_DEFAULTS`.

When `textRevealEnabled` is off the speed and fade controls are visually
muted (`opacity-50 pointer-events-none`).

**Storage**: `chatUIDefaults` in settings store.

**Side effects**: Live preview only by way of the chat drawer reading
`chatUIDefaults`. No CSS variables changed.

**Failure modes**: clamping is enforced via `clamp()` so manual `<input>`
edits beyond range snap back. NaN inputs snap to min.

---

### 7. Colors

**Source**: `src/settings/sections/ColorsSection.tsx`,
`src/settings/color-config.ts`

Catalog of every routable CSS variable, grouped:

- **Neutral (Slate)** — 12 vars (`--c-slate-50` … `--c-slate-950`)
- **Brand (Blue)** — 5 vars
- **Danger (Red / Rose)** — 6 vars
- **Warning (Amber / Orange)** — 7 vars
- **Success (Green / Emerald)** — 5 vars
- **Info (Purple / Violet / Indigo)** — 10 vars
- **Node Accents** — 13 per-node-type vars (`--c-node-agent` … `--c-node-subagent`)
- **Surfaces** — 3 vars (`--c-canvas-bg`, `--c-code-bg`, `--c-chat-input-bg`)

Per-row UI:

- HTML `<input type="color">` swatch.
- Hex text input that accepts `#rrggbb` only (regex-validated) and writes on
  match.
- Reset-arrow button per overridden var.
- "Reset all (N)" button at top, disabled when no overrides.

**Storage**: `localStorage['sam:color-overrides']` (BROWSER ONLY — not synced
to the backend or other devices). `applyColorOverrides()` writes inline
`style.setProperty(name, hex)` on `:root` so they trump `app.css`.

**Side effects**: instant live preview (every change calls `applyColorOverrides`
+ `saveColorOverrides`). No reload required.

**Failure modes**:

- `colorToHex()` round-trips via canvas; for `oklch`/`color-mix` values it
  returns `#rrggbb` approximation; semi-transparent values are reduced.
- localStorage quota error → silently swallowed.
- Reset Everything in Data & Maintenance does NOT clear color overrides
  (they live in a separate localStorage key).
- Color overrides persist across SSO/login because they're browser-local.

---

### 8. Data & Maintenance

**Source**: `src/settings/sections/DataMaintenanceSection.tsx`

Buttons grid (top non-destructive, bottom destructive):

| Button | Action | Destructive? |
|---|---|---|
| Export Graph | `downloadJson(exportGraph(...), 'agent-graph-<ts>.json')` | No |
| Import Graph | File picker → `uploadJson` → `importGraph` → `loadGraph` (replaces current graph) | Yes (replaces graph, no confirm) |
| Load Test Fixture | `importGraph(testFixture)` from `src/fixtures/test-graph.json` → `loadGraph` (replaces) | Yes (replaces graph, no confirm) |
| Clear Graph | `clearGraph()` after `window.confirm` | Yes |
| Clear Chat Sessions | per-agent `StorageClient.deleteAllSessions()` then `resetAllSessions()` after confirm | Yes |
| Clear App Settings | `resetSettings()` + `clearAllCatalogs()` after confirm | Yes |
| Reset Everything | sessions + graph + settings + catalogs after confirm | Yes |
| Run Maintenance | per-agent `StorageClient.runMaintenance()` then displays a `MaintenanceReport` | Depends on `storageDefaults.maintenanceMode` |

Maintenance report fields:

- `mode`, `prunedEntries.length`, `orphanTranscripts.length`,
  `archivedResets.length`, `storeRotated`, `evictedForBudget.length`,
  `diskBefore` → `diskAfter` (bytes).

**Maintenance mode semantics**:

- `warn` (default): report-only — no destructive operations.
- `enforce`: actually prunes, evicts, and rotates per
  `storageDefaults.pruneAfterDays` and quota.

**Storage import format**: a JSON blob with `nodes` and `edges`. Invalid
shape → "Invalid graph file format." status message.

**Failure modes**:

- Import Graph and Load Test Fixture both replace the entire graph with NO
  confirmation dialog. Risk of accidental graph wipe if the user clicks
  Import after starting work.
- Clearing chat sessions issues `deleteAllSessions` to every agent's storage
  client; missing/malformed `storage` config silently skips.
- The maintenance loop only displays the *last* agent's report (the loop
  overwrites `setMaintenanceReport` each iteration). Risk: misleading totals
  for multi-agent graphs.
- Color overrides are not reset by "Clear App Settings" or "Reset Everything"
  (they're in a separate `localStorage` key).

## End-to-End Test Scenarios

1. **Open settings via cog button**
   - From canvas, click cog → `appView` flips to `settings`, default
     `'api-keys'` section renders, sidebar shows section list on hover.

2. **Open settings via SAMAgent deep link**
   - In SAMAgent island, click cog → settings opens directly to **SAMAgent**
     section.

3. **Switch sections via sidebar**
   - Click each of the eight sections; each renders without console errors,
     active section is blue-highlighted.

4. **Section persistence on canvas round-trip**
   - Open settings, switch to Colors, click "Return to Canvas", click cog
     again → expectation: lands on **api-keys** (state is in-memory React
     state, so it resets — verify this is the actual behavior, not a bug
     to surface).

5. **Per-provider API key entry + masking**
   - In Providers & API Keys, type a key into OpenAI; field is masked
     (`type="password"`); click eye → cleartext; click eye again → masked.
   - Reload page → key persists; in-store `apiKeys.openai` is set.
   - Clear the input fully → `getApiKey('openai')` returns `undefined` next
     run.

6. **"Get key" link-out**
   - Click each "Get <provider> key" link; verify it opens the documented
     vendor URL in a new tab.

7. **Plugin provider rendering**
   - With backend providing OpenRouter via plugin registry, the OpenRouter
     row shows a "Plugin provider" pill.

8. **Model catalog sync — happy path**
   - Set OpenRouter key, set Defaults → Provider Plugin to OpenRouter, open
     Model Catalog → click Sync Models → POST `/api/providers/catalog/refresh`
     succeeds, table populates, "Cached … last updated <time>" appears,
     button has spinner during request.

9. **Model catalog sync — bad key**
   - With invalid OpenRouter key, click Sync → expect 400/error rendered as
     red banner with backend message.

10. **My Enabled vs All Models**
    - When `userModels` is non-empty, toggle is shown and persists view
      between searches; when empty, toggle hidden, fall back to "All".

11. **Model details modal**
    - Click a row → modal opens with model metadata + raw JSON toggle;
      close via X.

12. **Defaults — Agent system prompt mode swap**
    - Switch to `manual` → red banner about no guardrails; system prompt
      textarea visible; flip back to `append` → instructions textarea
      visible.

13. **Defaults — Apply to existing agents**
    - With two agent nodes, change Defaults → Agent → modelId; click
      Apply → confirm dialog → both agent nodes' `modelId` and
      `thinkingLevel` update; names/system prompts unchanged.

14. **Defaults — Provider plugin auto-fill**
    - Change Provider Plugin in Defaults → `authMethodId`, `envVar`, `baseUrl`
      auto-update from registry first auth method.

15. **Defaults flow into new nodes**
    - Change Storage default `pruneAfterDays` to `7`; return to canvas; drag
      a new Storage node; verify default value `7`.

16. **SAMAgent model dropdown filtering**
    - With only OpenAI key set, SAMAgent dropdown lists only OpenAI static
      and discovered models (plus Ollama). After adding Anthropic key,
      list re-renders to include Anthropic.

17. **SAMAgent — provider key cleared after selection**
    - Pick a model, then clear that provider's key in Providers & API Keys
      → return to SAMAgent → amber banner "no API key configured" shows.

18. **Safety — Dangerous Fully Auto two-step**
    - Click checkbox → confirmation card appears; click Cancel → checkbox
      stays off. Click checkbox again → click "I understand, enable" →
      `safety.allowDisableHitl = true`.

19. **Safety — Confirmation policy dirty draft**
    - Edit textarea → "Save policy" enabled, "Unsaved changes" label visible.
      Click another sidebar section without saving → return to Safety →
      verify behavior (component remounts; local draft is lost — confirm).
    - Click Save → store updated, button disabled.
    - Click Reset → textarea snaps back to default, store updated.

20. **Safety policy → chat HITL effect (cross-link to Section 4)**
    - With `allowDisableHitl=true`, in a Tools node uncheck `confirm_action`;
      run an agent; verify HITL banner does NOT appear before a state-mutating
      tool. Cross-link only — full HITL chat behavior is Section 4.

21. **Appearance live preview**
    - Open ChatDrawer with an in-flight stream → drag Reveal speed slider
      → text streams visibly faster/slower without reload.

22. **Colors live preview**
    - Open Colors → change `--c-blue-500` → blue accents in current view
      update instantly; refresh page → still applied.
    - Click reset-on-row → that var only reverts; click "Reset all" →
      everything reverts.
    - Verify `localStorage['sam:color-overrides']` contains the JSON.

23. **Colors — invalid hex text**
    - Type `#zzzzzz` in the hex text input → no change applied; valid
      `#ff00aa` → applied.

24. **Data & Maintenance — graph export/import round-trip**
    - Build a small graph → Export → file downloads as
      `agent-graph-<ts>.json`. Clear Graph (confirm) → Import → graph
      restored.

25. **Data & Maintenance — fixture load**
    - Click Load Test Fixture → `src/fixtures/test-graph.json` content
      replaces graph (no confirm — surface as risk).

26. **Data & Maintenance — Run Maintenance, warn vs enforce**
    - With `storageDefaults.maintenanceMode = 'warn'`, click Run → report
      shows mode `warn`, no actual deletions.
    - Switch to `enforce`, click Run → entries beyond `pruneAfterDays`
      are removed (verify on disk).

27. **Data & Maintenance — Reset Everything**
    - Confirm dialog → graph cleared, all sessions cleared, settings
      reset to defaults, model catalogs cleared. **Color overrides survive**
      (verify and document as expected behavior).

28. **Server-down save behavior**
    - Stop backend → change a setting → no error UI surfaces (silent
      catch). Reload page → setting reverts to last server value. Document
      as a known gap.

29. **`/api/settings` 500 error on load**
    - Make backend return 500 → `loadFromServer` catches; UI loads
      defaults; `loaded=true` is still set so SAMAgent and others can
      proceed.

30. **PUT settings persists safety to runtime mirror**
    - Toggle Dangerous Fully Auto → start a new agent run → verify the
      AgentManager observed the new value (server/index.ts:626-631 mirror).

## Known ambiguities and risks

- **Provider count is 13 in the hardcoded list** but the section can show
  more if the backend plugin registry exposes additional providers. The
  "13" figure is a floor, not a ceiling.
- The Sync Models button in Model Catalog targets only the
  `providerDefaults.pluginId`; users may expect a global "sync all" but
  there isn't one (Reset Everything clears all, but does not refresh).
- Currently `server/providers/plugins/index.ts` only registers
  `openrouterPlugin`. Other providers in the UI list rely on `STATIC_MODELS`
  fallbacks and won't return a catalog from `POST /api/providers/catalog/refresh`.
- Import Graph and Load Test Fixture replace the graph silently. Recommend
  adding a confirm dialog or note the risk in the Data & Maintenance
  manual.
- Color overrides are isolated to `localStorage` and are not part of the
  backend settings JSON, so they don't sync across devices and survive
  "Reset Everything".
- "Apply to existing agents" only patches `modelId` and `thinkingLevel` —
  not system prompt, safetyGuardrails, or systemPromptMode. Users may
  expect those to flow through.
- `setSafetySettings({allowDisableHitl})` does NOT prompt for confirmation
  when toggling OFF — only the "first-on" flow is gated.
- `Run Maintenance` displays only the last agent's report when multiple
  agents exist (loop overwrites state).
