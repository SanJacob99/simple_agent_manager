import { useMemo } from 'react';
import { useGraphStore } from '../../store/graph-store';
import type { ContextEngineNodeData, CompactionStrategy } from '../../types/nodes';
import { Field, Tooltip, inputClass, selectClass } from './shared';
import { useContextEngineSync } from '../../nodes/useContextEngineSync';
import {
  buildProviderCatalogKey,
  useModelCatalogStore,
} from '../../store/model-catalog-store';

const COMPACTION_STRATEGIES: CompactionStrategy[] = ['summary', 'sliding-window', 'trim-oldest', 'hybrid'];
const COMPACTION_TRIGGERS = ['auto', 'manual', 'threshold'] as const;

const COMPACTION_STRATEGY_DESCRIPTIONS: Record<CompactionStrategy, string> = {
  summary: 'Keeps the most recent ~30% of messages and replaces the rest with a short text summary.',
  'sliding-window': 'Drops the oldest messages until the newest fit within the token budget. No summary is kept.',
  'trim-oldest': 'Removes oldest messages one-by-one until the conversation fits the budget.',
  hybrid: 'Same behavior as summary today: keep recent turns, summarize older ones.',
};

function strategyUsesSummary(s: CompactionStrategy): boolean {
  return s === 'summary' || s === 'hybrid';
}

interface Props {
  nodeId: string;
  data: ContextEngineNodeData;
}

