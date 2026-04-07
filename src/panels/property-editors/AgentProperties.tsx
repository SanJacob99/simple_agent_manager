import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useGraphStore } from '../../store/graph-store';
import { useModelCatalogStore } from '../../store/model-catalog-store';
import type { AgentNodeData, ThinkingLevel } from '../../types/nodes';
import type {
  DiscoveredModelMetadata,
  ModelCapabilityOverrides,
  ModelCostInfo,
  ModelInputModality,
} from '../../types/model-metadata';
import {
  PROVIDERS,
  STATIC_MODELS,
} from '../../runtime/provider-model-options';
import { Field, Tooltip, inputClass, selectClass, textareaClass } from './shared';
import SystemPromptPreview from '../SystemPromptPreview';
import ModelCapabilitiesPanel from './ModelCapabilitiesPanel';

const THINKING_LEVELS: ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
];

interface Props {
  nodeId: string;
  data: AgentNodeData;
}

function modelSupportsTools(discovered: DiscoveredModelMetadata | undefined) {
  return discovered?.supportedParameters?.includes('tools') ?? false;
}

function getModelOptions(
  provider: string,
  discovered: string[],
): string[] {
  return [...new Set([...(STATIC_MODELS[provider] || []), ...discovered])];
}

function getDefaultModelId(
  provider: string,
  discovered: string[],
  openRouterModels: Record<string, DiscoveredModelMetadata> = {},
) {
  if (provider === 'openrouter') {
    const firstToolCapableModel = discovered.find((modelId) =>
      modelSupportsTools(openRouterModels[modelId]),
    );
    if (firstToolCapableModel) return firstToolCapableModel;
  }

  return getModelOptions(provider, discovered)[0] ?? '';
}

function getCustomModelPlaceholder(provider: string) {
  if (provider === 'openrouter') {
    return 'xiaomi/mimo-v2-pro';
  }
  return 'provider-specific-model-id';
}

function emptyCost(): ModelCostInfo {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };
}

/**
 * Build a full capabilities snapshot from discovered metadata.
 * This is written to the agent node data on model selection so the backend
 * can operate independently of the frontend catalog cache.
 */
function snapshotCapabilities(
  discovered: DiscoveredModelMetadata | undefined,
): ModelCapabilityOverrides {
  if (!discovered) return {};
  return {
    reasoningSupported: discovered.reasoningSupported ?? false,
    inputModalities: discovered.inputModalities ?? ['text'],
    contextWindow: discovered.contextWindow,
    maxTokens: discovered.maxTokens,
    cost: discovered.cost ?? emptyCost(),
    outputModalities: discovered.outputModalities ?? ['text'],
    tokenizer: discovered.tokenizer,
    supportedParameters: discovered.supportedParameters,
    topProvider: discovered.topProvider,
    description: discovered.description,
    modelName: discovered.name,
  };
}

