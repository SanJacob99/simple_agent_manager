# Section 7B — Backend: Tools, HITL, Skills, SAM CLI

<!-- last-verified: 2026-05-08 -->

## Scope

This section documents the server-side tools subsystem (factory, registry,
adapter, name policy, redaction, SDK, schema scrubber), the built-in tool
inventory under `server/tools/builtins/`, the runtime-side session tools at
`server/sessions/session-tools.ts`, the Human-in-the-Loop registry under
`server/hitl/`, the bundled-skills root under `server/skills/`, the
server-side SAM Agent assistant under `server/sam-agent/`, and the SAM CLI
under `bin/`.

Out of scope (covered elsewhere):

- REST routes, sessions/storage backends, transcript store — Section 7A
- Agent runtime turn loop and providers — Section 6A
- Memory engine, context engine, hooks — Section 6B
- Shared tool name resolution (`shared/resolve-tool-names.ts`) — Section 5

## Tools Subsystem

### Tool Factory (`server/tools/tool-factory.ts`)

`createAgentTools(names, extraTools, providerWebContext, factoryContext)`
is the single seam between the runtime and the catalog of tools. It walks
the resolved name list (already deduped to canonical names by
`shared/resolve-tool-names.ts`) and produces one `AgentTool<TSchema>` per
name. Behavior verified in source:

- Session tool names (those in `SESSION_TOOL_NAMES`) are skipped here —
  they are produced separately by `createSessionTools` because they need
  per-session context (router, transcript store, etc.) that the factory
  does not carry. See `lines 35, 92–94` and `session-tools.ts`.
- Registry-served tools win. If `REGISTERED_TOOL_NAMES.has(name)`, the
  factory resolves the alias with `resolveToolName(name)` and calls
  `buildToolFromModule(name, agentConfig, runtime)`. Aliases are deduped
  by canonical name — both `bash` and `exec` collapse to a single
  `exec` AgentTool, which avoids Gemini's "Duplicate function declaration"
  rejection (`lines 86–106`).
- Stub fallback. If the name is NOT in the registry, the factory looks
  it up in a literal map `TOOL_CREATORS`. Today the only entry is
  `calculator`, which has not yet been migrated to a `ToolModule`
  (`lines 31–33, 109–113`). Every other built-in flows through the
  registry — including `web_fetch`, `ask_user`, `confirm_action`, the
  `fs` tools, `exec`, image/audio/canva/browser/code-execution. The
  `IMPLEMENTED_TOOL_NAMES` re-export at line 25 is a back-compat
  shim — the canonical list lives in `shared/resolve-tool-names.ts`.
- `RuntimeHints` is built once per call and passed to every module's
  `resolveContext` and `create`. Fields: `cwd` (defaults to
  `process.cwd()`), `sandboxWorkdir`, `modelId`, `hitl`,
  `getOpenrouterApiKey`, `providerWeb` (`lines 73–80`).
- A fall-back empty `AgentConfig` is used if `factoryContext.agentConfig`
  is not supplied — modules that need required fields are expected to
  return `null` from `create` (`lines 81–83`).
- After build, the combined list is run through `findToolNameConflicts`;
  duplicates are logged via `logError('tools', ...)` but NOT thrown
  (`lines 118–124`).
- The final list is returned via `adaptAgentTools`, which wraps each
  tool's `execute` and applies Gemini schema cleaning when needed.

Caching/lifetime: there is none. `createAgentTools` is called per run
(by `RunCoordinator`) and the resulting `AgentTool[]` is discarded with
the run. The registry itself is a process-lifetime singleton populated
once at startup.

### Tool Adapter (`server/tools/tool-adapter.ts`)

`adaptAgentTool` wraps a tool's `execute` with three guarantees:

1. Params coercion via `coerceParamsRecord` — when providers stream
   tool-call arguments as a JSON string (some OpenAI shapes), the
   wrapper parses it once before invoking the tool. Returns the raw
   value if parsing fails so downstream schema validation can complain
   (`lines 23–37`).
2. Try/catch around `originalExecute`. Abort errors (signal aborted or
   `err.name === 'AbortError'`) are re-thrown so the runtime's abort
   path keeps working. Anything else is converted to a structured
   error result `{status: 'error', tool, error}` and a redacted log line
   is emitted (`lines 102–129`). The redacted preview uses
   `formatToolParamPreview` from `tool-redact.ts`.
3. Result normalization via `normalizeToolExecutionResult` — anything
   missing `content[]` is wrapped into a JSON text block so the runtime
   never forwards a broken payload (`lines 60–74`).

`adaptAgentTools(tools, modelId)` additionally calls
`cleanSchemaForGemini` on every tool's `parameters` when `modelId`
matches `gemini`, `gemma`, or `google/`. This is a one-shot transform
(`lines 134–153`) — see `server/tools/schema/clean-for-gemini.ts` for
the keyword strip list (`patternProperties`, `additionalProperties`,
`$ref`, `pattern`, `format`, `minItems`, `not`, etc.).

`isToolErrorDetails(value)` is the type guard the runtime/transcript
store uses to detect adapter-produced error envelopes.

### Tool Registry (`server/tools/tool-registry.ts`)

