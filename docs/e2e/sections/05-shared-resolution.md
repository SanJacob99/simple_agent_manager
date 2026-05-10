# Section 5 — Shared Resolution Layer

<!-- last-verified: 2026-05-08 -->

## Scope

The shared layer is the deterministic glue between the graph editor (`src/`) and the runtime/server (`server/`). It converts a React Flow graph into a serializable `AgentConfig`, assembles the SAM-authored system prompt, resolves tool name aliases/groups/profiles, estimates tokens, and defines every wire-protocol type the WebSocket and REST surfaces consume.

## Graph → AgentConfig Resolution

### Entry points

- **Resolver:** `src/utils/graph-to-agent.ts` — `resolveAgentConfig(agentNodeId, nodes, edges, { safetyGuardrails? })`. Returns `AgentConfig | null`. Browser-side only (calls `useToolCatalogStore.getState()` and `Intl.DateTimeFormat`).
- **Validator:** `src/utils/graph-to-agent.ts` — `validateAgentRuntimeGraph(agentNodeId, nodes, edges)` returns `AgentGraphValidationError[]`. Pure / boundary-free.
- **Compatibility shim:** `src/runtime/agent-config.ts` only re-exports types from `shared/agent-config.ts`. The CLAUDE.md convention is "prefer `shared/` over `src/runtime/agent-config.ts`."

### Inputs

- `nodes: AppNode[]` and `edges: Edge[]` from React Flow / `src/store/graph-store.ts`.
- `agentNodeId` to root the resolve at one agent.
- `options.safetyGuardrails` — extra text appended to the Safety section of the system prompt.
- Live state read inside the resolver:
  - `useToolCatalogStore.getState()` — server-discovered tool names that augment `IMPLEMENTED_TOOL_NAMES` for the prompt's "Enabled tools" line.
  - `Intl.DateTimeFormat().resolvedOptions().timeZone` and `new Date().toISOString()` for the prompt's Time section.
  - `navigator.platform` (server-side build path skips this).
  - `process.env[name]` for connector secret materialization (only meaningful when the resolver runs on the backend; in the browser this is `undefined` and `buildEnv` returns `{}`).

### Output shape (`shared/agent-config.ts:AgentConfig`)

| Field | Source / mapping |
|---|---|
| `id` | `agentNodeId` |
| `version` | hard-coded `2` |
| `name`, `description`, `tags` | agent node `data` |
| `provider` | first connected `provider` node (else `{ pluginId:'', authMethodId:'', envVar:'', baseUrl:'' }`) |
| `modelId`, `thinkingLevel`, `modelCapabilities` | agent node `data` |
| `systemPrompt` | `buildSystemPrompt({ ... })` → `ResolvedSystemPrompt` |
| `memory` | first connected `memory` node, else `null` |
| `tools` | first connected `tools` node, else `null` (raw selections, not expanded names) |
| `contextEngine` | first connected `contextEngine` node, else `null` |
| `agentComm` | every connected `agentComm` node mapped to `ResolvedAgentCommConfig` |
| `storage` | first connected `storage` node, else `null` |
| `vectorDatabases` | every connected `vectorDatabase` node |
| `crons` | every connected `cron` node |
| `mcps` | union of `mcp` nodes plus connector-derived MCP entries |
| `subAgents` | every connected `subAgent` node, conflicts skipped |
| `workspacePath` | `tools.toolSettings.exec.cwd` overrides agent `data.workingDirectory`; else `data.workingDirectory \|\| null` |
| `sandboxWorkdir` | `tools.toolSettings.exec.sandboxWorkdir ?? false` |
| `xaiApiKey`, `xaiModel`, `tavilyApiKey`, `openaiApiKey`, `geminiApiKey`, `imageModel`, `canvaPort*`, `browser*`, `*Tts*`, `*Music*` | mirrored from `tools.toolSettings.<group>.<key>`; only set when truthy |
| `exportedAt` | `Date.now()` |
| `sourceGraphId` | duplicates `agentNodeId` |
| `runTimeoutMs` | hard-coded `172_800_000` (48h) |
| `showReasoning`, `verbose` | agent node `data` (falsy default) |

### Resolution rules (in execution order)

