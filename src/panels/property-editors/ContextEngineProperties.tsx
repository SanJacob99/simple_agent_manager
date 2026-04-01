import { useGraphStore } from '../../store/graph-store';
import type { ContextEngineNodeData } from '../../types/nodes';
import { Field, inputClass, selectClass } from './shared';

interface Props {
  nodeId: string;
  data: ContextEngineNodeData;
}

export default function ContextEngineProperties({ nodeId, data }: Props) {
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

      <Field label="Strategy">
        <select
          className={selectClass}
          value={data.strategy}
          onChange={(e) =>
            update(nodeId, {
              strategy: e.target.value as ContextEngineNodeData['strategy'],
            })
          }
        >
          <option value="rag">RAG</option>
          <option value="summary">Summary</option>
          <option value="sliding-window">Sliding Window</option>
        </select>
      </Field>

      <Field label="Max Tokens">
        <input
          className={inputClass}
          type="number"
          min={256}
          step={256}
          value={data.maxTokens}
          onChange={(e) =>
            update(nodeId, { maxTokens: parseInt(e.target.value) || 4096 })
          }
        />
      </Field>
    </div>
  );
}