Discovery model: filesystem scan at startup. `initializeToolRegistry()`
walks each directory recursively, collects every `*.module.ts` /
`*.module.js` file, dynamically imports it, and treats the `default`
export as a `ToolModule` if it satisfies `isToolModule` (name + label +
description + resolveContext + create) — see `lines 105–139, 193–203`.

- Built-in directory: defaults to `<this-file>/../builtins` resolved via
  `import.meta.url`. Failure to scan is FATAL — built-ins are server
  code (`failSoft: false`).
- Extra directories: passed in via `extraDirs`. Failures (ENOENT or
  other) are logged and skipped — user tools must never crash the
  server (`failSoft: true` on the walk; per-file load errors fall
  through to `console.error` for `extra` source vs `throw` for
  `builtin` — `lines 221–230`).
- Disabled flag: for every file under an extras directory, the registry
  reads the parent directory's `sam.json` once (cached per dir) and
  drops the file if `disabled === true`. The skip is logged as
  `[tool-registry] skipping <dir>: disabled via sam.json`
  (`lines 149–168`). README's claim that the flag is honored is
  faithful — but note: `disabled` is read at scan time only. **Restart
  required** for any change to take effect.
- Built-in name collisions: throw at startup
  (`duplicate built-in tool name`, `lines 273–279`).
- Extra-vs-built-in collisions: extras are silently ignored with a
  console warning. User tools cannot shadow a built-in (`lines 282–289`).
- Idempotent. A second `initializeToolRegistry()` resolves the same
  in-flight promise unless `resetForTests: true` is passed
  (`lines 235–243, 250–256`).
- Aliases are static, declared at module load: `bash → exec`,
  `code_interpreter → code_execution` (`lines 62–65, 75`). They are
  added to `REGISTERED_TOOL_NAMES` immediately so the alias dispatch
  in `tool-factory.ts` works even before init.

Public API:

- `TOOL_MODULES` (live ReadonlyArray), `REGISTERED_TOOL_NAMES`
  (live ReadonlySet), `TOOL_ALIASES`.
- `resolveToolName(name)` — alias → canonical.
- `getToolModule(name)`, `buildToolFromModule(name, config, runtime)`,
  `getToolClassification(name)`,
  `groupToolsByClassification(names)` — used by the safety policy to
  decide which tools need confirmation.
- `getToolCatalog()` — UI projection consumed by `GET /api/tools` and
  the frontend `model-catalog-store`. Returns `{name, label,
  description, group, classification}` per module
  (`lines 320–329`).
- `getToolSourceCounts()` — `{builtin, user}` count for the startup
  log. Built-in count today equals the number of `*.module.ts` files
  under `server/tools/builtins/`.
- `isToolRegistryInitialized()` — sanity check used by tests and
  startup ordering.

`getToolModule`, `buildToolFromModule`,
`groupToolsByClassification`, and `getToolCatalog` all throw a
loud "Tool registry not initialized" error if called before
`initializeToolRegistry()` resolves (`ensureInitialized`,
`lines 345–352`).

### Tool Name Policy (`server/tools/tool-name-policy.ts`)

Two helpers:

- `normalizeToolName(name)` — `trim().toLowerCase()`. No reserved-name
  rejection, no character filtering. Casing is informational only;
  the registry uses canonical (already-lowercase) names everywhere.
- `findToolNameConflicts(names)` — returns the raw forms of any
  tool names that collide AFTER normalization. Used in `tool-factory.ts`
  after the final list is assembled. Conflicts are logged but not
  thrown — the runtime keeps going. There is no protection against
  user tools picking names with different casing than a built-in;
  the registry's own dedupe by canonical name wins.

There is no reserved-name list in this file. The closest equivalent is
`groupToolsByClassification`'s explicit exclusion of `ask_user` and
`confirm_action` from every bucket (the HITL gates are not gated by
themselves).

### Tool Redaction (`server/tools/tool-redact.ts`)

Pattern-based redaction applied to logged tool params/details. The
patterns target common secret shapes (`lines 1–9`):

- `Bearer <token>`
- `sk-...` (OpenAI-style keys)
- `ghp_...`, `gho_...` (GitHub PATs)
- `xox[baprs]-...` (Slack tokens)
- `-----BEGIN ... PRIVATE KEY-----` blocks
- Bare alphanumeric runs of length ≥ 32 (catch-all for opaque tokens
  and most API keys)

`maskValue` keeps the first 6 and last 4 chars when length ≥ 18 ("first…last");
shorter matches collapse to `***`. `sanitizeForConsole` strips control
characters and trims to 600 chars by default.

`formatToolParamPreview(label, value)` is what the adapter logs on
error and is therefore the redaction surface for tool params during
failures. **Redaction happens only on log paths.** The actual
arguments and results passed to the model and persisted to transcripts
are not touched here — see Section 7A for transcript persistence.

### Tool SDK & Tool Module (`server/tools/sdk.ts`, `tool-module.ts`)

`tool-module.ts` defines the registry contract:

- `ToolModule<TContext>`: `name`, `label`, `description`, optional
  `group` (for the Tools-node UI), optional `icon`, optional
  `classification` (`'read-only' | 'state-mutating' | 'destructive'`,
  default state-mutating), optional `config: { schema, defaults }`,
  required `resolveContext(config, runtime) → TContext`, required
  `create(ctx, runtime) → AgentTool | null`.
