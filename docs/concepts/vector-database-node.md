# Vector Database Node

> Configures a vector storage backend for an agent — used for embedding-based retrieval, semantic search, and RAG pipelines.

<!-- source: src/types/nodes.ts#VectorDatabaseNodeData -->
<!-- last-verified: 2026-04-03 -->

## Overview

The Vector Database Node attaches a vector storage provider to an agent for storing and retrieving embeddings. This is the foundation for semantic search and RAG (Retrieval-Augmented Generation) workflows — when paired with a Context Engine Node that has RAG enabled, the vector database can supply relevant context chunks to the agent before each LLM call.

Four vector database providers are supported, ranging from cloud-hosted services to self-hosted solutions. Multiple Vector Database Nodes can be connected to a single agent for querying different collections or providers.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Vector DB"` | Display label on the canvas |
| `provider` | `string` | `"chromadb"` | Vector DB provider: `pinecone`, `chromadb`, `qdrant`, `weaviate` |
| `collectionName` | `string` | `"default"` | Name of the vector collection to use |
| `connectionString` | `string` | `""` | Connection string or URL for the vector database |

## Runtime Behavior

Not yet implemented at runtime. During config resolution (`src/utils/graph-to-agent.ts`), Vector Database Nodes are collected into the `vectorDatabases` array of the `AgentConfig` as `ResolvedVectorDatabaseConfig` objects containing the label, provider, collectionName, and connectionString. The runtime does not yet act on this configuration.

When runtime support is added, the vector database will likely integrate with the Context Engine's RAG feature (`ragEnabled`, `ragTopK`, `ragMinScore`) to retrieve relevant chunks during the context assembly phase.

## Connections

- **Sends to**: Agent Node
- **Receives from**: None
- Multiple Vector Database Nodes can connect to the same agent.

## Example

```json
{
  "type": "vectorDatabase",
  "label": "Knowledge Base",
  "provider": "pinecone",
  "collectionName": "docs-embeddings",
  "connectionString": "https://my-index-abc123.svc.pinecone.io"
}
```
