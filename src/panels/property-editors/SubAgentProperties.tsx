import { useMemo } from 'react';
import { useGraphStore } from '../../store/graph-store';
import {
  buildProviderCatalogKey,
  useModelCatalogStore,
} from '../../store/model-catalog-store';
import type {
  SubAgentNodeData,
  ThinkingLevel,
} from '../../types/nodes';
import {
  ALL_SUB_AGENT_OVERRIDABLE_FIELDS,
  SUB_AGENT_NAME_REGEX,
  type SubAgentOverridableField,
} from '../../../shared/sub-agent-types';
import { Field, inputClass, selectClass, textareaClass, Tooltip } from './shared';
import ProviderModelPicker from '../../components/model-picker/ProviderModelPicker';
import { getModelOptions } from '../../components/model-picker/provider-model-utils';

const THINKING_LEVELS: ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
];

const OVERRIDE_LABELS: Record<SubAgentOverridableField, string> = {
  modelId: 'modelId',
  thinkingLevel: 'thinkingLevel',
  systemPromptAppend: 'systemPromptAppend',
  enabledTools: 'enabledTools',
};

const OVERRIDE_TIPS: Record<SubAgentOverridableField, string> = {
  modelId:
    'Parent may pass a different modelId per spawn. Must resolve through the same provider.',
  thinkingLevel:
    'Parent may bump or trim reasoning effort per spawn. Bound by the model\'s capabilities.',
  systemPromptAppend:
    'Parent may append extra task-specific guidance to the sub-agent\'s base prompt.',
  enabledTools:
    'Parent may narrow the sub-agent\'s tools to a subset of the dedicated Tools node\'s effective tools.',
};

interface Props {
  nodeId: string;
  data: SubAgentNodeData;
}

