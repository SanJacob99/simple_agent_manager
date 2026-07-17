# Knowledge Node

> Owns the *sources* — files, directories, URLs, git repos, or inline text — that get chunked, embedded, and written into the Vector DB the Context Engine's RAG path reads from. `vectorDatabase` provides the store; this node provides the ingestion pipeline that fills it.

<!-- source: src/types/nodes.ts#KnowledgeNodeData -->
<!-- last-verified: 2026-07-17 -->

## Overview

The Vector DB node is only a store; nothing populates it. The Knowledge node closes that gap with a first-class ingestion surface: a list of `sources`, a `chunkStrategy` and size/overlap, an `embedding` model, and a `refreshSchedule`. Raw sources become chunked vectors in the collection named by `collectionName`, which a connected Context Engine can then retrieve during a run. This mirrors the ingestion layer in LlamaIndex, LangChain document loaders, and managed RAG stacks.

Multiple Knowledge nodes can bind to one agent — each targeting its own collection or source set — so the node resolves to a **list** on `AgentConfig.knowledge` (like Vector DBs), not a single optional value. It pairs with the [Vector DB node](vector-database-node.md) (the store) and the Context Engine (the consumer).

> **Status:** the node, resolved config, and engine are scaffolded and unit-tested. Wiring an ingestion runner (fetch each source's raw text, chunk it with the engine, embed the chunks, upsert them into the Vector DB, and honor the refresh schedule) is the remaining integration step. Treat this as an extension surface until that path is verified end-to-end. See `docs/roadmap/2026-modernization.md`.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Knowledge"` | Human-readable label shown on the node. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the node is wired but no ingestion runs (`buildIngestionPlan` yields no sources). |
| `collectionName` | `string` | `"default"` | Target Vector DB collection this knowledge is ingested into. Match a connected Vector DB node's collection name. |
| `sources` | `KnowledgeSource[]` | `[]` | Ordered ingestion sources (see below). |
| `chunkStrategy` | `'fixed' \| 'sentence' \| 'paragraph' \| 'markdown'` | `'paragraph'` | How fetched documents are split before embedding. |
| `chunkSize` | `number` | `512` | Target chunk size in tokens (approximate; uses the shared token estimator). |
| `chunkOverlap` | `number` | `64` | Tokens of trailing context carried between adjacent chunks. Clamped below `chunkSize`. |
| `embedding` | `VectorEmbeddingConfig` | `openrouter / text-embedding-3-small` | Embedding model used at ingestion time (reuses the Vector DB embedding shape). |
| `refreshSchedule` | `string` | `"manual"` | Refresh cadence: `manual`, or a duration like `30m`, `6h`, `7d`. |
| `maxDocuments` | `number` | `0` | Cap on documents ingested per refresh. `0` means unlimited. |

Each entry in `sources` is a `KnowledgeSource`:

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Stable id within the node, used to correlate refreshes. |
| `type` | `'file' \| 'directory' \| 'url' \| 'git' \| 'text'` | Where the source comes from. |
| `location` | `string` | Path, URL, git remote, or inline text depending on `type`. |
| `include` | `string?` | Glob include filter for `directory`/`git` sources. |
| `exclude` | `string?` | Glob exclude filter for `directory`/`git` sources. |

Properties are derived from `src/types/nodes.ts#KnowledgeNodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves every connected Knowledge node into a `ResolvedKnowledgeConfig` on `AgentConfig.knowledge` (`shared/agent-config.ts`). Each source's optional globs are normalized to empty strings so the resolved shape is uniform. Agents without one have `knowledge === undefined` and rely solely on any pre-populated Vector DB.

`server/knowledge/knowledge-engine.ts` provides the ingestion substrate (dependency-free; it reuses `estimateTokens` from the shared token estimator):

- **`buildIngestionPlan(config)`** — collapses a resolved config into a clean work list: normalizes each source, drops empty ones (recording their ids in `droppedSourceIds`), and dedupes. A disabled node yields a plan with `enabled: false` and no sources.
- **`normalizeSource(source)`** — trims the location and globs; returns `null` for an empty location.
- **`dedupeSources(sources)`** — dedupes by `type` + `location` (first wins); inline `text` sources are keyed by `id` so identical pasted text stays distinct.
- **`splitIntoUnits(text, strategy)`** — breaks a document into the atomic units a strategy packs from (whole-doc, sentence, paragraph, or Markdown-heading).
- **`chunkText(text, config)`** — packs units greedily into `chunkSize`-token windows with `chunkOverlap` carried forward; hard-splits any single oversized unit on word boundaries. Clamps a degenerate size/overlap so it can never loop forever.
- **`parseRefreshInterval(schedule)`** / **`isRefreshDue(schedule, lastRunAt, now)`** — the refresh-due decision: `manual` is never due; a never-run source with an interval is always due; otherwise due once the interval has elapsed.

## Connections

Peripheral → Agent. Multiple Knowledge nodes can bind to a single Agent; each resolves into an entry on `AgentConfig.knowledge`.

## Example

```json
{
  "type": "knowledge",
  "label": "Product docs",
  "enabled": true,
  "collectionName": "product-docs",
  "sources": [
    { "id": "hb01", "type": "directory", "location": "./docs", "include": "**/*.md", "exclude": "**/drafts/**" },
    { "id": "site1", "type": "url", "location": "https://example.com/changelog" }
  ],
  "chunkStrategy": "markdown",
  "chunkSize": 512,
  "chunkOverlap": 64,
  "embedding": { "provider": "openrouter", "model": "openai/text-embedding-3-small" },
  "refreshSchedule": "6h",
  "maxDocuments": 0
}
```
