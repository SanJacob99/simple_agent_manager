# Section 2 — Property Editors (Per-Node Configuration)

<!-- last-verified: 2026-05-08 -->

## Scope

The right-hand Properties Panel (`src/panels/PropertiesPanel.tsx`) and every per-node
property editor under `src/panels/property-editors/`. This is the configuration
surface for each node type — the JSON values it produces feed `resolveAgentConfig()`
(Section 5) and ultimately the runtime. Canvas/graph behavior, settings workspace,
and chat UI are out of scope here.

## Properties Panel Shell

`PropertiesPanel.tsx` is a right-anchored, resizable `<aside>` that mounts only when a
node is selected (`useGraphStore.selectedNodeId`). Empty/multi-selection state collapses
the panel entirely (`if (!node) return null;`, line 69).

- Width persisted in `useUILayoutStore.propertiesPanelWidth` and clamped 280–720 via
  `useRightAnchoredResize` (PropertiesPanel.tsx:60-66). A drag handle on the left edge
  resizes it (`PanelResizeHandle`).
- Header (lines 84-107): coloured dot + node label (driven by
  `NODE_COLORS` / `NODE_LABELS` from `src/utils/theme.ts`), trash icon (calls
  `removeNode` then clears selection), and an X icon (`setSelectedNode(null)`).
- Body (lines 110-112): `PropertyEditorForType` switches on `data.type` and renders the
  matching editor. There is **no fallback case** — an unrecognised type renders
  `undefined` (a runtime risk if a new node type is added without a matching editor).
- The shared form primitives `Field`, `Tooltip`, `inputClass`, `selectClass`, and
  `textareaClass` live in `src/panels/property-editors/shared.tsx`. `Field` renders a
  10px uppercase label with optional tooltip; **note: it does not wire `htmlFor`/`id`,
  which is the root cause of the a11y findings logged in F-Misc accessibility note in
  `docs/superpowers/specs/2026-05-07-e2e-chrome-devtools-test-findings.md`.**
- The **System Prompt Preview** (`src/panels/SystemPromptPreview.tsx`) is launched only
  from the Agent editor's "View full prompt" button when `systemPromptMode === 'append'`.
  It is rendered as a full-screen modal overlay (AgentProperties.tsx:417-426), not as a
  tab inside the panel. The preview POSTs to `/api/agents/:id/resolved-system-prompt`
  with the resolved client config and renders the server-authoritative section list.

## Node Editors

Each editor file accepts `{ nodeId, data }` and writes back through
`useGraphStore((s) => s.updateNodeData)`. Defaults below are sourced from
`src/utils/default-nodes.ts`. Type definitions live in `src/types/nodes.ts`.

### Node: agent (`agent`)

Editor file: `src/panels/property-editors/AgentProperties.tsx`

| Field | Input | Default | Validation | Source / Notes |
|---|---|---|---|---|
| Agent Name | text | `''` | UI lock once `nameConfirmed=true` (line 221-231) | Free-form. Lock icon appears with title "Agent names cannot be changed after creation". |
| Description | text | `''` | none | Free-form. |
| Tags | comma-separated text | `[]` | trimmed/filtered (line 256-261) | Stored as `string[]`. |
| Working Directory | text | `''` | none | Empty = server `process.cwd()`. Cascades into the Tools node's exec/cdp settings (`agentWorkingDir` lookup in ToolsProperties.tsx:241-246). |
| Model | `ProviderModelPicker` | `'anthropic/claude-sonnet-4-6'` (default-nodes.ts:12) | none, but selecting a known model snapshots `modelCapabilities` and resets `thinkingLevel` (line 199-208) | Available list comes from `useModelCatalogStore.models[catalogKey]` keyed by the connected Provider node's `pluginId`+`baseUrl`. **Note F-06**: prior to commit `6671b2c`, the default was `anthropic/claude-sonnet-4-20250514`, which OpenRouter rejects on first chat (see `docs/superpowers/specs/2026-05-07-e2e-chrome-devtools-test-findings.md` F-06). The commit bumped the default to `anthropic/claude-sonnet-4-6` — this is still a hard-coded literal that will go stale again. |
| Model Capabilities (collapsible) | `ModelCapabilitiesPanel` | `{}` | optional number parsing | Snapshot of `reasoningSupported`, `inputModalities`, `contextWindow`, `maxTokens`, `cost`, `outputModalities`, etc. Each value can be overridden (override badge + reset button) and is persisted in `data.modelCapabilities`. |
| Thinking Level | select (off/minimal/low/medium/high/xhigh) | `'off'` | disabled when `resolvedCapabilities.reasoningSupported === false` (line 309) | Auto-promoted to `'medium'` on model selection if the chosen model supports reasoning (line 207). |
| System Prompt Mode | select | `'append'` | normalised on mount via `useEffect` (lines 122-126) — anything not `'manual'` is coerced to `'append'` | `append` shows app-built sections + the user's instructions; `manual` warns that no guardrails/tooling/workspace metadata are injected and gives full control. |
| Your Instructions / System Prompt | textarea (rows=6) | `'You are a helpful assistant.'` | none | Stored on the same `systemPrompt` field regardless of mode. |
| Show Reasoning | checkbox | `false` | none | Forwards model `thinking`/reasoning to the chat stream. |
| Verbose Tool Output | checkbox | `false` | none | Adds tool result summaries to the chat stream. |

