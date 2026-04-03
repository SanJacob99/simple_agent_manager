import { RefreshCw } from 'lucide-react';
import { useModelCatalogStore } from '../../store/model-catalog-store';
import { useSettingsStore } from '../settings-store';

export default function ModelCatalogSection() {
  const openRouterKey = useSettingsStore((state) => state.apiKeys.openrouter);
  const models = useModelCatalogStore((state) => state.models.openrouter);
  const loading = useModelCatalogStore((state) => state.loading.openrouter);
  const error = useModelCatalogStore((state) => state.errors.openrouter);
  const syncOpenRouterKey = useModelCatalogStore(
    (state) => state.syncOpenRouterKey,
  );

  const modelCount = Object.keys(models).length;

  return (
    <div className="space-y-4">
      {!openRouterKey ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          Add an OpenRouter API key in Providers &amp; API Keys to enable
          discovery.
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {error}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-300">
          {loading
            ? 'Refreshing OpenRouter models...'
            : `Discovered ${modelCount} OpenRouter models.`}
        </div>
      )}

      <button
        type="button"
        disabled={!openRouterKey || loading}
        onClick={() => void syncOpenRouterKey(openRouterKey, { force: true })}
        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <RefreshCw size={16} />
        Sync now
      </button>
    </div>
  );
}
