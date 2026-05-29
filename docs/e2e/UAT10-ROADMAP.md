# UAT.10 Win-Condition Roadmap — What's Missing

<!-- last-verified: 2026-05-10 -->

## Purpose

This document enumerates **everything that must change in the codebase (and what content must be authored)** for the UAT.10 binary win condition in [`E2E_TEST_PLAN.md`](./E2E_TEST_PLAN.md) — replicating the multi-agent content pipeline from the reference image — to actually pass.

The fix-and-rerun pass on 2026-05-10 closed the six F-NN findings (F-08, F-10, F-11, F-12, F-13, F-14) and risk **R-25** (Cron not in default palette). UAT.10 still fails because **three architectural risks (R-16, R-18, R-26) remain open**, plus pipeline-specific tools and a couple of UI hooks have not been authored. This roadmap is the single document the next implementation pass should work from.

Reference docs:
- Master plan: [`E2E_TEST_PLAN.md`](./E2E_TEST_PLAN.md) (UAT.10 description, reference-image architecture, criteria)
- Master findings: [`E2E_TEST_FINDINGS.md`](./E2E_TEST_FINDINGS.md) (status as of 2026-05-10 fix-pass)
- Per-section evidence: [`sections/06b-findings.md`](./sections/06b-findings.md), [`sections/07a-findings.md`](./sections/07a-findings.md), [`sections/07b-findings.md`](./sections/07b-findings.md)

---

## At-a-glance priority order

| # | Item | Risk | Severity | Rough scope | Blocks UAT.10 criterion |
|---|---|---|---|---|---|
| 1 | Vector Database runtime backend | R-26 | major | 1–2 weeks | #3 (end-to-end run), #4 (idempotency) |
| 2 | Persistent Memory backend (and absent reset features) | R-18 | major | 3–5 days | #3 (cross-restart state) |
| 3 | Safety tool-lock wiring in `server/hitl/` | R-16 | major | ½–1 day | tool-gating cleanliness |
| 4 | Reference-image custom tools (4) | — | major | ~1 week if from scratch | #3, #4, #5 |
| 5 | `on_agent_finish` hook config UI | — | minor | 1–2 days | UAT.8 + UAT.10 hook step |
| 6 | Retry-cap primitive for content_checker | — | minor | ½ day | #5 (boundedness) |
| 7 | Build + run the reference graph end-to-end | — | — | ½–1 day + LLM cost | UAT.10 dress rehearsal |

Total bare-minimum scope: **~3–4 weeks of focused engineering**, plus one paid LLM run for the live capstone.

---

## 1. R-26 — Vector Database runtime backend (HIGHEST priority)

**Why this is first:** UAT.10 criterion 4 (pipeline is idempotent — vector similarity stops the duplicate insert) is the single criterion that has *no software workaround*. Every other gating item has a manual or partial workaround; R-26 does not.

### Current state

- `vectorDatabase` node type exists in [`src/types/nodes.ts`](../../src/types/nodes.ts).
- `VectorDatabase` editor exists in [`src/panels/property-editors/`](../../src/panels/property-editors/) (per §2 R-26).
- `ResolvedVectorDatabaseConfig` is part of the resolved AgentConfig.
- **No runtime backend exists.** `server/runtime/` has no `vector-engine.ts`. The config flows into `AgentConfig.vectorDatabases` and stops there.
- The same condition applies to MCP (`mcps` array) and parts of Connectors (`connectors` config) per R-26.

### Decision needed: backend choice

These are the credible options. Pick one before writing code.

| Option | Pros | Cons |
|---|---|---|
| **Embedded SQLite + `sqlite-vss` extension** | Single-file, zero-deploy, fast for small corpora (≤100k vectors) | Native build complexity; `sqlite-vss` is not pure-JS |
| **DuckDB with vector extension** | Fast analytical queries; embedded; fewer native build pains than `sqlite-vss` | Newer; less ecosystem tooling than SQLite |
| **`hnswlib-node` over filesystem JSONL** | Pure-JS load, simple persistence model; in-RAM index | RAM-bound; manual rebuild on restart; metadata stored separately |
| **Local Chroma server** (`pip install chromadb`) | Mature, supports HNSW + filter; HTTP API the existing `WebFetch`-style code can consume | External process to run; not standalone |
| **Qdrant / Weaviate / pgvector** | Battle-tested for production scale | Heavyweight; a Postgres or container dependency |
| **In-memory only with manual JSONL persistence** | Simplest; zero deps | No real similarity search at scale; defeats the point of UAT.10 criterion 4 |

