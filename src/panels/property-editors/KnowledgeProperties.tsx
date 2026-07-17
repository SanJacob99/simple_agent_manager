import { nanoid } from 'nanoid';
import { Plus, Trash2 } from 'lucide-react';
import { useGraphStore } from '../../store/graph-store';
import type {
  KnowledgeNodeData,
  KnowledgeSource,
  KnowledgeSourceType,
  ChunkStrategy,
} from '../../types/nodes';
import { Field, inputClass, selectClass } from './shared';

const SOURCE_TYPES: { id: KnowledgeSourceType; label: string }[] = [
  { id: 'file', label: 'File' },
  { id: 'directory', label: 'Directory' },
  { id: 'url', label: 'URL' },
  { id: 'git', label: 'Git repo' },
  { id: 'text', label: 'Inline text' },
];

const CHUNK_STRATEGIES: { id: ChunkStrategy; label: string }[] = [
  { id: 'fixed', label: 'Fixed window' },
  { id: 'sentence', label: 'Sentence' },
  { id: 'paragraph', label: 'Paragraph' },
  { id: 'markdown', label: 'Markdown headings' },
];

const LOCATION_PLACEHOLDER: Record<KnowledgeSourceType, string> = {
  file: '/docs/handbook.md',
  directory: '/docs',
  url: 'https://example.com/guide',
  git: 'https://github.com/owner/repo',
  text: 'Paste text to embed…',
};

interface Props {
  nodeId: string;
  data: KnowledgeNodeData;
}

export default function KnowledgeProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);

  const updateSource = (index: number, patch: Partial<KnowledgeSource>) => {
    const sources = data.sources.map((s, i) => (i === index ? { ...s, ...patch } : s));
    update(nodeId, { sources });
  };

  const addSource = () => {
    const next: KnowledgeSource = {
      id: nanoid(6),
      type: 'file',
      location: '',
      include: '',
      exclude: '',
    };
    update(nodeId, { sources: [...data.sources, next] });
  };

  const removeSource = (index: number) => {
    update(nodeId, { sources: data.sources.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-1">
      <Field label="Label">
        <input
          className={inputClass}
          value={data.label}
          onChange={(e) => update(nodeId, { label: e.target.value })}
        />
      </Field>

      <Field
        label="Enabled"
        tooltip="When off, the node is wired into the graph but no ingestion runs."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => update(nodeId, { enabled: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Ingest sources into the collection</span>
        </label>
      </Field>

      <Field
        label="Collection"
        tooltip="Target Vector DB collection this knowledge is ingested into. Match a connected Vector DB node's collection name."
      >
        <input
          className={inputClass}
          value={data.collectionName}
          onChange={(e) => update(nodeId, { collectionName: e.target.value })}
          placeholder="default"
        />
      </Field>

      <Field
        label="Chunk strategy"
        tooltip="How fetched documents are split before embedding."
      >
        <select
          className={selectClass}
          value={data.chunkStrategy}
          onChange={(e) => update(nodeId, { chunkStrategy: e.target.value as ChunkStrategy })}
        >
          {CHUNK_STRATEGIES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Chunk size (tokens)"
        tooltip="Target chunk size in tokens (approximate). Units are packed until adding the next would exceed this."
      >
        <input
          type="number"
          min={1}
          step={32}
          className={inputClass}
          value={data.chunkSize}
          onChange={(e) =>
            update(nodeId, { chunkSize: Math.max(1, Math.floor(Number(e.target.value) || 1)) })
          }
        />
      </Field>

      <Field
        label="Chunk overlap (tokens)"
        tooltip="Tokens of trailing context carried into the next chunk. Clamped below the chunk size."
      >
        <input
          type="number"
          min={0}
          step={16}
          className={inputClass}
          value={data.chunkOverlap}
          onChange={(e) =>
            update(nodeId, { chunkOverlap: Math.max(0, Math.floor(Number(e.target.value) || 0)) })
          }
        />
      </Field>

      <Field
        label="Embedding model"
        tooltip="Model id used to embed chunks at ingestion time."
      >
        <input
          className={inputClass}
          value={data.embedding.model}
          onChange={(e) =>
            update(nodeId, { embedding: { ...data.embedding, model: e.target.value } })
          }
          placeholder="openai/text-embedding-3-small"
        />
      </Field>

      <Field
        label="Refresh schedule"
        tooltip="How often to re-ingest sources: 'manual', or a duration like 30m, 6h, 7d."
      >
        <input
          className={inputClass}
          value={data.refreshSchedule}
          onChange={(e) => update(nodeId, { refreshSchedule: e.target.value })}
          placeholder="manual"
        />
      </Field>

      <Field
        label="Max documents"
        tooltip="Cap on documents ingested per refresh. 0 means unlimited."
      >
        <input
          type="number"
          min={0}
          step={1}
          className={inputClass}
          value={data.maxDocuments}
          onChange={(e) =>
            update(nodeId, { maxDocuments: Math.max(0, Math.floor(Number(e.target.value) || 0)) })
          }
        />
      </Field>

      <div className="mb-2 mt-4 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Sources ({data.sources.length})
        </span>
        <button
          onClick={addSource}
          className="flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
        >
          <Plus size={12} /> Add source
        </button>
      </div>

      <div className="space-y-3">
        {data.sources.map((s, i) => {
          const usesGlobs = s.type === 'directory' || s.type === 'git';
          return (
            <div key={s.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-[10px] text-slate-500">{s.id}</span>
                <button
                  onClick={() => removeSource(i)}
                  className="rounded p-1 text-slate-500 transition hover:bg-red-500/10 hover:text-red-400"
                  title="Remove source"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <select
                className={`${selectClass} mb-2`}
                value={s.type}
                onChange={(e) => updateSource(i, { type: e.target.value as KnowledgeSourceType })}
              >
                {SOURCE_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              <input
                className={`${inputClass} mb-2`}
                value={s.location}
                onChange={(e) => updateSource(i, { location: e.target.value })}
                placeholder={LOCATION_PLACEHOLDER[s.type]}
              />
              {usesGlobs && (
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className={inputClass}
                    value={s.include ?? ''}
                    onChange={(e) => updateSource(i, { include: e.target.value })}
                    placeholder="include glob"
                  />
                  <input
                    className={inputClass}
                    value={s.exclude ?? ''}
                    onChange={(e) => updateSource(i, { exclude: e.target.value })}
                    placeholder="exclude glob"
                  />
                </div>
              )}
            </div>
          );
        })}
        {data.sources.length === 0 && (
          <p className="rounded-lg border border-dashed border-slate-800 px-3 py-4 text-center text-[11px] text-slate-500">
            No sources yet. Add a file, directory, URL, git repo, or inline text to ingest.
          </p>
        )}
      </div>
    </div>
  );
}