**Cross-node interactions:**
- Provider node connection — discovered via `edges.filter(e => e.target === nodeId)` and the model picker is empty until a Provider node points at this Agent (lines 75-94). The provider's `pluginId`+`baseUrl` are keyed into `useModelCatalogStore` so different OpenRouter base URLs maintain separate catalogues.
- The `workingDirectory` is read by Tools node's exec page to display "Inherits: …" (ToolsProperties.tsx:241-246).
- `modelCapabilities.reasoningSupported` flows through to `ContextEngineNode` (token budget inheritance) via `useContextEngineSync`.
- "View full prompt" launches `SystemPromptPreview` modal, which calls `/api/agents/:id/resolved-system-prompt` with the resolved client `AgentConfig`.

**Failure / disabled states:**
- `nameConfirmed=true` ⇒ agent name input is disabled+opaque with a lock title.
- No connected Provider ⇒ `availableModels` is empty; manual model id entry still allowed.
- Reasoning unsupported ⇒ Thinking Level dropdown disabled with explanatory `title`.
- Manual prompt mode ⇒ amber warning banner.

---

### Node: provider (`provider`)

Editor file: `src/panels/property-editors/ProviderProperties.tsx`

| Field | Input | Default | Validation | Source / Notes |
|---|---|---|---|---|
| Label | text | `'Provider'` | none | |
| Provider | select | `'openrouter'` | none | Options come from `useProviderRegistryStore().providers`. When empty, falls back to a single placeholder option carrying the saved `pluginId`. Switching providers resets `authMethodId`, `envVar`, and `baseUrl` (lines 33-42). |
| Auth Method | select | `'api-key'` | only rendered when `authMethods.length > 1` | Sourced from the selected plugin's `auth[]` array. |
| Environment Variable | text | `'OPENROUTER_API_KEY'` | none | Placeholder is the `currentAuth.envVar`. Acts as fallback env-var name for the API key. |
| Base URL Override | text | `''` | none | Empty = use `currentPlugin.defaultBaseUrl`. |

**Cross-node interactions:** This is the canonical source for the Agent / SubAgent / Context Engine model pickers. They look up `buildProviderCatalogKey({ pluginId, baseUrl })` against `useModelCatalogStore.models`.

**Failure / disabled states:** When the provider registry hasn't loaded yet, the select shows a single fallback option and no auth-method picker.

---

### Node: memory (`memory`)

Editor file: `src/panels/property-editors/MemoryProperties.tsx`

| Field | Input | Default | Validation | Source / Notes |
|---|---|---|---|---|
| Label | text | `'Memory'` | none | |
| Backend | select (`builtin` / `external` / `cloud`) | `'builtin'` | none | |
| Max Session Messages | number, min=1 | `100` | parsed with fallback to 100 (line 68) | |
| Persist across sessions | checkbox | `false` | none | |
| Search Mode | select (`keyword` / `semantic` / `hybrid`) | `'hybrid'` | none | |
| Enable compaction | checkbox | `false` | none | Reveals strategy + threshold below. |
| Compaction Strategy | select (`summary` / `sliding-window`) | `'summary'` | none | Note this list omits `trim-oldest` even though the type allows it elsewhere. |
| Compaction Threshold | number 0–1 step=0.1 | `0.8` | parsed with fallback to 0.8 (line 122) | |
| memory_search | checkbox | `true` | none | Folds into tool resolution. |
| memory_get | checkbox | `true` | none | |
| memory_save | checkbox | `true` | none | |
| External Endpoint | text | `''` | only shown when `backend !== 'builtin'` | Placeholder `https://api.example.com/memory`. |
| External API Key | password | `''` | only shown when `backend !== 'builtin'` | |

**Cross-node interactions:** The three `expose*` toggles drive whether `memory_*` tools are added to `enabledTools` during resolution. The `searchMode` also drives the memory engine's index strategy on the server.

**Failure / disabled states:** External fields hidden when builtin selected.

---

### Node: tools (`tools`)

Editor file: `src/panels/property-editors/ToolsProperties.tsx` (multi-page editor; sub-pages use `SchemaForm` from `src/panels/property-editors/schema-form/SchemaForm.tsx` driven by schemas in `src/panels/property-editors/tool-config-schemas.ts`).

**Main page fields:**