**Recommendation:** start with `hnswlib-node` plus a per-collection JSONL on disk for metadata + raw vectors. It's pure-JS, compatible with the existing storage-engine pattern, and lets the UAT.10 vector idempotency check actually fire. Migrate to Chroma later if scale demands it.

### Implementation tasks

- [ ] Create `server/runtime/vector-engine.ts` with `VectorEngine` class:
  - `init(config: ResolvedVectorDatabaseConfig)` — open or create the on-disk store under `<storagePath>/<agentName>/vectors/<collection>/`.
  - `upsert(collection, id, vector, metadata, payload)` — write to disk + index.
  - `query(collection, vector, { topK, filter? })` — return `[{id, score, metadata, payload}]`.
  - `count(collection, filter?)`, `delete(collection, id)`, `list(collection, filter?)`.
- [ ] Embedding generation: a `getEmbedding(text)` helper. Two paths:
  - OpenRouter `/v1/embeddings` if the user's chosen provider exposes it.
  - Built-in fallback to `text-embedding-3-small` via OpenAI-compatible endpoint when an OpenAI key is present.
- [ ] Tool-side surface: a built-in `vector_upsert` / `vector_query` / `vector_count` family under [`server/tools/builtins/vector/`](../../server/tools/builtins/) — registered by `tool-registry.ts` like every other built-in.
  - Each takes a `{collection, ...}` argument and resolves the agent's `vectorDatabases[0]` (or by name) at execute time.
- [ ] REST surface for diagnostic UI:
  - `POST /api/agents/:agentId/vector/:collection/query` — debug view.
  - `GET /api/agents/:agentId/vector/:collection/stats` — count + last-write-at.
- [ ] Wire `VectorDatabase` editor's fields (currently mostly dead) to a live "test connection" button that calls the stats endpoint.
- [ ] Tests:
  - `vector-engine.test.ts` — upsert + query + delete + persistence-across-restart.
  - `vector-tool.test.ts` — tool surface end-to-end with a fake embedding function.

### Out-of-scope for v1

- Multi-collection sharding.
- Cross-agent vector store sharing (each agent gets its own under `<storagePath>/<agentName>/vectors/`).
- Authentication on the vector REST surface — it inherits the same single-user-trusted posture as the rest of the backend (R-20).

### Acceptance test for closing R-26

A new `TC6B.x` (vector-engine) section: spin up a `VectorEngine`, upsert 5 documents, query for a near-duplicate of one, observe top-1 score above a configurable threshold, demonstrate the agent-side tool can short-circuit insert when the threshold is hit.

---

## 2. R-18 — Persistent Memory backend (and missing reset features)

### Current state (per §6B)

[`server/runtime/memory-engine.ts`](../../server/runtime/memory-engine.ts) is two `Map`s:
- `longTermStore: Map<string, MemoryEntry>` — RAM only.
- `sessionMessages: Map<sessionId, ...>` — RAM only.

The exposed tools are `memory_search` / `memory_get` / `memory_save`. The class doc-comment mentions optional IndexedDB persistence and external/cloud REST backends; **none are wired**.

Spec features that are **not implemented**:
- `dailyResetEnabled` / `dailyResetHour` (referenced by `ResolvedMemoryConfig`, ignored by the engine).
- `idleResetEnabled` / `idleResetMinutes` (same).
- `parentForkMaxTokens` (lives in storage config but the memory engine does not consult it).

### Implementation tasks

- [ ] **Persistence layer.** Mirror the session-store pattern: filesystem-backed JSONL under `<storagePath>/<agentName>/memory/`.
  - `memory/long-term.jsonl` — one entry per line: `{key, content, metadata, timestamp}`.
  - `memory/session/<sessionId>.jsonl` — per-session messages.
  - On `MemoryEngine` construction, read the long-term JSONL into the in-memory Map (cache-on-read).
  - `saveLongTerm` appends to JSONL + updates the cache.
  - Include a compaction pass (`server/runtime/memory-engine.ts#compact()` already exists but is never wired) that rewrites the JSONL with deduped keys when it grows past N MB.
- [ ] **Daily reset.** Add `MemoryEngine.maybeRunDailyReset(now: Date)`:
  - If `dailyResetEnabled` and the last reset's date is before today's `dailyResetHour` boundary in the user's TZ, archive the long-term JSONL to `memory/long-term.<YYYY-MM-DD>.jsonl.archived` and start fresh.
  - Hook into `RunCoordinator.beforeDispatch` so the reset fires lazily on first turn of the day.