1. **Agent root validation.** Resolver returns `null` if `agentNodeId` is missing or does not have `data.type === 'agent'`. There is no error thrown — the chat flow treats `null` as "not ready."
2. **Peripheral discovery.** Only edges whose `target === agentNodeId` are followed; sources are looked up in `nodes`. Missing source ids are silently filtered out (per-edge `find` + filter).
3. **One-of vs many-of nodes.** Resolver uses `find` (first match wins) for `provider`, `memory`, `tools`, `contextEngine`, `storage`. It uses `filter` (collect all) for `agentComm`, `vectorDatabase`, `cron`, `mcp`, `connectors`, `subAgent`, `skills`. Duplicates of "one-of" nodes are silently ignored at resolve time; only the provider gets a validator error (`duplicate_provider`).
4. **Tool resolution order — `profile → groups → enabledTools → plugins`.** Implemented in `shared/resolve-tool-names.ts:resolveToolNames`. `enabledGroups` is the source of truth when non-empty; otherwise `TOOL_PROFILES[profile]` is used as a fallback. `resolvedTools` (`enabledTools` from the node) is merged in. Each enabled plugin's `tools` array is merged in last. All names are canonicalized via `TOOL_NAME_ALIASES` (`bash → exec`, `code_interpreter → code_execution`).
5. **Skill folding.** `ToolsNode.skills` is concatenated with every connected `SkillsNode.enabledSkills` (the skills-node entries become bare `SkillDefinition` records with empty `content`). Then per-tool inline overrides at `toolSettings.<group>.skill` are appended as `SkillDefinition` entries with id `tool-skill-<id>` and the user text in `content`. The full union becomes `tools.skills` on the resolved config and is what the system prompt's Skills section reads.
6. **Bundled-skills filtering.** `eligibleBundledSkills(resolvedToolNames)` from `shared/default-tool-skills.ts` returns `EligibleSkillReference[]` for each tool whose name is in the resolved tool list. Skills whose tool was overridden inline (tracked by `overriddenToolIds`) are filtered out so the model isn't shown both an inline override and a generic SKILL.md reference.
7. **System-prompt tool summary filter.** The prompt's "Enabled tools" line is filtered by `IMPLEMENTED_TOOL_NAMES ∪ tool-catalog-store.tools`. Names that are unimplemented and not user-installed are hidden from the prompt — but they remain in `tools.resolvedTools` and are still sent to the runtime.
8. **System-prompt mode resolution.** `data.systemPromptMode === 'manual'` → `manual`; anything else → `append` (no `auto` path observed today). In `manual` mode the user instructions become the entire prompt; in `append` mode SAM's auto-built sections come first and user instructions are appended as a final `User Instructions` section if non-empty.
9. **Sub-agent conflict resolution.** Sub-agents are deduped by `data.name`. If two `subAgent` nodes share a name, both are skipped (added to `conflictedNames`). A resolved sub-agent is also dropped if its `data.name` fails `SUB_AGENT_NAME_REGEX = /^[a-z][a-z0-9_-]{0,31}$/`, or if it has zero or more than one connected Tools node.
10. **Sub-agent inheritance.** For each surviving sub-agent: provider inherits from parent unless dedicated; `modelId`/`thinkingLevel` inherit unless `*Mode === 'custom'`; `modelCapabilities` inherits when sub's own object is empty (`Object.keys(...) === 0`); skills are `parent ∪ dedicated` deduped by id (dedicated wins); MCPs are `parent ∪ dedicated` deduped by `mcpNodeId` (dedicated wins). Working directory: when `workingDirectoryMode === 'custom'`, use `data.workingDirectory`; else derive `posix.join(parent.workspacePath, 'subagent', name)`.
11. **Agent-comm defaults.** When a value is missing or wrong-typed on the node, the resolver substitutes: `maxTurns = 10`, `maxDepth = 3`, `tokenBudget = 100_000`, `rateLimitPerMinute = 30`, `messageSizeCap = 16_000`, `direction = 'bidirectional'` (only `'outbound'` and `'inbound'` are accepted as alternatives). Target agent name is derived by looking up `targetAgentNodeId` in `nodes` at resolve time.
12. **Connector → MCP folding.** Each `connectors` node whose `connectorId` is in `CONNECTOR_CATALOG` is appended to `mcps` as a `ResolvedMcpConfig` with `transport`, `command`, `args`, `url` from the catalog entry, env from `def.buildEnv(values)`, `autoConnect: true`, empty `headers`/`cwd`/`allowedTools`. Unknown / empty `connectorId` is silently skipped here — the validator covers both cases.
13. **Cron serialization.** Each `cron` node is mapped 1:1 to `ResolvedCronConfig`: `cronNodeId`, `label`, `schedule` (string), `prompt`, `enabled`, `sessionMode`, `timezone`, `maxRunDurationMs`, `retentionDays`. No format validation on `schedule` at resolve time.
14. **Vector database resolution.** Config-only: each `vectorDatabase` node yields `{ label, provider, collectionName, connectionString }`. There is no runtime wiring on the resolver side beyond emitting the config — verify in server code before claiming it is functional.
15. **Storage resolution.** All 18 storage fields are passed through unchanged from the storage node `data`. No defaults applied at resolve time — defaults live on the node defaults in `src/utils/default-nodes.ts` and on the storage engine itself.
16. **Memory resolution.** All 12 memory fields pass through. `searchMode`, `compactionStrategy`, `backend` are stored as the literals from the node.
17. **Context engine resolution.** All numeric fields pass through. `summaryModelId` defaults to `''` (interpreted by the runtime as "inherit agent's model"). `postCompactionTokenTarget` is left optional and resolved at runtime to `tokenBudget - reservedForResponse` when omitted.
18. **MCP resolution.** Each `mcp` node yields a `ResolvedMcpConfig` with the raw fields and `mcpNodeId` set so the server's `mcp:status` events can correlate back to the UI node.
19. **Workspace path precedence.** `tools.toolSettings.exec.cwd` (when truthy) wins over `agent.data.workingDirectory`. The agent-level value is itself optional; final value can be `null`.
20. **Per-tool override extraction.** API keys, voices, models, browser settings, image models, etc. are pulled from `tools.toolSettings.*` and emitted at the top level of `AgentConfig`. Each is conditional on `toolsNode.data.type === 'tools'` so an agent without a Tools node still resolves.