| Field | Input | Default | Notes |
|---|---|---|---|
| Label | text | `'Tools'` | |
| Tool Profile | select (`full`/`coding`/`messaging`/`minimal`/`custom`) | `'full'` | Selecting a non-custom profile overwrites `enabledGroups` from `TOOL_PROFILES[profile]` in `shared/resolve-tool-names.ts`. Profile auto-flips to `'custom'` when individual groups/tools are toggled. |
| Tool Groups | 7 checkboxes (`runtime`, `fs`, `web`, `coding`, `media`, `communication`, `human`) | profile-derived | Toggling any group force-promotes profile to `'custom'`. |
| Individual Tools | catalog-grouped checkboxes | `['ask_user', 'confirm_action']` | Only shown when profile is `'custom'`. Catalog comes from `useToolCatalogStore.entriesOrFallback()`. HITL tools (`ask_user`, `confirm_action`) are locked checked unless `useSettingsStore.safety.allowDisableHitl === true`. Alias-aware comparison via `canonicalizeToolName`. |
| Custom Tool input | text + Add | `''` | Adds free-text names to `enabledTools`. |

**Configure sub-page links** (each opens its own page with a back button):

| Page | Schema | Tool slot | Notable behaviour |
|---|---|---|---|
| `exec` / bash | `execToolConfigSchema` | `toolSettings.exec` | `cwd` placeholder/description show inherited agent working dir. |
| `code_execution` | `codeExecutionToolConfigSchema` | `toolSettings.codeExecution` | xAI API key (password), model, skill markdown. |
| `web_search` | `webSearchToolConfigSchema` | `toolSettings.webSearch` | Tavily key (password) + skill. |
| `image` / `image_generate` | `imageToolConfigSchema` + hand-written model picker | `toolSettings.image` | Model picker switches between catalog-filtered `<select>` (when connected provider is `openrouter` and the catalog has models with `outputModalities` containing `'image'`) and free-text input. Shows four hint variants based on connection state. OpenAI + Gemini API keys (password). |
| `canva` | `canvaToolConfigSchema` | `toolSettings.canva` | `portRangeStart`/`End` integers 1024–65535. |
| `browser` | `browserToolConfigSchema` + `BrowserCdpLauncher` | `toolSettings.browser` | Includes a "Launch Chrome for CDP" button that POSTs `/api/browser/launch-chrome`. `screenshotQuality` is hidden when `screenshotFormat === 'png'`. Has two sub-sections (`Screenshot streaming`, `Anti-detection & emulation`). Validations: viewportWidth 320–3840, viewportHeight 240–2160, timeoutMs 1000–300000, screenshotQuality 1–100. |
| `text_to_speech` | `textToSpeechToolConfigSchema` | `toolSettings.textToSpeech` | 17 fields across 6 sectioned providers (ElevenLabs, OpenAI, Google Gemini, Microsoft Azure, MiniMax, OpenRouter). API keys rendered as password inputs. |
| `music_generate` | `musicGenerateToolConfigSchema` | `toolSettings.musicGenerate` | Two providers (Google Lyria, MiniMax Music). Reuses image/Gemini and TTS/MiniMax keys. |
| `Sub-Agents` | `subAgentsToolConfigSchema` | `subAgentSpawning`, `maxSubAgents` (top-level fields, NOT under `toolSettings`) | `maxSubAgents` hidden when spawning off; range 1–10. |

**Skills inline editor:** The Tools node also carries `skills: SkillDefinition[]` and `plugins: PluginDefinition[]` in its data shape (per `src/types/nodes.ts:240-243`) — but **the editor does not currently surface a UI for either**. Defaults are empty arrays. Skills declared via the connected Skills node are folded into the system prompt during `resolveAgentConfig()` (Section 5).

**Cross-node interactions:**
- Reads connected Agent's `workingDirectory` (walks one outgoing edge to the agent).
- Reads connected Agent → Provider for the image-tool model picker (walks tools → agent → provider via incoming edges, ToolsProperties.tsx:248-271).
- Reads `useToolCatalogStore` for the live tool catalog and `useSettingsStore.safety.allowDisableHitl` for the HITL lock.

**Failure / disabled states:**
- HITL tools disabled (and locked checked) when `allowDisableHitl=false`. Amber banner at the top of the custom-tools section.
- Image preferred-model has 4 hint variants depending on connection state; only the openrouter+catalog-loaded path shows a real picker.

---

### Node: skills (`skills`)

Editor file: `src/panels/property-editors/SkillsProperties.tsx`

| Field | Input | Default | Validation | Notes |
|---|---|---|---|---|
| Label | text | `'Skills'` | none | |
| Available Skills | 7 checkboxes (`code_generation`, `summarization`, `translation`, `data_analysis`, `creative_writing`, `reasoning`, `math`) | `['code_generation', 'summarization']` | none | The 7 names are hard-coded in `AVAILABLE_SKILLS` (line 6). |
| Add Custom Skill | text + Add (Enter or button) | `''` | dedupe + trim (line 33) | Adds arbitrary names to `enabledSkills`. |

