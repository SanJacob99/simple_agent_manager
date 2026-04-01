import { useGraphStore } from '../../store/graph-store';
import type { VectorDatabaseNodeData } from '../../types/nodes';
import { Field, inputClass, selectClass } from './shared';

interface Props {
  nodeId: string;
  data: VectorDatabaseNodeData;
}

export default function VectorDatabaseProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);

  return (
    <div className="space-y-1">
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
              provider: e.target.value as VectorDatabaseNodeData['provider'],
            })
          }
        >
          <option value="chromadb">ChromaDB</option>
          <option value="pinecone">Pinecone</option>
          <option value="qdrant">Qdrant</option>
          <option value="weaviate">Weaviate</option>
        </select>
      </Field>

      <Field label="Collection Name">
        <input
          className={inputClass}
          value={data.collectionName}
          onChange={(e) => update(nodeId, { collectionName: e.target.value })}
          placeholder="my-collection"
        />
      </Field>

      <Field label="Connection String">
        <input
          className={inputClass}
          value={data.connectionString}
          onChange={(e) => update(nodeId, { connectionString: e.target.value })}
          placeholder="http://localhost:8000"
        />
      </Field>
    </div>
  );
}
