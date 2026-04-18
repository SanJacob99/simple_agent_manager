import { useEffect, useMemo, useState } from 'react';
import { useGraphStore } from '../../store/graph-store';
import {
  buildProviderCatalogKey,
  useModelCatalogStore,
} from '../../store/model-catalog-store';
import type { AgentNodeData, ThinkingLevel } from '../../types/nodes';
import type {
  DiscoveredModelMetadata,
  ModelCapabilityOverrides,
  ModelCostInfo,
  ModelInputModality,
} from '../../types/model-metadata';
import ProviderModelPicker from '../../components/model-picker/ProviderModelPicker';
import {
  getModelOptions,
} from '../../components/model-picker/provider-model-utils';
import { Field, inputClass, selectClass, textareaClass } from './shared';
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
  const update = useGraphStore((s) => s.updateNodeData);
  const edges = useGraphStore((s) => s.edges);
  const allNodes = useGraphStore((s) => s.nodes);
  const modelsByKey = useModelCatalogStore((s) => s.models);
  const connectedPluginId = useMemo(() => {
    const incomingEdges = edges.filter((edge) => edge.target === nodeId);
    for (const edge of incomingEdges) {
      const source = allNodes.find((node) => node.id === edge.source);
      if (source?.data.type === 'provider') {
        return source.data.pluginId as string;
      }
    }
    return '';
  }, [allNodes, edges, nodeId]);
  const connectedBaseUrl = useMemo(() => {
    const incomingEdges = edges.filter((edge) => edge.target === nodeId);
    for (const edge of incomingEdges) {
      const source = allNodes.find((node) => node.id === edge.source);
      if (source?.data.type === 'provider') {
        return source.data.baseUrl as string;
      }
    }
    return '';
  }, [allNodes, edges, nodeId]);
  const catalogKey = useMemo(
    () =>
      buildProviderCatalogKey({
        pluginId: connectedPluginId,
        baseUrl: connectedBaseUrl,
      }),
    [connectedBaseUrl, connectedPluginId],
  );
  const providerModels = useMemo(
    () => modelsByKey[catalogKey] ?? {},
    [catalogKey, modelsByKey],
  );

  const discoveredModels = useMemo(
    () => Object.keys(providerModels),
    [providerModels],
  );
  const discoveredModel =
    providerModels[data.modelId];

  const availableModels = useMemo(
    () => getModelOptions(connectedPluginId, discoveredModels),
    [connectedPluginId, discoveredModels],
  );

  const systemPromptMode = data.systemPromptMode === 'manual' ? 'manual' : 'append';

  useEffect(() => {
    if (data.systemPromptMode !== systemPromptMode) {
      update(nodeId, { systemPromptMode });
    }
  }, [data.systemPromptMode, nodeId, systemPromptMode, update]);

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
    const discovered: DiscoveredModelMetadata | undefined =
      providerModels[newModelId];
    const caps = snapshotCapabilities(discovered);
    update(nodeId, {
      modelId: newModelId,
      modelCapabilities: caps,
      ...(caps.reasoningSupported === false ? { thinkingLevel: 'off' } : {}),
    });
  };

  const commitManualModelId = () => {
    const trimmedModelId = data.modelId.trim();
    if (!trimmedModelId) return;
    if (providerModels[trimmedModelId]) {
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

      <Field label="Working Directory">
        <input
          className={inputClass}
          value={data.workingDirectory ?? ''}
          onChange={(e) => update(nodeId, { workingDirectory: e.target.value })}
          placeholder="Empty = server working directory"
        />
        <p className="mt-0.5 text-[9px] text-slate-600">
          Base directory for shell commands and workspace context.
        </p>
      </Field>

      <Field label="Model">
        <ProviderModelPicker
          provider={connectedPluginId}
          modelId={data.modelId}
          availableModels={availableModels}
          discoveredModels={providerModels}
          onSelectModel={applyModelSelection}
          onChangeManualModelId={(modelId) => update(nodeId, { modelId })}
          onCommitManualModelId={commitManualModelId}
          enableOpenRouterFilters
          inputClassName={inputClass}
        />
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
