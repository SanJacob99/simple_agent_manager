import { useState } from 'react';
import { X, Cpu, Database, Server, Component, Tag, DollarSign, TextSelect, FileJson } from 'lucide-react';
import type { DiscoveredModelMetadata } from '../../types/model-metadata';

interface ModelDetailsModalProps {
  model: DiscoveredModelMetadata;
  onClose: () => void;
}

function formatCostWithDecimals(cost: number | undefined): string {
  if (cost === undefined || cost === null) return '-';
  const perMillion = cost * 1_000_000;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(perMillion);
}

function ValueItem({ label, value, unit = '' }: { label: string; value: string | number | undefined | null; unit?: string }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="flex justify-between items-center py-2 border-b border-slate-700/50 last:border-0">
      <span className="text-xs text-slate-400">{label}</span>
      <span className="text-xs font-medium text-slate-200 text-right max-w-[200px] truncate" title={String(value)}>
        {value} {unit}
      </span>
    </div>
  );
}

export default function ModelDetailsModal({ model, onClose }: ModelDetailsModalProps) {
  const [showRaw, setShowRaw] = useState(false);
  const rawData = model.raw;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden my-auto max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-800 bg-slate-800/50 px-6 py-5 shrink-0">
          <div className="flex gap-4 items-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10 border border-blue-500/20">
              <Cpu size={24} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-100">{model.name || model.id}</h2>
              <div className="flex gap-2 items-center mt-1">
                <span className="text-xs px-2 py-0.5 rounded-md bg-slate-700 font-medium text-slate-300">
                  {model.provider}
                </span>
                <span className="text-xs text-slate-500 font-mono">{model.id}</span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body (Scrollable) */}
        <div className="p-6 overflow-y-auto space-y-6 bg-slate-900 overflow-x-hidden">
          {/* Description */}
          {model.description && (
            <div className="text-sm leading-relaxed text-slate-300 bg-slate-800/20 p-4 rounded-xl border border-slate-800">
              {model.description}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Architecture / Capabilities */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                <Component size={16} className="text-indigo-400" />
                Capabilities & Limits
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                <ValueItem label="Context Window" value={model.contextWindow?.toLocaleString()} unit="tokens" />
                <ValueItem label="Max Completion Tokens" value={model.maxTokens?.toLocaleString()} unit="tokens" />
                <ValueItem label="Input Modalities" value={model.inputModalities?.join(', ') || 'text'} />
                <ValueItem label="Output Modalities" value={rawData?.architecture?.output_modalities?.join(', ') || 'text'} />
                <ValueItem label="Reasoning Supported" value={model.reasoningSupported ? 'Yes' : 'No'} />
                <ValueItem label="Tokenizer" value={rawData?.architecture?.tokenizer} />
              </div>
            </div>

            {/* Pricing (Per Million Tokens) */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                <DollarSign size={16} className="text-green-400" />
                Pricing (per 1M tokens)
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                <ValueItem label="Input (Prompt)" value={formatCostWithDecimals(model.cost?.input)} />
                <ValueItem label="Output (Completion)" value={formatCostWithDecimals(model.cost?.output)} />
                <ValueItem label="Cache Read" value={formatCostWithDecimals(model.cost?.cacheRead)} />
                <ValueItem label="Cache Write" value={formatCostWithDecimals(model.cost?.cacheWrite)} />
                {rawData?.pricing?.image && Number(rawData.pricing.image) > 0 && (
                  <ValueItem label="Image Processing" value={formatCostWithDecimals(Number(rawData.pricing.image))} unit="(per 1M unit)" />
                )}
                {rawData?.pricing?.request && Number(rawData.pricing.request) > 0 && (
                  <ValueItem label="Per Request Fee" value={formatCostWithDecimals(Number(rawData.pricing.request))} />
                )}
              </div>
            </div>

            {/* Provider Info */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                <Server size={16} className="text-amber-400" />
                Provider Details
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                <ValueItem label="Top Provider Context" value={rawData?.top_provider?.context_length?.toLocaleString()} />
                <ValueItem label="Top Provider Max Tokens" value={rawData?.top_provider?.max_completion_tokens?.toLocaleString()} />
                <ValueItem label="Is Moderated" value={rawData?.top_provider?.is_moderated ? 'Yes' : 'No'} />
                <ValueItem label="Instruct Type" value={rawData?.architecture?.instruct_type} />
              </div>
            </div>
            
            {/* Parameters */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                <Tag size={16} className="text-rose-400" />
                Supported Parameters
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 flex flex-wrap gap-2">
                {rawData?.supported_parameters?.length ? (
                  rawData.supported_parameters.map((param: string) => (
                    <span key={param} className="px-2 py-1 bg-slate-800 text-slate-300 rounded text-[10px] uppercase font-semibold border border-slate-700/50">
                      {param}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-slate-500">No specific parameters extracted.</span>
                )}
              </div>
            </div>
          </div>

          {/* Raw JSON Accordion */}
          {rawData && (
            <div className="mt-6 pt-6 border-t border-slate-800">
              <button
                onClick={() => setShowRaw(!showRaw)}
                className="flex w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-900/50 p-4 transition hover:bg-slate-800"
              >
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-300">
                  <FileJson size={16} className="text-slate-400" />
                  Raw API Payload
                </div>
                <span className="text-xs text-slate-500 font-medium">
                  {showRaw ? 'Hide' : 'Show Developer Payload'}
                </span>
              </button>
              
              {showRaw && (
                <div className="mt-2 rounded-xl border border-slate-800 bg-black/40 p-4 overflow-x-auto">
                  <pre className="text-[10px] text-green-400 font-mono leading-relaxed">
                    {JSON.stringify(rawData, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
