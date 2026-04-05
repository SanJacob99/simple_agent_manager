import { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Component,
  DollarSign,
  Server,
  Tag,
  Cpu,
  RotateCcw,
} from 'lucide-react';
import type {
  DiscoveredModelMetadata,
  ModelCapabilityOverrides,
  ModelCostInfo,
  ModelInputModality,
  ModelTopProviderInfo,
} from '../../types/model-metadata';
import { Tooltip, inputClass } from './shared';
import ModelDetailsModal from '../../settings/sections/ModelDetailsModal';

// --- Helpers ---

function formatCostPerMillion(cost: number | undefined): string {
  if (cost === undefined || cost === null) return '-';
  const perMillion = cost * 1_000_000;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(perMillion);
}

function emptyCost(): ModelCostInfo {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

function parseOptionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// --- Sub-components ---

function ValueRow({
  label,
  value,
  unit = '',
  isOverridden,
  onReset,
}: {
  label: string;
  value: string | number | undefined | null;
  unit?: string;
  isOverridden?: boolean;
  onReset?: () => void;
}) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-slate-800/50 last:border-0 group">
      <span className="text-[10px] text-slate-400">{label}</span>
      <div className="flex items-center gap-1.5">
        {isOverridden && (
          <span className="text-[8px] px-1 py-0.5 rounded bg-blue-500/20 text-blue-400 font-semibold uppercase">
            override
          </span>
        )}
        <span
          className="text-[10px] font-medium text-slate-200 text-right max-w-[140px] truncate"
          title={String(value)}
        >
          {value} {unit}
        </span>
        {isOverridden && onReset && (
          <button
            type="button"
            onClick={onReset}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-500 hover:text-slate-300"
            title="Reset to API default"
          >
            <RotateCcw size={10} />
          </button>
        )}
      </div>
    </div>
  );
}

