import { useGraphStore } from '../../store/graph-store';
import type { AgentCommNodeData } from '../../types/nodes';
import { Field, inputClass, selectClass } from './shared';

interface Props {
  nodeId: string;
  data: AgentCommNodeData;
}

export default function AgentCommProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);
  const nodes = useGraphStore((s) => s.nodes);

  // List all agent nodes except the one this comm node is connected to
  const agentNodes = nodes.filter((n) => n.data.type === 'agent');

  return (
    <div className="space-y-1">
      <Field label="Label">
        <input
          className={inputClass}
          value={data.label}
          onChange={(e) => update(nodeId, { label: e.target.value })}
        />
      </Field>

      <Field label="Target Agent">
        <select
          className={selectClass}
          value={data.targetAgentNodeId || ''}
          onChange={(e) =>
            update(nodeId, {
              targetAgentNodeId: e.target.value || null,
            })
          }
        >
          <option value="">None</option>
          {agentNodes.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.data.type === 'agent' ? agent.data.name : agent.id}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Protocol">
        <select
          className={selectClass}
          value={data.protocol}
          onChange={(e) =>
            update(nodeId, {
              protocol: e.target.value as 'direct' | 'broadcast',
            })
          }
        >
          <option value="direct">Direct</option>
          <option value="broadcast">Broadcast</option>
        </select>
      </Field>

      <Field label="Direction">
        <select
          className={selectClass}
          value={data.direction}
          onChange={(e) =>
            update(nodeId, {
              direction: e.target.value as 'bidirectional' | 'outbound' | 'inbound',
            })
          }
        >
          <option value="bidirectional">Bidirectional</option>
          <option value="outbound">Outbound only</option>
          <option value="inbound">Inbound only</option>
        </select>
      </Field>

      <Field label="Max turns (per channel)">
        <input
          type="number"
          min={1}
          className={inputClass}
          value={data.maxTurns}
          onChange={(e) => update(nodeId, { maxTurns: Number(e.target.value) })}
        />
      </Field>

      <Field label="Max depth (cascade)">
        <input
          type="number"
          min={1}
          className={inputClass}
          value={data.maxDepth}
          onChange={(e) => update(nodeId, { maxDepth: Number(e.target.value) })}
        />
      </Field>

      <Field label="Token budget (per channel)">
        <input
          type="number"
          min={1000}
          step={1000}
          className={inputClass}
          value={data.tokenBudget}
          onChange={(e) => update(nodeId, { tokenBudget: Number(e.target.value) })}
        />
      </Field>

      <Field label="Rate limit (msgs/min)">
        <input
          type="number"
          min={1}
          className={inputClass}
          value={data.rateLimitPerMinute}
          onChange={(e) => update(nodeId, { rateLimitPerMinute: Number(e.target.value) })}
        />
      </Field>

      <Field label="Message size cap (chars)">
        <input
          type="number"
          min={100}
          step={100}
          className={inputClass}
          value={data.messageSizeCap}
          onChange={(e) => update(nodeId, { messageSizeCap: Number(e.target.value) })}
        />
      </Field>
    </div>
  );
}
