# Section 2 — Property Editors — Findings

<!-- last-verified: 2026-05-08 -->

Companion to [02-property-editors.md](./02-property-editors.md). Run executed via the `chrome-devtools` MCP server against `npm run dev` (frontend `:5173`, backend `:3210`).

## Status

- **Run started:** 2026-05-08
- **Run status:** complete
- **Baseline:** user's 13-node / 11-edge graph backed up to `.sam/graph.backup.s2.json` (10254 bytes) before destructive phase, restored at end (verified 13/11 + both agents). User pre-authorized destructive workflow during §1.
- **Test set:** TC2.1 → TC2.25 (25 cases, 13 node editors)

## Summary

| Severity | Count |
|---|---|
| blocker | 0 |
| major | 0 (re-confirmation of F-06) |
| minor | 0 |
| cosmetic | 0 |

No new findings in §2. The previously-logged F-06 (default agent modelId rejected by OpenRouter) reproduces here — see TC2.3 below — and the same upstream cause (settings store override) applies.

## Test results

| TC | Title | Result | Notes |
|---|---|---|---|
| TC2.1 | Panel opens/closes | ✅ | Click node → panel opens with `Agent Properties` heading + Delete-node + close-X buttons. Click X → panel closes. Pane click also closes (TC1.19). |
| TC2.2 | Resize handle persists width | ✅ | Covered by TC1.10 (set `propertiesPanelWidth: 480` in localStorage → reload → panel renders at 480px). |
| TC2.3 | Agent default model is non-stale | ❌ re-confirms F-06 | Fresh-dragged Agent's `data.modelId === 'anthropic/claude-sonnet-4-20250514'`. The May 2024 model ID still ships. Even though [src/utils/default-nodes.ts:12](../../../src/utils/default-nodes.ts#L12) was bumped in commit `6671b2c` to `'anthropic/claude-sonnet-4-6'`, [src/settings/types.ts:98](../../../src/settings/types.ts#L98) still holds the stale value, and [graph-store.ts buildNodeData](../../../src/store/graph-store.ts) overlays settings on top of defaults — so the stale id wins. |
| TC2.4 | Agent Name lock after confirmation | ✅ | `nameConfirmed:true` agent — name input `disabled: true`, lock icon 🔒 visible next to label. |
| TC2.5 | Thinking Level disabled when reasoning unsupported | ✅ | With `modelCapabilities={}`, the Thinking Level select reports `disabled: true` and `title: "This model does not support extended reasoning"`. All 6 options (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`) populated. |
| TC2.6 | Manual prompt mode shows warning | ✅ | Switching `systemPromptMode: 'append' → 'manual'` makes the "View full prompt" button disappear (banner area takes over). Switching back restores it. |
| TC2.7 | System Prompt Preview round-trips through server | ✅ | Click "View full prompt" → modal opens (System Prompt heading + total-tokens read-out from `/api/agents/:id/resolved-system-prompt`). Escape key closes the modal. |
| TC2.8 | Memory External fields hidden in builtin | ✅ | Default `backendType:'builtin'` → no External Endpoint / API Key fields. Switching to `external` reveals both. |
| TC2.9 | Tools profile presets + auto-promote to custom | ✅ | Profile=`coding` → `enabledGroups: ['runtime','fs','coding']` (note: docs say `…and human` but app currently produces 3 groups, not 4 — see Note A). HITL banner "HITL locked on" visible in custom mode. |
| TC2.10 | Tools sub-pages navigation | ✅ | Browser sub-page renders the full description, "Launch Chrome for CDP" CTA, and screenshot/anti-detection sections. Switching `screenshotFormat: jpeg → png` removes the Quality field as expected. |
| TC2.11 | Browser CDP launcher posts to backend | ⏭ deferred | Click would launch a Chrome instance — destructive. CTA visible (TC2.10). |
| TC2.12 | Image preferred-model picker variants | ✅ | With no agent connected: amber hint "No agent connected. Connect this Tools node to an agent with a provider to see available models." rendered. Other 3 variants (catalog-loaded / not-loaded / non-OR provider) verified statically. |
| TC2.13 | Skills node toggles update enabledSkills | ✅ | All 7 preset skill names (`code_generation`, `summarization`, `translation`, `data_analysis`, `creative_writing`, `reasoning`, `math`) rendered as checkboxes. "Add" button present. |
| TC2.14 | Context Engine inherits token budget when connected | ✅ baseline | With no agent connection: hint "Connect to an agent to inherit from model" rendered, default 128000 editable. (Inherited variant requires connecting CE → agent → provider with model metadata; structural confirmation only on this dev setup.) |
| TC2.15 | Manual compaction button | ✅ | With trigger=`manual`, "Run summary compaction → 50,000 tokens" button appears, `disabled: true` (no active session). |
| TC2.16 | Post-compaction target capped | ✅ | Input has `max="123904"` (= `tokenBudget 128000 - reservedForResponse 4096`). Per spec. |
| TC2.17 | Agent Comm target list and limits | ✅ | Target Agent dropdown lists all agents (`None`, `main`, `second`) — confirms doc note that the "exclude connected agent" filter is not implemented. Protocol `Direct/Broadcast`, Direction `Bidirectional/Outbound only/Inbound only`, 5 numeric inputs all rendered. |
| TC2.18 | Connector picker + variables form | ✅ | Catalog has only `github`. Selecting it reveals description "Read repos, search code, manage issues and PRs." plus a per-variable "Token environment variable" input with helper "Name of the env var holding your GitHub personal access token." |
| TC2.19 | Storage conditional fields | ✅ | Initial state with `maxDiskBytes:0` → no High Water field. Setting `maxDiskBytes: 1073741824` → High Water field appears. Daily Reset / Idle Reset / High Water all conditional as documented. |
| TC2.20 | Vector DB editor records config but no runtime hookup | ✅ | All 4 providers (`chromadb`, `pinecone`, `qdrant`, `weaviate`) listed. Collection + Connection-string fields present. Per CLAUDE.md, no runtime adapter consumes these values today — observed config-only behavior. |
| TC2.21 | MCP transport switching reveals correct fields | ✅ | Stdio default: Command + Args + Env present, URL/Headers hidden. Switch to `http`: Command/Args/Env hidden, URL + Headers appear. |
| TC2.22 | Sub-Agent validation banners and overrides | ✅ | Both banners rendered for an unwired sub-agent ("attach a Tools node", "Connect to an Agent"). 5 checkboxes total (4 override-allowlist + 1 recursive). Recursive defaults to `false`. |
| TC2.23 | Cron editor reachable via persisted graph | ✅ | Cron node fixture-injected (not in palette per F1.39). Editor renders Schedule/Prompt/Enabled/Timezone/Max Run. Retention hidden in `persistent` mode, appears in `ephemeral`. |
| TC2.24 | Delete node from header trash icon | ✅ | Trash icon on agent panel header → opened the same 3-branch Delete Agent dialog as keyboard delete (TC1.9). "No, keep data" branch removed the node from canvas. |
| TC2.25 | Provider switching resets dependent fields | ⚠️ environment-limited | Only `openrouter` plugin loaded on this dev backend ("[Providers] No providers.json found... loaded 1 default plugin(s)") so the multi-plugin reset path can't be executed at runtime. Behavior verified statically per [ProviderProperties.tsx:33-42](../../../src/panels/property-editors/ProviderProperties.tsx#L33). |

## Notes

### Note A — Tools profile `coding` produces 3 groups, not 4

The spec ([02-property-editors.md TC2.9](./02-property-editors.md)) says:

> Set profile to `coding` — expect tool groups to switch to `runtime/fs/coding` and `human` (per `TOOL_PROFILES`).

Observed in this run: `enabledGroups: ['runtime', 'fs', 'coding']`. No `human` group. Source of truth lives in `shared/resolve-tool-names.ts:TOOL_PROFILES`. Either the doc overstates the preset, or the code/profile changed since the doc was written. Not flagged as a finding because the visible behavior is internally consistent (auto-promote to custom on group toggle still works) and the doc is the secondary source. Worth a quick reconcile in a follow-up.

### Note B — Compaction Threshold field carries a token-step in manual mode

When `compactionTrigger='manual'`, the threshold input shows `value="0.8"` (default for the 0–1 threshold) but `step="1024"` (configured for the manual token-limit overload). This is consistent with the spec's "(NB: same field as threshold, repurposed)" disclaimer but means a freshly-switched manual trigger displays a non-sensical default that the user must correct before entering a token target. Cosmetic, not flagged.

### Note C — Header X close button has no `title`/`aria-label`

The Properties panel header has two icon buttons. Trash has `title="Delete node"`. The close-X has no `title` and no `aria-label`. Adding `aria-label="Close panel"` would make it discoverable to screen readers and to MCP automation (the prior P3 a11y note F-05 already flags broader form-label gaps; this is in the same spirit but not regressing — capturing here so a future a11y sweep can pick it up alongside F-05).

## Methodology notes

- All 13 node editors covered by seeding a 14-node scratch graph (1 of each node type + 1 second agent for the AgentComm target-list test) via REST PUT, then exercising each editor through `useGraphStore` reactivity by dispatching React-friendly value setters (`HTMLSelectElement.prototype` / `HTMLInputElement.prototype` value setter calls + `change`/`input` events) on the rendered DOM elements. This works for `select`, `input[type=text|number|checkbox]`. The xyflow handle / pointer-event-driven flows that fail in §1 (TC1.4 etc.) are not encountered here.
- Naming-dialog cancellation (TC2.3 sequence) cleaned up the unconfirmed scratch agent automatically.
- Browser CDP launcher (TC2.11) and the destructive delete-with-data branch (TC2.24 fully) were intentionally not exercised — both either spawn external processes or modify storage outside the canvas snapshot.

## Re-confirmations of prior findings

| Prior finding | TC | Status |
|---|---|---|
| F-06 — default model rejected by OpenRouter | TC2.3 | still reproduces; settings store path identified as the leftover root cause |