**NB: there is no `name` + `body` skill editor here.** The `SkillDefinition { id, name, content, injectAs }` shape lives on `ToolsNodeData.skills`, not `SkillsNodeData`. The Skills node currently only stores `enabledSkills: string[]`. Skills folded into the system prompt during `buildSystemPrompt()` come from the Tools node's `skills` array, not from this node's checkboxes. The `enabledSkills[]` strings are looked up against bundled skill content during prompt assembly.

**Cross-node interactions:** `enabledSkills` strings are matched against bundled skill content during `resolveAgentConfig()` and folded into the system prompt.

**Failure / disabled states:** None. Empty `enabledSkills` ⇒ no skills folded in.

---

### Node: contextEngine (`contextEngine`)

Editor file: `src/panels/property-editors/ContextEngineProperties.tsx`

| Field | Input | Default | Validation | Notes |
|---|---|---|---|---|
| Label | text | `'Context Engine'` | none | |
| Token Budget | number (or read-only "inherited" badge) | `128000` | min=1024, step=1024 | When connected to an agent with discovered `contextWindow`, becomes a read-only "inherited" display showing `From <modelId> (<n> tokens)`. Otherwise editable. |
| Reserved for Response | number | `4096` | min=256, step=256 | |
| Compaction Strategy | select (`summary`, `sliding-window`, `trim-oldest`) | `'summary'` | none | Description text changes per strategy. |
| Summary Model | text + datalist | `''` (inherits agent model) | none | Only shown when strategy is `summary`. Datalist sourced from the connected agent's provider catalog. Empty = use agent model. |
| Compaction Trigger | select (`auto`/`manual`/`threshold`) | `'auto'` | none | |
| Compaction Threshold (0-1) | number | `0.8` | only shown when trigger=`threshold` | |
| Compaction Token Limit | number | `0.8` (NB: same field as threshold, repurposed) | only shown when trigger=`manual`, step=1024 | |
| Compact Now button | button | — | only shown when trigger=`manual` | Disabled when no `storageClient` or no active session. Reports messages-before/after + tokens-before/after on success. |
| Token Target After Compaction | number | `50000` | min=512, step=1024, max=`tokenBudget - reservedForResponse` | Capped by budget − reserved. |
| Compaction donut | recharts pie | — | — | Reads `useContextUsageStore` for live session usage. Shows %used or trigger %. |
| Auto-flush before compact | checkbox | `true` | none | Tooltip explains semantics. |
| Enable RAG retrieval | checkbox | `false` | none | Reveals topK + minScore. |
| Top K results | number | `5` | min=1, max=50 | |
| Min similarity score | number | `0.7` | min=0, max=1, step=0.05 | |

**Cross-node interactions:**
- `useContextEngineSync(nodeId, data)` resolves the connected agent and its model context window to drive the inherited budget badge.
- Walks edges to find the Provider attached to the connected Agent for the summary-model datalist.
- Walks `useSessionStore.activeSessionKey[agent.id]` and `useSessionStore.storageEngines[agent.id]` for the Compact Now button.
- The bootstrap-limit field in the spec brief is **not** a top-level field — `postCompactionTokenTarget` is the closest equivalent, controlling post-compaction size.

**Failure / disabled states:**
- "Compact Now" disabled when no storageClient or no active session.
- Manual compaction inline message (ok / err) appears below the button.

---

### Node: agentComm (`agentComm`)

Editor file: `src/panels/property-editors/AgentCommProperties.tsx`

| Field | Input | Default | Validation | Notes |
|---|---|---|---|---|
| Label | text | `'Agent Comm'` | none | |
| Target Agent | select | `null` | none | Lists every agent node in the graph. The "do not include this connected agent" filter mentioned in the comment is not implemented (line 14 says "except the one this comm node is connected to" but the implementation lists all agents). |
| Protocol | select (`direct`/`broadcast`) | `'direct'` | none | |
| Direction | select (`bidirectional`/`outbound`/`inbound`) | `'bidirectional'` | none | |
| Max turns (per channel) | number | `10` | min=1 | No upper bound. |
| Max depth (cascade) | number | `3` | min=1 | No upper bound. |
| Token budget (per channel) | number | `100000` | min=1000, step=1000 | |
| Rate limit (msgs/min) | number | `30` | min=1 | |
| Message size cap (chars) | number | `16000` | min=100, step=100 | |

**Cross-node interactions:** `targetAgentNodeId` references another agent node by id. Channel session isolation is documented in `docs/concepts/agentComm-node.md`; the editor does not surface session-isolation controls — those are channel-level runtime behaviour.

**Failure / disabled states:** None — every field is always editable. There is no validation banner if `targetAgentNodeId` is null.