export default function SubAgentProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const modelsByKey = useModelCatalogStore((s) => s.models);

  // The sub-agent is the *source* of one edge whose target is an agent node;
  // that target is its parent. Sub-agent nodes only attach to a single parent
  // in v1, so first match wins.
  const parentAgent = useMemo(() => {
    const parentEdge = edges.find((e) => e.source === nodeId);
    if (!parentEdge) return null;
    const target = nodes.find((n) => n.id === parentEdge.target);
    if (!target || target.data.type !== 'agent') return null;
    return target;
  }, [edges, nodes, nodeId]);

  // Peripherals attached to *this* sub-agent.
  const ownInputs = useMemo(() => {
    return edges
      .filter((e) => e.target === nodeId)
      .map((e) => nodes.find((n) => n.id === e.source))
      .filter((n): n is NonNullable<typeof n> => Boolean(n));
  }, [edges, nodes, nodeId]);

  const hasToolsNode = ownInputs.some((n) => n.data.type === 'tools');
  const dedicatedProvider = ownInputs.find((n) => n.data.type === 'provider');

  // Provider catalog: dedicated wins; else fall back to the parent's provider.
  const effectiveProvider = useMemo(() => {
    if (dedicatedProvider && dedicatedProvider.data.type === 'provider') {
      return {
        pluginId: dedicatedProvider.data.pluginId,
        baseUrl: dedicatedProvider.data.baseUrl,
        source: 'dedicated' as const,
      };
    }
    if (!parentAgent) return null;
    const parentProvider = edges
      .filter((e) => e.target === parentAgent.id)
      .map((e) => nodes.find((n) => n.id === e.source))
      .find((n) => n?.data.type === 'provider');
    if (!parentProvider || parentProvider.data.type !== 'provider') return null;
    return {
      pluginId: parentProvider.data.pluginId,
      baseUrl: parentProvider.data.baseUrl,
      source: 'inherited' as const,
    };
  }, [dedicatedProvider, edges, nodes, parentAgent]);

  const catalogKey = useMemo(() => {
    if (!effectiveProvider) return '';
    return buildProviderCatalogKey({
      pluginId: effectiveProvider.pluginId,
      baseUrl: effectiveProvider.baseUrl,
    });
  }, [effectiveProvider]);

  const providerModels = useMemo(
    () => modelsByKey[catalogKey] ?? {},
    [catalogKey, modelsByKey],
  );
  const discoveredModelIds = useMemo(
    () => Object.keys(providerModels),
    [providerModels],
  );
  const availableModels = useMemo(
    () => getModelOptions(effectiveProvider?.pluginId ?? '', discoveredModelIds),
    [effectiveProvider?.pluginId, discoveredModelIds],
  );

  const trimmedName = data.name?.trim() ?? '';
  const nameValid = trimmedName.length > 0 && SUB_AGENT_NAME_REGEX.test(trimmedName);
  const nameErrorMsg =
    trimmedName.length === 0
      ? 'Required. Lowercase, digits, hyphens, underscores. Must start with a letter.'
      : !nameValid
        ? 'Invalid: must match /^[a-z][a-z0-9_-]{0,31}$/.'
        : '';

  const toggleOverride = (field: SubAgentOverridableField, on: boolean) => {
    const current = new Set(data.overridableFields);
    if (on) {
      current.add(field);
    } else {
      current.delete(field);
    }
    update(nodeId, { overridableFields: [...current] });
  };

  const applyCustomModel = (modelId: string) => {
    update(nodeId, { modelId });
  };

  const showsCustomModelPicker = data.modelIdMode === 'custom';

  return (
    <div className="space-y-1">
      {/* Validation banner */}
      {!hasToolsNode && (
        <div className="mb-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
          <p className="text-[11px] text-amber-300/90">
            <strong>Required:</strong> attach a dedicated <code>Tools</code> node to this
            sub-agent. The runtime resolver will skip sub-agents that lack one.
          </p>
        </div>
      )}
      {!parentAgent && (
        <div className="mb-2 rounded-md border border-slate-700 bg-slate-900/60 p-2.5">
          <p className="text-[11px] text-slate-400">
            Connect this sub-agent to an Agent node. Until then it has no parent and
            won't appear in the resolved <code>AgentConfig</code>.
          </p>
        </div>
      )}

      <Field label="Name">
        <input
          className={inputClass}
          value={data.name}
          onChange={(e) => update(nodeId, { name: e.target.value })}
          placeholder="researcher"
        />
        {!nameValid && (
          <p className="mt-0.5 text-[10px] text-amber-400">{nameErrorMsg}</p>
        )}
      </Field>

      <Field label="Description">
        <input
          className={inputClass}
          value={data.description}
          onChange={(e) => update(nodeId, { description: e.target.value })}
          placeholder="What this sub-agent is for"
        />
      </Field>

      <Field label="System Prompt">
        <textarea
          className={textareaClass}
          rows={4}
          value={data.systemPrompt}
          onChange={(e) => update(nodeId, { systemPrompt: e.target.value })}
          placeholder="Sub-agent's base system prompt"
        />
      </Field>

      <Field label="Working Directory">
        <select
          className={selectClass}
          value={data.workingDirectoryMode}
          onChange={(e) =>
            update(nodeId, {
              workingDirectoryMode: e.target.value as 'derived' | 'custom',
            })
          }
        >
          <option value="derived">Derived: parent cwd / subagent / {trimmedName || '<name>'}</option>
          <option value="custom">Custom path</option>
        </select>
        {data.workingDirectoryMode === 'custom' && (
          <input
            className={`${inputClass} mt-2`}
            value={data.workingDirectory}
            onChange={(e) => update(nodeId, { workingDirectory: e.target.value })}
            placeholder="/absolute/or/relative/path"
          />
        )}
      </Field>

      <Field label="Model">
        <select
          className={selectClass}
          value={data.modelIdMode}
          onChange={(e) =>
            update(nodeId, { modelIdMode: e.target.value as 'inherit' | 'custom' })
          }
        >
          <option value="inherit">Inherit from parent agent</option>
          <option value="custom">Custom model</option>
        </select>
        {showsCustomModelPicker && (
          <div className="mt-2">
            {effectiveProvider ? (
              <>
                <ProviderModelPicker
                  provider={effectiveProvider.pluginId}
                  modelId={data.modelId}
                  availableModels={availableModels}
                  discoveredModels={providerModels}
                  onSelectModel={applyCustomModel}
                  onChangeManualModelId={(modelId) => update(nodeId, { modelId })}
                  onCommitManualModelId={() => {}}
                  enableOpenRouterFilters
                  inputClassName={inputClass}
                />
                <p className="mt-0.5 text-[9px] text-slate-600">
                  Provider source: {effectiveProvider.source} ({effectiveProvider.pluginId || '—'})
                </p>
              </>
            ) : (
              <>
                <input
                  className={inputClass}
                  value={data.modelId}
                  onChange={(e) => update(nodeId, { modelId: e.target.value })}
                  placeholder="provider/model-id"
                />
                <p className="mt-0.5 text-[10px] text-amber-400/80">
                  No provider in scope yet — connect one to the parent (or to this sub-agent)
                  to enable the model picker.
                </p>
              </>
            )}
          </div>
        )}
      </Field>

      <Field label="Thinking Level">
        <select
          className={selectClass}
          value={data.thinkingLevelMode}
          onChange={(e) =>
            update(nodeId, {
              thinkingLevelMode: e.target.value as 'inherit' | 'custom',
            })
          }
        >
          <option value="inherit">Inherit from parent</option>
          <option value="custom">Custom level</option>
        </select>
        {data.thinkingLevelMode === 'custom' && (
          <select
            className={`${selectClass} mt-2`}
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
        )}
      </Field>

      <Field label="Override Allowlist">
        <p className="mb-2 text-[10px] leading-snug text-slate-500">
          Fields the parent may override per spawn. Anything outside this set is
          rejected by <code>sessions_spawn</code>.
        </p>
        <div className="space-y-1.5">
          {ALL_SUB_AGENT_OVERRIDABLE_FIELDS.map((field) => {
            const checked = data.overridableFields.includes(field);
            return (
              <label key={field} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => toggleOverride(field, e.target.checked)}
                  className="mt-0.5 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
                />
                <Tooltip text={OVERRIDE_TIPS[field]}>
                  <span className="cursor-help text-xs text-slate-300 underline decoration-dotted decoration-slate-600 underline-offset-4">
                    {OVERRIDE_LABELS[field]}
                  </span>
                </Tooltip>
              </label>
            );
          })}
        </div>
      </Field>

      <Field label="Recursive Sub-Agents">
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={data.recursiveSubAgentsEnabled}
            onChange={(e) =>
              update(nodeId, { recursiveSubAgentsEnabled: e.target.checked })
            }
            className="mt-0.5 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">
            Allow this sub-agent to spawn its own sub-agents.
            <span className="block text-[10px] text-slate-500">
              Off by default. Recursion is disabled until product is ready.
            </span>
          </span>
        </label>
      </Field>
    </div>
  );
}
