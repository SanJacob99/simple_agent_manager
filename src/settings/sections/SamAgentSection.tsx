import { useMemo } from 'react';
import { useSettingsStore } from '../settings-store';
import { useModelCatalogStore } from '../../store/model-catalog-store';
import { useProviderRegistryStore } from '../../store/provider-registry-store';
import { STATIC_MODELS } from '../../runtime/provider-model-options';
import type { ThinkingLevel } from '../../types/nodes';

const THINKING_LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

interface ModelOption {
  value: string; // "<pluginId>::<baseUrl>::<modelId>"
  pluginId: string;
  baseUrl: string;
  modelId: string;
}

function buildModelOptions(
  allCatalogModels: Record<string, Record<string, unknown>>,
  apiKeys: Record<string, string>,
): ModelOption[] {
  const options: ModelOption[] = [];
  const seen = new Set<string>();

  const configuredPluginIds = new Set(
    Object.entries(apiKeys)
      .filter(([, key]) => key.trim().length > 0)
      .map(([pluginId]) => pluginId),
  );
  configuredPluginIds.add('ollama'); // no key required

  const addOption = (pluginId: string, baseUrl: string, modelId: string) => {
    const dedupeKey = `${pluginId}::${baseUrl}::${modelId}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    options.push({ value: dedupeKey, pluginId, baseUrl, modelId });
  };

  for (const pluginId of configuredPluginIds) {
    const staticList = STATIC_MODELS[pluginId] ?? [];
    for (const modelId of staticList) addOption(pluginId, '', modelId);
  }

  for (const [catalogKey, modelsMap] of Object.entries(allCatalogModels)) {
    const sep = catalogKey.indexOf('::');
    if (sep === -1) continue;
    const pluginId = catalogKey.slice(0, sep);
    const baseUrlToken = catalogKey.slice(sep + 2);
    const baseUrl = baseUrlToken === 'default' ? '' : baseUrlToken;
    if (!configuredPluginIds.has(pluginId)) continue;
    for (const modelId of Object.keys(modelsMap)) addOption(pluginId, baseUrl, modelId);
  }

  options.sort((a, b) => {
    if (a.pluginId !== b.pluginId) return a.pluginId.localeCompare(b.pluginId);
    return a.modelId.localeCompare(b.modelId);
  });
  return options;
}

const inputCls = 'w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100';

export default function SamAgentSection() {
  const samAgentDefaults = useSettingsStore((s) => s.samAgentDefaults);
  const setSamAgentDefaults = useSettingsStore((s) => s.setSamAgentDefaults);
  const apiKeys = useSettingsStore((s) => s.apiKeys);
  const allCatalogModels = useModelCatalogStore((s) => s.models);
  const registryProviders = useProviderRegistryStore((s) => s.providers);

  const modelOptions = useMemo(
    () => buildModelOptions(allCatalogModels, apiKeys),
    [allCatalogModels, apiKeys],
  );

  const modelSelection = samAgentDefaults.modelSelection;
  const selectValue = modelSelection
    ? `${modelSelection.provider.pluginId}::${modelSelection.provider.baseUrl}::${modelSelection.modelId}`
    : '';

  const handleModelChange = (value: string) => {
    const opt = modelOptions.find((o) => o.value === value);
    if (!opt) return;
    const regProvider = registryProviders.find((p) => p.id === opt.pluginId);
    const firstAuth = regProvider?.auth[0];
    setSamAgentDefaults({
      modelSelection: {
        provider: {
          pluginId: opt.pluginId,
          authMethodId: firstAuth?.methodId ?? 'api-key',
          envVar: firstAuth?.envVar ?? '',
          baseUrl: opt.baseUrl,
        },
        modelId: opt.modelId,
      },
    });
  };

  const apiKeyForProvider = modelSelection
    ? (apiKeys[modelSelection.provider.pluginId] ?? '').trim().length > 0
    : false;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-300">Model</label>
        <select
          aria-label="SAMAgent model"
          className={inputCls}
          value={selectValue}
          onChange={(e) => handleModelChange(e.target.value)}
        >
          {modelOptions.length === 0 ? (
            <option value="">No providers configured — add an API key first</option>
          ) : (
            <>
              {!selectValue && <option value="">Select a model…</option>}
              {modelOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.pluginId} / {opt.modelId}
                </option>
              ))}
            </>
          )}
        </select>
        <p className="mt-1 text-xs text-slate-500">
          Picks the model that powers SAMAgent. Only providers with a configured API key are listed.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-300">Thinking level</label>
        <select
          aria-label="SAMAgent thinking level"
          className={inputCls}
          value={samAgentDefaults.thinkingLevel}
          onChange={(e) => setSamAgentDefaults({ thinkingLevel: e.target.value as ThinkingLevel })}
        >
          {THINKING_LEVELS.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-500">
          Higher levels improve reasoning quality but cost more and run slower. Some models
          (e.g. Gemini 3.1 Pro) reject <code>off</code> and require a non-zero level.
        </p>
      </div>

      {modelSelection && !apiKeyForProvider && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          The selected provider <span className="font-medium">{modelSelection.provider.pluginId}</span> has
          no API key configured. Open <span className="font-medium">Providers &amp; API Keys</span> to add one.
        </div>
      )}
    </div>
  );
}
