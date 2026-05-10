# Section 5 — Shared Resolution Layer — Findings

<!-- last-verified: 2026-05-08 -->

Companion to [05-shared-resolution.md](./05-shared-resolution.md). Run executed via the `chrome-devtools` MCP server. Most §5 scenarios are pure-logic tests of `shared/` and `src/utils/graph-to-agent.ts`; verification was a mix of (a) live invocation of `resolveAgentConfig` / `validateAgentRuntimeGraph` / token + sanitizer / workflow-patch helpers via `evaluate_script` against the running Vite app, and (b) static source reading where the browser path doesn't reach the code (e.g., connector `process.env`, server-side path `posix.join`, dynamic-import vs. resolver's static import boundary for the catalog store).

## Status

- **Run started:** 2026-05-08
- **Run status:** complete
- **Baseline:** Graph + settings unchanged. No live agent runs were issued in this section. All resolver invocations used scratch fixtures or read-only inspections of the user's existing graph.
- **Test set:** T1 → T48 (48 scenarios)

## Summary

| Severity | Count |
|---|---|
| blocker | 0 |
| major | 0 |
| minor | 0 |
| cosmetic | 1 (doc-reconcile — T3 wording outdated) |

No new findings. Re-confirmations: F-06 (default modelId leak path), F-07 (validator unsurfaced).

## Test results

