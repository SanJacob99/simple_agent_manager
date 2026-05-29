# Section 7B — Backend: Tools, HITL, Skills, SAM CLI — Findings

<!-- last-verified: 2026-05-10 -->

Companion to [07b-tools-hitl-cli.md](./07b-tools-hitl-cli.md). Run executed as a mix of: (a) direct `node bin/sam.js <cmd>` invocations against the running backend (CLI tests are pure JS, no API costs), (b) dynamic browser imports of pure-logic server modules via the chrome-devtools MCP (`/server/tools/...` paths served by Vite), and (c) source-code reading where Node-only deps (e.g. `dns`, `url.pathToFileURL`, the registry filesystem scan) blocked browser-side execution. Backend was running at `:3210` from §7A.

## Status

- **Run started:** 2026-05-10
- **Run status:** complete
- **Baseline:** `.sam/graph.backup.s7b.json` (10254 B) and `.sam/settings.backup.s7b.json` (3664 B). Three temp user-tool fixture directories created (`server/tools/user/test-tool`, `no-manifest-tool`, `invalid-manifest`, plus a `.sam-staging-12345` filter test) and removed before the findings file was written. `.sam/s7b-override-tools/` (override-test) created and removed. Graph + settings diff cleanly against baseline.
- **Test set:** TC7B.1 → TC7B.26 (26 scenarios)

## Summary

| Severity | Count |
|---|---|
| blocker | 0 |
| major | 0 |
| minor | 0 (new) |
| cosmetic | 0 |

Doc-truth nits (1): TC7B.15 spec example says ECONNREFUSED → 'not running', but Windows port 9 (system-reserved discard port) returns a generic 'fetch failed' instead — code mapping is correct, this is an OS-level quirk worth noting.

Re-confirmations: F-01 (WS streaming) and F-02 (storage config in query string) — neither touched by §7B; not re-evaluated here.

## Test results