### Validation: `validateAgentRuntimeGraph`

| Code | Triggered when | Where consumed |
|---|---|---|
| `missing_provider` | zero connected `provider` nodes | **F-07: nowhere in the UI today.** Function is exported and unit-tested but no React component calls it. |
| `duplicate_provider` | more than one connected `provider` node | same — not consumed |
| `empty_plugin_id` | provider node connected but `pluginId === ''` | same — not consumed |
| `unselected_connector` | connector node has empty `connectorId` | same — not consumed |
| `unknown_connector` | connector node references an id not in `CONNECTOR_CATALOG` | same — not consumed |

The connector path also silently skips bad connectors during resolution (`graph-to-agent.ts:413`), so a misconfigured connector results in a working agent that simply lacks the connector — with no banner, badge, or error message. Wire-up is open work; recorded as F-07.

## System Prompt Assembly

`shared/system-prompt-builder.ts:buildSystemPrompt(input)` returns `ResolvedSystemPrompt = { mode, sections, assembled, userInstructions }`. `assembled` is `sections.map(s => s.content).join('\n\n')`. Each section carries a `tokenEstimate` from `estimateTokens()`.

### Mode handling

- `manual` — single section keyed `manual`. `assembled = userInstructions`. Auto sections are not produced.
- `append` (default for any non-`manual` value) — auto sections built, then a final `userInstructions` section appended only when `userInstructions.trim()` is non-empty.

### Section order in `append` mode

