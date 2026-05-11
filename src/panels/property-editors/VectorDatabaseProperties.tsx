import { useGraphStore } from '../../store/graph-store';
import type {
  VectorDatabaseNodeData,
  VectorStoreProvider,
  EmbeddingProvider,
  VectorEmbeddingConfig,
} from '../../types/nodes';
import { Field, inputClass, selectClass } from './shared';

interface Props {
  nodeId: string;
  data: VectorDatabaseNodeData;
}

const STORE_PROVIDERS: Array<{ value: VectorStoreProvider; label: string }> = [
  { value: 'sqlite-vec', label: 'SQLite (sqlite-vec) — local, default' },
  { value: 'pinecone', label: 'Pinecone (not yet wired)' },
  { value: 'chromadb', label: 'ChromaDB (not yet wired)' },
  { value: 'qdrant', label: 'Qdrant (not yet wired)' },
  { value: 'weaviate', label: 'Weaviate (not yet wired)' },
];

const OPENROUTER_MODELS = [
  'openai/text-embedding-3-small',
  'openai/text-embedding-3-large',
  'google/gemini-embedding-001',
  'qwen/qwen3-embedding-8b',
  'baai/bge-m3',
];

const OLLAMA_MODELS = [
  'nomic-embed-text',
  'mxbai-embed-large',
  'all-minilm',
];

export default function VectorDatabaseProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);

  const updateEmbedding = (patch: Partial<VectorEmbeddingConfig>) => {
    update(nodeId, { embedding: { ...data.embedding, ...patch } });
  };

  const isSqliteVec = data.provider === 'sqlite-vec';
  const isOpenRouter = data.embedding.provider === 'openrouter';
  const modelOptions = isOpenRouter ? OPENROUTER_MODELS : OLLAMA_MODELS;

  return (
    <div className="space-y-1">
      <p className="text-[11px] text-slate-400 px-1 pb-1">
        Connecting this node enables <code>vector_search</code>,{' '}
        <code>vector_upsert</code>, <code>vector_delete</code>, and{' '}
        <code>vector_get</code> on the agent automatically.
      </p>

      <Field label="Label">
        <input
          className={inputClass}
          value={data.label}
          onChange={(e) => update(nodeId, { label: e.target.value })}
        />
      </Field>

      <Field label="Provider">
        <select
          className={selectClass}
          value={data.provider}
          onChange={(e) =>
            update(nodeId, {
              provider: e.target.value as VectorStoreProvider,
            })
          }
        >
          {STORE_PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>

      {!isSqliteVec && (
        <p className="text-[11px] text-amber-400 px-1">
          Only sqlite-vec is wired at runtime today. Selecting another provider
          will throw an error when the agent first uses a vector tool.
        </p>
      )}

      <Field label="Collection Name">
        <input
          className={inputClass}
          value={data.collectionName}
          onChange={(e) => update(nodeId, { collectionName: e.target.value })}
          placeholder="my-collection"
        />
      </Field>

      {isSqliteVec ? (
        <Field label="Storage Path">
          <input
            className={inputClass}
            value={data.storagePath}
            onChange={(e) => update(nodeId, { storagePath: e.target.value })}
            placeholder=".sam/vector"
          />
        </Field>
      ) : (
        <Field label="Connection String">
          <input
            className={inputClass}
            value={data.connectionString}
            onChange={(e) => update(nodeId, { connectionString: e.target.value })}
            placeholder="http://localhost:8000"
          />
        </Field>
      )}

      <div className="mt-2 border-t border-slate-700/60 pt-2">
        <p className="text-[11px] uppercase tracking-wide text-slate-400 px-1">
          Embedding
        </p>

        <Field label="Provider">
          <select
            className={selectClass}
            value={data.embedding.provider}
            onChange={(e) =>
              updateEmbedding({
                provider: e.target.value as EmbeddingProvider,
                model:
                  e.target.value === 'openrouter'
                    ? OPENROUTER_MODELS[0]
                    : OLLAMA_MODELS[0],
              })
            }
          >
            <option value="openrouter">OpenRouter (cloud, default)</option>
            <option value="ollama">Ollama (local)</option>
          </select>
        </Field>

        <Field label="Model">
          <select
            className={selectClass}
            value={data.embedding.model}
            onChange={(e) => updateEmbedding({ model: e.target.value })}
          >
            {modelOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            {!modelOptions.includes(data.embedding.model) && (
              <option value={data.embedding.model}>
                {data.embedding.model} (custom)
              </option>
            )}
          </select>
        </Field>

        <Field label="Base URL (optional)">
          <input
            className={inputClass}
            value={data.embedding.baseUrl ?? ''}
            onChange={(e) =>
              updateEmbedding({ baseUrl: e.target.value || undefined })
            }
            placeholder={
              isOpenRouter
                ? 'https://openrouter.ai/api/v1'
                : 'http://localhost:11434'
            }
          />
        </Field>

        <Field label="Dimensions (optional)">
          <input
            className={inputClass}
            type="number"
            min={1}
            value={data.embedding.dimensions ?? ''}
            onChange={(e) =>
              updateEmbedding({
                dimensions: e.target.value
                  ? Math.max(1, parseInt(e.target.value, 10) || 0) || undefined
                  : undefined,
              })
            }
            placeholder="auto"
          />
        </Field>
      </div>
    </div>
  );
}