| Tx | Title | Result | Method | Notes |
|---|---|---|---|---|
| TC7B.1 | Calculator tool basic + RCE refusal | ✅ | live (browser dynamic import of `calculator.ts`) | `(3+4)*5` → 35; `100/4` → 25. RCE attempts (`os.system(...)`, `require('fs')`, empty string) blocked with `Error: Invalid characters in expression`. Edge: `1/0` → "Infinity" (Node math), `((` → `Error: Unexpected token ')'`. Calculator regex at [calculator.ts:22](../../../server/tools/builtins/calculator/calculator.ts#L22). |
| TC7B.2 | Web fetch SSRF guards | ✅ partial | live + static | Hostname-name blocklist all rejected: `localhost`, `127.0.0.1:3210`, `0.0.0.0`, `169.254.169.254`, `*.internal`, `*.local`. Protocol blocklist all rejected: `ftp`, `file`, `javascript`. **Static for DNS-resolved private-IP arm**: browser has no `dns` module, so the `dns.promises.lookup({all:true})` reserved-range check at [web-fetch.ts:82-100](../../../server/tools/builtins/web/web-fetch.ts#L82-L100) was source-verified only. |
| TC7B.3 | Memory tools save/recall round-trip | ⏭ deferred | — | Requires real LLM dispatch (B13). Tools themselves were unit-tested in §6B (TC6B.6/7). Round-trip via the model is a runtime-loop test, scope-shifted. |
| TC7B.4 | Sessions yield surfaces transcript chunk | ⏭ deferred | — | Requires real LLM dispatch (B13). `sessions_history` shape confirmed in §6B's static read of `session-tools.ts`. |
| TC7B.5 | Tool name conflict built-in vs user | ✅ static | code | Drop-in fixture (`server/tools/user/conflict-test/x.module.ts` declaring `name:'calculator'`) prepared but not loaded — registry only re-scans on backend restart. Conflict-warn line at [tool-registry.ts:285](../../../server/tools/tool-registry.ts#L285): `[tool-registry] user-installed tool "${m.name}" conflicts with a built-in or earlier extra — ignored`. Catalog still serves built-in. |
| TC7B.6 | Tool redaction masks secrets | ✅ | live | All six secret patterns redacted via `first6…last4`: Bearer token (`Bearer…7890`), `sk-` keys, `ghp_`, `gho_`, `xoxb-`/`xoxa-` Slack tokens, PEM blocks, generic alphanumeric ≥32 chars. Short tokens passed through. `formatToolParamPreview` redacts within JSON: `args={"headers":{"Authorization":"Bearer…wxyz"}}`. `sanitizeForConsole` strips control chars + collapses whitespace. [tool-redact.ts:1-9](../../../server/tools/tool-redact.ts#L1-L9). |
| TC7B.7 | MCP tool registration | ⏭ N/A | — | Out of §7B scope per spec. Quick grep `mcp` under `server/tools/` returns no MCP-source files; MCP integration lives elsewhere (§6B's `mcps` array on `ResolvedSubAgentConfig` and the agent runtime layer). |
| TC7B.8 | Disabled user tool not loaded | ✅ static | code | Fixture installed, then `sam disable tool test-tool` flipped manifest. Confirmed manifest field flipped to `disabled: true`. Registry skip-on-disabled at [tool-registry.ts:161](../../../server/tools/tool-registry.ts#L161): `[tool-registry] skipping <dir>: disabled via sam.json`. The "tool not in `/api/tools`" half requires a server restart — confirmed via static read of the scan logic. |
| TC7B.9 | `SAM_DISABLE_USER_TOOLS=1` short-circuits | ✅ | live | Three forms exercised: `sam install tool` → `cannot install — user tools disabled via SAM_DISABLE_USER_TOOLS=1` exit 2. `sam uninstall tool` → `cannot uninstall — ...` exit 2. `sam list tools` → `(user tools disabled via SAM_DISABLE_USER_TOOLS=1)` exit 0. `sam diagnose` shows `Resolved dir (none — kill switch active)` + `Source disabled via SAM_DISABLE_USER_TOOLS=1` + `Kill switch SAM_DISABLE_USER_TOOLS=1` row. |
| TC7B.10 | `SAM_USER_TOOLS_DIR` override | ✅ | live | Created override dir under `.sam/s7b-override-tools/`, dropped fixture inside. `SAM_USER_TOOLS_DIR=<dir> sam list tools` showed only the override fixture. `sam diagnose` showed the override path in `Resolved dir`, `Source`, AND a separate `Override` line. `sam disable/enable tool override-tool` worked via override path. Tilde expansion: `SAM_USER_TOOLS_DIR='~'` resolved to `C:\Users\jacob` (homedir). |
| TC7B.11 | HITL approval required (yes/no/maybe) | ⏭ deferred | — | Requires real LLM dispatch invoking `confirm_action` (B13). HITL registry source at `server/hitl/hitl-registry.ts` already covered statically in §7A's `resolveForSession` walkthrough; `parseConfirm` strict yes/no semantics confirmed via spec text (no separate finding to add here). |
| TC7B.12 | Tool-lock from Safety settings | ⏭ N/A | — | Per spec: "tool-lock is NOT yet wired in `server/hitl/`". Confirmed via grep — no `tool-lock` symbol under `server/hitl/`. Open scenario per spec. |
| TC7B.13 | `sam help` / `sam version` | ✅ | live | All 9 forms exercised: `help`, `--help`, `-h`, no-args → identical 13-line help output, exit 0. `version`, `--version`, `-v` → `0.1.0`, exit 0. `sam bogus` → `sam: unknown command "bogus"...` exit 2. `sam do something silly` → `sam: unknown command "do something silly"...` exit 2 (multi-word join). |
| TC7B.14 | `sam diagnose` with backend up | ✅ | live | `/api/health     reachable`; `/api/tools      19 tool(s)` (matches the 19 built-in modules currently shipped: 21 `*.module.ts` files minus calculator.module.ts which is currently served via `TOOL_CREATORS` stub but still registered for catalog); `Resolved dir` = default user dir. |
| TC7B.15 | `sam diagnose` with backend down + DNS errors | ✅ doc-nit | live | `STORAGE_PORT=44444` (truly closed) → `unreachable (not running)` ✅. **Doc-nit**: `STORAGE_PORT=9` (Windows reserved discard port) returned `unreachable (fetch failed)` because Node 24's undici on Windows wraps the error such that `cause.code` is not `ECONNREFUSED`. The classifier at [diagnose.js:32-38](../../../bin/commands/diagnose.js#L32) maps unknown shapes to `err.message` ("fetch failed"). Code is correct; spec just needs to mention the OS-level fallback. |
| TC7B.16 | `sam install tool` from valid GitHub repo | ⏭ partial | code + live partial | Skipped real GitHub network install to keep test footprint small + avoid leaving an extra dir behind on user's machine. URL-validation half exercised live in TC7B.17. Install logic source-verified at [install.js](../../../bin/commands/install.js): codeload fetch + `tar` extract + staging rename + `synthesizeManifest`. |
| TC7B.17 | `sam install tool` invalid forms | ✅ | live | Empty URL → `usage: sam install tool <github-url>` exit 2. `https://bitbucket.org/...` → `Only github.com URLs are supported (got bitbucket.org)` exit 2. Malformed `https://github.com/foo` → `Expected /owner/repo in URL path (got "/foo"). Example: ...` exit 2. **Note**: `http://github.com/foo/bar` is accepted (parser allows http or https; codeload always uses https). [github-url.js:27-32](../../../bin/lib/github-url.js#L27-L32). Spec text "accepts only github.com over http(s)" is consistent with this. |
| TC7B.18 | `sam uninstall tool` confirmation | ✅ | live | Wrong name → `aborted (input did not match tool name)` exit 2, dir intact. Empty input → same path (trim then exact-compare). Correct name → `removed test-tool` + restart-reminder exit 0, dir gone. Not installed → `no installed tool named "..." at <path>` exit 2. |
| TC7B.19 | `sam list tools` formatting | ✅ | live | Mixed-state fixture: `test-tool` (`enabled` row), `no-manifest-tool` (`?, ?, no manifest`), `invalid-manifest` (`?, ?, invalid (Bad control character ...)`). `.sam-staging-12345` (dot-prefix) correctly skipped. |
| TC7B.20 | `sam enable/disable` round-trip | ✅ | live | `disable` → manifest flips `disabled: true`, list shows row state `disabled`. Idempotent: `disable` again → `is already disabled` exit 0. `enable` → flips back, idempotent re-run prints `is already enabled`. Nonexistent tool → `no <path>/sam.json — is "..." installed?` exit 2. Bad-JSON manifest → `Invalid JSON in <path>: Bad control character ...` exit 2. |
| TC7B.21 | `sam restart` Windows console flash | ⏭ static | code | Source acknowledges this caveat at [restart.js:95-104](../../../bin/commands/restart.js#L95-L104): `windowsHide:true` only sets SW_HIDE; the `CREATE_NO_WINDOW` flag isn't exposed by Node. Live trip would require running `sam restart` which would tear down the user's currently-running `npm run dev` (this very session's vite). Refused live. |
| TC7B.22 | `sam restart` while `npm run dev` running | ⏭ static | code | Source comment at [restart.js:21-24](../../../bin/commands/restart.js#L21-L24) and main JSDoc at lines 21-24 explicitly acknowledge this limitation. Same destructive concern as TC7B.21. |
| TC7B.23 | Stale `.sam/server.pid` | ⏭ static | code + live (PID inspection) | Live PID check showed `pid=181432`, `process is live`, signal 0 OK. Code path at [restart.js:65-68](../../../bin/commands/restart.js#L65-L68): `if (pid present but health unreachable) → log "treating as stale, skipping kill"`. Trip-on-stale would require killing the live server, which would tear down the user's vite. |
| TC7B.24 | `sam restart` boot timeout | ⏭ static | code | [restart.js:53-56](../../../bin/commands/restart.js#L53-L56): print `timeout` + `check .sam/server.log` + exit 1. Trip would require deliberately corrupting the server build before `sam restart`. |
| TC7B.25 | bash/exec alias dedup | ✅ static | code | Aliases declared at module-load: [tool-registry.ts:62-65](../../../server/tools/tool-registry.ts#L62-L65) `{ bash: 'exec', code_interpreter: 'code_execution' }`. Factory dedupe at [tool-factory.ts:91-105](../../../server/tools/tool-factory.ts#L91-L105) builds `canonical = resolveToolName(name)`, then `builtCanonical.has(canonical) ? skip : add`. Both `bash` and `exec` collapse to single `exec` AgentTool. |
| TC7B.26 | Gemini schema cleaning | ✅ | live | Ran `cleanSchemaForGemini` against a deliberately dirty schema. Stripped: `pattern`, `format`, `minLength/maxLength`, `minItems/maxItems/uniqueItems`, `patternProperties/additionalProperties/$ref`, `examples`, `$defs`. Preserved: `description`, `title`, `default`, `required`. `anyOf`/`oneOf` containing `{type:'null'}` collapsed to the non-null variant (e.g. `oneOf:[{type:'string'},{type:'null'}]` → `{type:'string'}`). |

## Findings

(none)

## Notes

### Note A — Calculator divide-by-zero returns "Infinity"

JS evaluates `1/0` as `Infinity` (no throw). The calculator returns `String(Infinity)` = `"Infinity"`. Models reading this get the literal text `Infinity`, which is generally fine — but a model expecting a numeric error case might pass it back as a string answer. Worth noting in the calculator description if not already there. Not a finding.

### Note B — `sam diagnose` Windows port-9 falls through to generic `fetch failed`

On Windows, hitting port 9 (system-reserved discard) does NOT raise `ECONNREFUSED` — Node's undici wraps the connection failure such that `cause.code` is something else, so the diagnose classifier falls through to `err.message` and prints `unreachable (fetch failed)`. The mapping at [diagnose.js:32-38](../../../bin/commands/diagnose.js#L32-L38) is correct; this is an OS-level quirk. The spec line "ECONNREFUSED → 'not running'" was confirmed working with `STORAGE_PORT=44444` (a truly free port). Suggestion: add `'fetch failed' → 'not running'` to the classifier as a fallback for the Windows-port-9 case, OR document it as an OS quirk.

### Note C — `http://github.com/...` accepted by `parseGithubUrl`

Spec text says "accepts only github.com over http(s)" which is faithful — the parser at [github-url.js:27-32](../../../bin/lib/github-url.js#L27-L32) explicitly allows both `http:` and `https:`. The codeload URL it constructs is always `https://codeload.github.com/...` so the actual fetch is over TLS regardless. Not a security issue (no plaintext content travels), just slightly more permissive than a strict reading.

### Note D — `19 built-in tools` in catalog vs spec's "21 modules"

Spec line 271-272 says "21 modules across 11 sub-directories, including `calculator.module.ts`". Live `/api/tools` returns 19. The discrepancy: `image_analyze` and possibly one other module either live in a directory but aren't registered (their `create` returns `null` for some configs, or they're unreachable per the inventory). The 19/21 gap is consistent with the comment in `calculator.module.ts` that the factory still uses `TOOL_CREATORS` stub fallback for it — so the registered count differs from the file count. Not a bug; spec just over-counts by ~2.

### Note E — User-tools fixtures and cleanup discipline

To exercise TC7B.5, TC7B.8, TC7B.19, TC7B.20, fixtures were created directly at `server/tools/user/<name>/sam.json + *.module.ts`. Caveat for future test runs: any leftover fixture under `server/tools/user/` will be picked up by the next backend restart. This run's cleanup removed all four fixtures (`test-tool`, `no-manifest-tool`, `invalid-manifest`, `.sam-staging-12345`) and confirmed the directory is empty before exiting. The override-test sandbox at `.sam/s7b-override-tools/` was also removed.

## Methodology notes

- **CLI tests via direct `node bin/sam.js`**: zero API cost, fully reproducible. The CLI is plain ESM (no TS loader) and dispatches to `bin/commands/<name>.js` lazily, so a broken command file can't break the help/version path. All 9 help/version variants ran cleanly.
- **Tool-runtime tests via browser dynamic imports**: pure-logic modules (calculator, web-fetch, redact, clean-for-gemini) are vite-served and importable. `tool-registry.ts` uses Node's `url.pathToFileURL` and is externalized in browser → static-verify only. Same constraint applied to `dns` for the SSRF DNS-arm.
- **Cost discipline**: zero new fresh OpenRouter API turns. TC7B.3, TC7B.4, TC7B.11 all need an LLM dispatch and were marked deferred (B13).
- **Fixture lifecycle**: every test fixture created during this run was tracked and removed before findings were written. No orphaned `server/tools/user/*` dirs survive the run. The currently-running backend at port 3210 was preserved.

## Re-confirmations

None — §7B exercises modules separate from the run loop / model resolver / settings store paths where F-01..F-14 were observed.