- [ ] **Idle reset.** Same shape but on `idleResetMinutes` instead of date boundary.
- [ ] **Parent-fork-max-tokens.** When a sub-agent is spawned, optionally fork the parent's session messages forward up to the cap; document this is *session* memory not long-term.
- [ ] **Tests** in `memory-engine.test.ts`:
  - Persistence across construction.
  - Daily reset archives correctly.
  - Idle reset fires after the threshold.
  - parent-fork forwards exactly N tokens of context.

### Acceptance test for closing R-18

`sam restart`, then call `memory_search` and recover entries from before the restart.

---

## 3. R-16 — Safety tool-lock wiring

### Current state (per §7B TC7B.12)

[`src/settings/`](../../src/settings/) has the Safety section with a `confirmationPolicy` and `allowDisableHitl`. Per the spec, the Safety panel was supposed to expose a "tool-lock" toggle that gates which tools can run without confirmation. **There is no symbol named `toolLock` (or similar) anywhere under `server/hitl/`** — confirmed by grep. The Safety toggle has no enforcement path today.

### Implementation tasks

- [ ] Add `toolLocks: Record<string, ToolLockMode>` to `SafetySettings` where `ToolLockMode = 'always-allow' | 'always-confirm' | 'always-deny'`.
- [ ] Surface in the Settings → Safety panel: per-tool dropdown with the three modes; default `always-confirm` for destructive tools, `always-allow` for read-only.
- [ ] In `RunCoordinator.dispatch` (or earlier, in the runtime's `BEFORE_TOOL_CALL` waterfall), consult `toolLocks[toolName]`:
  - `always-allow` → bypass confirm gate even if the model called `confirm_action` first.
  - `always-confirm` → force a HITL prompt regardless.
  - `always-deny` → reject before dispatch with a synthetic tool-result `[locked: tool denied by Safety policy]`.
- [ ] Persist as part of `PUT /api/settings`.
- [ ] Tests:
  - `hitl-registry.test.ts` — a locked tool emits the right `hitl:input_required` shape.
  - `run-coordinator.test.ts` — `always-deny` short-circuits with the synthetic result.

### Acceptance test for closing R-16

Set `web_fetch` to `always-deny` in Safety, ask an agent to fetch a URL, observe the deny payload reaches the model without any network call.

---

## 4. Reference-image custom tools (4 tools)

UAT.10's pipeline names four tool families that don't ship with SAM today. Each needs to be authored — either as a built-in (`server/tools/builtins/`) or as an installable user-tool repo on GitHub (per `sam install tool` in §7B).

| Tool | Description | Depends on |
|---|---|---|
| `search_news` | Brave / Google / FireCrawl variant: query + result list with `{title, url, snippet, publishedAt}` | nothing — pure web call |
| `save_headlines` | Vector-similarity guard: embed the headline, query for top-1 above threshold, **skip insert** on hit | R-26 |
| `social_media_posting` | One-of-three platform sub-tools (LinkedIn, Reddit, Facebook). Each posts via the platform's API and returns the post id | platform OAuth / API keys (out of scope of SAM proper — user-supplied) |
| `post_checker` | Verifies the post landed (HTTP fetch + check expected text) | nothing |

### Implementation strategy

**Recommended:** ship `search_news` and `post_checker` as built-ins (web-fetch wrappers that any user can rely on); leave `save_headlines` until R-26 is closed; make `social_media_posting` a user-installable tool because it requires platform credentials each user has to provide.

### Tasks

- [ ] `server/tools/builtins/search/news-search.module.ts` — Brave Search API by default (the user provides a key); falls back to a general web search if no key.
- [ ] `server/tools/builtins/web/post-checker.module.ts` — fetch URL + assert substring present.
- [ ] `server/tools/builtins/vector/save-headlines.module.ts` — once R-26 lands.
- [ ] Author `samweb-tools-social/` (a separate repo) with three modules + a `sam.json`. Document in [`docs/concepts/user-tools-guide.md`](../concepts/user-tools-guide.md).
- [ ] Tests for the three built-ins. The user-tool repo gets its own test setup outside this codebase.

---

## 5. `on_agent_finish` hook config UI

### Current state (per §6B)

The `AGENT_END` hook is fully wired in [`server/hooks/hook-types.ts`](../../server/hooks/hook-types.ts) and the registry / waterfall fires it. **There is no UI to configure which plugin / tool runs on `agent_end`** — the only way to attach a hook today is by writing a plugin under `plugins/` and editing `AgentConfig.plugins` by hand.

### Implementation tasks

- [ ] Property editor section: Agent → "Hooks" tab. Per-hook list of `{handler: string, priority: number, critical: boolean}` entries.
- [ ] A picker UI for `handler` that lists available plugins (loaded from `pluginRegistry`) plus a "custom path" mode.
- [ ] Round-trip through `AgentConfig.plugins[*].hooks` — no schema change needed.
- [ ] Surface the configured hooks in the resolved-system-prompt preview as a "registered hooks" footer (optional but useful).

---

## 6. Retry-cap primitive for `content_checker_skill`

UAT.10 criterion 5 — pipeline is bounded — requires the `content_checker_skill` to cap retries at 3. The product itself has no retry-cap primitive: this is a tool-level concern.

### Implementation tasks

- [ ] Add a `runCount` field to the sub-agent record (`server/agents/sub-agent-registry.ts`) that increments on each spawn from the same parent + same target.
- [ ] Expose to the `subagents` session tool so a checker can read `runCount > 3` and decide to bail.
- [ ] Or: do this entirely tool-side in `content_checker_skill` by querying `sessions_history` for prior turn count.

The simplest closure is the second option (no schema changes, all tool-side logic). Document the pattern; don't build a primitive that's only used by one specific custom tool.

---

## 7. Build the reference graph + run end-to-end

Once items 1–6 above are in, this is the dress rehearsal:

- [ ] Drag the canonical 10+-runtime layout (Manager + 3 orchestrators + 3 research sub-agents + 3 content sub-agents + 3 content checkers + 3 social-media tool pairs + Storage + ContextEngine + Memory + VectorDatabase + Cron).
- [ ] Configure prompts and tool wiring per the verbatim text in [E2E_TEST_PLAN.md UAT.10](./E2E_TEST_PLAN.md#uat10--win-condition-multi-agent-content-pipeline).
- [ ] Trigger the MANAGER (manual chat or via the cron node now that R-25 is closed).
- [ ] Verify all five binary criteria:
  1. Graph mirrors reference (visual check).
  2. Every node configured via UI/SAM Agent NL/sam install (no JSON edits).
  3. ≥1 Stage 3 social media post derived from a Stage 1 headline.
  4. Duplicate-headline replay does not produce a second insert.
  5. Checker retries cap at 3.

Estimated LLM cost for the dress rehearsal: 10–30 USD on OpenRouter, depending on model choice and how many iterations debugging takes.

---

## What we are NOT changing as part of UAT.10

These risks/findings remain open but **do not gate UAT.10**:

- **R-04** EventBridge replay buffer — useful but UAT.10 doesn't require WS reconnect mid-run.
- **R-07** Atomic file writes — durability concern, not a functional gate.
- **R-13** Drag validator vs hydration divergence — F-08 closed the hydration half; the drag-side refinement is cosmetic at this point.
- **R-19** `server/connections/` naming collision — doc-only.
- **R-20** No request auth — single-user-trusted posture is unchanged.
- **R-23** Cosmetic comment mismatch — doc-only.
- **R-24** a11y issues — orthogonal to UAT.10.
- **R-28** `autoClose.ts` naming — doc-only.
- **R-31** `dev:server` not `--watch` — deliberate.
- **R-32** SAM Agent uses its own HitlRegistry — by design.

These should be addressed in a separate hardening pass.

---

## Definition of done for "win condition reached"

UAT.10 is binary. It is **DONE** when, in a single live run starting from a clean canvas:

1. The user can drag and configure the full reference graph **using only the SAM UI + SAM Agent NL + `sam install tool`** (no JSON edits, no `~/.simple-agent-manager/storage/*.json` shell-edits).
2. Triggering the pipeline produces ≥1 row in the headlines vector store, ≥1 row in the regular DB, ≥1 row per social platform in the posts table.
3. Replaying with a duplicate headline produces **no** second insert.
4. The content checker caps retries at 3 (no infinite loop).
5. All steps complete within a single `npm run dev` cycle.

When this passes, append a one-line entry to [`E2E_TEST_FINDINGS.md`](./E2E_TEST_FINDINGS.md): `UAT.10 — PASS YYYY-MM-DD`.

---

## How to track progress on this roadmap

- Each numbered section above (1–7) is a unit of work that can be assigned independently.
- Items 1, 2, 3 are blocking; items 4, 5, 6 are blocking too but can run in parallel with each other.
- Item 7 is the final gate.
- Update `last-verified:` at the top of this document each time a section closes.
- When all sections are closed, this document can be deleted (or moved to `docs/superpowers/specs/` as a historical record).

This roadmap is the single source of truth for "what's missing." Anything not on this list either is already done, or is not a UAT.10 gate.