---

### Node: connectors (`connectors`)

Editor file: `src/panels/property-editors/ConnectorsProperties.tsx`

| Field | Input | Default | Validation | Notes |
|---|---|---|---|---|
| Label | text | `'Connector'` | none | |
| Connector | select | `''` | empty option label "Pick a connector..." | Options sourced from `CONNECTOR_CATALOG` (`shared/connectors/catalog.ts`). |
| Description (read-only) | paragraph | — | — | Rendered from `definition.description` when a valid connector is selected. |
| Per-variable inputs | text | `''` (placeholder = `v.default`) | none | Generated from `definition.variables[]`. Each variable contributes one input + description paragraph. Stored under `data.config[v.key]`. |

**Failure / disabled states:**
- `connectorId` set but not in catalog ⇒ amber message: `Unknown connector id: <id>. Pick one from the list.`
- **Note F-07** (per `docs/superpowers/specs/2026-05-07-e2e-chrome-devtools-test-findings.md`): the validator `validateAgentRuntimeGraph` emits `unselected_connector` / `unknown_connector` errors but **no UI consumer reads them**. The editor itself only shows the "unknown" message inline; the empty-`connectorId` case is not surfaced anywhere outside this editor.

---

### Node: storage (`storage`)

Editor file: `src/panels/property-editors/StorageProperties.tsx`

| Field | Input | Default | Validation | Notes |
|---|---|---|---|---|
| Label | text | `'Storage'` | none | |
| Backend | select (`filesystem` only) | `'filesystem'` | none | Type allows `'filesystem'` only — no other backends defined. |
| Storage Path | text | `'~/.simple-agent-manager/storage'` | none | |
| Session Retention | number | `50` | min=1, parsed with fallback 50 | |
| Enable memory files | checkbox | `true` | none | When off, daily-memory toggle is hidden. |
| Maintain daily logs | checkbox | `true` | only shown when `memoryEnabled` | |
| Daily Reset | checkbox | `false` | none | |
| Daily Reset Hour | number | `4` | clamped 0–23 (line 110) | Shown only when daily reset enabled. |
| Idle Reset | checkbox | `false` | none | |
| Idle Reset Minutes | number | `60` | min=1 | Shown only when idle reset enabled. |
| Parent Fork Token Limit | number | `100000` | min=0 | |
| Maintenance Mode | select (`warn`/`enforce`) | `'warn'` | none | "warn (dry run)" vs "enforce (auto cleanup)". |
| Prune After (days) | number | `30` | min=1 | |
| Max Entries | number | `500` | min=1 | |
| Rotate Store (bytes) | number | `10485760` | min=0, fallback 10_485_760 | |
| Archive Retention (days) | number | `30` | min=0 | |
| Max Disk (bytes, 0=disabled) | number | `0` | min=0 | |
| High Water (%) | number | `80` | clamped 1–100 (line 243) | Only shown when `maxDiskBytes > 0`. |
| Interval (minutes) | number | `60` | min=1 | |

**Cross-node interactions:** Required (along with contextEngine) for chat to be enabled per the project CLAUDE.md.

**Failure / disabled states:**
- Daily-memory hidden when `memoryEnabled=false`.
- Daily-reset hour hidden when `dailyResetEnabled=false`.
- Idle reset minutes hidden when `idleResetEnabled=false`.
- High water % hidden when `maxDiskBytes=0`.
- Note from MEMORY: JSONL partial reads optimisation is open — large session files may stress this backend.

---

### Node: vectorDatabase (`vectorDatabase`)

Editor file: `src/panels/property-editors/VectorDatabaseProperties.tsx`

| Field | Input | Default | Validation | Notes |
|---|---|---|---|---|
| Label | text | `'Vector DB'` | none | |
| Provider | select (`chromadb`/`pinecone`/`qdrant`/`weaviate`) | `'chromadb'` | none | |
| Collection Name | text | `'default'` | none | |
| Connection String | text | `''` | none | Placeholder `http://localhost:8000`. |

**Cross-node interactions / status:** **This node is config-only.** Per project CLAUDE.md ("verify `connectors`, `vectorDatabase`, `cron`, and `mcp` behavior in code before documenting them as fully implemented"), no runtime adapter consumes these values today — the Context Engine's RAG toggles still exist as placeholders. The editor lets you pick a provider + collection + URL, but there is no observable runtime effect downstream. Worth flagging as a stale-config risk.

**Failure / disabled states:** None — every field is always editable. There is no connectivity check.

---

### Node: mcp (`mcp`)

Editor file: `src/panels/property-editors/MCPProperties.tsx`

