import { useMemo, useState, useEffect } from 'react';
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

function CostInput({ value, onChange, placeholder }: { value: number, onChange: (val: string) => void, placeholder?: string }) {
  const [localVal, setLocalVal] = useState(() => value === 0 ? '' : Number((value * 1e6).toPrecision(6)).toString());
  
  useEffect(() => {
    const propsVal = Number((value * 1e6).toPrecision(6));
    const localNum = Number(localVal) || 0;
    if (Math.abs(localNum - propsVal) > 1e-9) {
      setLocalVal(propsVal === 0 ? '' : propsVal.toString());
    }
  }, [value]);

  return (
    <input
      className={inputClass}
      type="number"
      step="any"
      value={localVal}
      onChange={(e) => {
        setLocalVal(e.target.value);
        onChange(e.target.value);
      }}
      placeholder={placeholder}
    />
  );
}

const THINKING_LEVELS: ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
];

const CUSTOM_MODEL_VALUE = '__custom__';

interface Props {
  nodeId: string;
  data: AgentNodeData;
}

function getModelOptions(provider: string, discovered: string[]) {
  return [...new Set([...(STATIC_MODELS[provider] || []), ...discovered])];
}

function getCustomModelPlaceholder(provider: string) {
  if (provider === 'openrouter') {
    return 'xiaomi/mimo-v2-pro';
  }
  return 'provider-specific-model-id';
}

function parseOptionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function emptyCost(): ModelCostInfo {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };
}