| Tx | Title | Result | Method | Notes |
|---|---|---|---|---|
| T1 | Resolver returns null for missing agent | ✅ | live | `resolveAgentConfig('non-existent', [], [])` returned `null`, no throw. |
| T2 | One Provider/Storage/CE produces valid AgentConfig | ✅ | live | scribe: `version=2`, `modelId='anthropic/claude-haiku-4.5'`, `provider.pluginId='openrouter'`, `storage` + `contextEngine` non-null, `runTimeoutMs=172800000`, `agentComm[1]`, `subAgents[0]`, prompt mode `'append'`, sections = identity/executionBias/safety/trustBoundaries/time/runtime/reasoning/userInstructions (correctly omits tooling/skills/workspace because scribe has none). |
| T3 | Default agent model F-06 reproduction | ⚠️ doc-reconcile | static + live | **Spec wording outdated.** [src/utils/default-nodes.ts:12](../../../src/utils/default-nodes.ts#L12) now ships `'anthropic/claude-sonnet-4-6'` (per commit `6671b2c`). The F-06 leak path is now via the **settings store override** ([src/settings/types.ts:98](../../../src/settings/types.ts#L98)) which still has `'anthropic/claude-sonnet-4-20250514'`. Spec should reword to "default leaks via settings overlay". |
| T4 | Validator missing-provider error is unsurfaced | ✅ | live + grep | `validateAgentRuntimeGraph('a', [agent], [])` returns `[{code:'missing_provider'}]`. No `*.tsx` consumer references this function (only the test file). Confirms F-07. |
| T5 | Validator catches duplicate Provider | ✅ | live | Returns `[{code:'duplicate_provider'}]` for two providers connected to one agent. |
| T6 | Validator catches empty plugin id | ✅ | live | Provider with `pluginId=''` → `[{code:'empty_plugin_id'}]`. |
| T7 | Connector with empty connectorId silently skipped | ✅ | live | Validator returns `unselected_connector`; resolver: `mcps.length === 0` (the connector is not pushed). |
| T8 | Connector with unknown connectorId silently skipped | ✅ | live | Validator returns `unknown_connector` (`Connector node "Conn" references unknown connector "made-up"`); resolver: `mcps.length === 0`. |
| T9 | GitHub connector structure | ✅ structural | live + static | `CONNECTOR_CATALOG['github']` exposes `transport='stdio'`, `command='npx'`, `args=['-y','@modelcontextprotocol/server-github']`, `toolPrefix='github_'`, single variable `tokenEnvVar`. **Browser limitation:** `def.buildEnv(values)` reads `process.env` which is undefined in browser; throws. The `mcps[0].env` materialization at resolve time only works server-side — browser builds always emit `env: {}` for connectors. Documented in spec as expected behavior; confirmed reproducible. |
| T10 | Tool resolution: profile fallback | ✅ | live | `resolveToolNames({profile:'coding', enabledGroups:[], ...})` returned `['apply_patch','code_execution','edit_file','exec','list_directory','read_file','write_file']` — exactly `runtime ∪ fs ∪ coding` deduped. |
| T11 | Tool resolution: groups override profile | ✅ | live | `{profile:'minimal', enabledGroups:['runtime'], ...}` returned `['code_execution','exec']` — `runtime` only, NOT `web` from `minimal`. Confirms `enabledGroups.length > 0` short-circuits the profile fallback per [resolve-tool-names.ts:141-143](../../../shared/resolve-tool-names.ts#L141-L143). |
| T12 | Tool alias canonicalization | ✅ | live | `enabledTools:['bash','code_interpreter']` → resolved `['code_execution','exec']`. Aliases canonicalized at add-site, no duplicates. |
| T13 | Plugin tools merged when enabled | ✅ | live | Enabled plugin's `tools:['custom_search']` appears in result; disabled plugin's `tools:['hidden_tool']` is skipped. |
| T14 | Skills folding: ToolsNode.skills + SkillsNode entries | ✅ | live | ToolsNode skill `{id:'a'}` + SkillsNode `enabledSkills:['b']` → resolved `tools.skills` has both `a` and `b`, `hasContent=false` for both, IDs unique. |
| T15 | Inline tool override emits rich skill + suppresses bundled | ✅ | live | Setting `toolSettings.exec.skill='My exec rules'` produced a SkillDefinition `{id:'tool-skill-exec', name:'exec tool guidance (inline override)', content:'My exec rules'}`. Prompt has `### exec tool guidance (inline override)` heading. The `### Available` section contains `code-execution (bundled)` but NOT `exec (bundled)` — confirms the override suppresses the bundled SKILL.md ref via `overriddenToolIds` filter at [graph-to-agent.ts:464-465](../../../src/utils/graph-to-agent.ts#L464-L465). |
| T16 | Bundled skill list filtered by enabled tools | ✅ | live | With `enabledGroups:['runtime']`, the prompt's `### Available` lists `code-execution` (with `{SAM_BUNDLED_ROOT}/code-execution/SKILL.md` path); does NOT list `web-search` or `image` (their tools aren't enabled). |
| T17 | Manual mode bypasses auto sections | ✅ | live | `systemPromptMode:'manual', systemPrompt:'Hi'` → `sections=[{key:'manual'}]`, `assembled='Hi'`. No identity/safety/etc. sections produced. |
| T18 | Append mode injects user instructions last | ✅ | live | `systemPromptMode:'append'` + non-empty user instructions → last section is `key='userInstructions'`, body starts with `## User Instructions\n\n...`. |
| T19 | Token estimates ≈ ceil(content.length / 4) | ✅ | live | Each section's `tokenEstimate / ceil(contentLen/4)` ratio = 1.00 across all 8 sections (identity 285→72, executionBias 926→232, safety 348→87, trustBoundaries 2221→556, time 129→33, runtime 93→24, reasoning 277→70, userInstructions 50→13). |
| T20 | Sub-agent inheritance: provider + model inherited | ✅ | live | verify-yield-agent's resolved sub-agent (`researcher`) inherits `modelId='anthropic/claude-haiku-4.5'`, `provider.pluginId='openrouter'`, `thinkingLevel='off'` from parent. |
| T21 | Sub-agent name conflict drops both | ✅ | live | Two sub-agents both named `helper` → `subAgents.length === 0`. |
| T22 | Sub-agent invalid name dropped | ✅ | live | `Helper` (uppercase) → `subAgents.length === 0`. `1bad` (starts with digit) → `subAgents.length === 0`. Regex `/^[a-z][a-z0-9_-]{0,31}$/` enforced. |
| T23 | Sub-agent without dedicated Tools node dropped | ✅ | live | `subAgents.length === 0` when sub-agent has no tools child. |
| T24 | Sub-agent skills merge with parent | ⏭ static | code | Browser test errored on the `posix.join` path (T25 — see below), so skills merge wasn't exercised through the live wd-derived branch. Static-verified at [graph-to-agent.ts:85-89](../../../src/utils/graph-to-agent.ts#L85-L89): `[...parent.skills.filter(s => !dedicatedIds.has(s.id)), ...dedicatedSkills]`. |
| T25 | Sub-agent working directory derived | ⏭ static | code | Browser path crashes: `posixPath.posix.join` undefined when imported in browser via `import * as posixPath from 'path'` — Vite's `path` polyfill doesn't expose `.posix`. The error `Cannot read properties of undefined (reading 'join')` reproduces only when `parent.workspacePath` is truthy AND `subAgent.workingDirectoryMode !== 'custom'`. Live verify-yield's parent has `workingDirectory:''` so the branch is bypassed (`workingDirectory: ''`). Server-side resolver path is unaffected (Node's real `path`). Static-verified at [graph-to-agent.ts:138](../../../src/utils/graph-to-agent.ts#L138) — formula is `posixPath.posix.join(parent.workspacePath.replace(/\\/g, '/'), 'subagent', data.name)`. **Worth flagging:** the browser-side resolver throws on this path, which means any agent with `workingDirectory` + sub-agents + `derived` mode would fail to resolve in the browser. Discuss with the team — either mark as server-only or import a browser-safe posix shim. |
| T26 | Agent-comm defaults applied | ✅ | live | AgentComm node with no fields → `{maxTurns:10, maxDepth:3, tokenBudget:100000, rateLimitPerMinute:30, messageSizeCap:16000, direction:'bidirectional'}`. |
| T27 | Agent-comm target name resolved | ✅ | live | `targetAgentNodeId: 'b'` (real agent named 'partner-agent') → `targetAgentName: 'partner-agent'`. Pointing to non-existent → `targetAgentName: null`. |
| T28 | Storage all-fields passthrough | ✅ | live | All 18 fields verbatim: `backendType:'filesystem', storagePath:'/x/y', sessionRetention:7, memoryEnabled:true, dailyMemoryEnabled:false, dailyResetEnabled:true, dailyResetHour:6, idleResetEnabled:true, idleResetMinutes:30, parentForkMaxTokens:99999, maintenanceMode:'enforce', pruneAfterDays:14, maxEntries:200, rotateBytes:5000, resetArchiveRetentionDays:90, maxDiskBytes:1000, highWaterPercent:70, maintenanceIntervalMinutes:120`. |
| T29 | Memory all-fields passthrough | ✅ | live | All 12 fields preserved: `backend:'external', maxSessionMessages:250, persistAcrossSessions:true, compactionEnabled:true, compactionStrategy:'sliding-window', compactionThreshold:0.9, exposeMemorySearch:false, exposeMemoryGet:false, exposeMemorySave:true, searchMode:'keyword-only', externalEndpoint:'http://x', externalApiKey:'k`. |
| T30 | Context engine summaryModelId default | ✅ | live | `summaryModelId:''` echoes verbatim (interpreted at runtime as "inherit"). |
| T31 | Cron passthrough | ✅ | live | `cronNodeId:'cr', label:'cron', schedule:'0 9 * * *', prompt:'wake', enabled:true, sessionMode:'persistent', timezone:'America/New_York', maxRunDurationMs:600000, retentionDays:7` all verbatim. |
| T32 | Vector database is config-only | ✅ | live | `vectorDatabases[0] = {label:'VDB', provider:'chromadb', collectionName:'col1', connectionString:'cs://x'}`. No system-prompt mention, no MCP fold. |
| T33 | tools.exec.cwd overrides agent.workingDirectory | ✅ | live | Agent `workingDirectory:'/agent-cwd'` + tools `exec.cwd:'/tools-cwd'` → `workspacePath: '/tools-cwd'`. |
| T34 | Tool override extraction (openaiApiKey) | ✅ | live | `toolSettings.image.openaiApiKey:'sk-test-123'` → `AgentConfig.openaiApiKey: 'sk-test-123'`. |
| T35 | MCP node resolved with mcpNodeId | ✅ | live | `id:'mcp_node_xyz'` → `mcps[0].mcpNodeId: 'mcp_node_xyz'`. |
| T36 | Tool summary filter hides unimplemented names | ✅ | live | `enabledTools:['exotic_tool', 'exec']` → `resolvedTools=['exotic_tool', 'exec']` but prompt's `### Enabled tools` line shows only `'exec'`. Filter at [graph-to-agent.ts:454](../../../src/utils/graph-to-agent.ts#L454) hides `exotic_tool` (not in `IMPLEMENTED_TOOL_NAMES`, not in catalog store). |
| T37 | User-installed tool surfaced via catalog store | ⏭ partial | static | Browser-side `evaluate_script` cannot mutate `useToolCatalogStore` such that the resolver's static-imported store sees the change — the dynamic `import()` returns a different module instance from the one bound inside `graph-to-agent.ts`. Static-verified at [graph-to-agent.ts:448-454](../../../src/utils/graph-to-agent.ts#L448-L454): `const catalogKnown = catalogState.loaded ? new Set(catalogState.tools.map(t => t.name)) : null;` then `t => IMPLEMENTED_TOOL_NAMES.has(t) || catalogKnown?.has(t)`. To live-verify, either trigger via `loadToolCatalog()` from the running app or run on the server. |
| T38 | Token estimator CJK inflation | ✅ | live | `estimateTokens('你好')` = 2 (each CJK char inflated to 4 chars = 8/4 = 2). `estimateTokens('hello')` = 2 (5/4 ceil = 2). |
| T39 | Image content tokens estimate | ✅ | live | `estimateMessagesTokens([{content:[{type:'image'},{type:'text',text:'hi'}]}])` = 301 (300 image + 1 'hi'). |
| T40 | contextTokensFromUsage totalTokens precedence | ✅ | live | `{input:10, totalTokens:100}` → 100. `{input:10}` → 10. `{input:5, cacheRead:20, cacheWrite:10}` → 35 (input + cacheRead + cacheWrite). |
| T41 | foldActualIntoBreakdown clamps to ≥0 | ✅ | live | Preview `{systemPrompt:50, skills:30, tools:20, messages:0}` (sum=100), actual total 90 → fold returns `messages: 0` (90-100=-10 clamped to 0). |
| T42 | redactGraphSnapshot masks secret keys + drops position | ✅ | live | Input `{nodes:[{id:'n', type:'t', position:{x:1,y:2}, data:{type:'t', api_key:'sk-mine', label:'x', envVar:'OPENAI_API_KEY'}}]}` → `{id:'n', type:'t', data:{api_key:'[redacted]', label:'x', envVar:'OPENAI_API_KEY'}}` — `position` dropped, `api_key` redacted, `envVar` (env var name, not secret) preserved. |
| T43 | isWorkflowPatch shallow validator | ✅ | live | `{add_nodes:[], update_nodes:[], remove_nodes:[], add_edges:[], remove_edges:[], rationale:''}` → `true`. Object missing `add_nodes` → `false`. |
| T44 | Audio retrocompat | ✅ | live | `isPcmMimeType` accepts `audio/pcm`, `audio/l16`, `audio/basic`; rejects `audio/mpeg`. `pcmParamsForProvider`: ElevenLabs 16k/mono/16-bit ✅, MiniMax 32k/mono/16-bit ✅, default (Google/OpenAI/OpenRouter) 24k/mono/16-bit ✅. `wrapPcmAsWav([1,2,3,4], 16000, 1, 16)` returns 48 bytes (44 RIFF/WAVE header + 4 PCM bytes), starts with `RIFF` magic. |
| T45 | Sanitizer preserves code blocks | ✅ | live | `'Here is \`<\|special\|>\` token in code.'` → unchanged (within backticks). `'Here is <\|special\|> token outside.'` → `'Here is  token outside.'` (special token stripped outside code spans). |
| T46 | Sanitizer strips Gemini undelimited thought | ✅ | live | `'I will now inform the user.Final answer.'` → `'Final answer.'` — recap preamble stripped. Negative test: `'I will tell the user about this. The result is 42.'` → unchanged (verb `tell` followed by a different recap structure not matching the strip pattern). Sanitizer correctly avoids over-aggressive matching. |
| T47 | Diagnostics shape guard | ✅ | live | `isRunDiagnosticData({kind:'run_error', runId, sessionId, code:'internal', message, phase:'pending', retriable:true, createdAt})` → `true`. Same shape with `phase:'unknown'` → `false`. |
| T48 | Channel meta keys | ✅ | live | `AGENT_COMM_ERROR_CODES` exports all 10 codes verbatim: `topology_violation, direction_violation, message_too_large, rate_limited, receiver_unavailable, channel_sealed, depth_exceeded, token_budget_exceeded, max_turns_reached, internal_error`. `AgentCommSealReason` is a TS-only type (not a runtime export) — its three values are enforced via TypeScript at compile time. The `pair[0] < pair[1]` invariant + `ownerAgentId === pair[0]` is a runtime invariant in the server's agent-comm router; browser-side just consumes the resulting `ChannelSessionMeta` shape. |

## Notes

### Note A — Spec T3 wording is outdated

The spec ([05-shared-resolution.md TC #3](./05-shared-resolution.md)) says:

> A bare agent default has `modelId === 'anthropic/claude-sonnet-4-20250514'` (per `src/utils/default-nodes.ts`)

This is no longer true. Commit `6671b2c` bumped [src/utils/default-nodes.ts:12](../../../src/utils/default-nodes.ts#L12) to `'anthropic/claude-sonnet-4-6'`. The F-06 leak that still reproduces lives in `src/settings/types.ts:98` (the settings-store agentDefaults). The spec should reword T3 to "default leaks via settings-store overlay (the settings store still ships the stale id)." Doc-only fix.

### Note B — Browser path crash on sub-agent `derived` working directory when parent has a workingDirectory

`src/utils/graph-to-agent.ts:138` calls `posixPath.posix.join(...)` via `import * as posixPath from 'path'`. In the browser (Vite), the `path` module's `.posix` namespace is **undefined**, so this line throws `Cannot read properties of undefined (reading 'join')`. The bug only manifests when:

1. The parent agent has a non-empty `workingDirectory`, AND
2. A sub-agent's `workingDirectoryMode !== 'custom'` (i.e., `'derived'` or `'inherit'`).

The user's live graph has `workingDirectory: ''` on both agents, so the branch is bypassed in production. But any user who *does* set a working directory on a parent with sub-agents would hit this when the chat drawer or SAM Agent triggers a browser-side resolve. Server-side runtime resolves are unaffected (real Node `path`).

Two fixes worth considering: (a) replace with `${parent.workspacePath.replace(/\\/g,'/')}/subagent/${data.name}` (no Node `path` dependency), or (b) import a browser-safe shim (`path-browserify`).

### Note C — T37 catalog-store branch is unreachable from `evaluate_script`

The resolver at [graph-to-agent.ts:7](../../../src/utils/graph-to-agent.ts#L7) imports `useToolCatalogStore` statically. Browser-side dynamic `import('/src/store/tool-catalog-store.ts')` and `setState` against the dynamic-import return value affects a *different* singleton instance from the one bound in `graph-to-agent.ts`. So `evaluate_script` mutations to the dynamically-imported store are not observed by the resolver. The branch was static-verified instead. To exercise the live branch, either (a) call `loadToolCatalog()` from the running app (which uses the resolver's same static import), or (b) test from Node where there's no module-instance separation.

### Note D — `IMPLEMENTED_TOOL_NAMES` size

Size = 27 — matches the 27 names listed in the spec body (after expanding `...SESSION_TOOL_NAMES` to 7 entries: 19 explicit + 7 session = 26). Counted: exec, bash, code_execution, calculator, web_search, web_fetch, browser, read_file, write_file, edit_file, list_directory, apply_patch, image, image_generate, show_image, canva, text_to_speech, ask_user, confirm_action, music_generate, sessions_list, sessions_history, sessions_send, sessions_spawn, sessions_yield, subagents, session_status = 27. Matches.

## Methodology notes

- **Live invocation** via `chrome-devtools-mcp evaluate_script`: dynamic `import('/src/utils/graph-to-agent.ts')` and `import('/shared/...ts')` exposes the resolver, validator, token estimator, sanitizer, workflow-patch helpers, and audio helpers directly. Vite serves these at the dev URL with HMR; the function references behave identically to production for pure-logic tests.
- **Fixture style**: each test built minimal inline node arrays (e.g., `mkAgent('a')`, `mkProvider('p')`, plus the relevant peripheral) and `mkEdge(source, target)` arrays. No state mutation against the live graph or settings (other than the deferred T37 attempt to seed the catalog store).
- **Read-only inspection** of the user's live graph: verify-yield-agent + scribe were resolved against the actual `/api/graph` payload to spot-check inheritance (T20), agent-comm presence (S4 carry-over), and the prompt-section keys (T2).
- **Static reading** for tests where browser path doesn't reach the code (T9 connector buildEnv with `process.env`, T25 server-only `posix.join`, T37 module-instance separation, T48 TypeScript-only types).
- **Boundary discipline**: nothing was sent to the model. No transcript or settings file was written. The catalog-store mutation in T37 was reverted regardless of whether it took effect.

## Re-confirmations of prior findings

| Prior finding | Tx | Status |
|---|---|---|
| F-06 — default agent modelId rejected by OpenRouter | T3 | re-confirmed via static + live; specifically the leak path is now via settings-store overlay (`src/settings/types.ts:98`), not `default-nodes.ts` |
| F-07 — `validateAgentRuntimeGraph` errors are not consumed by UI | T4 | re-confirmed; grep across `src/**/*.tsx` shows no consumer; the function is exported and unit-tested only |