| Field | Input | Default | Validation | Notes |
|---|---|---|---|---|
| Label | text | `'MCP'` | none | |
| Connection (read-only) | colored dot + text | `unknown` | — | Reads `useAgentConnectionStore.mcps[nodeId].status` and `.error`. Status options: `unknown`, `connecting`, `connected`, `error`, `disconnected`. |
| Transport | select (`stdio`/`http`/`sse`) | `'stdio'` | none | Tooltip describes each option. |
| Command (stdio) | text | `''` | none | Only shown when `transport=stdio`. Placeholder `npx`. |
| Args (stdio) | TokenList (chip + add) | `[]` | none | |
| Working Directory (stdio) | text | `''` | none | Empty = inherit server cwd. |
| Env (stdio) | KeyValueList | `{}` | none | Free-form k/v pairs. |
| URL (http/sse) | text | `''` | none | Only shown when remote. Placeholder `https://mcp.example.com/rpc`. |
| Headers (http/sse) | KeyValueList | `{}` | none | |
| Tool Prefix | text | `''` | none | Prepended to tool names from this server. |
| Allowed Tools | TokenList | `[]` | none | Empty = expose all tools. |
| Auto-connect | checkbox | `true` | none | When off, lazy-connect on first tool call. |

**Cross-node interactions:** Status badge is driven by an out-of-band websocket → `useAgentConnectionStore`. There is no test-connection button.

**Failure / disabled states:** Stdio fields hidden when remote; URL/Headers hidden when stdio. Error message rendered inline next to the status dot when present. Per CLAUDE.md, MCP behaviour is to be verified in code — runtime hookup may be partial.

---

### Node: subAgent (`subAgent`)

Editor file: `src/panels/property-editors/SubAgentProperties.tsx`

| Field | Input | Default | Validation | Notes |
|---|---|---|---|---|
| Validation banner — no Tools node | banner | — | shown when no Tools peripheral attached | Amber: "Required: attach a dedicated Tools node…". |
| Validation banner — no parent | banner | — | shown when no agent on outgoing edge | Slate: "Connect this sub-agent to an Agent node…". |
| Name | text | `''` | regex `/^[a-z][a-z0-9_-]{0,31}$/` (`SUB_AGENT_NAME_REGEX` from `shared/sub-agent-types.ts`); error message inline | |
| Description | text | `''` | none | |
| System Prompt | textarea (rows=4) | "You are a focused assistant. Complete the parent agent's task and report back concisely." | none | |
| Working Directory mode | select (`derived`/`custom`) | `'derived'` | none | `derived` shows preview path "parent cwd / subagent / `<name>`". |
| Working Directory (custom) | text | `''` | only shown when mode=`custom` | |
| Model mode | select (`inherit`/`custom`) | `'inherit'` | none | |
| Model (custom) | `ProviderModelPicker` or text fallback | `''` | none | Picker uses dedicated provider node attached to sub-agent if present, else parent agent's provider. Falls back to plain text input when no provider is in scope (with amber notice). |
| Thinking Level mode | select (`inherit`/`custom`) | `'inherit'` | none | |
| Thinking Level (custom) | select (off/minimal/.../xhigh) | `'off'` | only shown when mode=`custom` | |
| Override Allowlist | 4 checkboxes (`modelId`, `thinkingLevel`, `systemPromptAppend`, `enabledTools`) | `[]` | none | Each label has a tooltip explaining override semantics. Anything outside this set is rejected by `sessions_spawn`. |
| Recursive Sub-Agents | checkbox | `false` | none | Off-by-default with note "Recursion is disabled until product is ready." |

**Cross-node interactions:**
- Walks outgoing edges to find parent agent. First agent target wins.
- Walks own incoming edges for a dedicated `tools` node and dedicated `provider` node.
- Provider catalog: dedicated wins, else inherits from parent agent's provider. Source label ("dedicated"/"inherited") is rendered below the picker.

**Failure / disabled states:**
- Two banners (no tools, no parent) gate readiness.
- Name regex error inline below input.
- No-provider fallback shown when neither sub-agent nor parent has a provider.

---

### Node: cron (`cron`)

Editor file: `src/panels/property-editors/CronProperties.tsx`

| Field | Input | Default | Validation | Notes |
|---|---|---|---|---|
| Label | text | `'Cron Job'` | none | |
| Schedule (cron) | text | `'0 9 * * *'` | none — no live cron-syntax check | |
| Prompt | textarea | `''` | none | Message sent on each tick. |
| Enabled | checkbox | `true` | none | |
| Session Mode | select (`persistent`/`ephemeral`) | `'persistent'` | none | |
| Timezone | text | `'local'` | none — no IANA validation | |
| Max Run Duration (ms) | number | `300000` | min=0 | |
| Retention (days) | number | `7` | min=1 | Shown only when `sessionMode='ephemeral'`. |