export default function AgentProperties({ nodeId, data }: Props) {
  const [showPreview, setShowPreview] = useState(false);
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [showCustomModelInput, setShowCustomModelInput] = useState(false);
  const [showFreeOnly, setShowFreeOnly] = useState(false);
  const [requireTools, setRequireTools] = useState(data.provider === 'openrouter');
  const [requireReasoning, setRequireReasoning] = useState(false);
  const [requireImageInput, setRequireImageInput] = useState(false);
  const update = useGraphStore((s) => s.updateNodeData);
  const openRouterModels = useModelCatalogStore((s) => s.models.openrouter);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const deferredModelSearch = useDeferredValue(modelSearch);
  const hasOpenRouterCatalog = Object.keys(openRouterModels).length > 0;

  const discoveredModels = useMemo(
    () => (data.provider === 'openrouter' ? Object.keys(openRouterModels) : []),
    [data.provider, openRouterModels],
  );
  const discoveredModel =
    data.provider === 'openrouter'
      ? openRouterModels[data.modelId]
      : undefined;

  const availableModels = useMemo(
    () => getModelOptions(data.provider, discoveredModels),
    [data.provider, discoveredModels],
  );

  const isCustomModel = !availableModels.includes(data.modelId);
  const showManualModelInput = showCustomModelInput || isCustomModel;
  const systemPromptMode = data.systemPromptMode === 'manual' ? 'manual' : 'append';

  const filteredModels = useMemo(() => {
    const search = deferredModelSearch.trim().toLowerCase();
    return availableModels.filter((modelId) => {
      const model = data.provider === 'openrouter' ? openRouterModels[modelId] : undefined;
      const matchesSearch =
        search.length === 0 ||
        modelId.toLowerCase().includes(search) ||
        model?.name?.toLowerCase().includes(search) ||
        model?.description?.toLowerCase().includes(search);

      if (!matchesSearch) return false;

      if (showFreeOnly) {
        if (!model?.cost) return false;
        const isFree =
          model.cost.input === 0 &&
          model.cost.output === 0 &&
          model.cost.cacheRead === 0 &&
          model.cost.cacheWrite === 0;
        if (!isFree) return false;
      }

      if (requireTools && hasOpenRouterCatalog && model && !modelSupportsTools(model)) {
        return false;
      }

      if (requireReasoning && !model?.reasoningSupported) {
        return false;
      }

      if (requireImageInput && !model?.inputModalities?.includes('image')) {
        return false;
      }

      return true;
    });
  }, [
    availableModels,
    data.provider,
    deferredModelSearch,
    hasOpenRouterCatalog,
    openRouterModels,
    requireImageInput,
    requireReasoning,
    requireTools,
    showFreeOnly,
  ]);

  useEffect(() => {
    setIsModelPickerOpen(false);
    setModelSearch('');
    setShowCustomModelInput(false);
    setShowFreeOnly(false);
    setRequireTools(data.provider === 'openrouter');
    setRequireReasoning(false);
    setRequireImageInput(false);
  }, [data.provider]);

  useEffect(() => {
    if (data.systemPromptMode !== systemPromptMode) {
      update(nodeId, { systemPromptMode });
    }
  }, [data.systemPromptMode, nodeId, systemPromptMode, update]);

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

  // Resolve capabilities: overrides (persisted in node) take precedence,
  // falling back to discovered metadata from the live catalog.
  const resolvedCapabilities = {
    reasoningSupported:
      data.modelCapabilities.reasoningSupported ??
      discoveredModel?.reasoningSupported ??
      false,
    inputModalities:
      data.modelCapabilities.inputModalities ??
      discoveredModel?.inputModalities ??
      (['text'] as ModelInputModality[]),
    contextWindow:
      data.modelCapabilities.contextWindow ?? discoveredModel?.contextWindow,
    maxTokens: data.modelCapabilities.maxTokens ?? discoveredModel?.maxTokens,
    cost: data.modelCapabilities.cost ?? discoveredModel?.cost ?? emptyCost(),
    outputModalities:
      data.modelCapabilities.outputModalities ??
      discoveredModel?.outputModalities ??
      ['text'],
    tokenizer:
      data.modelCapabilities.tokenizer ?? discoveredModel?.tokenizer,
    supportedParameters:
      data.modelCapabilities.supportedParameters ??
      discoveredModel?.supportedParameters,
    topProvider:
      data.modelCapabilities.topProvider ?? discoveredModel?.topProvider,
    description:
      data.modelCapabilities.description ?? discoveredModel?.description,
    modelName:
      data.modelCapabilities.modelName ?? discoveredModel?.name,
  };

  const updateCapabilities = (updates: Partial<ModelCapabilityOverrides>) => {
    update(nodeId, {
      modelCapabilities: {
        ...data.modelCapabilities,
        ...updates,
      },
    });
  };

  const clearCapability = (key: keyof ModelCapabilityOverrides) => {
    const next = { ...data.modelCapabilities };
    delete next[key];
    update(nodeId, { modelCapabilities: next });
  };

  const updateCost = (key: keyof ModelCostInfo, value: string) => {
    const num = Number(value);
    const nextCost = {
      ...(data.modelCapabilities.cost ?? resolvedCapabilities.cost ?? emptyCost()),
      [key]: Number.isNaN(num) ? 0 : num / 1e6,
    };
    updateCapabilities({ cost: nextCost });
  };

  const toggleInputModality = (
    modality: ModelInputModality,
    checked: boolean,
  ) => {
    const next = new Set(resolvedCapabilities.inputModalities);
    if (checked) {
      next.add(modality);
    } else {
      next.delete(modality);
    }
    updateCapabilities({
      inputModalities: [...next] as ModelInputModality[],
    });
  };

  const applyModelSelection = (newModelId: string) => {
    let discovered: DiscoveredModelMetadata | undefined;
    if (data.provider === 'openrouter') {
      discovered = openRouterModels[newModelId];
    }

    const caps = snapshotCapabilities(discovered);
    update(nodeId, {
      modelId: newModelId,
      modelCapabilities: caps,
      ...(caps.reasoningSupported === false ? { thinkingLevel: 'off' } : {}),
    });
    setShowCustomModelInput(false);
    setIsModelPickerOpen(false);
    setModelSearch('');
  };

  const commitManualModelId = () => {
    const trimmedModelId = data.modelId.trim();
    if (!trimmedModelId) return;
    if (
      data.provider === 'openrouter' &&
      openRouterModels[trimmedModelId]
    ) {
      applyModelSelection(trimmedModelId);
    }
  };

  return (
    <div className="space-y-1">
      <Field label="Agent Name">
        {data.nameConfirmed ? (
          <div className="flex items-center gap-2">
            <input
              className={`${inputClass} opacity-60 cursor-not-allowed`}
              value={data.name}
              disabled
            />
            <span className="text-[9px] text-slate-600 whitespace-nowrap" title="Agent names cannot be changed after creation">
              🔒
            </span>
          </div>
        ) : (
          <input
            className={inputClass}
            value={data.name}
            onChange={(e) => update(nodeId, { name: e.target.value })}
            placeholder="My Agent"
          />
        )}
      </Field>

      <Field label="Description">
        <input
          className={inputClass}
          value={data.description || ''}
          onChange={(e) => update(nodeId, { description: e.target.value })}
          placeholder="What does this agent do?"
        />
      </Field>

      <Field label="Tags">
        <input
          className={inputClass}
          value={(data.tags || []).join(', ')}
          onChange={(e) =>
            update(nodeId, {
              tags: e.target.value
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean),
            })
          }
          placeholder="tag1, tag2, ..."
        />
      </Field>

      <Field label="Provider">
        <select
          className={selectClass}
          value={data.provider}
          onChange={(e) => {
            const provider = e.target.value;
            const discoveredIds =
              provider === 'openrouter' ? Object.keys(openRouterModels) : [];
            const newModelId = getDefaultModelId(
              provider,
              discoveredIds,
              openRouterModels,
            );

            // Snapshot capabilities for the new model
            let discovered: DiscoveredModelMetadata | undefined;
            if (provider === 'openrouter') {
              discovered = openRouterModels[newModelId];
            }

            const caps = snapshotCapabilities(discovered);
            update(nodeId, {
              provider,
              modelId: newModelId,
              modelCapabilities: caps,
              ...(caps.reasoningSupported === false ? { thinkingLevel: 'off' } : {}),
            });
          }}
        >
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Model">
        <div ref={modelPickerRef} className="space-y-2">
          <button
            type="button"
            aria-label="Model Picker"
            aria-expanded={isModelPickerOpen}
            className={`${inputClass} flex items-center justify-between gap-3 text-left`}
            onClick={() => {
              setIsModelPickerOpen((open) => !open);
              setModelSearch('');
            }}
          >
            <span className="truncate">{data.modelId || 'Select a model'}</span>
            <span className="shrink-0 text-[10px] text-slate-500">
              {filteredModels.length}/{availableModels.length}
            </span>
          </button>

          {isModelPickerOpen && (
            <div className="rounded-md border border-slate-700 bg-slate-900/95 p-2 shadow-lg">
              <div className="space-y-2">
                <input
                  aria-label="Search models"
                  className={inputClass}
                  value={modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                  placeholder="Search model IDs"
                  autoFocus
                />

                {data.provider === 'openrouter' && (
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
                    filteredModels.map((modelId) => {
                      const model =
                        data.provider === 'openrouter'
                          ? openRouterModels[modelId]
                          : undefined;
                      const isSelected = modelId === data.modelId;
                      const isFree =
                        !!model?.cost &&
                        model.cost.input === 0 &&
                        model.cost.output === 0 &&
                        model.cost.cacheRead === 0 &&
                        model.cost.cacheWrite === 0;

                      return (
                        <button
                          key={modelId}
                          type="button"
                          className={`flex w-full items-start justify-between gap-3 border-b border-slate-800 px-3 py-2 text-left last:border-b-0 ${
                            isSelected
                              ? 'bg-slate-800/80 text-slate-100'
                              : 'text-slate-300 hover:bg-slate-800/50'
                          }`}
                          onClick={() => applyModelSelection(modelId)}
                        >
                          <div className="min-w-0">
                            <div className="truncate text-xs">{modelId}</div>
                            {model?.name && model.name !== modelId && (
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
                  className="text-[10px] text-blue-400 hover:text-blue-300 transition"
                  onClick={() => {
                    setShowCustomModelInput(true);
                    setIsModelPickerOpen(false);
                    setModelSearch('');
                  }}
                >
                  Use custom model ID
                </button>
              </div>
            </div>
          )}

          {showManualModelInput && (
            <>
              <input
                aria-label="Custom model ID"
                className={inputClass}
                value={data.modelId}
                onChange={(e) => update(nodeId, { modelId: e.target.value })}
                onBlur={commitManualModelId}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    commitManualModelId();
                  }
                }}
                placeholder={getCustomModelPlaceholder(data.provider)}
              />
              <p className="text-[10px] text-slate-500">
                Enter a provider-supported model ID that may not be listed in the
                app yet.
              </p>
            </>
          )}
        </div>
      </Field>

      {/* Collapsible Model Capabilities Panel */}
      <ModelCapabilitiesPanel
        nodeId={nodeId}
        overrides={data.modelCapabilities}
        discoveredModel={discoveredModel}
        resolved={resolvedCapabilities}
        onUpdateCapabilities={updateCapabilities}
        onClearCapability={clearCapability}
        onUpdateCost={updateCost}
        onToggleInputModality={toggleInputModality}
      />

      <Field label="Thinking Level">
        <select
          className={selectClass}
          value={data.thinkingLevel}
          disabled={!resolvedCapabilities.reasoningSupported}
          title={
            !resolvedCapabilities.reasoningSupported
              ? 'This model does not support extended reasoning'
              : undefined
          }
          onChange={(e) =>
            update(nodeId, { thinkingLevel: e.target.value as ThinkingLevel })
          }
        >
          {THINKING_LEVELS.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </Field>

      <Field label="System Prompt Mode">
        <select
          aria-label="System Prompt Mode"
          className={selectClass}
          value={systemPromptMode}
          onChange={(e) =>
            update(nodeId, { systemPromptMode: e.target.value as any })
          }
        >
          <option value="append">Append (add your instructions)</option>
          <option value="manual">Manual (full control)</option>
        </select>
      </Field>

      {/* Append mode: summary + textarea */}
      {systemPromptMode === 'append' && (
        <>
          <div className="rounded-md border border-slate-800 bg-slate-900/40 p-3">
            <p className="text-[10px] text-slate-500 italic">
              App-built sections are injected first. Your instructions are appended at the end.
            </p>
            <button
              onClick={() => setShowPreview(true)}
              className="mt-1 text-[10px] text-blue-400 hover:text-blue-300 transition"
            >
              View full prompt
            </button>
          </div>
          <Field label="Your Instructions">
            <textarea
              aria-label="Your Instructions"
              className={textareaClass}
              rows={6}
              value={data.systemPrompt}
              onChange={(e) => update(nodeId, { systemPrompt: e.target.value })}
              placeholder="Additional instructions appended after app-built sections..."
            />
          </Field>
        </>
      )}

      {/* Manual mode: warning + full textarea */}
      {systemPromptMode === 'manual' && (
        <>
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="text-xs text-amber-300/90">
              You are fully responsible for the system prompt. No safety guardrails, tooling, workspace, or runtime metadata will be injected.
            </p>
          </div>
          <Field label="System Prompt">
            <textarea
              aria-label="System Prompt"
              className={textareaClass}
              rows={6}
              value={data.systemPrompt}
              onChange={(e) => update(nodeId, { systemPrompt: e.target.value })}
              placeholder="Your complete system prompt..."
            />
          </Field>
        </>
      )}

      <Field label="Show Reasoning">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.showReasoning ?? false}
            onChange={(e) => update(nodeId, { showReasoning: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-400">
            Forward model thinking/reasoning to the chat stream
          </span>
        </label>
      </Field>

      <Field label="Verbose Tool Output">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.verbose ?? false}
            onChange={(e) => update(nodeId, { verbose: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-400">
            Add tool result summaries to the chat stream
          </span>
        </label>
      </Field>

      {showPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="h-[80vh] w-[600px] rounded-lg border border-slate-700 bg-slate-900 shadow-xl overflow-hidden">
            <SystemPromptPreview
              agentNodeId={nodeId}
              onClose={() => setShowPreview(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
