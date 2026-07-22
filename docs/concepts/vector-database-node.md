# Vector Database Node

> Attaches a vector store to an agent and auto-enables the four industry-standard vector tools (`vector_search`, `vector_upsert`, `vector_delete`, `vector_get`). Default backend is `sqlite-vec`; default embedder is OpenRouter.

<!-- source: src/types/nodes.ts#VectorDatabaseNodeData -->
<!-- last-verified: 2026-07-22 -->

## Overview

The Vector Database Node attaches a vector collection to an agent for storing embeddings and serving semantic search. Multiple nodes can be connected to the same agent — each adds an independent collection, addressable by its `label`.

Wiring a `vectorDatabase` node to an agent **automatically enables** four tools on the agent. There is no user-facing on/off switch in the Tools node — the wiring is the enable signal, exactly like memory tools auto-attach when a Memory node is wired. The four tools are:

- `vector_search` — top-K similarity search by query text (read-only)
- `vector_upsert` — insert/update documents (state-mutating)
- `vector_delete` — remove documents by id (destructive)
- `vector_get` — fetch a single document by id (read-only)

The agent's embedding model lives **on the same node**. Insert-time and query-time embeddings always go through the same client, so cosine distance is comparable.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Vector DB"` | Display label, also used as the `collection` parameter when more than one node is attached |
| `provider` | `'sqlite-vec' \| 'pinecone' \| 'chromadb' \| 'qdrant' \| 'weaviate'` | `"sqlite-vec"` | Vector storage backend. Only `sqlite-vec` is wired at runtime today — the others are type-level scaffolds and will throw `UnsupportedProviderError` when used |
| `collectionName` | `string` | `"default"` | Logical collection name. With `sqlite-vec` it also drives the on-disk filename and SQL table names |
| `connectionString` | `string` | `""` | For remote providers, the endpoint URL. With `sqlite-vec`, optional absolute file path that overrides `storagePath` |
| `storagePath` | `string` | `".sam/vector"` | sqlite-vec only: directory holding the `.db` file. Relative paths resolve under `process.cwd()` |
| `embedding.provider` | `'openrouter' \| 'ollama'` | `"openrouter"` | Where embeddings come from |
| `embedding.model` | `string` | `"openai/text-embedding-3-small"` | Model id passed to the embedding endpoint. OpenRouter routes to OpenAI / Google / Qwen / BAAI / Perplexity / NVIDIA models; Ollama runs local models like `nomic-embed-text` or `mxbai-embed-large` |
| `embedding.baseUrl` | `string?` | provider default | Override the embedding endpoint URL. Useful for self-hosted OpenRouter-compatible servers or non-default Ollama hosts |
| `embedding.dimensions` | `number?` | inferred | Optional vector dimension. When omitted, the first insert locks the collection to whatever the model returns |

## Runtime Behaviour

Resolved by `src/utils/graph-to-agent.ts` into `AgentConfig.vectorDatabases: ResolvedVectorDatabaseConfig[]`. The `AgentRuntime` constructor (`server/runtime/agent-runtime.ts`) calls `createVectorTools(config, runtime)` (`server/runtime/vector-tools/index.ts`), which builds a `VectorToolContext` whose lazy `getEngine(label?)` calls `getOrCreateVectorEngine(config, label, runtime)` (`server/runtime/vector-engine-registry.ts`) — the four vector tool modules use that context to resolve a shared `VectorDatabaseEngine` instance per collection.

Engine lifecycle (`server/runtime/vector-database-engine.ts`):

1. On first use, `init()` opens a SQLite file under `<storagePath>/<sanitized-collectionName>.db`, loads the `sqlite-vec` extension, and creates a metadata table plus a documents table.
2. The first `upsert` call embeds the document(s), reads the vector dimension, and creates the `vec_<collection>` virtual table sized for that dimension. The dimension is persisted in the metadata table.
3. Subsequent inserts and queries assert dimension parity — switching embedding models on a populated collection raises `DimensionMismatchError`.
4. Searches issue `SELECT … WHERE embedding MATCH ? ORDER BY distance LIMIT ?` against the virtual table and join the result back to the documents table for text + metadata.
5. `destroyAsync()` on the runtime closes all open sqlite handles.

Selecting a non-`sqlite-vec` provider raises `UnsupportedProviderError` the first time the engine initialises. Missing OpenRouter keys or unreachable Ollama servers raise wrapped errors that the tool's `execute` returns as plain text (the agent sees a clean message and can recover).

## Tools

The four tools are built by `createVectorTools(config, runtime)` in `server/runtime/vector-tools/index.ts` and appended to the agent's tool list in `AgentRuntime`'s constructor (the same path memory tools take from `MemoryEngine.createMemoryTools()`). The Tools node never sees them and the user has no checkbox to disable them — wiring the `vectorDatabase` node is the enable signal.

When two or more `vectorDatabase` nodes are connected, every tool requires a `collection` parameter equal to one of the node labels. With a single attached node, `collection` is optional and defaults to that node.

## Connections

- **Sends to**: Agent Node
- **Receives from**: None
- Multiple Vector Database Nodes can connect to the same agent; each is addressable by its `label`.

## Example

```json
{
  "type": "vectorDatabase",
  "label": "Knowledge Base",
  "provider": "sqlite-vec",
  "collectionName": "docs",
  "connectionString": "",
  "storagePath": ".sam/vector",
  "embedding": {
    "provider": "openrouter",
    "model": "openai/text-embedding-3-small"
  }
}
```

Local Ollama variant:

```json
{
  "type": "vectorDatabase",
  "label": "Local Notes",
  "provider": "sqlite-vec",
  "collectionName": "notes",
  "connectionString": "",
  "storagePath": ".sam/vector",
  "embedding": {
    "provider": "ollama",
    "model": "nomic-embed-text",
    "baseUrl": "http://localhost:11434"
  }
}
```