**Cross-node interactions / status:** **Not in the default sidebar palette** — the palette in `src/panels/Sidebar.tsx` lists `agent`, `memory`, `tools`, `skills`, `contextEngine`, `agentComm`, `connectors`, `storage`, `vectorDatabase`, `mcp`, `provider`, `subAgent`. `cron` is in `NodeType` and has a registered renderer (`src/nodes/CronNode.tsx`) and editor, but cannot be created via drag-from-palette today. Manifest `docs/concepts/_manifest.json` per project CLAUDE.md is also missing a cron entry — flagged in CLAUDE.md as "If you change `cron`, create `docs/concepts/cron-node.md`."

**Failure / disabled states:** Retention hidden in persistent mode.

---

## End-to-End Test Scenarios

### TC2.1 — Properties panel opens for selected node and closes on deselect

1. Drag any node onto the canvas.
2. Click the node — expect the right-anchored panel to appear with the matching editor and a coloured dot + node label in the header.
3. Click the X button — expect the panel to disappear.
4. Click the node again, then click empty canvas — expect the panel to disappear (multi-/no-selection => `node` is undefined => panel returns null).

### TC2.2 — Resize handle persists width

1. Open the properties panel.
2. Drag the left-edge handle to widen the panel.
3. Reload the app.
4. Re-select a node — expect the previously persisted width (clamped 280–720) to be restored.

### TC2.3 — Agent default model is non-stale

1. Drop a fresh Agent node.
2. Expect `data.modelId === 'anthropic/claude-sonnet-4-6'` (current default after `6671b2c`). Document that the prior default `anthropic/claude-sonnet-4-20250514` is broken with OpenRouter (F-06).
3. Connect Provider (OpenRouter), Storage, Context Engine; send a chat — expect no "is not a valid model ID" error.

### TC2.4 — Agent Name lock after confirmation

1. Set `nameConfirmed=true` (via the persistence flow that confirms a saved agent).
2. Open the agent node — expect the name input to be disabled, opaque, and titled "Agent names cannot be changed after creation".

### TC2.5 — Thinking Level disabled when reasoning unsupported

1. Connect Provider + Agent.
2. Pick a model whose discovered metadata reports `reasoningSupported=false`.
3. Open Thinking Level — expect the dropdown disabled with title "This model does not support extended reasoning".

### TC2.6 — Manual prompt mode shows warning

1. Set Agent's System Prompt Mode to `manual`.
2. Expect amber banner: "You are fully responsible for the system prompt…".
3. Set back to `append` — banner disappears, and the "View full prompt" button reappears.

### TC2.7 — System Prompt Preview round-trips through server

1. With Agent in `append` mode, click "View full prompt".
2. Expect a modal with sections from `/api/agents/:id/resolved-system-prompt`.
3. Expand-all / collapse-all, total tokens displayed at the bottom.
4. Close the modal.

### TC2.8 — Memory External fields hidden in builtin mode

1. New Memory node — Backend defaults to `builtin`; external endpoint/API-key fields hidden.
2. Switch to `external` — expect endpoint + key inputs.
3. Verify password input masks the API key.

### TC2.9 — Tools profile presets and individual override

1. Set profile to `coding` — expect tool groups to switch to `runtime/fs/coding` and `human` (per `TOOL_PROFILES`).
2. Toggle one group — profile auto-switches to `custom`.
3. With profile=`custom`, expect HITL tools (`ask_user`, `confirm_action`) checked AND disabled (locked) when `safety.allowDisableHitl=false`.
4. Enable Dangerous Fully Auto in Settings — expect HITL checkboxes unlock.

### TC2.10 — Tools sub-pages navigation

1. Open Tools editor.
2. Click each "Configure" page link in turn (`exec`, `code_execution`, `web_search`, `image`, `canva`, `browser`, `text_to_speech`, `music_generate`, `Sub-Agents`).
3. Each page shows a back arrow, a SchemaForm-rendered list of fields with the documented defaults, and validation bounds (e.g. browser viewport min/max).
4. Browser page: switch `screenshotFormat` to `png` — `screenshotQuality` field disappears.
5. Sub-Agents page: when `subAgentSpawning=false`, `maxSubAgents` is hidden.

### TC2.11 — Browser CDP launcher posts to backend

1. Open Tools → browser.
2. Set port 9222, click "Launch Chrome" — expect a `POST /api/browser/launch-chrome` and either an emerald "Chrome launched" message or amber/red error.
3. On success, the `cdpEndpoint` field is populated.

### TC2.12 — Image preferred-model picker switches by provider

1. Open Tools → image with no agent connected — expect plain text input with amber "No agent connected." hint.
2. Connect an OpenRouter provider but with model catalog not loaded — expect text input with amber "OpenRouter catalog not loaded." hint.
3. Sync the catalog — expect a select listing image-capable models.
4. Connect a non-OpenRouter provider — expect text input with slate hint and the connected provider name.

### TC2.13 — Skills node toggles update enabledSkills

