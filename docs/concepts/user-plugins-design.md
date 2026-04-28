# User-Installed Provider Plugins — Design Spike

> Open-question doc. **No code yet** — this exists to align on the
> shape of user-installed provider plugins before an implementation
> chunk is opened.

<!-- last-verified: 2026-04-28 -->

## Why this doc

The SAM CLI ships an end-to-end install path for user-installed
**tools** (Chunks 1–4 of `notes/CLI-dev.md`). User-installed
**provider plugins** are a separate axis with overlapping primitives but
different runtime concerns (auth, catalogs, network calls). Before
extending `sam install` to handle plugins we need answers — or at
least documented defaults — for the questions below.

The intent is: read this once, decide each item, record the decision
inline, then split into a normal implementation chunk.

## What we have today

Provider plugins are registered statically:

- Implementations live under [server/providers/plugins/](../../server/providers/plugins/) (just `openrouter` so far) and are referenced from `PLUGIN_MAP` in [server/providers/plugins/index.ts](../../server/providers/plugins/index.ts).
- `loadProviderPlugins()` in [server/providers/provider-loader.ts](../../server/providers/provider-loader.ts) consults a top-level `providers.json` to gate which plugins register at boot. Missing config registers everything.
- Registered plugins land in `ProviderPluginRegistry` and contribute to:
  - `GET /api/providers` (summaries),
  - the catalog cache via `ProviderCatalogCache.refresh()`,
  - the runtime auth resolver in [server/providers/provider-auth.ts](../../server/providers/provider-auth.ts).
- The plugin SDK contract is `ProviderPluginDefinition` in [shared/plugin-sdk/](../../shared/plugin-sdk/).

What we **don't** have:

- A filesystem-scan path for plugins (tools have one; plugins do not).
- A manifest analogous to `sam.json` for plugins.
- A user-plugins directory (`server/providers/plugins/` is product code, not user content).
- A trust/sandboxing story specific to plugins (network capabilities, not just disk).

## Open questions

### Q1 — Where do user-installed plugins live on disk?

Candidates:

- **Mirror user-tools.** New dir `server/providers/user/<name>/`, gitignored. Default + `SAM_USER_PLUGINS_DIR` override + `SAM_DISABLE_USER_PLUGINS=1` kill switch. Discovery via filesystem scan.
- **Unified `server/plugins/<name>/`** for both tools and plugins. Manifest `kind` field selects discriminator. Cleaner if we expect plugins to be installed alongside tools, but conflates two registries.
- **Project-root `.sam/plugins/`** like a user-config dir. Keeps user content fully outside `server/`. Different model than tools and probably worth resisting just for symmetry's sake.

Default leaning: mirror user-tools (`server/providers/user/<name>/`). It's the smallest delta from existing primitives.

### Q2 — How does the server discover user plugins at boot?

Tools today scan for `*.module.ts` and dynamic-import each one. For plugins:

- Same scan? `*.plugin.ts` (parallel naming) or just `*.module.ts` with a discriminator in the default export?
- Or manifest-driven? `sam.json` declares an entry path (`"entry": "./openai.plugin.ts"`) which is what gets imported. Decouples filesystem layout from how the SDK contract is satisfied.

Default leaning: manifest-driven entry. Plugins are heavier-weight than tools; coupling the file layout to discovery is the tools simplification, not a value to preserve.

### Q3 — Do plugins share `sam.json` or get their own manifest?

Same file with a `kind` field (`"kind": "tool" | "provider"`) is appealing — one schema, one validator, one CLI install path. It also means the manifest can grow other plugin kinds later without churn (think: webhook handlers, hooks).

But provider plugins need fields tools don't (`pluginId`, `defaultBaseUrl`, declared auth methods, capability flags `supportsCatalog`/`supportsWebSearch`). Either the schema gets a `provider:` sub-object or those become top-level optional fields gated by `kind`.

Default leaning: extend `sam.json` with `kind` (default `"tool"`) and a `provider` sub-object that the loader reads only when `kind === "provider"`. See [shared/user-tool-manifest.ts](../../shared/user-tool-manifest.ts) for the existing schema. The TODO list in that file already anticipates this.

### Q4 — How do user plugins contribute to the catalog?

`ProviderCatalogCache` keys by `pluginId`. Implications:

- A user plugin must declare a `pluginId` distinct from built-ins. We need to log-and-skip on collision (parallel to how tools handle name conflicts) rather than registering and shadowing.
- The catalog refresh path runs `plugin.catalog(...)` — user code making network calls with the operator's API key. Trust + auth flow is the same as tools touching the filesystem (full trust), but the surface is wider. This belongs in the user-plugins-guide that ships with the implementation.

### Q5 — Auth and secrets

Built-in plugins declare auth methods that the settings UI exposes (`/api/settings`). For user plugins:

- Do their declared auth methods automatically appear in the settings UI? Probably yes — otherwise the user can't supply an API key.
- Should user plugins be able to read `process.env` directly, or only get keys via the resolver in [server/providers/provider-auth.ts](../../server/providers/provider-auth.ts)? Encouraging the resolver gives us one revocation path; allowing `process.env` is what built-ins do today.
- Do we ever block a plugin from being granted a key, or is enabling-the-plugin a sufficient consent moment?

### Q6 — What does `sam install plugin <url>` do?

If Q3 lands on a unified manifest with `kind`:

- A single `sam install <url>` could detect kind from the fetched manifest and install into the correct directory automatically.
- Or stay explicit: `sam install plugin <url>` and `sam install tool <url>` route to different install targets and both refuse a manifest of the wrong kind.

Explicit verbs are easier to document and harder to misuse. Default leaning: keep them split.

### Q7 — Versioning, updates, and reproducibility

Tools today install from `HEAD` by default and let the operator pin via `/tree/<ref>`. For provider plugins — which can break the model catalog when their schema drifts — pinning matters more.

- Should `sam install plugin <url>` require a `tree/<ref>` (no implicit HEAD)?
- When `sam install plugin <url>` runs against an already-installed plugin name (same `pluginId`), does it update in place, refuse, or write a versioned subdirectory?
- Where do we record the pinned commit SHA for reproducibility? The `// TODO: sha` slot in [shared/user-tool-manifest.ts](../../shared/user-tool-manifest.ts) anticipates this for tools too.

### Q8 — Disable / kill switch parity with tools

Server-side:

- `disabled: true` in `sam.json` already exists for tools. Plugins should honor the same flag.
- A separate `SAM_DISABLE_USER_PLUGINS=1` kill switch parallel to `SAM_DISABLE_USER_TOOLS=1` — yes, almost certainly. It's the only safe way to ship a production container that loads no operator-installed code.

CLI side:

- `sam disable tool <name>` flips the flag. Symmetric `sam disable plugin <name>` is the obvious next verb. (See [bin/commands/toggle.js](../../bin/commands/toggle.js) — the existing helper is verb-agnostic and could be extended.)

### Q9 — UI integration

Currently the provider picker reads the static plugin list. After user plugins:

- The picker would need a `userInstalled: boolean` flag (or equivalent) so the UI can mark / group / warn appropriately.
- Should disabled plugins still appear in the picker greyed out, or be filtered out entirely? The list-tools CLI dims; the UI probably wants the same affordance.

### Q10 — Sandboxing

User tools today are full-trust: same Node process, full filesystem access. The user-tools guide states this clearly. User plugins inherit the same risk *plus* network-egress capability with the operator's API keys.

We are not going to ship a sandbox. The mitigation has to be (a) explicit "you're loading code; here's whose code" trust UX in the install path, and (b) the kill switch. Document what the trust model is **not** so nobody gets surprised.

## Suggested next step

Once each Q has a "decided / leaning / deferred" annotation, open a normal implementation chunk modeled on `notes/CLI-dev.md` with the same chunk-by-chunk shape:

1. Manifest schema extension (`kind` + provider sub-object) + validator parity.
2. User-plugins directory + filesystem scan + kill switch + override env.
3. `sam install plugin <url>` + `sam list plugins` + `sam uninstall plugin <name>`.
4. Server-side `disabled` honoring + `sam enable/disable plugin <name>`.
5. UI surfacing (`userInstalled` flag, disabled-row treatment).

That ordering mirrors the tools chunking and reuses the install/manifest plumbing already in [bin/](../../bin/).

## See also

- [notes/CLI-dev.md](../../notes/CLI-dev.md) — chunking plan that produced this doc.
- [docs/concepts/user-tools-guide.md](user-tools-guide.md) — the analogous flow for tools, which most decisions here should mirror until there's a reason not to.
- [shared/user-tool-manifest.ts](../../shared/user-tool-manifest.ts) — current `sam.json` schema with TODO slots.