- `RuntimeHints`: `cwd`, `sandboxWorkdir`, `modelId`, `hitl`,
  `getOpenrouterApiKey`, `providerWeb`.
- `ProviderWebContext`: `{ plugin, apiKey, baseUrl }` — handed to
  `web_search` / `web_fetch` modules so they can delegate to a
  provider plugin (e.g. OpenRouter) before falling back to the
  built-in implementation.
- `defineTool<TContext>(module)` — identity helper that pins the
  generic; without it TS widens `TContext` to `unknown` at the call
  site and inference on `create` is lost.

`sdk.ts` re-exports `defineTool`, `ToolModule`, `ToolClassification`,
`RuntimeHints`, `ProviderWebContext`. This is the **stability contract**
for user tools: a `*.module.ts` file is supposed to import from this
file, not from `tool-module` directly. Adding exports is non-breaking;
renaming/removing is breaking.

### User Tools Directory (`server/tools/resolve-user-tools-dir.ts`)

`resolveUserToolsDir(env = process.env)` returns
`{dirs: string[], describe: string}`. Precedence:

1. `SAM_DISABLE_USER_TOOLS=1` — kill switch. Returns
   `{dirs: [], describe: 'disabled via SAM_DISABLE_USER_TOOLS=1'}`.
2. `SAM_USER_TOOLS_DIR=<path>` — override. Expands a leading `~`
   (`~` alone or `~/...`) and returns that single dir.
3. Default — `<this-file>/../user`, i.e. `server/tools/user/` resolved
   from `import.meta.url` so it works under tsx and a compiled layout.

Missing dirs are not filtered here — the registry's
`failSoft: true` walk handles ENOENT gracefully. The CLI mirrors this
exact precedence in `bin/lib/resolve-user-tools-dir.js` so installs
land where the server later reads them.

### Built-in Tools (`server/tools/builtins/`)

Inventory by directory (every tool except `calculator` ships a
`*.module.ts` and is registry-driven; calculator is served from the
`TOOL_CREATORS` stub). All are real implementations.

