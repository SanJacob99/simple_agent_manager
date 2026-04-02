import { useMemo, useState, useEffect } from 'react';
import { useGraphStore } from '../../store/graph-store';
import { useModelCatalogStore } from '../../store/model-catalog-store';
import type { AgentNodeData, ThinkingLevel } from '../../types/nodes';
import type {
  ModelCapabilityOverrides,
  ModelCostInfo,
  ModelInputModality,
} from '../../types/model-metadata';
import {
  PROVIDERS,
  STATIC_MODELS,
} from '../../runtime/provider-model-options';
import { Field, inputClass, selectClass, textareaClass } from './shared';

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
        <input
          className={inputClass}
          value={data.name}
          onChange={(e) => update(nodeId, { name: e.target.value })}
          placeholder="My Agent"
        />
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
            update(nodeId, {
              provider,
              modelId: models[0] || '',
              modelCapabilities: {},
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

              update(nodeId, {
                modelId: e.target.value,
                modelCapabilities: {},
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

      <Field label="Model Capabilities">
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
              <span className="text-xs text-slate-300">Input modalities</span>
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
              <span className="text-xs text-slate-300">Context window</span>
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
              <span className="text-xs text-slate-300">Max tokens</span>
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
              <span className="text-xs text-slate-300">Cost metadata</span>
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

      <Field label="System Prompt">
        <textarea
          className={textareaClass}
          rows={6}
          value={data.systemPrompt}
          onChange={(e) => update(nodeId, { systemPrompt: e.target.value })}
          placeholder="You are a helpful assistant..."
        />
      </Field>
    </div>
  );
}