function CostInput({
  value,
  onChange,
  placeholder,
}: {
  value: number;
  onChange: (val: string) => void;
  placeholder?: string;
}) {
  const displayVal =
    value === 0 ? '' : Number((value * 1e6).toPrecision(6)).toString();
  return (
    <input
      className={inputClass}
      type="number"
      step="any"
      value={displayVal}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

// --- Compact Summary Bar ---

function CapabilitySummaryBar({
  capabilities,
  onExpand,
}: {
  capabilities: ResolvedCapabilities;
  onExpand: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onExpand}
      className="w-full flex items-center justify-between rounded-lg border border-slate-700/80 bg-slate-800/60 px-3 py-2 transition hover:bg-slate-800 hover:border-slate-600 group"
    >
      <div className="flex items-center gap-2 min-w-0">
        <Cpu size={14} className="text-blue-400 shrink-0" />
        <div className="flex items-center gap-2 text-[10px] text-slate-300 truncate">
          {capabilities.contextWindow && (
            <span className="font-medium">
              {(capabilities.contextWindow / 1000).toFixed(0)}K ctx
            </span>
          )}
          {capabilities.maxTokens && (
            <span className="text-slate-500">
              {(capabilities.maxTokens / 1000).toFixed(0)}K out
            </span>
          )}
          {capabilities.reasoningSupported && (
            <span className="px-1 py-0.5 rounded bg-purple-500/20 text-purple-400 text-[8px] font-semibold uppercase">
              reasoning
            </span>
          )}
          {capabilities.inputModalities.includes('image') && (
            <span className="px-1 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[8px] font-semibold uppercase">
              vision
            </span>
          )}
          {(capabilities.cost.input > 0 || capabilities.cost.output > 0) && (
            <span
              className="text-slate-500 text-[9px]"
              title="Input / Output cost per 1M tokens"
            >
              {formatCostPerMillion(capabilities.cost.input)}/
              {formatCostPerMillion(capabilities.cost.output)}
            </span>
          )}
        </div>
      </div>
      <ChevronDown
        size={14}
        className="text-slate-500 group-hover:text-slate-300 transition shrink-0"
      />
    </button>
  );
}

// --- Types ---

interface ResolvedCapabilities {
  reasoningSupported: boolean;
  inputModalities: ModelInputModality[];
  contextWindow?: number;
  maxTokens?: number;
  cost: ModelCostInfo;
  outputModalities: string[];
  tokenizer?: string;
  supportedParameters?: string[];
  topProvider?: ModelTopProviderInfo;
  description?: string;
  modelName?: string;
}

interface ModelCapabilitiesPanelProps {
  nodeId: string;
  overrides: ModelCapabilityOverrides;
  discoveredModel: DiscoveredModelMetadata | undefined;
  resolved: ResolvedCapabilities;
  onUpdateCapabilities: (updates: Partial<ModelCapabilityOverrides>) => void;
  onClearCapability: (key: keyof ModelCapabilityOverrides) => void;
  onUpdateCost: (key: keyof ModelCostInfo, value: string) => void;
  onToggleInputModality: (modality: ModelInputModality, checked: boolean) => void;
}

// --- Main Component ---

export default function ModelCapabilitiesPanel({
  nodeId: _nodeId,
  overrides,
  discoveredModel,
  resolved,
  onUpdateCapabilities,
  onClearCapability,
  onUpdateCost,
  onToggleInputModality,
}: ModelCapabilitiesPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [showFullModal, setShowFullModal] = useState(false);

  if (!expanded) {
    return (
      <div className="space-y-1">
        <label className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Model Capabilities
          <Tooltip text="Metadata describing what the selected model supports. These values are auto-filled from the API and snapshotted when you select a model. You can override individual values per agent.">
            <span className="cursor-help text-slate-500 hover:text-slate-300">
              ?
            </span>
          </Tooltip>
        </label>
        <CapabilitySummaryBar
          capabilities={resolved}
          onExpand={() => setExpanded(true)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Model Capabilities
          <Tooltip text="Metadata describing what the selected model supports. These values are auto-filled from the API and snapshotted when you select a model. You can override individual values per agent.">
            <span className="cursor-help text-slate-500 hover:text-slate-300">
              ?
            </span>
          </Tooltip>
        </label>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-slate-500 hover:text-slate-300 transition"
        >
          <ChevronUp size={14} />
        </button>
      </div>

      <div className="space-y-3 rounded-lg border border-slate-700/80 bg-slate-800/30 p-3">
        {/* Description */}
        {resolved.description && (
          <p className="text-[10px] text-slate-400 leading-relaxed bg-slate-900/40 p-2 rounded-md border border-slate-800/50">
            {resolved.description}
          </p>
        )}

        {/* Capabilities & Limits */}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-300 uppercase tracking-wide">
            <Component size={12} className="text-indigo-400" />
            Capabilities & Limits
          </div>
          <div className="rounded-md border border-slate-800/60 bg-slate-900/40 p-2">
            {/* Reasoning */}
            <div className="flex items-center justify-between py-1.5 border-b border-slate-800/50 group">
              <label className="flex items-center gap-2 text-[10px] text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={resolved.reasoningSupported}
                  onChange={(e) =>
                    onUpdateCapabilities({
                      reasoningSupported: e.target.checked,
                    })
                  }
                  className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
                />
                Reasoning
              </label>
              <div className="flex items-center gap-1">
                {overrides.reasoningSupported !== undefined && (
                  <>
                    <span className="text-[8px] px-1 py-0.5 rounded bg-blue-500/20 text-blue-400 font-semibold uppercase">
                      override
                    </span>
                    <button
                      type="button"
                      onClick={() => onClearCapability('reasoningSupported')}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-500 hover:text-slate-300"
                      title="Reset to API default"
                    >
                      <RotateCcw size={10} />
                    </button>
                  </>
                )}
              </div>
            </div>

            <ValueRow
              label="Context Window"
              value={resolved.contextWindow?.toLocaleString()}
              unit="tokens"
              isOverridden={overrides.contextWindow !== undefined}
              onReset={() => onClearCapability('contextWindow')}
            />
            <ValueRow
              label="Max Completion Tokens"
              value={resolved.maxTokens?.toLocaleString()}
              unit="tokens"
              isOverridden={overrides.maxTokens !== undefined}
              onReset={() => onClearCapability('maxTokens')}
            />
            <ValueRow
              label="Input Modalities"
              value={resolved.inputModalities.join(', ')}
              isOverridden={overrides.inputModalities !== undefined}
              onReset={() => onClearCapability('inputModalities')}
            />
            <ValueRow
              label="Output Modalities"
              value={resolved.outputModalities.join(', ')}
            />
            <ValueRow label="Tokenizer" value={resolved.tokenizer} />
          </div>
        </div>

        {/* Editable overrides */}
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-0.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-slate-500">Context Window</label>
                {overrides.contextWindow !== undefined && (
                  <button
                    type="button"
                    className="text-[8px] text-slate-500 hover:text-slate-300"
                    onClick={() => onClearCapability('contextWindow')}
                  >
                    reset
                  </button>
                )}
              </div>
              <input
                className={inputClass}
                type="number"
                value={resolved.contextWindow ?? ''}
                onChange={(e) =>
                  onUpdateCapabilities({
                    contextWindow: parseOptionalNumber(e.target.value),
                  })
                }
                placeholder="tokens"
              />
            </div>
            <div className="space-y-0.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-slate-500">Max Tokens</label>
                {overrides.maxTokens !== undefined && (
                  <button
                    type="button"
                    className="text-[8px] text-slate-500 hover:text-slate-300"
                    onClick={() => onClearCapability('maxTokens')}
                  >
                    reset
                  </button>
                )}
              </div>
              <input
                className={inputClass}
                type="number"
                value={resolved.maxTokens ?? ''}
                onChange={(e) =>
                  onUpdateCapabilities({
                    maxTokens: parseOptionalNumber(e.target.value),
                  })
                }
                placeholder="tokens"
              />
            </div>
          </div>

          {/* Input modalities toggles */}
          <div className="space-y-0.5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-slate-500">Input Modalities</label>
              {overrides.inputModalities !== undefined && (
                <button
                  type="button"
                  className="text-[8px] text-slate-500 hover:text-slate-300"
                  onClick={() => onClearCapability('inputModalities')}
                >
                  reset
                </button>
              )}
            </div>
            <div className="flex gap-3">
              {(['text', 'image'] as ModelInputModality[]).map((mod) => (
                <label
                  key={mod}
                  className="flex items-center gap-1.5 text-[10px] text-slate-400 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={resolved.inputModalities.includes(mod)}
                    onChange={(e) => onToggleInputModality(mod, e.target.checked)}
                    className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
                  />
                  {mod}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Pricing */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-300 uppercase tracking-wide">
              <DollarSign size={12} className="text-green-400" />
              Pricing (per 1M tokens)
            </div>
            {overrides.cost !== undefined && (
              <button
                type="button"
                className="text-[8px] text-slate-500 hover:text-slate-300"
                onClick={() => onClearCapability('cost')}
              >
                reset
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-0.5">
              <label className="text-[9px] text-slate-500">Input</label>
              <CostInput
                value={resolved.cost.input}
                onChange={(val) => onUpdateCost('input', val)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-0.5">
              <label className="text-[9px] text-slate-500">Output</label>
              <CostInput
                value={resolved.cost.output}
                onChange={(val) => onUpdateCost('output', val)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-0.5">
              <label className="text-[9px] text-slate-500">Cache Read</label>
              <CostInput
                value={resolved.cost.cacheRead}
                onChange={(val) => onUpdateCost('cacheRead', val)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-0.5">
              <label className="text-[9px] text-slate-500">Cache Write</label>
              <CostInput
                value={resolved.cost.cacheWrite}
                onChange={(val) => onUpdateCost('cacheWrite', val)}
                placeholder="0.00"
              />
            </div>
          </div>
        </div>

        {/* Top Provider */}
        {resolved.topProvider && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-300 uppercase tracking-wide">
              <Server size={12} className="text-amber-400" />
              Provider Details
            </div>
            <div className="rounded-md border border-slate-800/60 bg-slate-900/40 p-2">
              <ValueRow
                label="Context Length"
                value={resolved.topProvider.contextLength?.toLocaleString()}
                unit="tokens"
              />
              <ValueRow
                label="Max Completion"
                value={resolved.topProvider.maxCompletionTokens?.toLocaleString()}
                unit="tokens"
              />
              <ValueRow
                label="Moderated"
                value={resolved.topProvider.isModerated ? 'Yes' : 'No'}
              />
            </div>
          </div>
        )}

        {/* Supported Parameters */}
        {resolved.supportedParameters &&
          resolved.supportedParameters.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-300 uppercase tracking-wide">
                <Tag size={12} className="text-rose-400" />
                Supported Parameters
              </div>
              <div className="flex flex-wrap gap-1">
                {resolved.supportedParameters.map((param) => (
                  <span
                    key={param}
                    className="px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded text-[8px] uppercase font-semibold border border-slate-700/50"
                  >
                    {param}
                  </span>
                ))}
              </div>
            </div>
          )}

        {/* Full Details Button */}
        {discoveredModel && discoveredModel.raw && (
          <button
            type="button"
            onClick={() => setShowFullModal(true)}
            className="w-full mt-1 py-1.5 text-[10px] text-blue-400 hover:text-blue-300 transition rounded-md border border-slate-800/60 bg-slate-900/30 hover:bg-slate-800/50 font-medium"
          >
            View full API payload
          </button>
        )}
      </div>

      {/* Full details modal */}
      {showFullModal && discoveredModel && (
        <ModelDetailsModal
          model={discoveredModel}
          onClose={() => setShowFullModal(false)}
        />
      )}
    </div>
  );
}