| Tool dir | Files | Notes |
|----------|-------|-------|
| `calculator/` | `calculator.module.ts`, `calculator.ts` | `expression: string`. Whitelist regex `^[0-9+\-/*%().\s]+$` then `new Function('return (...)')`. Returns text. (Module exists but factory still uses `TOOL_CREATORS` fallback today.) |
| `web/web-fetch.ts` | name `web_fetch` | `url`, optional `method`. SSRF guard: protocol must be http/https; explicit hostname blocklist (`localhost`, `127.0.0.1`, `0.0.0.0`, `::1`, `169.254.169.254`, `*.internal`, `*.local`); DNS lookup with `{all: true}` and per-record IPv4/IPv6 reserved-range checks. HTML auto-converted to text via `htmlToText`. Body truncated at 10000 chars. |
| `web/web-search.ts` | name `web_search` | Provider-plugin delegated when `runtime.providerWeb` is present. |
| `human/ask-user.ts` | name `ask_user` | Freeform Q&A. Default timeout 45 s, max 55 s (Gemini's 60 s streaming idle limit). Emits `hitl:input_required` and `hitl:resolved` events; awaits `HitlRegistry.register`. Aborts on `signal` via `registry.resolve(... cancelled: aborted)`. |
| `human/confirm-action.ts` | name `confirm_action` | Strict yes/no gate. Same timeout policy as `ask_user`. Description tells the model to call this BEFORE any destructive action and to leave it as the only tool call in the turn. |
| `fs/read-file.ts` | `read_file` | Workspace-aware via `RuntimeHints.cwd` + `sandboxWorkdir`. |
| `fs/write-file.ts` | `write_file` | Same. |
| `fs/edit-file.ts` | `edit_file` | Same. |
| `fs/list-directory.ts` | `list_directory` | Same. |
| `fs/apply-patch.ts` | `apply_patch` | Same; applies unified diffs. |
| `exec/exec.ts` | `exec` (alias `bash`) | Workspace-restricted shell when `sandboxWorkdir`. The factory dedupes `bash`/`exec` to a single declaration. |
| `code-execution/code-execution.ts` | `code_execution` (alias `code_interpreter`) | Sandboxed code run. |
| `image/image-generate.ts` | `image_generate` | Uses `getOpenrouterApiKey` lazy resolver. |
| `image/image-analyze.ts` | `image_analyze` | Multimodal image-understanding tool. |
| `image/show-image.ts` | `show_image` | Surfaces an image into the transcript/UI. |
| `music/music-generate.ts` | `music_generate` | OpenRouter-keyed. |
| `tts/text-to-speech.ts` | `text_to_speech` | OpenRouter-keyed. |
| `canva/canva.ts` | `canva` | Canva connector. |
| `browser/browser.ts` | `browser` | Headless Chrome via `chrome-launcher.ts`. |

The `getToolSourceCounts().builtin` value at startup should equal the
count of `*.module.ts` files under `server/tools/builtins/` (today: 21
modules across 11 sub-directories, including `calculator.module.ts`).

### Session Tools (`server/sessions/session-tools.ts`)

Built per-run from a `SessionToolContext`. Each is included only when
its name appears in `ctx.enabledToolNames` AND in `SESSION_TOOL_NAMES`.

| Tool | Args | Behavior |
|------|------|----------|
| `sessions_list` | `kind?` (all/agent/cron), `recency?` (minutes), `label?` (substring), `agent?` (must equal caller agentId), `preview?` | Returns session summaries from `SessionRouter.listSessions`. With `preview=true`, capped at 50 results and includes first-user preview (≤120 chars) plus `messageCount` from the transcript. |
| `sessions_history` | `sessionKey`, `limit?` (default 20, max 200), `before?` (entryId cursor), `includeToolResults?` (default true) | Reads transcript newest-first via `transcriptStore.readTranscript`. Per-message cap 500 chars, per-tool-result cap 200 chars, total budget ~12000 chars. Returns `{entries, nextCursor, truncated, totalEntries}`. |
| `sessions_send` | `sessionKey`, `message`, `wait?`, `timeoutMs?` | Dispatches a turn via `coordinator.dispatch`. With `wait=true`, awaits `coordinator.wait`. Refuses sessions with a `sub:` prefix (sub-agent sessions are one-shot). |
| `session_status` | `sessionKey`, `modelOverride?` | Reads/writes session metadata. When `modelOverride` is provided, calls `sessionRouter.updateAfterTurn`. |
| `sessions_spawn` | `subAgent` (literal union of declared names), `message`, `overrides?`, `wait?` (default true), `timeoutMs?` | Only registered when `parentSubAgents.length > 0` AND wiring (`subAgentExecutor`, abort register/unregister, persist callbacks, `parentAgentConfig`) is fully present. Validates overrides against each sub-agent's `overridableFields` allowlist. Uses `SubAgentRegistry.spawn` and `SubAgentExecutor.dispatch`; persists immutable spawn record + mutable session meta. |
| `sessions_yield` | `timeoutMs?` (default 600000) | Calls `ctx.resolveYield`. Reports number of running sub-agents. No-op when none active or yield already pending. |
| `subagents` | `action` (list/status/kill), `subAgentId?` | `kill` calls `subAgentRegistry.kill(id)` then `abortRun(record.runId)` — same order as the REST kill path. |

### Tool Schema (`server/tools/schema/clean-for-gemini.ts`)

Strips Gemini-unsupported JSON Schema keywords (`patternProperties`,
`additionalProperties`, `$ref`, `$defs`, `$id`, `$schema`,
`definitions`, `examples`, `minLength`, `maxLength`, `minimum`,
`maximum`, `multipleOf`, `pattern`, `format`, `minItems`, `maxItems`,
`uniqueItems`, `minProperties`, `maxProperties`, `not`) and simplifies
`anyOf`/`oneOf` containing a null variant. `description`, `title`,
`default` are preserved.

Consumers: invoked from `adaptAgentTools` in `tool-adapter.ts` when
`modelId` matches `gemini`, `gemma`, or starts with `google/`. No
other callers — model-resolver-driven decision is centralised here.

## HITL (`server/hitl/`)

Single file: `hitl-registry.ts`. There is no separate "HITL
coordinator" — the registry IS the queue. The runtime call path is:

1. Tool dispatch hits `ask_user` or `confirm_action`.
2. The tool emits `hitl:input_required` via the WS event emitter
   passed in through `RuntimeHints.hitl.emit`.
3. The tool calls `registry.register(...)` and awaits the returned
   promise.
4. WS `hitl:respond` (or a user message routed through
   `resolveForSession`) calls `registry.resolve(...)`.
5. The promise resolves with `{kind: 'text'|'confirm', answer}` OR
   `{cancelled: true, reason: 'timeout'|'aborted'}`. Tool returns the
   answer back to the model as a normal tool result.

### Approval queue model

`Map<key, PendingEntry>` keyed by `agentId::sessionKey::toolCallId`.
Entries hold `resolve` (the promise resolver) + a `setTimeout` timer.
Entries live in process memory; **server restart drops them**, the
tool times out at the runtime end. Re-registration under the same key
cancels the existing entry with `aborted` and starts a new one.

### Lock semantics (tool-lock from Safety settings)

Not implemented in `server/hitl/`. The registry knows nothing about
"which tools are locked" — that decision lives elsewhere
(`groupToolsByClassification` in `tool-registry.ts` is the closest
hook today, and it is purely informational). Searches confirm no
`tool-lock` symbol in `server/hitl/`. **Document as: not yet wired.**

### Approve/deny flow (endpoints)

WS `hitl:respond` (text answer) and `hitl:respond` with `confirm`
form. REST surface: TBD — verify against Section 7A. The registry
itself has only the in-process API:
`register`, `resolve`, `resolveForSession`, `cancelAllForSession`,
`listForSession`, `hasPendingForSession`.

`resolveForSession` is the dispatch-path hook: when a user message
arrives while a HITL prompt is pending, the dispatcher routes the
text through this method INSTEAD of starting a new turn. For
`kind:'confirm'` prompts, `parseConfirm` requires exactly "yes"/"no"
(case-insensitive, trimmed) — anything else returns
`{parseError: 'Please reply exactly "yes" or "no".'}` and the entry
stays pending.

### Timeout / default behavior

- Default 45 s, max 55 s for both `ask_user` and `confirm_action`.
- Caps are inside the tools themselves, not the registry — pass an
  arbitrary `timeoutMs` to `register` and the timer fires accordingly.
- Timeout resolves the pending entry with
  `{cancelled: true, reason: 'timeout'}` and is returned to the model
  as `[user did not answer: timeout]`.
- Abort path: `signal.addEventListener('abort', ...)` is wired in
  `ask-user.ts`/`confirm-action.ts`, calling
  `registry.resolve(... reason: 'aborted')`.

## Server-Side Skills (`server/skills/`)

Two surface points:

- `bundled-skills-root.ts` — exposes `getBundledSkillsRoot()` (the
  absolute path to `server/skills/bundled/`) and
  `substituteBundledSkillsRoot(text)`. The shared placeholder
  `BUNDLED_SKILLS_ROOT_PLACEHOLDER` (from
  `shared/default-tool-skills.ts`) lets the client embed paths like
  `{SAM_BUNDLED_ROOT}/exec/SKILL.md` inside saved AgentConfigs without
  hard-coding the install path.
- `bundled/<id>/SKILL.md` — bundled SKILL.md sources. Today: `browser`,
  `canva`, `code-execution`, `exec`, `image`, `music-generate`,
  `text-to-speech`, `web-search`.

The actual skill folding (SkillsNode entries, `ToolsNode.skills`)
happens in `shared/system-prompt-builder.ts` and
`shared/resolve-tool-names.ts`. The server's contribution is purely
serving the file content from the bundled root.

## SAM Agent Server (`server/sam-agent/`)

The in-app SAM Agent assistant — a separate runtime that helps the
user edit their graph. Files:

- `sam-agent-coordinator.ts` — owns the lifecycle. Wraps an
  `AgentRuntime` built per-dispatch via `buildSamAgentConfig`.
  Tracks current message id, accumulated text, and tool results.
  Manages a HITL registry instance (`SamAgentHitlRegistry` — its
  own, not the run registry) and emits `samAgent:event` envelopes.
  Single-flight: `inFlight` boolean blocks concurrent dispatch.
- `sam-agent-config.ts` — builds the agent config (model selection,
  tools).
- `sam-agent-system-prompt.ts` — assembles the SAM-specific system
  prompt.
- `sam-agent-tools.ts` — declares the agent's tool surface.
- `sam-agent-doc-tools.ts` — doc/concept lookup tools.
- `sam-agent-patch-tool.ts` — produces graph patch suggestions.
- `sam-agent-validators.ts` — patch validation.
- `sam-agent-transcript.ts` — separate transcript store for the SAM
  Agent's own conversation. NOT the same persistence as user
  sessions.
- `sam-agent-hitl.ts` — separate HITL registry; events are forwarded
  to WS as `samAgent:event` with `hitl:input_required` /
  `hitl:resolved` payloads.
- `transcripts/` — runtime artefact directory.

Endpoints / WS surface and apply-card application: verify in
`server/index.ts` and `server/api/` (Section 7A territory).

## SAM CLI (`bin/`)

### Dispatcher (`bin/sam.js`)

Plain ESM (no TypeScript loader). Reads version from `package.json`.
Exit codes:

- `0` — success.
- `1` — caught error in `main()` (prints stack to stderr).
- `2` — unknown command (`sam: unknown command "<args>"`).

Commands are loaded lazily via dynamic `import()` from `./commands/`
so a broken command file cannot break unrelated commands. Both
`-h/--help/help` and `-v/--version/version` are recognized.

### Commands

#### `sam help`
Prints the static help block. Exit 0.

#### `sam version`
Reads `version` from `package.json`. Exit 0.

#### `sam diagnose` (`bin/commands/diagnose.js`)
Read-only probe of `http://localhost:<STORAGE_PORT>` (default 3210):

1. `GET /api/health` with 1500 ms timeout. Reports `reachable`,
   `unreachable (timeout|not running|host not found|...)`, or
   `HTTP <status>`. `ECONNREFUSED → 'not running'`,
   `ENOTFOUND → 'host not found'`, `AbortError → 'timeout'`.
2. If health OK, `GET /api/tools` with 3000 ms timeout. Reports
   tool count from the parsed JSON length.
3. Prints `User tools` block: resolved dir from
   `resolveUserToolsDir(env)`, `Source:` describe string,
   `Override:` if `SAM_USER_TOOLS_DIR` is set, `Kill switch:` if
   `SAM_DISABLE_USER_TOOLS` is set.

No mutation. Exit 0 even on probe failure (the user's diagnostic
expects to see the failure printed).

#### `sam install tool <github-url>` (`bin/commands/install.js`)

1. `parseGithubUrl(args[1])` — accepts only `github.com` over
   http(s). Forms: `/owner/repo`, `/owner/repo/`, `/owner/repo.git`,
   `/owner/repo/tree/<ref>`. Default ref `HEAD`. Anything else
   throws → CLI exits 2.
2. `resolveTargetDir()` — same precedence as the server. If the
   kill switch is on (`dirs.length === 0`), prints
   `cannot install — user tools <describe>` and exits 2.
3. Refuses if `<userDir>/<repo>` already exists (exits 2 with
   "Use `sam uninstall tool <repo>` first").
4. Downloads `https://codeload.github.com/<o>/<r>/tar.gz/<ref>` to
   OS tmp via `fetch`. HTTP-non-OK throws.
5. Extracts via system `tar`. On Windows, prefers
   `C:\Windows\System32\tar.exe` (bsdtar); falls back to `tar
   --force-local` (GNU tar) so `C:\...` is not parsed as a
   remote-tape spec.
6. Stages inside the user dir as `.sam-staging-<pid>-<ts>` so the
   final move is a same-filesystem rename (avoids EXDEV when /tmp
   is on a different drive on Windows).
7. Validates archive root: must contain `sam.json` OR at least one
   `*.module.ts`. If missing both, throws "this does not look like
   a SAM user tool".
8. If `sam.json` is shipped, validates it via `readManifest`; bad
   shape throws.
9. Otherwise, synthesizes a manifest with `name=<repo>,
   version=0.0.0, source=<github-url>, disabled=false, _todo=...`
   and writes it. Prints "synthesized sam.json".
10. `fs.renameSync(archiveRoot, targetDir)`. Cleans staging + tar
    in `finally` (best-effort).
11. Prints `Installed:` block with name/version/source/path and
    instructs the user to restart.

Side effects: writes `<userDir>/<repo>/`. Exit 1 on install failure
(after cleanup).

#### `sam uninstall tool <name>` (`bin/commands/uninstall.js`)

1. Resolve target dir; refuse if kill switch active.
2. `<dir>/<name>` must exist; exit 2 with "no installed tool named
   <name>" if not.
3. Print `This will delete <path> and everything inside it.`
4. `prompt('Type the tool name to confirm: ')`. **Must match
   `name` exactly** (no fuzzy match). Mismatch → exit 2 with "input
   did not match tool name".
5. `fs.rmSync(targetDir, {recursive, force})`. Print "removed
   <name>" + restart reminder.

#### `sam list tools` (`bin/commands/list.js`)

Read-only. Walks `resolveTargetDir().dir`, skipping `.`-prefixed
subdirs (avoids `.sam-staging-*` left behind by crashed installs).

For each subdir:

- No `sam.json` → row with `?, ?, no manifest`.
- Bad JSON / shape → row with `?, ?, invalid (<msg>)`.
- Otherwise → `name | version | source | enabled|disabled`.

Disabled rows are dimmed via ANSI `\x1b[2m...\x1b[0m`. Color
suppressed when stdout is not a TTY or `NO_COLOR` is set.

Special states:

- Kill switch active → prints `(user tools disabled via SAM_DISABLE_USER_TOOLS=1)`.
- Dir does not exist → `(no user tools — <dir> does not exist yet)`.
- Empty dir → `(no user tools installed in <dir>)`.

#### `sam enable tool <name>` / `sam disable tool <name>` (`bin/commands/toggle.js`)

Single module handles both verbs.

1. Resolve target dir; refuse if kill switch active.
2. `readManifest(<dir>/<name>)`. Missing → exit 2 with "is <name>
   installed?". Bad shape → exit 2 with the validator's message.
3. Idempotent: if `manifest.disabled === targetDisabled`, print
   "is already <enabled|disabled>" and return.
4. Flip the flag, `writeManifest`, print "<name> enabled|disabled"
   plus "Run `sam restart` (or restart the backend) for the change
   to take effect."

No source-code changes. **Restart required.**

#### `sam restart` (`bin/commands/restart.js`)

Inline supervisor — no separate watcher.

1. Read `<repo>/.sam/server.pid` from `bin/lib/sam-paths.js`. If
   missing → "no .sam/server.pid — nothing to stop", proceed to
   spawn.
2. If pid present but `/api/health` unreachable, treat as stale
   pid, skip kill.
3. SIGTERM, wait up to `STOP_TIMEOUT_MS=5000` for `/api/health` to
   stop responding. If still alive, SIGKILL + wait
   `KILL_TIMEOUT_MS=2000`.
4. Spawn fresh: `node --import tsx server/index.ts`, detached,
   stdio redirected to `.sam/server.log` (truncated on each run),
   `windowsHide: true`, `child.unref()`.
5. Poll `/api/health` every `POLL_INTERVAL_MS=300` ms up to
   `BOOT_TIMEOUT_MS=20000`. Print `ok` and exit 0; on timeout
   print `timeout` + "check .sam/server.log" and exit 1.

Known caveats (per source comments):

- **Windows console flash**: detached `spawn` of a console app
  briefly pops a window because Node does not expose
  `CREATE_NO_WINDOW`. `windowsHide: true` only sets `SW_HIDE`.
  Workaround: run `npm run dev:server` directly and skip
  `sam restart`.
- **`npm run dev` (concurrently + vite)**: tearing down the
  server takes vite with it because concurrently exits when one
  child dies. The user must re-run `npm run dev` to bring vite
  back up.

### `bin/lib/` helpers

- `github-url.js` — `parseGithubUrl(input)`. Throws on non-https,
  non-`github.com`, or unsupported path forms. Returns
  `{owner, repo, ref, sourceUrl, codeloadUrl}`.
- `install-target.js` — `resolveTargetDir(env)`. Wraps
  `resolveUserToolsDir` to return `{dir: string|null, info}`. `null`
  when the kill switch is on.
- `manifest.js` — JS-side mirror of the TypeBox schema. Required
  fields: `name`, `version`, `source`, `disabled`. `name`/`version`/
  `source` must be non-empty strings; `disabled` must be a boolean.
  `synthesizeManifest({name, source})` produces `version: '0.0.0',
  disabled: false, _todo: '...'`. Comment in source notes: keep in
  sync with `shared/user-tool-manifest.ts` by hand.
- `prompt.js` — the type-the-name confirmation reader for
  uninstall.
- `resolve-user-tools-dir.js` — JS port of the TS resolver.
  Identical precedence (kill switch → override → default).
- `sam-paths.js` — `SAM_DIR` (`<repo>/.sam`), `SERVER_PID_FILE`
  (`<repo>/.sam/server.pid`), `repoRoot()`. Comment notes: kept in
  sync with `server/runtime-state.ts` by hand.

### `sam.json` schema (`shared/user-tool-manifest.ts`)

TypeBox object. Required fields:

| Field | Type | Description |
|-------|------|-------------|
| `name` | non-empty string | Display name and install directory name. |
| `version` | non-empty string | Free-form, not validated. |
| `source` | non-empty string | Origin URL (typically github.com). |
| `disabled` | boolean | When true, server skips loading any `*.module.ts` in this dir. |

Stubs (TODO comments): `description`, `author`, `license`,
`homepage`, `sha` (commit pin), `installedAt`, `samVersion`. Adding
fields is non-breaking; required-field changes break both the CLI
validator AND the server registry.

## End-to-End Test Scenarios

Each test below is a black-box scenario the tester can run against a
freshly started backend (`npm run dev:server` or `sam restart`).
"Backend up" means `sam diagnose` reports `/api/health reachable`.

### TC7B.1 — calculator tool basic call
- Steps: graph with calculator tool enabled; user prompt "compute (3+4)*5".
- Expect: tool result "35" rendered in transcript; no error block.
- Negative: prompt "run os.system('rm -rf /')" — calculator should
  refuse with `Error: Invalid characters in expression` (no execve).

### TC7B.2 — web_fetch tool basic call
- Positive: `https://example.com` → status 200 + body text-converted
  from HTML, truncated at 10000 chars.
- Negative SSRF cases (each must return `Access to internal or
  restricted hosts is not permitted`):
  - `http://127.0.0.1:3210/api/health`
  - `http://localhost`
  - `http://169.254.169.254/latest/meta-data/`
  - `http://10.0.0.1`, `http://192.168.1.1`, `http://172.16.0.1`
  - `http://foo.local`, `http://bar.internal`
  - non-http protocol: `ftp://example.com` → `Invalid URL protocol`.

### TC7B.3 — Memory tools save/recall round-trip
- Steps: enable memory tool group; prompt "remember my dog's name is
  Rex"; new turn: "what's my dog's name?"
- Expect: second turn calls memory recall and answers "Rex".

### TC7B.4 — Session tools: yield surfaces transcript chunk
- Steps: enable `sessions_history`; prompt "summarize the last 5 turns".
- Expect: tool call with `sessionKey` matching current; result JSON
  includes `entries[]` newest-first, `truncated`, `nextCursor`.

### TC7B.5 — Tool name conflict: built-in vs user-tool
- Setup: install a user tool whose `*.module.ts` declares
  `name: 'calculator'`.
- Restart server.
- Expect: console warn `[tool-registry] user-installed tool
  "calculator" conflicts with a built-in or earlier extra — ignored`.
  Tool surface still has the built-in calculator. `sam list tools`
  still shows the user dir; `getToolCatalog()` does not double-list.

### TC7B.6 — Tool redaction: secret arg masked in transcript log
- Steps: deliberately fail a tool call with an arg that includes
  `Bearer abcdefghijklmnopqr` (≥18 chars).
- Expect: server log line shows masked value `Bearer abcdef…opqr` (the
  raw token never appears). Verify the actual transcript persisted to
  disk — Section 7A — does NOT lean on this redaction; redaction is
  log-path only.

### TC7B.7 — MCP tool registration discovers tools
- Out of scope for current builtins. Verify whether MCP tool source
  exists (Grep `mcp` under `server/tools/`); if not, mark this TC as
  "not-yet-implemented" rather than fail.

### TC7B.8 — User tool with `disabled: true` is not loaded
- Setup: install a tool, then `sam disable tool <name>`, then
  `sam restart`.
- Expect: server stdout includes `[tool-registry] skipping <dir>:
  disabled via sam.json`. `GET /api/tools` does not include the tool.
  `sam list tools` shows the tool dimmed with state `disabled`.

### TC7B.9 — `SAM_DISABLE_USER_TOOLS=1` short-circuits
- Setup: export `SAM_DISABLE_USER_TOOLS=1` then start server.
- Expect: startup log lists user-tool source as
  `disabled via SAM_DISABLE_USER_TOOLS=1`; `getToolSourceCounts().user
  === 0`. `sam install tool <url>` refuses with `cannot install — user
  tools disabled via SAM_DISABLE_USER_TOOLS=1`.

### TC7B.10 — `SAM_USER_TOOLS_DIR` override
- Setup: `SAM_USER_TOOLS_DIR=/tmp/sam-tools`, drop a valid
  `*.module.ts` + `sam.json` there, restart.
- Expect: tool appears in catalog. `sam diagnose` prints the override
  path. `sam list tools` walks the override path. `sam install tool
  <url>` writes into the override path.
- Tilde expansion: `~/sam-tools` and `~` alone resolve via `os.homedir()`.

### TC7B.11 — HITL approval required
- Setup: agent uses `confirm_action` before a destructive `exec` or
  `write_file` call.
- Expect: tool dispatch pauses; UI receives `hitl:input_required`
  with `kind: 'confirm'`. Reply "yes" → tool result is the literal
  string "yes"; agent proceeds. Reply "no" → tool result is "no";
  agent aborts cleanly. Reply "maybe" → registry returns
  `{parseError: 'Please reply exactly "yes" or "no".'}`; entry stays
  pending. Server abort while pending → `[user did not answer:
  aborted]` returned.

### TC7B.12 — Tool-lock from Safety settings
- **Caveat**: tool-lock is NOT yet wired in `server/hitl/`. Treat as
  an open scenario — verify the Safety settings UI write path lands
  somewhere the runtime can read before adding a positive test.

### TC7B.13 — `sam help` / `sam version`
- `sam help`, `sam --help`, `sam -h`, no-args invocation: identical
  help output, exit 0.
- `sam version`, `sam --version`, `sam -v`: prints
  `package.json#version`, exit 0.
- `sam bogus` → stderr `sam: unknown command "bogus"...`, exit 2.

### TC7B.14 — `sam diagnose` with backend up
- Backend on port 3210. Output includes
  `/api/health    reachable` and `/api/tools    <N> tool(s)`.
- `User tools` block prints the resolved dir.

### TC7B.15 — `sam diagnose` with backend down
- Backend not running. Output: `/api/health    unreachable (not
  running)`; `/api/tools    skipped (health failed)`. Exit 0.
- DNS bad: spoof `STORAGE_PORT` env unchanged but block resolver →
  `unreachable (timeout)` after 1500 ms.

### TC7B.16 — `sam install tool <valid-github-url>`
- URL: `https://github.com/<owner>/<repo>`. Repo contains a top-level
  `*.module.ts` (no `sam.json`).
- Expect: download → extract → `synthesized sam.json (please fill in
  the TODO fields)` → rename to `<userDir>/<repo>/`. Manifest has
  `disabled: false, version: '0.0.0', source: <https URL>`.
- After `sam restart`: tool appears in `getToolCatalog()`.

### TC7B.17 — `sam install tool` from invalid repo / missing module
- Empty repo (no `*.module.ts`, no `sam.json`) → throws `Archive root
  has no sam.json and no *.module.ts. Refusing to install`. Staging
  cleaned. Target dir does NOT exist. Exit code 1.
- Bad URL: `https://bitbucket.org/foo/bar` → exit 2 (`Only github.com
  URLs are supported`).
- Empty URL → exit 2 (`Empty URL`).

### TC7B.18 — `sam uninstall tool` with name confirmation
- Type tool name exactly → directory is deleted; "removed <name>".
- Type wrong name → exit 2; directory still present.
- Type empty string → exit 2; trim is applied before compare.
- Tool not installed → exit 2 with "no installed tool named".

### TC7B.19 — `sam list tools` formatting
- Empty user dir → `(no user tools installed in <dir>)`.
- Mix of enabled / disabled / no-manifest / invalid-JSON tools →
  table renders all rows; `disabled` rows dimmed (visible only on a
  TTY without `NO_COLOR`).
- `.sam-staging-*` left over → skipped (dot-prefix filter).

### TC7B.20 — `sam enable/disable` round-trip
- Install tool → `sam disable tool <name>` → `sam restart` → tool
  not in `getToolCatalog()` → `sam enable tool <name>` → `sam
  restart` → tool back. Idempotent re-runs print "is already <state>".

### TC7B.21 — `sam restart` on Windows: console flash
- Per source comment: a brief console window flashes during the
  detached spawn because `windowsHide: true` does not equate to
  `CREATE_NO_WINDOW`. **Document, don't fail** — this is a known
  caveat. Verify `.sam/server.log` is truncated and contains the
  fresh server's startup output.

### TC7B.22 — `sam restart` while `npm run dev` is running
- `npm run dev` runs concurrently+vite. Run `sam restart`.
- Expected (per source comment): vite drops because concurrently
  exits when one child dies. The new server is up but the frontend
  needs a manual `npm run dev` to come back. Acceptance: documented
  caveat surfaces in CLI output? — currently no, the user discovers
  it. Treat as a known UX issue.

### TC7B.23 — Stale `.sam/server.pid`
- Kill server with `kill -9` (don't unlink pid file). `sam restart`
  should print `server.pid=<n> but <health URL> unreachable —
  treating as stale, skipping kill`, then spawn fresh.

### TC7B.24 — `sam restart` boot timeout
- Inject a server boot failure (e.g. invalid env). `sam restart`
  spawns, polls for 20 s, then prints `timeout` + `check
  .sam/server.log`. Exit 1.

### TC7B.25 — Bash/exec alias dedup
- Enable both `bash` and `exec` in the Tools node.
- Expect: exactly one `exec` declaration in the model's tool list
  (factory dedupe at `tool-factory.ts:86–106`); Gemini does not
  reject the run.

### TC7B.26 — Gemini schema cleaning
- Set `modelId` to `google/gemini-...` and enable a tool whose schema
  contains `pattern` or `additionalProperties` (e.g. `web_fetch`).
- Expect: declared schema sent to provider has those keywords
  stripped; `description` preserved. Same model on `claude-...` keeps
  the original schema.