export default function ContextEngineProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);
  const edges = useGraphStore((s) => s.edges);
  const nodes = useGraphStore((s) => s.nodes);
  const modelsByKey = useModelCatalogStore((s) => s.models);
  const { connectedAgent, modelId, modelContextWindow } = useContextEngineSync(nodeId, data);

  // Find the provider node attached to the connected agent, so the summary
  // model picker can offer that provider's discovered models.
  const agentProviderCatalogKey = useMemo(() => {
    if (!connectedAgent) return '';
    const providerNode = edges
      .filter((e) => e.target === connectedAgent.id)
      .map((e) => nodes.find((n) => n.id === e.source))
      .find((n) => n?.data.type === 'provider');
    if (!providerNode || providerNode.data.type !== 'provider') return '';
    return buildProviderCatalogKey({
      pluginId: providerNode.data.pluginId,
      baseUrl: providerNode.data.baseUrl,
    });
  }, [connectedAgent, edges, nodes]);

  const providerModelIds = useMemo(() => {
    if (!agentProviderCatalogKey) return [] as string[];
    return Object.keys(modelsByKey[agentProviderCatalogKey] ?? {});
  }, [agentProviderCatalogKey, modelsByKey]);

  const showSummaryModel = strategyUsesSummary(data.compactionStrategy);
  const summaryModelId = data.summaryModelId ?? '';

  return (
    <div className="space-y-1">
      <Field label="Label">
        <input
          className={inputClass}
          value={data.label}
          onChange={(e) => update(nodeId, { label: e.target.value })}
        />
      </Field>

      {/* Token Budget — inherited from model */}
      <Field label="Token Budget">
        {modelContextWindow ? (
          <>
            <div className={`${inputClass} flex items-center justify-between bg-slate-800/60 cursor-default`}>
              <span>{data.tokenBudget.toLocaleString()}</span>
              <span className="text-[9px] text-blue-400 font-medium">inherited</span>
            </div>
            <p className="mt-0.5 text-[10px] text-slate-600">
              From {modelId} ({modelContextWindow.toLocaleString()} tokens)
            </p>
          </>
        ) : connectedAgent ? (
          <>
            <input
              className={inputClass}
              type="number"
              min={1024}
              step={1024}
              value={data.tokenBudget}
              onChange={(e) =>
                update(nodeId, { tokenBudget: parseInt(e.target.value) || 128000 })
              }
            />
            <p className="mt-0.5 text-[10px] text-amber-500/80">
              Model metadata unavailable — set manually
            </p>
          </>
        ) : (
          <>
            <input
              className={inputClass}
              type="number"
              min={1024}
              step={1024}
              value={data.tokenBudget}
              onChange={(e) =>
                update(nodeId, { tokenBudget: parseInt(e.target.value) || 128000 })
              }
            />
            <p className="mt-0.5 text-[10px] text-slate-600">
              Connect to an agent to inherit from model
            </p>
          </>
        )}
      </Field>

      <Field label="Reserved for Response">
        <input
          className={inputClass}
          type="number"
          min={256}
          step={256}
          value={data.reservedForResponse}
          onChange={(e) =>
            update(nodeId, { reservedForResponse: parseInt(e.target.value) || 4096 })
          }
        />
      </Field>

      {/* Compaction */}
      <Field label="Compaction Strategy">
        <select
          className={selectClass}
          value={data.compactionStrategy}
          onChange={(e) =>
            update(nodeId, { compactionStrategy: e.target.value as CompactionStrategy })
          }
        >
          {COMPACTION_STRATEGIES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <p className="mt-0.5 text-[10px] text-slate-600">
          {COMPACTION_STRATEGY_DESCRIPTIONS[data.compactionStrategy]}
        </p>
      </Field>

      {showSummaryModel && (
        <Field label="Summary Model">
          <input
            className={inputClass}
            list={`summary-model-options-${nodeId}`}
            value={summaryModelId}
            placeholder={modelId ? `Inherit from agent (${modelId})` : 'Inherit from agent'}
            onChange={(e) => update(nodeId, { summaryModelId: e.target.value })}
          />
          {providerModelIds.length > 0 && (
            <datalist id={`summary-model-options-${nodeId}`}>
              {providerModelIds.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          )}
          <p className="mt-0.5 text-[10px] text-slate-600">
            Leave empty to use the agent's own model. Set a different model id to delegate summarization.
          </p>
        </Field>
      )}

      <Field label="Compaction Trigger">
        <select
          className={selectClass}
          value={data.compactionTrigger}
          onChange={(e) => update(nodeId, { compactionTrigger: e.target.value })}
        >
          {COMPACTION_TRIGGERS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </Field>

      {/* Threshold input — depends on trigger type */}
      {data.compactionTrigger === 'threshold' && (
        <Field label="Compaction Threshold (0-1)">
          <input
            className={inputClass}
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={data.compactionThreshold}
            onChange={(e) =>
              update(nodeId, { compactionThreshold: parseFloat(e.target.value) || 0.8 })
            }
          />
          <p className="mt-0.5 text-[10px] text-slate-600">
            Ratio of token budget usage that triggers compaction
          </p>
        </Field>
      )}

      {data.compactionTrigger === 'manual' && (
        <Field label="Compaction Token Limit">
          <input
            className={inputClass}
            type="number"
            min={0}
            step={1024}
            value={data.compactionThreshold}
            onChange={(e) =>
              update(nodeId, { compactionThreshold: parseFloat(e.target.value) || 0 })
            }
          />
          <p className="mt-0.5 text-[10px] text-slate-600">
            Number of tokens after which to compact when triggered
          </p>
        </Field>
      )}

      {data.compactionTrigger === 'auto' && (
        <p className="mb-3 text-[10px] text-slate-600 italic">
          Compaction runs automatically when the context window reaches 80% capacity.
        </p>
      )}

      <Field label="Owns Compaction">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.ownsCompaction}
            onChange={(e) => update(nodeId, { ownsCompaction: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <Tooltip text="When enabled, the Context Engine takes full control of compaction. No other node (e.g. Memory) will trigger its own compaction — all history trimming and summarization is managed here.">
            <span className="text-xs text-slate-300 underline decoration-dotted decoration-slate-600 underline-offset-4 cursor-help">
              Engine controls all compaction
            </span>
          </Tooltip>
        </label>
      </Field>

      <Field label="Auto-Flush Before Compact">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.autoFlushBeforeCompact}
            onChange={(e) => update(nodeId, { autoFlushBeforeCompact: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <Tooltip text="Before compaction starts, all pending tool results and buffered messages are flushed into the conversation. This ensures no in-flight data is lost when history is trimmed or summarized.">
            <span className="text-xs text-slate-300 underline decoration-dotted decoration-slate-600 underline-offset-4 cursor-help">
              Flush pending writes before compacting
            </span>
          </Tooltip>
        </label>
      </Field>

      {/* RAG */}
      <Field label="RAG Integration">
        <div className="space-y-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={data.ragEnabled}
              onChange={(e) => update(nodeId, { ragEnabled: e.target.checked })}
              className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
            />
            <Tooltip text="Retrieval-Augmented Generation injects relevant document chunks into the context before each prompt. Requires a connected Vector Database node to search against.">
              <span className="text-xs text-slate-300 underline decoration-dotted decoration-slate-600 underline-offset-4 cursor-help">
                Enable RAG retrieval
              </span>
            </Tooltip>
          </label>
          {data.ragEnabled && (
            <>
              <div>
                <label className="text-[10px] text-slate-500">Top K results</label>
                <input
                  className={inputClass}
                  type="number"
                  min={1}
                  max={50}
                  value={data.ragTopK}
                  onChange={(e) =>
                    update(nodeId, { ragTopK: parseInt(e.target.value) || 5 })
                  }
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500">Min similarity score</label>
                <input
                  className={inputClass}
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={data.ragMinScore}
                  onChange={(e) =>
                    update(nodeId, { ragMinScore: parseFloat(e.target.value) || 0.7 })
                  }
                />
              </div>
            </>
          )}
        </div>
      </Field>

      {/* Bootstrap Limits */}
      <Field label="Bootstrap Limits">
        <Tooltip text="Controls how much workspace bootstrap file content is injected into the system prompt. Per-file limit truncates individual files; total limit caps cumulative content across all files.">
          <span className="mb-1.5 inline-block text-[10px] text-slate-500 underline decoration-dotted decoration-slate-600 underline-offset-4 cursor-help">
            What are these?
          </span>
        </Tooltip>
        <div className="space-y-2">
          <div>
            <label className="text-[10px] text-slate-500">Max chars per file</label>
            <input
              className={inputClass}
              type="number"
              min={1000}
              step={1000}
              value={data.bootstrapMaxChars}
              onChange={(e) =>
                update(nodeId, { bootstrapMaxChars: parseInt(e.target.value) || 20000 })
              }
            />
          </div>
          <div>
            <label className="text-[10px] text-slate-500">Max total chars (all files)</label>
            <input
              className={inputClass}
              type="number"
              min={1000}
              step={5000}
              value={data.bootstrapTotalMaxChars}
              onChange={(e) =>
                update(nodeId, { bootstrapTotalMaxChars: parseInt(e.target.value) || 150000 })
              }
            />
          </div>
        </div>
      </Field>
    </div>
  );
}
