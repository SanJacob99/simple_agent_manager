import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { DiscoveredModelMetadata } from '../../types/model-metadata';
import {
  filterModelOptions,
  getCustomModelPlaceholder,
  isCustomModelId,
  modelSupportsTools,
} from './provider-model-utils';

const defaultInputClassName =
  'w-full rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30';

interface ProviderModelPickerProps {
  provider: string;
  modelId: string;
  availableModels: string[];
  discoveredModels?: Record<string, DiscoveredModelMetadata>;
  onSelectModel: (modelId: string) => void;
  onChangeManualModelId: (modelId: string) => void;
  onCommitManualModelId?: () => void;
  enableOpenRouterFilters?: boolean;
  inputClassName?: string;
  pickerAriaLabel?: string;
  searchInputAriaLabel?: string;
  searchPlaceholder?: string;
  manualInputAriaLabel?: string;
  manualTriggerLabel?: string;
  helperText?: ReactNode;
}

export default function ProviderModelPicker({
  provider,
  modelId,
  availableModels,
  discoveredModels = {},
  onSelectModel,
  onChangeManualModelId,
  onCommitManualModelId,
  enableOpenRouterFilters = false,
  inputClassName = defaultInputClassName,
  pickerAriaLabel = 'Model Picker',
  searchInputAriaLabel = 'Search models',
  searchPlaceholder = 'Search model IDs',
  manualInputAriaLabel = 'Custom model ID',
  manualTriggerLabel = 'Use custom model ID',
  helperText = 'Enter a provider-supported model ID that may not be listed in the app yet.',
}: ProviderModelPickerProps) {
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [showCustomModelInput, setShowCustomModelInput] = useState(false);
  const [showFreeOnly, setShowFreeOnly] = useState(false);
  const [requireTools, setRequireTools] = useState(
    enableOpenRouterFilters && provider === 'openrouter',
  );
  const [requireReasoning, setRequireReasoning] = useState(false);
  const [requireImageInput, setRequireImageInput] = useState(false);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const deferredModelSearch = useDeferredValue(modelSearch);

  const filteredModels = useMemo(
    () =>
      filterModelOptions({
        availableModels,
        provider,
        search: deferredModelSearch,
        discoveredModels,
        showFreeOnly,
        requireTools,
        requireReasoning,
        requireImageInput,
      }),
    [
      availableModels,
      deferredModelSearch,
      discoveredModels,
      provider,
      requireImageInput,
      requireReasoning,
      requireTools,
      showFreeOnly,
    ],
  );

  const showOpenRouterFilters = enableOpenRouterFilters && provider === 'openrouter';
  const showManualModelInput =
    showCustomModelInput || isCustomModelId(modelId, availableModels);

  useEffect(() => {
    setIsModelPickerOpen(false);
    setModelSearch('');
    setShowCustomModelInput(false);
    setShowFreeOnly(false);
    setRequireTools(enableOpenRouterFilters && provider === 'openrouter');
    setRequireReasoning(false);
    setRequireImageInput(false);
  }, [enableOpenRouterFilters, provider]);

  useEffect(() => {
    if (!isModelPickerOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!modelPickerRef.current?.contains(event.target as Node)) {
        setIsModelPickerOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isModelPickerOpen]);

  return (
    <div ref={modelPickerRef} className="space-y-2">
      <button
        type="button"
        aria-label={pickerAriaLabel}
        aria-expanded={isModelPickerOpen}
        className={`${inputClassName} flex items-center justify-between gap-3 text-left`}
        onClick={() => {
          setIsModelPickerOpen((open) => !open);
          setModelSearch('');
        }}
      >
        <span className="truncate">{modelId || 'Select a model'}</span>
        <span className="shrink-0 text-[10px] text-slate-500">
          {filteredModels.length}/{availableModels.length}
        </span>
      </button>

      {isModelPickerOpen && (
        <div className="rounded-md border border-slate-700 bg-slate-900/95 p-2 shadow-lg">
          <div className="space-y-2">
            <input
              aria-label={searchInputAriaLabel}
              className={inputClassName}
              value={modelSearch}
              onChange={(e) => setModelSearch(e.target.value)}
              placeholder={searchPlaceholder}
              autoFocus
            />

            {showOpenRouterFilters && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  aria-pressed={requireTools}
                  className={`rounded-full border px-2 py-1 text-[10px] transition ${
                    requireTools
                      ? 'border-blue-500 bg-blue-500/15 text-blue-200'
                      : 'border-slate-700 bg-slate-800 text-slate-300'
                  }`}
                  onClick={() => setRequireTools((value) => !value)}
                >
                  Tools
                </button>
                <button
                  type="button"
                  aria-label="Free only"
                  aria-pressed={showFreeOnly}
                  className={`rounded-full border px-2 py-1 text-[10px] transition ${
                    showFreeOnly
                      ? 'border-blue-500 bg-blue-500/15 text-blue-200'
                      : 'border-slate-700 bg-slate-800 text-slate-300'
                  }`}
                  onClick={() => setShowFreeOnly((value) => !value)}
                >
                  Free only
                </button>
                <button
                  type="button"
                  aria-pressed={requireReasoning}
                  className={`rounded-full border px-2 py-1 text-[10px] transition ${
                    requireReasoning
                      ? 'border-blue-500 bg-blue-500/15 text-blue-200'
                      : 'border-slate-700 bg-slate-800 text-slate-300'
                  }`}
                  onClick={() => setRequireReasoning((value) => !value)}
                >
                  Reasoning
                </button>
                <button
                  type="button"
                  aria-pressed={requireImageInput}
                  className={`rounded-full border px-2 py-1 text-[10px] transition ${
                    requireImageInput
                      ? 'border-blue-500 bg-blue-500/15 text-blue-200'
                      : 'border-slate-700 bg-slate-800 text-slate-300'
                  }`}
                  onClick={() => setRequireImageInput((value) => !value)}
                >
                  Image input
                </button>
              </div>
            )}

            <div
              aria-label="Model results"
              className="max-h-64 overflow-y-auto rounded-md border border-slate-800 bg-slate-950/60"
            >
              {filteredModels.length > 0 ? (
                filteredModels.map((candidateModelId) => {
                  const model =
                    provider === 'openrouter'
                      ? discoveredModels[candidateModelId]
                      : undefined;
                  const isSelected = candidateModelId === modelId;
                  const isFree =
                    !!model?.cost &&
                    model.cost.input === 0 &&
                    model.cost.output === 0 &&
                    model.cost.cacheRead === 0 &&
                    model.cost.cacheWrite === 0;

                  return (
                    <button
                      key={candidateModelId}
                      type="button"
                      className={`flex w-full items-start justify-between gap-3 border-b border-slate-800 px-3 py-2 text-left last:border-b-0 ${
                        isSelected
                          ? 'bg-slate-800/80 text-slate-100'
                          : 'text-slate-300 hover:bg-slate-800/50'
                      }`}
                      onClick={() => {
                        onSelectModel(candidateModelId);
                        setShowCustomModelInput(false);
                        setIsModelPickerOpen(false);
                        setModelSearch('');
                      }}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-xs">{candidateModelId}</div>
                        {model?.name && model.name !== candidateModelId && (
                          <div className="truncate text-[10px] text-slate-500">
                            {model.name}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-wrap justify-end gap-1">
                        {isFree && (
                          <span className="rounded-full border border-emerald-600/40 bg-emerald-500/10 px-2 py-0.5 text-[9px] text-emerald-200">
                            Free
                          </span>
                        )}
                        {modelSupportsTools(model) && (
                          <span className="rounded-full border border-blue-600/40 bg-blue-500/10 px-2 py-0.5 text-[9px] text-blue-200">
                            Tools
                          </span>
                        )}
                        {model?.reasoningSupported && (
                          <span className="rounded-full border border-violet-600/40 bg-violet-500/10 px-2 py-0.5 text-[9px] text-violet-200">
                            Reasoning
                          </span>
                        )}
                        {model?.inputModalities?.includes('image') && (
                          <span className="rounded-full border border-amber-600/40 bg-amber-500/10 px-2 py-0.5 text-[9px] text-amber-200">
                            Image
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="px-3 py-4 text-[10px] text-slate-500">
                  No models match the current search and filters.
                </div>
              )}
            </div>

            <button
              type="button"
              className="text-[10px] text-blue-400 transition hover:text-blue-300"
              onClick={() => {
                setShowCustomModelInput(true);
                setIsModelPickerOpen(false);
                setModelSearch('');
              }}
            >
              {manualTriggerLabel}
            </button>
          </div>
        </div>
      )}

      {showManualModelInput && (
        <>
          <input
            aria-label={manualInputAriaLabel}
            className={inputClassName}
            value={modelId}
            onChange={(e) => onChangeManualModelId(e.target.value)}
            onBlur={onCommitManualModelId}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onCommitManualModelId?.();
              }
            }}
            placeholder={getCustomModelPlaceholder(provider)}
          />
          {helperText ? (
            <p className="text-[10px] text-slate-500">{helperText}</p>
          ) : null}
        </>
      )}
    </div>
  );
}
