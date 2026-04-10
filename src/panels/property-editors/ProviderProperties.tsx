import { useGraphStore } from '../../store/graph-store';
import { useProviderRegistryStore } from '../../store/provider-registry-store';
import type { ProviderNodeData } from '../../types/nodes';
import { Field, inputClass, selectClass } from './shared';

interface Props {
  nodeId: string;
  data: ProviderNodeData;
}

export default function ProviderProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);
  const providers = useProviderRegistryStore((s) => s.providers);

  const currentPlugin = providers.find((p) => p.id === data.pluginId);
  const authMethods = currentPlugin?.auth ?? [];
  const currentAuth = authMethods.find((a) => a.methodId === data.authMethodId);

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
          value={data.pluginId}
          onChange={(e) => {
            const newPlugin = providers.find((p) => p.id === e.target.value);
            const defaultAuth = newPlugin?.auth[0];
            update(nodeId, {
              pluginId: e.target.value,
              authMethodId: defaultAuth?.methodId ?? '',
              envVar: defaultAuth?.envVar ?? '',
              baseUrl: '',
            });
          }}
        >
          {providers.length === 0 && (
            <option value={data.pluginId}>{data.pluginId || 'No providers loaded'}</option>
          )}
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>

      {authMethods.length > 1 && (
        <Field label="Auth Method">
          <select
            className={selectClass}
            value={data.authMethodId}
            onChange={(e) => {
              const auth = authMethods.find((a) => a.methodId === e.target.value);
              update(nodeId, {
                authMethodId: e.target.value,
                envVar: auth?.envVar ?? data.envVar,
              });
            }}
          >
            {authMethods.map((a) => (
              <option key={a.methodId} value={a.methodId}>
                {a.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="Environment Variable">
        <input
          className={inputClass}
          value={data.envVar}
          onChange={(e) => update(nodeId, { envVar: e.target.value })}
          placeholder={currentAuth?.envVar ?? 'e.g. OPENROUTER_API_KEY'}
        />
        <p className="mt-1 text-[10px] text-slate-500">
          Fallback environment variable name for the API key.
        </p>
      </Field>

      <Field label="Base URL Override">
        <input
          className={inputClass}
          value={data.baseUrl}
          onChange={(e) => update(nodeId, { baseUrl: e.target.value })}
          placeholder={currentPlugin?.defaultBaseUrl ?? 'Leave empty for default'}
        />
        <p className="mt-1 text-[10px] text-slate-500">
          Leave empty to use the provider&apos;s default URL
          {currentPlugin?.defaultBaseUrl ? ` (${currentPlugin.defaultBaseUrl})` : ''}.
        </p>
      </Field>
    </div>
  );
}
