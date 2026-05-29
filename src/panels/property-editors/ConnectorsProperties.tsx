import { useGraphStore } from '../../store/graph-store';
import type { ConnectorsNodeData } from '../../types/nodes';
import { CONNECTOR_CATALOG } from '../../../shared/connectors/catalog';
import { Field, inputClass, selectClass } from './shared';

interface Props {
  nodeId: string;
  data: ConnectorsNodeData;
}

const CATALOG_IDS = Object.keys(CONNECTOR_CATALOG);

export default function ConnectorsProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);
  const definition = data.connectorId ? CONNECTOR_CATALOG[data.connectorId] : undefined;

  return (
    <div className="space-y-1">
      <Field label="Label">
        <input
          className={inputClass}
          value={data.label}
          onChange={(e) => update(nodeId, { label: e.target.value })}
        />
      </Field>

      <Field label="Connector">
        <select
          className={selectClass}
          value={data.connectorId}
          onChange={(e) => update(nodeId, { connectorId: e.target.value })}
        >
          <option value="">Pick a connector...</option>
          {CATALOG_IDS.map((id) => (
            <option key={id} value={id}>
              {CONNECTOR_CATALOG[id].label}
            </option>
          ))}
        </select>
      </Field>

      {definition && (
        <>
          <p className="text-xs text-slate-400 px-1">{definition.description}</p>
          {definition.variables.map((v) => (
            <Field key={v.key} label={v.label}>
              <input
                className={inputClass}
                value={data.config?.[v.key] ?? ''}
                placeholder={v.default}
                onChange={(e) =>
                  update(nodeId, {
                    config: { ...data.config, [v.key]: e.target.value },
                  })
                }
              />
              <p className="text-[10px] text-slate-500 mt-0.5">{v.description}</p>
            </Field>
          ))}
        </>
      )}

      {data.connectorId && !definition && (
        <p className="text-xs text-amber-400 px-1">
          Unknown connector id: <code>{data.connectorId}</code>. Pick one from the list.
        </p>
      )}
    </div>
  );
}