export default function AgentProperties({ nodeId, data }: Props) {
  const [showPreview, setShowPreview] = useState(false);
  const update = useGraphStore((s) => s.updateNodeData);
  const openRouterModels = useModelCatalogStore((s) => s.models.openrouter);

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

  const resolveCapabilitiesForModel = (provider: string, modelId: string): ModelCapabilityOverrides => {
    let discovered: DiscoveredModelMetadata | undefined;
    if (provider === 'openrouter') {
      discovered = openRouterModels[modelId];
    }
    
    // For non-openrouter or undiscovered models, fall back to what we can guess
    return {
      reasoningSupported: discovered?.reasoningSupported ?? false,
      inputModalities: discovered?.inputModalities ?? ['text'],
      contextWindow: discovered?.contextWindow,
      maxTokens: discovered?.maxTokens,
      cost: discovered?.cost ?? emptyCost()
    };
  };

  const resolvedCapabilities = {
    reasoningSupported:
      data.modelCapabilities.reasoningSupported ??
      discoveredModel?.reasoningSupported ??
      false,
    inputModalities:
      data.modelCapabilities.inputModalities ??
      discoveredModel?.inputModalities ??
      ['text'],
    contextWindow:
      data.modelCapabilities.contextWindow ?? discoveredModel?.contextWindow,
    maxTokens: data.modelCapabilities.maxTokens ?? discoveredModel?.maxTokens,
    cost: data.modelCapabilities.cost ?? discoveredModel?.cost ?? emptyCost(),
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
            const models = STATIC_MODELS[provider] || [];
            const newModelId = models[0] || '';
            update(nodeId, {
              provider,
              modelId: newModelId,
              modelCapabilities: resolveCapabilitiesForModel(provider, newModelId),
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
        <div className="space-y-2">
          <select
            className={selectClass}
            value={isCustomModel ? CUSTOM_MODEL_VALUE : data.modelId}
            onChange={(e) => {
              if (e.target.value === CUSTOM_MODEL_VALUE) {
                update(nodeId, { modelId: '' });
                return;
              }

              const newModelId = e.target.value;
              update(nodeId, {
                modelId: newModelId,
                modelCapabilities: resolveCapabilitiesForModel(data.provider, newModelId),
              });
            }}
          >
            {availableModels.map((modelId) => (
              <option key={modelId} value={modelId}>
                {modelId}
              </option>
            ))}
            <option value={CUSTOM_MODEL_VALUE}>Custom model...</option>
          </select>

          {isCustomModel && (
            <>
              <input
                className={inputClass}
                value={data.modelId}
                onChange={(e) => update(nodeId, { modelId: e.target.value })}
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

      <Field label="Model Capabilities" tooltip="Metadata describing what the selected model supports. These values are auto-filled from discovered model info when available, but you can override them per agent.">
        <div className="space-y-3 rounded-md border border-slate-800 bg-slate-900/40 p-3">
          <p className="text-[10px] text-slate-500">
            These fields use discovered/default values until you override them
            for this agent.
          </p>

          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={resolvedCapabilities.reasoningSupported}
                onChange={(e) =>
                  updateCapabilities({
                    reasoningSupported: e.target.checked,
                  })
                }
              />
              Supports reasoning
              <Tooltip text="Whether the model supports chain-of-thought reasoning (e.g. extended thinking). Enables the Thinking Level setting when checked.">
                <span className="cursor-help text-slate-500 hover:text-slate-300">?</span>
              </Tooltip>
            </label>
            {data.modelCapabilities.reasoningSupported !== undefined && (
              <button
                type="button"
                className="text-[10px] text-slate-500 hover:text-slate-300"
                onClick={() => clearCapability('reasoningSupported')}
              >
                Use default
              </button>
            )}
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1 text-xs text-slate-300">
                Input modalities
                <Tooltip text="The types of input the model can process. 'text' is always supported. 'image' enables sending images and screenshots in chat.">
                  <span className="cursor-help text-slate-500 hover:text-slate-300">?</span>
                </Tooltip>
              </span>
              {data.modelCapabilities.inputModalities !== undefined && (
                <button
                  type="button"
                  className="text-[10px] text-slate-500 hover:text-slate-300"
                  onClick={() => clearCapability('inputModalities')}
                >
                  Use default
                </button>
              )}
            </div>
            <div className="flex gap-4">
              {(['text', 'image'] as ModelInputModality[]).map((modality) => (
                <label
                  key={modality}
                  className="flex items-center gap-2 text-xs text-slate-400"
                >
                  <input
                    type="checkbox"
                    checked={resolvedCapabilities.inputModalities.includes(
                      modality,
                    )}
                    onChange={(e) =>
                      toggleInputModality(modality, e.target.checked)
                    }
                  />
                  {modality}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1 text-xs text-slate-300">
                Context window
                <Tooltip text="The maximum number of tokens the model can receive as input (prompt + conversation history). Used by the context engine to decide when to compact history.">
                  <span className="cursor-help text-slate-500 hover:text-slate-300">?</span>
                </Tooltip>
              </span>
              {data.modelCapabilities.contextWindow !== undefined && (
                <button
                  type="button"
                  className="text-[10px] text-slate-500 hover:text-slate-300"
                  onClick={() => clearCapability('contextWindow')}
                >
                  Use default
                </button>
              )}
            </div>
            <input
              className={inputClass}
              type="number"
              value={resolvedCapabilities.contextWindow ?? ''}
              onChange={(e) =>
                updateCapabilities({
                  contextWindow: parseOptionalNumber(e.target.value),
                })
              }
              placeholder="Context window"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1 text-xs text-slate-300">
                Max tokens
                <Tooltip text="The maximum number of tokens the model can generate in a single response. Limits output length to control cost and response time.">
                  <span className="cursor-help text-slate-500 hover:text-slate-300">?</span>
                </Tooltip>
              </span>
              {data.modelCapabilities.maxTokens !== undefined && (
                <button
                  type="button"
                  className="text-[10px] text-slate-500 hover:text-slate-300"
                  onClick={() => clearCapability('maxTokens')}
                >
                  Use default
                </button>
              )}
            </div>
            <input
              className={inputClass}
              type="number"
              value={resolvedCapabilities.maxTokens ?? ''}
              onChange={(e) =>
                updateCapabilities({
                  maxTokens: parseOptionalNumber(e.target.value),
                })
              }
              placeholder="Max tokens"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1 text-xs text-slate-300">
                Cost metadata
                <Tooltip text="Token pricing used to estimate conversation cost in the chat panel. Values are in dollars per 1 million tokens. Cache pricing applies when prompt caching is supported.">
                  <span className="cursor-help text-slate-500 hover:text-slate-300">?</span>
                </Tooltip>
              </span>
              {data.modelCapabilities.cost !== undefined && (
                <button
                  type="button"
                  className="text-[10px] text-slate-500 hover:text-slate-300"
                  onClick={() => clearCapability('cost')}
                >
                  Use default
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400">Input (per 1M)</label>
                <CostInput
                  value={resolvedCapabilities.cost.input}
                  onChange={(val) => updateCost('input', val)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400">Output (per 1M)</label>
                <CostInput
                  value={resolvedCapabilities.cost.output}
                  onChange={(val) => updateCost('output', val)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400">Cache Read (per 1M)</label>
                <CostInput
                  value={resolvedCapabilities.cost.cacheRead}
                  onChange={(val) => updateCost('cacheRead', val)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400">Cache Write (per 1M)</label>
                <CostInput
                  value={resolvedCapabilities.cost.cacheWrite}
                  onChange={(val) => updateCost('cacheWrite', val)}
                  placeholder="0.00"
                />
              </div>
            </div>
          </div>
        </div>
      </Field>

      <Field label="Thinking Level">
        <select
          className={selectClass}
          value={data.thinkingLevel}
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
          value={data.systemPromptMode ?? 'auto'}
          onChange={(e) =>
            update(nodeId, { systemPromptMode: e.target.value as any })
          }
        >
          <option value="auto">Auto (app-managed)</option>
          <option value="append">Append (add your instructions)</option>
          <option value="manual">Manual (full control)</option>
        </select>
      </Field>

      {/* Auto mode: read-only summary */}
      {(data.systemPromptMode ?? 'auto') === 'auto' && (
        <div className="rounded-md border border-slate-800 bg-slate-900/40 p-3">
          <p className="text-[10px] text-slate-500 italic">
            System prompt is built automatically from connected nodes and app settings.
          </p>
          <button
            onClick={() => setShowPreview(true)}
            className="mt-1 text-[10px] text-blue-400 hover:text-blue-300 transition"
          >
            View full prompt
          </button>
        </div>
      )}

      {/* Append mode: summary + textarea */}
      {(data.systemPromptMode ?? 'auto') === 'append' && (
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
      {(data.systemPromptMode ?? 'auto') === 'manual' && (
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