1. `identity` — always. Static SAM brand block (`# SAM Agent ...`).
2. `tooling` — emitted only when `toolsSummary` is non-null. Body is the static `TOOLING_GUIDANCE` followed by `### Enabled tools\n\n<comma-separated names>`.
3. `executionBias` — always. Static block.
4. `safety` — always. `DEFAULT_SAFETY` plus `\n\n${safetyGuardrails.trim()}` when caller passed text.
5. `trustBoundaries` — always. Static prompt-injection defense.
6. `skills` — emitted only when `skillsSummary` is non-null. Body is `## Skills\n\n${skillsSummary}` where the resolver pre-builds `skillsSummary` as up to three sub-blocks: `### Available` (bundled SKILL.md references), `### Tags` (bare skill names), and one `### <Name>` block per inline-content skill.
7. `selfUpdate` — emitted only when `selfUpdate.enabled === true`. Lists tool names for `schemaLookup`, `patch`, `apply`, `runUpdate` (defaults: `config.schema.lookup`, `config.patch`, `config.apply`, `update.run`). Adds protected-paths line. The browser resolver does not pass `selfUpdate`, so this section is server-side only today.
8. `workspace` — emitted only when `workspacePath` is non-null. Optional bootstrap files truncated per `bootstrapMaxChars` (per file) and `bootstrapTotalMaxChars` (cumulative). Resolver hardcodes 20_000 / 150_000 and passes `bootstrapFiles: null`.
9. `documentation` — emitted only when `docsPath` is set. Browser resolver does not pass it.
10. `sandbox` — emitted only when `sandbox` is set. Browser resolver does not pass it.
11. `time` — emitted only when `timezone` is non-null. Body uses `nowIso ?? new Date().toISOString()`.
12. `replyTags` — emitted only when caller passed `replyTags`. Browser resolver does not.
13. `heartbeats` — same.
14. `runtime` — always. One-line summary `host=... | os=... | model=... | repo=...` (`thinking=` is intentionally omitted to avoid Gemini's plain-text-thinking trigger; level travels via API `reasoning.effort`).
15. `reasoning` — always. Reads `reasoningVisibility` (`off` default) and `runtimeMeta.thinkingLevel`.

### Skills sub-section composition (in resolver, before builder)

- `bundledRefs = eligibleBundledSkills(resolvedToolNamesList).filter(ref => !overriddenToolIds.has(ref.id))` — only emitted when at least one bundled skill survives the override filter; preamble tells the model to load on demand via `read_file`.
- `bareSkills = allSkills.filter(s => !s.content.trim())` — listed under `### Tags`.
- `richSkills = allSkills.filter(s => s.content.trim())` — each gets its own `### <name>\n\n<content.trim()>` section.

## Tool Name Resolution

- `TOOL_NAME_ALIASES = { bash → exec, code_interpreter → code_execution }`. `canonicalizeToolName` is applied on every add inside `resolveToolNames`, so saved configs holding aliases silently land on canonical names.
- `TOOL_GROUPS` (in `shared/resolve-tool-names.ts`):
  - `runtime`: `exec, code_execution`
  - `fs`: `read_file, write_file, edit_file, list_directory, apply_patch`
  - `web`: `web_search, web_fetch, browser`
  - `coding`: `exec, read_file, write_file, code_execution`
  - `media`: `image, image_generate, show_image, canva, music_generate`
  - `communication`: `send_message, text_to_speech`
  - `human`: `ask_user, confirm_action`
  - `sessions`: `sessions_list, sessions_history, sessions_send, sessions_spawn, sessions_yield, subagents, session_status`
- `TOOL_PROFILES`:
  - `full`: `runtime, fs, web, coding, communication`
  - `coding`: `runtime, fs, coding`
  - `messaging`: `web, communication`
  - `minimal`: `web`
  - `custom`: `[]`
- `IMPLEMENTED_TOOL_NAMES` set is used only by the system-prompt summary filter, never by the resolver's `resolvedTools` array. Memory tools (`memory_search`, `memory_save`, `memory_get`) are intentionally absent from `TOOL_GROUPS` and managed by the Memory node.
- `ALL_TOOL_NAMES` is the canonical list shown in the Tools node picker (no aliases listed) and includes all session tools.
- `shared/tool-catalog.ts:ToolCatalogEntry` is the wire format for `GET /api/tools` and feeds the Zustand `tool-catalog-store`. The store augments the prompt's tool-summary filter (`catalogKnown` set) for user-installed tools.
- User tool manifests (`shared/user-tool-manifest.ts`) describe `sam.json` for tools installed via the CLI; the server reads `disabled` to decide whether to load `*.module.ts`. The resolver does not look at this directly — the catalog response already filters disabled tools.

## Token Estimation & Context Usage

### Estimator (`shared/token-estimator.ts`)

- Pure heuristic, no tokenizer per provider. `CHARS_PER_TOKEN_ESTIMATE = 4`.
- `estimateStringChars` inflates non-Latin (CJK Unified, CJK Ext A, Hangul, CJK Compat, CJK Ext B+) characters to 4 chars each so the `chars/4` formula stays accurate for ideographic scripts.
- `estimateTokens(text)` = `ceil(max(0, estimateStringChars(text)) / 4)`.
- `estimateMessagesTokens(messages)` recurses into structured content arrays; each `{type:'image'}` part contributes a fixed `IMAGE_TOKEN_ESTIMATE = 300` tokens.
- Used by `system-prompt-builder.makeSection` to populate `tokenEstimate` on every section.
- Ground truth post-turn is the provider's `usage.totalTokens` — see `contextTokensFromUsage` in `shared/context-usage.ts`.

### Context usage (`shared/context-usage.ts`)

- `ContextUsage` has `source: 'actual' | 'preview' | 'persisted'`.
- `contextTokensFromUsage` prefers `usage.totalTokens` > 0; else `input + cacheRead + cacheWrite`. Output tokens are NOT counted toward context fill.
- `foldActualIntoBreakdown(preview, actualTotal)` keeps `systemPrompt`, `skills`, `tools` stable from the preview snapshot and recomputes `messages = max(0, actualTotal - (sysprompt + skills + tools))`.
- `TRANSCRIPT_SYSTEM_PROMPT_TYPE = 'sam.system_prompt'` — custom transcript entry shape that records the resolved prompt for one run; never replayed into the model.
- `ContextUsageBreakdown.skillsEntries` / `toolsEntries` are sorted descending server-side.

## Protocol & Run Types

### Commands (`shared/protocol.ts`, frontend → backend)

`agent:start`, `agent:prompt`, `agent:abort`, `agent:destroy`, `agent:sync`, `agent:dispatch`, `hitl:respond`, `hitl:list`, `session:set-config`, `run:wait`, `config:setApiKeys`, plus the SAMAgent set: `samAgent:start`, `samAgent:prompt`, `samAgent:abort`, `samAgent:clear`, `samAgent:hitlRespond`, `samAgent:patchState`. The discriminated union `Command` is exported.

### Server events (`shared/protocol.ts`, backend → frontend)

`agent:ready`, `agent:error`, `message:start`, `message:delta`, `message:end`, `tool:start`, `tool:end`, `agent:end`, `agent:state`, `run:accepted`, `queue:entered`, `queue:updated`, `queue:left`, `run:wait:result`, `lifecycle:start`, `lifecycle:end`, `lifecycle:error`, `reasoning:start`, `reasoning:delta`, `reasoning:end`, `message:suppressed`, `compaction:start`, `compaction:end`, `tool:summary`, `hitl:input_required`, `hitl:resolved`, `hitl:list:result`, `context:usage`, `mcp:status`, plus the SAMAgent envelope (`samAgent:event` wrapping `SamAgentEvent`, or `samAgent:transcript`). The discriminated union `ServerEvent` is exported.

### Run lifecycle (`shared/run-types.ts`)

- `DispatchResult` = `{ runId, sessionId, acceptedAt }`
- `WaitResult.status` ∈ `'ok' | 'error' | 'timeout'`; `phase` ∈ `'pending' | 'running' | 'completed' | 'error'`
- `StructuredError.code` ∈ `'model_refused' | 'rate_limited' | 'timeout' | 'aborted' | 'internal'` with `retriable: boolean`
- `RunPayload.type` ∈ `'text' | 'reasoning' | 'tool_summary' | 'error'`
- `RunUsage` = `{ input, output, cacheRead, cacheWrite, totalTokens }`
- `CoordinatorEvent` is the internal event union the run coordinator emits and the server fans out as `ServerEvent`s.

### Channel & session boundaries

- `shared/agent-comm-types.ts:AGENT_COMM_ERROR_CODES` = `topology_violation, direction_violation, message_too_large, rate_limited, receiver_unavailable, channel_sealed, depth_exceeded, token_budget_exceeded, max_turns_reached, internal_error`. `AgentCommSealReason` = `max_turns_reached | token_budget_exceeded | manual`.
- `ChannelSessionMeta` carries the canonical `[lo, hi]` agent-id pair, names, owner agent id, turn/token counts, seal state, and last-activity ISO timestamp.
- `AgentCommAuditEvent` records `send`, `limit-tripped`, `wake-cancelled`, `sealed` events on the channel transcript.

### Sub-agent contract (`shared/sub-agent-types.ts`)

- `SubAgentOverridableField` ∈ `'modelId' | 'thinkingLevel' | 'systemPromptAppend' | 'enabledTools'`.
- `SubAgentSessionMeta` = sub-session registry record with `subAgentId`, `subAgentName`, `parentSessionKey`, `parentRunId`, `status` (`running | completed | error | killed`), `sealed`, `appliedOverrides`, `modelId`, `providerPluginId`, `startedAt`, `endedAt?`.
- `SUB_AGENT_NAME_REGEX = /^[a-z][a-z0-9_-]{0,31}$/`.

### Storage / session shape (`shared/storage-types.ts`)

- `SessionStoreEntry` is the wire shape returned by the session store; carries `chatType` (`direct | group | room`), per-session token counters, `contextTokens`, optional `contextBreakdown`, optional `resolvedSystemPrompt`, `compactionCount`, `parentSessionId`, optional `subAgentMeta`, optional `channelMeta`.
- `SessionEntry` is the generic transcript entry shape (untyped `[key:string]:unknown`) imported by the session router.
- `MaintenanceReport`, `ForkPoint`, `BranchTree`, `SessionLineage` belong here too.
- `shared/session-routes.ts` declares the REST shapes for `/api/sessions/*`: `SessionRouteRequest/Response`, `SessionTranscriptResponse`, `SessionCompactResponse`.

### Diagnostics (`shared/session-diagnostics.ts`)

- `RUN_DIAGNOSTIC_CUSTOM_TYPE = 'sam.run_diagnostic'` with `RunErrorDiagnosticData | EmptyReplyDiagnosticData` payloads.
- `SUB_AGENT_RESUME_CUSTOM_TYPE = 'sam.sub_agent_resume'`, `SUB_AGENT_SPAWN_CUSTOM_TYPE = 'sam.sub_agent_spawn'`.

### SAMAgent protocol (`shared/sam-agent/`)

- `protocol-types.ts`: `SamAgentMessage`, `SamAgentToolResult`, `SamAgentEvent` (`message:* | tool:* | lifecycle:* | hitl:*`), envelope `SamAgentEventEnvelope`, `SamAgentHitlAnswer` (text/confirm/cancelled).
- `workflow-patch.ts`: `WorkflowPatch` shape (`add_nodes`, `update_nodes`, `remove_nodes`, `add_edges`, `remove_edges`, `rationale`), `GraphSnapshot`, `redactGraphSnapshot` (drops React Flow positions, redacts secret-keyed fields by case-insensitive `SECRET_KEY_PATTERN`), `isWorkflowPatch` shallow validator.

### Audio (`shared/audio-format.ts`)

- `isPcmMimeType` matches `audio/l16`, `audio/pcm`, `audio/x-pcm`, `audio/basic`.
- `pcmParamsForProvider`: ElevenLabs 16k mono 16-bit, MiniMax 32k mono 16-bit, default (Google/OpenAI/OpenRouter) 24k mono 16-bit.
- `wrapPcmAsWav` writes a 44-byte RIFF/WAVE header in front of raw PCM bytes — used both server-side (TTS pipeline) and client-side (retrocompat for old transcripts).

### Visible-text sanitizer (`shared/text/`)

- `sanitizeAssistantVisibleText(text)` runs four stages:
  1. `stripModelSpecialTokens` — strips `<|...|>` and `<｜...｜>` Harmony-style delimiters; preserves matches inside fenced code or inline code spans (`code-regions.ts`).
  2. `stripReasoningTagsFromText` — strips `<think>`, `<thinking>`, `<thought>`, `<antthinking>`, `<final>` (with `antml:` prefix variants); also code-region-aware.
  3. `stripThoughtChannelPreamble` — Gemini-3.x preview workaround that detects the `>thought\n` sentinel up to 10 chars in.
  4. `stripUndelimitedThought` — handles `ALWAYS START your thought` recap and `I (can|will|should|need to) (inform|tell|respond|reply|let|update) the user...` bridges.
- `sanitizeAssistantContentBlocks<T>(blocks)` only mutates `{type:'text', text:string}` entries.

## Connectors Catalog (`shared/connectors/catalog.ts`)

- One entry today: `github`. Stdio MCP via `npx -y @modelcontextprotocol/server-github`. One variable: `tokenEnvVar` (default `GITHUB_PERSONAL_ACCESS_TOKEN`). Tool prefix `github_`.
- `buildEnv(values)` reads `process.env[name]` at resolve time. If the env var is unset, the returned env map is empty (the MCP server then fails at runtime). The graph file never stores the secret.
- `ConnectorDefinition` shape: `{ id, label, description, mcp: { transport, command?, args?, url? }, variables: ConnectorVariable[], toolPrefix, buildEnv }`.
- The resolver consumes a connector by:
  1. Looking up `CONNECTOR_CATALOG[node.data.connectorId]`.
  2. Materializing each variable via `node.data.config?.[v.key] ?? v.default`.
  3. Pushing one entry into `mcps` with the catalog command/args/url, `def.buildEnv(values)`, `autoConnect: true`, `mcpNodeId = node.id`.
- Ambiguous behavior: connector entries in `mcps` carry `toolPrefix` from the catalog but `allowedTools: []` — no allowlist scoping is applied at resolve time.

## Plugin SDK & Tool Manifests

### Provider plugin SDK (`shared/plugin-sdk/`)

- `ProviderPluginDefinition`: `{ id, name, description, runtimeProviderId, defaultBaseUrl, auth: ProviderAuthMethod[], catalog?, wrapStreamFn?, webSearch?, webFetch? }`.
- `ProviderAuthMethod`: `{ methodId, label, type:'api-key', envVar?, usesSavedKey?, validate? }`. Only `'api-key'` auth is modelled today.
- `ProviderPluginCatalog.refresh(ctx)` returns `{ models, userModels? }` keyed by id. Maps to `shared/model-catalog.ts:ProviderCatalogResponse` on the wire (`{ models, userModels, syncedAt, userModelsRequireRefresh }`).
- `ProviderPluginSummary` is the client-safe version returned by the server (no `validate`, no `catalog.refresh`).
- `composeProviderStreamWrappers(base, ...wrappers)` runs each wrapper in order; falsy wrappers are skipped.
- `WebSearchProviderPlugin` / `WebFetchProviderPlugin` declare `{ id, label, createTool(ctx) }` returning a typed `AgentTool<TSchema>` from `pi-agent-core`.
- `definePluginEntry(definition)` is a passthrough type helper for `*.plugin.ts` files.

### User tool manifests (`shared/user-tool-manifest.ts`)

- `sam.json` schema (TypeBox): `{ name, version, source, disabled }`. Required-fields-only by design; optional fields are stubbed in `// TODO:` comments.
- `MANIFEST_FILENAME = 'sam.json'`.
- The CLI (`bin/lib/manifest.js`) and the server registry both read this file. The shared schema is the source of truth; the CLI has its own JS-shape validator that must stay in sync.

## End-to-End Test Scenarios

1. **Resolver returns null for missing agent.** `resolveAgentConfig('non-existent', [], [])` → `null`. No throw.
2. **One Provider, one Storage, one ContextEngine produce a valid AgentConfig.** Resolves to non-null with `provider.pluginId === '<plugin>'`, `storage !== null`, `contextEngine !== null`, `version === 2`, `runTimeoutMs === 172_800_000`.
3. **Default agent model F-06 reproduction.** A bare agent default has `modelId === 'anthropic/claude-sonnet-4-20250514'` (per `src/utils/default-nodes.ts`); after resolution, `AgentConfig.modelId` matches and the runtime errors against OpenRouter. Test asserts the default value and flags it as known-bad.
4. **Validator missing-provider error is unsurfaced.** Build a graph with no Provider → Connect Connector → Open chat. Assert: `validateAgentRuntimeGraph` returns `[{code:'missing_provider'}]`, but no DOM node mentions it (F-07: function never called by UI).
5. **Validator catches duplicate Provider.** Two `provider` nodes connected to the same agent → validator returns `duplicate_provider`. Resolver still emits one (first wins).
6. **Validator catches empty plugin id.** Provider connected with `pluginId === ''` → validator returns `empty_plugin_id`. Resolver emits a config with empty `provider.pluginId`.
7. **Connector with empty connectorId silently skipped.** Connector node connected, `connectorId === ''`. Resolver: `mcps` has no connector entry. Validator: `unselected_connector` (UI ignores per F-07).
8. **Connector with unknown connectorId silently skipped.** Same as above with `connectorId === 'made-up'` → `unknown_connector`. Resolver does not throw.
9. **GitHub connector with token resolves to MCP entry.** Set `process.env.GITHUB_PERSONAL_ACCESS_TOKEN = 'tok'` then run resolver. Assert: `mcps[0].command === 'npx'`, `args` includes `'@modelcontextprotocol/server-github'`, `env.GITHUB_PERSONAL_ACCESS_TOKEN === 'tok'`, `toolPrefix === 'github_'`, `autoConnect === true`.
10. **Tool resolution: profile fallback only when no groups.** Tools node `profile = 'coding'`, `enabledGroups = []`, `enabledTools = []`. `resolveToolNames` returns the `coding` profile expansion = `runtime ∪ fs ∪ coding` deduped.
11. **Tool resolution: groups override profile.** `profile = 'minimal'`, `enabledGroups = ['runtime']`. Result is `runtime` group only — `web` (the `minimal` profile) is NOT included.
12. **Tool alias canonicalization.** Save `enabledTools: ['bash', 'code_interpreter']`. Result: `['exec', 'code_execution']` (no duplicates with the same alias coming from a group).
13. **Plugin tools merged when enabled.** A `PluginDefinition` with `enabled: true, tools: ['custom_search']` adds `custom_search` to the resolved list. `enabled: false` plugins are skipped.
14. **Skills folding: ToolsNode.skills + SkillsNode entries.** ToolsNode skill `[{id:'a', content:''}]` plus a SkillsNode with `enabledSkills:['b']` → resolved `tools.skills` has both `a` and `b` (each as `injectAs:'system-prompt'`, `b.content === ''`). The system prompt's Skills section lists both under `### Tags`.
15. **Inline tool override emits rich skill and suppresses bundled SKILL.md.** Set `toolSettings.exec.skill = 'My exec rules'`. Resolver produces a `SkillDefinition` `{id:'tool-skill-exec', name:'exec tool guidance (inline override)', content:'My exec rules', injectAs:'system-prompt'}` AND drops the bundled `exec` ref from `### Available`. The prompt has `### exec tool guidance (inline override)` body.
16. **Bundled skill list filtered by enabled tools.** With `enabledGroups:['runtime']` (= `exec`, `code_execution`), the prompt's `### Available` contains `exec` and `code-execution` entries pointing at `{SAM_BUNDLED_ROOT}/<id>/SKILL.md`, but not `web-search` or `image`.
17. **System prompt manual mode bypasses auto sections.** `systemPromptMode: 'manual'`, `userInstructions: 'Hi'`. `ResolvedSystemPrompt.sections` has exactly one entry (key `manual`), `assembled === 'Hi'`.
18. **System prompt append mode injects user instructions last.** Default mode + non-empty user instructions → final section is `userInstructions`, body starts with `## User Instructions`.
19. **System prompt token estimates.** Each `SystemPromptSection.tokenEstimate` ≈ `ceil(content.length/4)` for ASCII; CJK content yields ~1 token per char per the inflation rule.
20. **Sub-agent inheritance: provider + model inherited.** SubAgent node with `modelIdMode:'inherit'`, no dedicated provider. Result: `subAgents[0].provider === parent.provider`, `modelId === parent.modelId`.
21. **Sub-agent name conflict drops both.** Two SubAgent nodes both named `helper` → `subAgents` is empty (both skipped by `conflictedNames`).
22. **Sub-agent invalid name dropped.** Name `Helper` (uppercase) fails `SUB_AGENT_NAME_REGEX` → not in `subAgents`.
23. **Sub-agent without dedicated Tools node dropped.** No tools child → `resolveSubAgent` returns `null` → omitted from `subAgents`.
24. **Sub-agent skills merge with parent.** Parent skills `[a]`, sub dedicated skills `[b]` → `subAgents[0].skills` = `[a, b]`. Same id in both → dedicated entry wins.
25. **Sub-agent working directory derived.** Parent `workingDirectory:'/work'`, sub name `helper`, mode `inherit` → `workingDirectory === '/work/subagent/helper'`.
26. **Agent-comm defaults applied.** AgentComm node with no `maxTurns` → `agentComm[0].maxTurns === 10`. Same for `maxDepth=3`, `tokenBudget=100_000`, `rateLimitPerMinute=30`, `messageSizeCap=16_000`. `direction` defaults to `'bidirectional'` unless `'outbound'` or `'inbound'`.
27. **Agent-comm target name resolved.** `targetAgentNodeId` points to a real `agent` node → `targetAgentName === <thatAgent.name>`. Pointing to a non-agent / missing node → `targetAgentName === null`.
28. **Storage all-fields passthrough.** Set unique values for every field on a Storage node; assert each appears verbatim on `AgentConfig.storage`.
29. **Memory all-fields passthrough.** Same, with `compactionStrategy:'sliding-window'`, `searchMode:'<custom>'`, etc.
30. **Context engine summaryModelId default.** Node leaves `summaryModelId` undefined → `contextEngine.summaryModelId === ''` (interpreted by runtime as "inherit").
31. **Cron schedule serialized as-is.** Node `schedule:'0 9 * * *'`, `timezone:'America/New_York'`, `enabled:true` → `crons[0]` mirrors all fields. No cron format validation at resolve time.
32. **Vector database is config-only.** Resolver emits `vectorDatabases[]` entries; no MCP fold, no system-prompt mention. No runtime test here — verify in server section.
33. **Workspace path: tools.exec.cwd overrides agent workingDirectory.** Agent `workingDirectory:'/a'`, ToolsNode `toolSettings.exec.cwd:'/b'` → `workspacePath === '/b'`.
34. **Tool override extraction.** Set `toolSettings.image.openaiApiKey:'sk-...'` → `AgentConfig.openaiApiKey === 'sk-...'`. Empty string → field omitted (undefined).
35. **MCP node resolved with `mcpNodeId`.** Field equals the React Flow node id so `mcp:status` events can correlate.
36. **Tool summary filter hides unimplemented names.** Add a tool name `'exotic_tool'` to `resolvedTools`. Build prompt with empty catalog store. Assert: `'exotic_tool'` is in `tools.resolvedTools` but missing from the `### Enabled tools` line.
37. **User-installed tool surfaced via catalog store.** Pre-populate `tool-catalog-store` with `{name:'my_tool'}`, set `loaded:true`. Resolve agent with `enabledTools:['my_tool']`. Prompt's `### Enabled tools` includes `my_tool`.
38. **Token estimator CJK inflation.** `estimateTokens('你好')` ≈ 2 tokens (each CJK char inflated to 4 chars → 8 chars / 4 = 2). ASCII `'hello'` → `ceil(5/4)=2`.
39. **Image content tokens estimate.** `estimateMessagesTokens([{content:[{type:'image'},{type:'text',text:'hi'}]}])` = 300 + 1.
40. **`contextTokensFromUsage` totalTokens precedence.** `{input:10, totalTokens:100}` → 100. `{input:10}` (no totalTokens) → 10.
41. **`foldActualIntoBreakdown` clamps messages to ≥0.** Preview `{systemPrompt:50, skills:30, tools:20, messages:0}`, actual total 90 → fold returns `messages = 0` (since 90 - 100 < 0).
42. **`redactGraphSnapshot` masks secret keys.** Input data `{ api_key:'sk', label:'x' }` → output `{ api_key:'[redacted]', label:'x' }`. Positions are dropped from every node.
43. **`isWorkflowPatch` shallow validator.** Object missing `add_nodes` array → `false`. Full minimal patch with empty arrays + `rationale:''` → `true`.
44. **Audio retrocompat path.** Old transcript with `mimeType:'audio/pcm'` produced by ElevenLabs → client wraps as WAV with 16k/mono/16-bit header.
45. **Visible-text sanitizer preserves code blocks.** Input ``` `<|special|>` ``` (inline code) → unchanged. Same token outside code → stripped.
46. **Sanitizer strips Gemini undelimited thought.** Input `'I will now inform the user.Final answer.'` → `'Final answer.'`.
47. **Diagnostics shape guard.** `isRunDiagnosticData` accepts `{kind:'run_error', runId, sessionId, code, message, phase:'pending', retriable:true, createdAt}`; rejects if `phase` is not `'pending'`/`'running'`.
48. **Channel meta ordering.** A channel session keyed `channel:<lo>:<hi>` has `pair[0] < pair[1]` after sort and `ownerAgentId === pair[0]`.

## Known gaps and ambiguity flags

- **F-06.** `default-nodes.ts` and `settings/types.ts` ship `anthropic/claude-sonnet-4-20250514` as the default `modelId`. New agents fail at chat time on OpenRouter until the user changes it.
- **F-07.** `validateAgentRuntimeGraph` is exported from `graph-to-agent.ts:747`, has tests, but is not referenced by any `src/**/*.tsx` consumer. Its five error codes never reach the user.
- **`auto` system-prompt mode.** `SystemPromptMode = 'auto' | 'append' | 'manual'` is declared in `agent-config.ts`, but resolver and builder both treat any non-`manual` value as `append`. `'auto'` is dead code today.
- **Vector database runtime wiring** is config-only at the shared layer. Verify in `server/` before claiming feature parity.
- **`shared/cron`** schedule is not validated at resolve time. Server-side cron schedule parser is the only validator.
- **CLAUDE.md note:** there is no `docs/concepts/cron-node.md` yet. The schema includes `cron` but the manifest does not.
- **`runtimeMeta.thinking`** is intentionally omitted from the runtime line in the system prompt to avoid Gemini-3 plain-text-thinking trigger; the value travels via API `reasoning.effort` instead. Tests must not assert it appears in the prompt.
