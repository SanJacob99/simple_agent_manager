import { useState, useMemo } from 'react';
import { RefreshCw, Search, Check, X, Database, Globe } from 'lucide-react';
import { useModelCatalogStore } from '../../store/model-catalog-store';
import { useSettingsStore } from '../settings-store';
import type { DiscoveredModelMetadata } from '../../types/model-metadata';
import ModelDetailsModal from './ModelDetailsModal';

const ITEMS_PER_PAGE = 10;

function formatNumber(num: number | undefined): string {
  if (num === undefined || num === null) return '-';
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return num.toString();
}

function formatCost(cost: number | undefined): string {
  if (cost === undefined || cost === null) return '-';
  // Cost is provided per token. We want to display per million tokens.
  const perMillion = cost * 1_000_000;
  // Format cleanly (e.g. $0.50 or $15.00 or $0.00)
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 6, // Some costs are extremely small
  }).format(perMillion);
}

export default function ModelCatalogSection() {
  const openRouterKey = useSettingsStore((state) => state.apiKeys.openrouter);
  const modelsMap = useModelCatalogStore((state) => state.models.openrouter);
  const userModelsMap = useModelCatalogStore((state) => state.userModels.openrouter);
  const syncedAt = useModelCatalogStore((state) => state.syncedAt.openrouter);
  const userModelsRequireRefresh = useModelCatalogStore(
    (state) => state.userModelsRequireRefresh.openrouter,
  );
  const loading = useModelCatalogStore((state) => state.loading.openrouter);
  const error = useModelCatalogStore((state) => state.errors.openrouter);
  const refreshOpenRouterCatalog = useModelCatalogStore(
    (state) => state.refreshOpenRouterCatalog,
  );

  const [viewMode, setViewMode] = useState<'all' | 'user'>('user');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedModel, setSelectedModel] = useState<DiscoveredModelMetadata | null>(null);

  const currentMap = viewMode === 'all' ? modelsMap : userModelsMap;
  
  const filteredModels = useMemo(() => {
    const arr = Object.values(currentMap);
    if (!searchQuery) return arr;
    
    const query = searchQuery.toLowerCase();
    return arr.filter((m) => m.id.toLowerCase().includes(query));
  }, [currentMap, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredModels.length / ITEMS_PER_PAGE));
  
  // Ensure current page is valid when filtering changes
  if (currentPage > totalPages && totalPages > 0) {
    setCurrentPage(totalPages);
  }

  const paginatedModels = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredModels.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredModels, currentPage]);

  const totalFound = Object.keys(modelsMap).length;

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex items-center justify-between">
        {!openRouterKey ? (
          <div className="flex-1 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
            Add an OpenRouter API key in Providers &amp; API Keys to enable discovery.
          </div>
        ) : error ? (
          <div className="flex-1 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
          </div>
        ) : (
          <div className="flex-1 space-y-1">
            <h3 className="text-sm border-slate-800 font-semibold text-slate-100">
              OpenRouter Model Catalog
            </h3>
            <p className="text-xs text-slate-400">
              {loading
                ? 'Refreshing OpenRouter models...'
                : syncedAt
                ? `Cached OpenRouter catalog last updated ${new Date(syncedAt).toLocaleString()}.`
                : totalFound === 0
                ? 'No models synchronized.'
                : `Discovered ${totalFound} OpenRouter models.`}
            </p>
          </div>
        )}

        <div className="ml-4 flex items-center gap-2">
          <button
            type="button"
            disabled={!openRouterKey || loading}
            onClick={() => void refreshOpenRouterCatalog()}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Sync Models
          </button>
        </div>
      </div>

      {userModelsRequireRefresh && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          Your OpenRouter API key changed. Refresh to repopulate My Enabled Models for this account.
        </div>
      )}

      {totalFound > 0 && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            {/* View Mode Toggle */}
            <div className="flex items-center rounded-lg bg-slate-900 border border-slate-800 p-1">
              <button
                onClick={() => { setViewMode('user'); setCurrentPage(1); }}
                className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  viewMode === 'user'
                    ? 'bg-slate-700 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Database size={14} />
                My Enabled Models
              </button>
              <button
                onClick={() => { setViewMode('all'); setCurrentPage(1); }}
                className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  viewMode === 'all'
                    ? 'bg-slate-700 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Globe size={14} />
                All Models
              </button>
            </div>

            {/* Search Input */}
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
              <input
                type="text"
                placeholder="Search models by ID..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 py-1.5 pl-9 pr-3 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
              />
            </div>
          </div>

          {/* Table */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-800 text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Model ID</th>
                    <th className="px-4 py-3 font-medium">Reasoning</th>
                    <th className="px-4 py-3 font-medium">Modalities</th>
                    <th className="px-4 py-3 font-medium">Context</th>
                    <th className="px-4 py-3 font-medium">Cost / 1M (In/Out)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {paginatedModels.length > 0 ? (
                    paginatedModels.map((model: DiscoveredModelMetadata) => (
                      <tr 
                        key={model.id} 
                        onClick={() => setSelectedModel(model)}
                        className="transition hover:bg-slate-800/30 cursor-pointer"
                      >
                        <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-200">
                          {model.id}
                        </td>
                        <td className="px-4 py-3">
                          {model.reasoningSupported ? (
                            <span className="inline-flex items-center gap-1 rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] uppercase font-semibold text-blue-400">
                              <Check size={10} /> Yes
                            </span>
                          ) : (
                            <span className="text-slate-600">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 capitalize">
                          {model.inputModalities?.join(', ') || 'Text'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {formatNumber(model.contextWindow)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {formatCost(model.cost?.input)} / {formatCost(model.cost?.output)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                        No models found. Try adjusting your search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {filteredModels.length > 0 && (
              <div className="flex items-center justify-between border-t border-slate-800 bg-slate-900/80 px-4 py-3">
                <div className="text-xs text-slate-400">
                  Showing <span className="font-medium text-slate-200">{(currentPage - 1) * ITEMS_PER_PAGE + 1}</span> to{' '}
                  <span className="font-medium text-slate-200">{Math.min(currentPage * ITEMS_PER_PAGE, filteredModels.length)}</span> of{' '}
                  <span className="font-medium text-slate-200">{filteredModels.length}</span> models
                </div>
                
                <div className="flex items-center gap-2">
                  <button
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(p => p - 1)}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-medium text-slate-300 transition hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <button
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage(p => p + 1)}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-medium text-slate-300 transition hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {selectedModel && (
        <ModelDetailsModal model={selectedModel} onClose={() => setSelectedModel(null)} />
      )}
    </div>
  );
}
