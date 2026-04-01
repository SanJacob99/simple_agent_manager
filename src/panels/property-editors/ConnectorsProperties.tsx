import { useState } from 'react';
import { useGraphStore } from '../../store/graph-store';
import type { ConnectorsNodeData } from '../../types/nodes';
import { Field, inputClass, selectClass } from './shared';

const CONNECTOR_TYPES = [
  'rest-api',
  'graphql',
  'websocket',
  'grpc',
  'slack',
  'discord',
  'github',
  'jira',
  'custom',
];

interface Props {
  nodeId: string;
  data: ConnectorsNodeData;
}

export default function ConnectorsProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');

  const addConfigEntry = () => {
    if (newKey.trim()) {
      update(nodeId, {
        config: { ...data.config, [newKey.trim()]: newVal },
      });
      setNewKey('');
      setNewVal('');
    }
  };

  const removeConfigEntry = (key: string) => {
    const { [key]: _, ...rest } = data.config;
    update(nodeId, { config: rest });
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

      <Field label="Connector Type">
        <select
          className={selectClass}
          value={data.connectorType}
          onChange={(e) => update(nodeId, { connectorType: e.target.value })}
        >
          {CONNECTOR_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Configuration">
        <div className="space-y-1.5">
          {Object.entries(data.config).map(([key, value]) => (
            <div key={key} className="flex items-center gap-1 text-xs">
              <span className="font-mono text-slate-400">{key}:</span>
              <span className="flex-1 truncate text-slate-300">{value}</span>
              <button
                onClick={() => removeConfigEntry(key)}
                className="text-red-400 hover:text-red-300"
              >
                x
              </button>
            </div>
          ))}
          <div className="flex gap-1">
            <input
              className={inputClass}
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="key"
            />
            <input
              className={inputClass}
              value={newVal}
              onChange={(e) => setNewVal(e.target.value)}
              placeholder="value"
            />
            <button
              onClick={addConfigEntry}
              className="shrink-0 rounded-md bg-slate-700 px-2 text-xs text-slate-300 hover:bg-slate-600"
            >
              +
            </button>
          </div>
        </div>
      </Field>
    </div>
  );
}
