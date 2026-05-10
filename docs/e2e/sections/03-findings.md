# Section 3 — Settings Workspace — Findings

<!-- last-verified: 2026-05-08 -->

Companion to [03-settings-workspace.md](./03-settings-workspace.md). Run executed via the `chrome-devtools` MCP server against `npm run dev` (frontend `:5173`, backend `:3210`).

## Status

- **Run started:** 2026-05-08
- **Run status:** complete
- **Baseline:** user's 13-node / 11-edge graph + full settings JSON backed up to `.sam/graph.backup.s3.json` (10254 bytes) and `.sam/settings.backup.s3.json` (3664 bytes) before destructive cases. Restored at end (verified 13/11 + agents `modelId=anthropic/claude-haiku-4.5` + `thinkingLevel=off` + OpenRouter key intact).
- **Test set:** TC1 → TC30 (30 scenarios)

## Summary

| Severity | Count |
|---|---|
| blocker | 0 |
| major | 0 |
| minor | 0 (1 re-confirmation of F-06 via TC13) |
| cosmetic | 0 |

No new findings in §3. TC13 re-confirms F-06 (default agent modelId rejected by OpenRouter — root cause still in [src/settings/types.ts:98](../../../src/settings/types.ts#L98)). Three doc-reconcile notes captured (Notes A–C) and one prior risk re-confirmed via TC25 (Load Test Fixture has no confirm dialog — already documented in spec § "Known ambiguities and risks").

## Test results

| TC | Title | Result | Method | Notes |
|---|---|---|---|---|
| TC1 | Open settings via cog button | ✅ | UI | `appView` flips to `settings`, default `'api-keys'` section renders, sidebar shows 8 sections, "Return to Canvas" present, 13 provider cards rendered (matches `KNOWN_PROVIDERS`). |
| TC2 | Open settings via SAMAgent deep link | ✅ | UI | Click SAMAgent island model header → settings opens directly to `'sam-agent'` section (heading `SAMAgent`, blue-highlighted sidebar entry). |
| TC3 | Switch sections via sidebar | ✅ | UI | All 8 sections render (`Providers & API Keys`, `Model Catalog`, `Defaults`, `SAMAgent`, `Safety`, `Appearance`, `Colors`, `Data & Maintenance`); each gets blue active class `bg-blue-100 text-blue-800`; no console errors. |
| TC4 | Section persistence on canvas round-trip | ⚠️ doc-reconcile | UI | **Spec predicted** the section state resets to `api-keys` because "state is in-memory React state, so it resets". **Actual:** section persists across canvas → settings round-trip (set Colors → Return → Settings → still on Colors). Reason: `App.tsx` only toggles `appView`; `activeSettingsSection` survives because the App component isn't unmounted. Resets only on full page reload. Spec note in [03-settings-workspace.md TC4](./03-settings-workspace.md) should be updated. |
| TC5 | Per-provider API key entry + masking | ✅ | UI | All 13 inputs are `type="password"` by default. Eye toggle flips OpenRouter input `password ↔ text ↔ password`. |
| TC6 | "Get key" link-out URLs | ✅ | UI | 12 vendor links present (Ollama row has no link), all 12 use `target="_blank"`, hrefs match `KNOWN_PROVIDERS` table. |
| TC7 | Plugin provider rendering | ✅ | UI | OpenRouter row shows "Plugin provider" pill (only one currently registered server-side). |
| TC8 | Model catalog sync — happy path | ✅ | UI + network | Click `Sync Models` → `POST /api/providers/catalog/refresh` → cached-time updates from `5/7/2026, 5:00:48 PM` → `5/8/2026, 3:59:56 PM`; model count moved 369 → 367 (live OpenRouter data). |
| TC9 | Model catalog sync — bad key | ⏭ deferred | — | Cannot temporarily install an invalid key without authorized credential mutation (sandbox blocks settings PUT that clears apiKeys per `feedback_backend_frontend_independence`). See [00-not-executed.md](./00-not-executed.md). |
| TC10 | My Enabled vs All Models | ✅ structural | UI | Toggle appears after first sync (userModels non-empty). Both views render; user's OpenRouter account has all models enabled, so filtering filters to the same set — toggle wiring confirmed but discriminating filter behavior is inconclusive in this account. |
| TC11 | Model details modal | ✅ | UI | Click row → fixed-position modal opens with model metadata + "Raw API Payload — Show Developer Payload" toggle. **Note C** below — close-X button is icon-only with no `aria-label`/`title`; ESC key and backdrop click do **not** close the modal. |
| TC12 | Defaults — Agent system prompt mode swap | ✅ | UI | `append → manual` reveals warning banner: "You are fully responsible for the system prompt. No safety guardrails…". **Note A** — banner is amber (`border-amber-500/30 bg-amber-500/5`), not red as the spec describes. |
| TC13 | Defaults — Apply to existing agents | ✅ | UI + REST verify | Agents go from `modelId=anthropic/claude-haiku-4.5, thinkingLevel=off` to `modelId=anthropic/claude-sonnet-4-20250514, thinkingLevel=high` (the configured defaults). Names and other fields untouched. **Re-confirms F-06** — agent defaults still ship `claude-sonnet-4-20250514` from [src/settings/types.ts:98](../../../src/settings/types.ts#L98). |
| TC14 | Defaults — Provider plugin auto-fill | ⚠️ environment-limited | static | Only `openrouter` plugin loaded (per F-04). Multi-plugin selection cannot exercise the auto-fill path live; verified statically — `DefaultsSection.tsx` calls `useProviderRegistryStore` for `authMethodId`/`envVar` on plugin change. |
| TC15 | Defaults flow into new nodes | ✅ static | code | [src/store/graph-store.ts:101-108](../../../src/store/graph-store.ts#L101-L108) reads `useSettingsStore.getState().storageDefaults` at node-creation time and overlays `storagePath`, `sessionRetention`, `memoryEnabled`, `maintenanceMode`, `pruneAfterDays` onto the new node. Identical pattern at L495-503 (apply-to-existing). Wiring confirmed; live-drag deferred to avoid creating a scratch node post-restore. |
| TC16 | SAMAgent model dropdown filtering | ✅ | UI | Dropdown lists 375 entries from 2 providers (`ollama` always-present + `openrouter` because key is set). No other providers appear because no other keys are configured. |
| TC17 | SAMAgent provider key cleared after selection | ⏭ deferred | — | Sandbox blocks `PUT /api/settings` that empties `apiKeys.openrouter` even temporarily. Static read of [SamAgentSection.tsx:26-28](../../../src/settings/sections/SamAgentSection.tsx) confirms the amber-banner branch when `getApiKey(pluginId).trim() === ''`. |
| TC18 | Safety — Dangerous Fully Auto two-step | ✅ | UI | Click checkbox → confirmation card with "I understand, enable" + "Cancel" appears. Cancel returns to off. Re-click → understand → `safety.allowDisableHitl = true` (verified via `input[type="checkbox"][checked]`). Toggling OFF goes through with no confirmation — confirms the spec's "asymmetric gate" note. |
| TC19 | Safety — Confirmation policy dirty draft | ✅ | UI | Edit textarea → `Save policy` enabled, `Unsaved changes` label visible. Switch to Appearance → back to Safety → draft cleared, `Save policy` disabled, no `Unsaved changes` label, original policy text restored (component remounts). Save and Reset paths not exercised live to keep the persisted policy clean. |
| TC20 | Safety policy → chat HITL effect | ⏭ §4 cross-link | — | Out of §3 scope; the chat-side HITL banner test belongs in §4. |
| TC21 | Appearance live preview | ✅ structural | UI | Defaults: layout=`blocks`, reveal-enabled, speed=`90` (range 20-400 step 5), fade=`320` (range 0-800 step 20). Toggling `textRevealEnabled` off applies muted ancestor (`.opacity-50.pointer-events-none`) to both range sliders; re-enable restores. Live-stream preview deferred (would need an active chat stream). |
| TC22 | Colors live preview + persistence | ✅ | UI | Set `--c-blue-200 = #ff00aa` → inline `:root` style updates immediately (`document.documentElement.style.getPropertyValue('--c-blue-200')` = `#ff00aa`); `localStorage['sam:color-overrides'] = '{"--c-blue-200":"#ff00aa"}'`; Reset-all button enables and shows `(1)`. Reset-all clears both store and inline style. |
| TC23 | Colors — invalid hex text | ✅ | UI | `#zzzzzz` does not change the inline var (rejected by regex); `#00ff88` applies. |
| TC24 | Export/import round-trip | ✅ partial | UI + blob | Export downloads a blob with shape `{version:2, exportedAt, graph:{id, version, graph:{nodes:13, edges:11}, updatedAt}}`. Filename matches `agent-graph-<timestamp>.json`, MIME `application/json`. Import path covered by reverse direction in TC25 (fixture loaded via the same `loadGraph` codepath); explicit user-uploaded import not exercised. |
| TC25 | Load Test Fixture | ✅ | UI + REST | Click loads `src/fixtures/test-graph.json` silently (no `window.confirm`), replacing 13/11 → 6/5 (`Research Assistant` agent + provider/memory/tools/smart-context/storage). **Re-confirms spec risk** (also flagged in spec § "Known ambiguities and risks") — silent replacement is a UX hazard. |
| TC26 | Run Maintenance — warn mode | ✅ | UI + network | Click `Run Maintenance` → two `POST /api/storage/maintenance` calls (one per agent) but only the **last** report renders: `Mode: warn / Pruned 0 / Orphan 0 / Archived 0 / Rotated no / Evicted 0 / Disk 74503 → 74503 bytes`. **Re-confirms spec known issue** — multi-agent overwrites the displayed report. |
| TC27 | Reset Everything — color override survival | ✅ static | code | [DataMaintenanceSection.tsx:170-173](../../../src/settings/sections/DataMaintenanceSection.tsx#L170-L173) calls `clearGraph + resetAllSessions + resetSettings + clearAllCatalogs`; none of those touch `localStorage['sam:color-overrides']` (managed by `applyColorOverrides`/`saveColorOverrides` in `src/settings/color-config.ts`). Live "Reset Everything" not executed (would erase user's on-disk session data, which was not authorized for this run — see [00-not-executed.md](./00-not-executed.md)). |
| TC28 | Server-down save behavior | ⏭ deferred | — | Requires stopping the backend, which would interfere with the rest of the run. Source confirms `saveSettings` swallows errors at [settings-store.ts:97-99](../../../src/settings/settings-store.ts#L97-L99). |
| TC29 | `/api/settings` 500 on load | ⏭ deferred | — | Requires fault injection in the running backend. Source confirms `loadFromServer` catches in `useSettingsStore`; `loaded=true` is still set. |
| TC30 | PUT settings → runtime mirror | ⏭ §4 cross-link | — | Requires starting a real agent run to observe `currentSafetySettings` mirror at `agent:start`; belongs in §4 (chat / runtime). |

## Notes

### Note A — Manual-mode prompt warning is amber, not red

[03-settings-workspace.md § Defaults / Agent](./03-settings-workspace.md) describes the manual-mode banner as a "red warning banner". The actual element uses Tailwind `border-amber-500/30 bg-amber-500/5 text-amber-300/90`. Visually amber. Doc reconcile only — text content matches the spec ("You are fully responsible for the system prompt. No safety guardrails, tooling, workspace, or runtime metadata will be injected.").

### Note B — Section state persists across canvas round-trip (overrides spec TC4 prediction)

`App.tsx` keeps `activeSettingsSection` in component state but does not unmount the App when toggling `appView`. Switching to canvas and back lands on the section the user last opened, not on `'api-keys'`. The spec's TC4 prediction of "lands on `api-keys`" is incorrect for everything short of a full page reload. Either tighten the spec to say "persists during a single SPA session, resets on reload" or change the App to clear the section on the `appView === 'canvas'` transition. Picking either is a product decision; flagging as a doc-bug, not a code-bug.

### Note C — Model details modal: icon-only close, no Esc/backdrop dismiss

The Model Catalog row-detail modal is a `<div class="fixed inset-0 z-[100] …">`. The header has one icon-only `<button>` (no `aria-label`/`title`) wrapping a `<svg>`. Pressing `Escape` does not close it; clicking the backdrop does not close it. Same a11y pattern as Note C in §2's findings (close-X on Properties panel) and an extension of F-05's broader form-label gap. Capturing here so a future a11y sweep can pick it up alongside F-05.

### Note D — `My Enabled` vs `All Models` filtering is inconclusive on this account

The toggle appears (so the API returned non-empty `userModels`), it switches between two views, the URL/state persists between searches — UI wiring is correct. But the user's OpenRouter account currently has the same set of models enabled as the full discoverable list (367 in both views), so the toggle's *filtering* effect is not visually distinguishable on this run. A separate test on an account with a partial enabled-set would be the only way to prove the filter actually subsets the table.

## Methodology notes

- **State backup:** snapshot graph + settings before destructive cases; restored from `.sam/graph.backup.s3.json` and `.sam/settings.backup.s3.json` after TC13/TC25.
- **MCP click vs JS click:** MCP `click(uid)` occasionally targeted stale elements after rapid React re-renders. Fall-back was an `evaluate_script` block that re-finds the button by text and dispatches `click()` directly + a 100–200 ms `setTimeout` to let React commit. Both reach the same React handler.
- **Form-control automation:** all `<select>` and `<input>` mutations went through the React-friendly value setter (`Object.getOwnPropertyDescriptor(...).set.call(el, val)` + `dispatchEvent('change' or 'input')`) so React's internal value tracking sees the change.
- **Confirm dialogs:** TC13 stubbed `window.confirm` to auto-accept (the `Apply to existing agents` dialog). Restored after.
- **Blob exports:** TC24 monkey-patched `URL.createObjectURL` and `HTMLAnchorElement.prototype.click` to intercept the export blob without triggering an OS download dialog. Patches restored.
- **Network-level evidence:** `chrome-devtools-mcp__list_network_requests` was used to confirm the `POST /api/providers/catalog/refresh` (TC8), the two `POST /api/storage/maintenance` calls (TC26), and the `PUT /api/settings` traffic from settings edits.

## Re-confirmations of prior findings

| Prior finding | TC | Status |
|---|---|---|
| F-04 — only `openrouter` plugin registered server-side | TC14 | still reproduces; environment-limited |
| F-06 — default agent modelId rejected by OpenRouter | TC13 | still reproduces; settings-store override path identified in §2 (`src/settings/types.ts:98`) |
| Spec note — Load Test Fixture replaces graph silently | TC25 | confirmed live; UX risk persists |
| Spec note — Run Maintenance shows only last agent's report | TC26 | confirmed live; two POST calls, one report rendered |