1. New Skills node — defaults to `['code_generation', 'summarization']`.
2. Toggle each preset checkbox; add a custom skill via the input and Enter; remove via uncheck/duplicate-add ignored.
3. Verify the Skills node only writes to `enabledSkills: string[]`. There is no inline `name`+`body` editor; rich `SkillDefinition` entries live on Tools node, not Skills node.

### TC2.14 — Context Engine inherits token budget when connected

1. Drop Context Engine node alone — Token Budget editable, default 128000.
2. Connect to Agent without provider — still editable with amber "Model metadata unavailable — set manually".
3. Connect Agent → Provider, sync catalog, pick a model with known `contextWindow` — expect Token Budget to flip to a read-only "inherited" badge with `From <modelId>`.

### TC2.15 — Manual compaction button in Context Engine

1. Set Compaction Trigger to `manual`.
2. Confirm "Compact Now" button is disabled when no chat session is active.
3. Open chat for the connected agent and accumulate enough messages.
4. Click "Compact Now" — expect either an OK message ("Compacted X → Y messages…") or an error message inline.

### TC2.16 — Context Engine post-compaction target capped

1. Set `tokenBudget=10000`, `reservedForResponse=2000`.
2. Try to set `postCompactionTokenTarget=20000` — input's `max=8000` clamps the slider/typed value. Description text shows the cap.

### TC2.17 — Agent Comm target list and limits

1. Drop two Agent nodes and one Agent Comm node.
2. Open Agent Comm — Target Agent select lists both agents (current implementation does NOT filter out the connected agent despite the comment).
3. Edit `maxTurns`, `maxDepth`, `tokenBudget`, `rateLimitPerMinute`, `messageSizeCap` — values flow into `data` immediately. None have upper-bound validation.

### TC2.18 — Connector picker + variables form

1. Drop a Connectors node.
2. Without picking, no variable inputs render; the validator emits `unselected_connector` but **no UI surfaces this** (F-07).
3. Pick `github` — description appears + per-variable inputs render with placeholders from catalog defaults.
4. Type a value — `data.config[v.key]` updates immediately.
5. Type a stale `connectorId` directly into state — amber "Unknown connector id" message renders.

### TC2.19 — Storage conditional fields

1. Drop a Storage node.
2. Toggle off `memoryEnabled` — daily-memory toggle disappears.
3. Toggle on Daily Reset — Daily Reset Hour appears; verify clamp to 0–23.
4. Toggle on Idle Reset — Idle Reset Minutes appears.
5. Set Max Disk to >0 — High Water (%) appears; verify clamp to 1–100.
6. Switch Maintenance Mode between `warn` and `enforce`.

### TC2.20 — Vector DB editor records config but no runtime hookup

1. Drop a Vector DB node, configure provider/collection/URL.
2. Verify values persist across reloads.
3. Document: no runtime adapter consumes these values today — config-only per CLAUDE.md.

### TC2.21 — MCP transport switching reveals correct fields

1. Drop an MCP node (default `stdio`).
2. Verify `Command`, `Args`, `Working Directory`, `Env` shown; URL/Headers hidden.
3. Switch transport to `http` (or `sse`) — stdio fields hidden, `URL` and `Headers` shown.
4. Add a key/value pair to Headers via the `+` button; remove via the `x` chip.
5. Status badge reflects `useAgentConnectionStore.mcps[nodeId]` — initially `unknown`.

### TC2.22 — Sub-Agent validation banners and overrides

1. Drop a Sub-Agent node alone — expect both banners ("attach a Tools node", "Connect to an Agent").
2. Connect a Tools node and an Agent — banners clear in turn.
3. Type an invalid name like "1bad" — amber regex error; valid name like "researcher" clears it.
4. Switch model mode to `custom` and use the picker; verify "Provider source: dedicated/inherited" subtext.
5. Toggle each override-allowlist checkbox; tooltips appear on hover.
6. Verify Recursive Sub-Agents defaults to off.

### TC2.23 — Cron editor reachable only via persisted graph

1. Verify `cron` is **not** in the Sidebar palette (Sidebar.tsx).
2. Inject a `cron` node into the graph store directly (e.g. via test fixture).
3. Open its editor — verify all fields and that `Retention (days)` is hidden in persistent mode.
4. Note: per CLAUDE.md, `docs/concepts/cron-node.md` does not yet exist; `_manifest.json` lacks the entry.

### TC2.24 — Delete node from header trash icon

1. Select any node, click trash icon in panel header.
2. Expect the node removed from the canvas and the panel collapsed (selection cleared).

### TC2.25 — Provider switching resets dependent fields

1. Drop a Provider node (default `openrouter`).
2. Switch the Provider select to a different plugin — `authMethodId`, `envVar`, `baseUrl` are reset to that plugin's first auth method's defaults.
3. With a multi-auth provider, the Auth Method dropdown appears; switching it updates `envVar` placeholder.
