import { useGraphStore } from '../../store/graph-store';
import type { DatabaseNodeData } from '../../types/nodes';
import { Field, inputClass, selectClass } from './shared';

interface Props {
  nodeId: string;
  data: DatabaseNodeData;
}

export default function DatabaseProperties({ nodeId, data }: Props) {
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

      <Field label="Database Type">
        <select
          className={selectClass}
          value={data.dbType}
          onChange={(e) =>
            update(nodeId, {
              dbType: e.target.value as DatabaseNodeData['dbType'],
            })
          }
        >
          <option value="postgresql">PostgreSQL</option>
          <option value="mysql">MySQL</option>
          <option value="sqlite">SQLite</option>
          <option value="mongodb">MongoDB</option>
          <option value="indexeddb">IndexedDB (browser)</option>
          <option value="rest-api">REST API</option>
        </select>
      </Field>

      <Field label="Connection String">
        <input
          className={inputClass}
          value={data.connectionString}
          onChange={(e) => update(nodeId, { connectionString: e.target.value })}
          placeholder="postgresql://user:pass@localhost:5432/db"
          type="password"
        />
      </Field>
    </div>
  );
}
