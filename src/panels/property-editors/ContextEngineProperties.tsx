import { useMemo, useState } from 'react';
import { PieChart, Pie, Cell } from 'recharts';
import { useGraphStore } from '../../store/graph-store';
import type { ContextEngineNodeData, CompactionStrategy } from '../../types/nodes';
import { Field, Tooltip, inputClass, selectClass } from './shared';
import { useContextEngineSync } from '../../nodes/useContextEngineSync';
import {
  buildProviderCatalogKey,
  useModelCatalogStore,
} from '../../store/model-catalog-store';
import { useSessionStore } from '../../store/session-store';
import {
  selectContextUsage,
  useContextUsageStore,
} from '../../store/context-usage-store';
import { cssVar } from '../../utils/css-var';

const COMPACTION_STRATEGIES: CompactionStrategy[] = ['summary', 'sliding-window', 'trim-oldest'];
const COMPACTION_TRIGGERS = ['auto', 'manual', 'threshold'] as const;

const COMPACTION_STRATEGY_DESCRIPTIONS: Record<CompactionStrategy, string> = {
  summary: 'Keeps the most recent ~30% of messages and replaces the rest with a short text summary.',
  'sliding-window': 'Drops the oldest messages until the newest fit within the token budget. No summary is kept.',
  'trim-oldest': 'Removes oldest messages one-by-one until the conversation fits the budget.',
};

function strategyUsesSummary(s: CompactionStrategy): boolean {
  return s === 'summary';
}

const COMPACTION_DONUT_SIZE = 72;

/**
 * Compute the token count at which compaction is expected to fire for
 * the configured trigger mode. `auto` is hardcoded to 80% of the budget
 * to mirror the runtime behavior advertised below.
 */
function resolveCompactionTriggerTokens(data: ContextEngineNodeData): number {
  const budget = Math.max(0, data.tokenBudget);
  if (data.compactionTrigger === 'auto') {
    return Math.round(budget * 0.8);
  }
  if (data.compactionTrigger === 'threshold') {
    const ratio = Math.max(0, Math.min(1, data.compactionThreshold ?? 0));
    return Math.round(budget * ratio);
  }
  // 'manual': threshold stored as absolute token count.
  const tokens = Math.max(0, data.compactionThreshold ?? 0);
  return Math.min(tokens, budget);
}

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
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

  // Active chat session for the connected agent, if any. Drives the
  // "used so far" wedge on the compaction donut.
  const activeSessionKey = useSessionStore((s) =>
    connectedAgent ? s.activeSessionKey[connectedAgent.id] : undefined,
  );
  const sessionUsage = useContextUsageStore(selectContextUsage(activeSessionKey ?? null));
  const usedTokens = sessionUsage?.contextTokens;

  // "Compact now" state for the manual-trigger button. Scoped to the
  // property panel so it can drive both the button label and a tiny
  // result/error message inline.
  const storageClient = useSessionStore((s) =>
    connectedAgent ? s.storageEngines[connectedAgent.id] : undefined,
  );
  const [isCompacting, setIsCompacting] = useState(false);
  const [compactResult, setCompactResult] = useState<
    | { kind: 'ok'; messagesBefore: number; messagesAfter: number; tokensBefore: number; tokensAfter: number; compacted: boolean }
    | { kind: 'err'; message: string }
    | null
  >(null);

  const triggerManualCompaction = async () => {
    if (!storageClient || !activeSessionKey) return;
    setIsCompacting(true);
    setCompactResult(null);
    try {
      const result = await storageClient.compactSession(activeSessionKey);
      setCompactResult({ kind: 'ok', ...result });
    } catch (err) {
      setCompactResult({
        kind: 'err',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsCompacting(false);
    }
  };

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
        <>
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

          <Field label="Compact Now">
            <button
              type="button"
              disabled={!storageClient || !activeSessionKey || isCompacting}
              onClick={triggerManualCompaction}
              className="w-full rounded border border-blue-600/60 bg-blue-600/20 px-2 py-1 text-xs text-blue-200 hover:bg-blue-600/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isCompacting
                ? 'Compacting…'
                : `Run ${data.compactionStrategy} compaction → ${data.postCompactionTokenTarget.toLocaleString()} tokens`}
            </button>
            {!activeSessionKey && (
              <p className="mt-0.5 text-[10px] text-slate-600">
                Open a chat session on the connected agent to enable manual compaction.
              </p>
            )}
            {compactResult?.kind === 'ok' && (
              <p className="mt-0.5 text-[10px] text-slate-500">
                {compactResult.compacted
                  ? `Compacted ${compactResult.messagesBefore} → ${compactResult.messagesAfter} messages (${compactResult.tokensBefore.toLocaleString()} → ${compactResult.tokensAfter.toLocaleString()} tokens).`
                  : 'Nothing to compact — history already fits the target.'}
              </p>
            )}
            {compactResult?.kind === 'err' && (
              <p className="mt-0.5 text-[10px] text-red-400">
                {compactResult.message}
              </p>
            )}
          </Field>
        </>
      )}

      {data.compactionTrigger === 'auto' && (
        <p className="mb-3 text-[10px] text-slate-600 italic">
          Compaction runs automatically when the context window reaches 80% capacity.
        </p>
      )}

      <Field label="Token Target After Compaction">
        <input
          className={inputClass}
          type="number"
          min={512}
          step={1024}
          max={Math.max(512, data.tokenBudget - data.reservedForResponse)}
          value={data.postCompactionTokenTarget}
          onChange={(e) =>
            update(nodeId, {
              postCompactionTokenTarget: parseInt(e.target.value) || 50000,
            })
          }
        />
        <p className="mt-0.5 text-[10px] text-slate-600">
          Size the assembled context should land at after compaction runs. Lower values
          free more headroom but may drop earlier turns. Capped at
          {' '}
          {(data.tokenBudget - data.reservedForResponse).toLocaleString()}
          {' '}
          tokens (budget minus reserved response).
        </p>
      </Field>

      <CompactionBudgetDonut data={data} usedTokens={usedTokens} />

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

    </div>
  );
}

/**
 * Small donut that visualizes how much of the token budget is usable
 * before compaction fires, how much sits in the "compaction zone" past
 * the trigger, and — when an active chat session exists on the
 * connected agent — how much of that budget the session has already
 * consumed.
 *
 * Slices (in angular order, going clockwise from 12 o'clock):
 *   1. Used, below trigger   (solid blue)   -- only when usedTokens > 0
 *   2. Unused, below trigger (muted slate) -- the remaining headroom
 *   3. Used, above trigger   (solid red)   -- only when session has
 *                                             already crossed the
 *                                             compaction threshold
 *   4. Unused, above trigger (amber)       -- the compaction zone that
 *                                             the session hasn't eaten
 *                                             into yet
 */
function CompactionBudgetDonut({
  data,
  usedTokens,
}: {
  data: ContextEngineNodeData;
  usedTokens: number | undefined;
}) {
  const budget = Math.max(0, data.tokenBudget);
  const triggerTokens = resolveCompactionTriggerTokens(data);
  const preCompaction = Math.min(triggerTokens, budget);
  const compactionZone = Math.max(0, budget - preCompaction);
  const triggerPct = budget > 0 ? Math.round((preCompaction / budget) * 100) : 0;

  const hasSession = typeof usedTokens === 'number';
  const used = Math.max(0, Math.min(usedTokens ?? 0, budget));
  const usedPre = Math.min(used, preCompaction);
  const usedOver = Math.max(0, used - preCompaction);
  const unusedPre = Math.max(0, preCompaction - usedPre);
  const unusedOver = Math.max(0, compactionZone - usedOver);

  const usedPctOfBudget = budget > 0 ? Math.round((used / budget) * 100) : 0;
  const usedPctOfTrigger = preCompaction > 0
    ? Math.round((used / preCompaction) * 100)
    : 0;
  const crossedTrigger = used > preCompaction;

  const chartData = useMemo(() => {
    const usedColor = cssVar('--c-blue-500');
    const unusedPreColor = cssVar('--c-slate-700');
    const usedOverColor = cssVar('--c-red-500');
    const unusedOverColor = cssVar('--c-amber-500');
    const emptyColor = cssVar('--c-slate-900');

    const slices: Array<{ name: string; value: number; color: string }> = [];
    if (usedPre > 0) slices.push({ name: 'Used (before trigger)', value: usedPre, color: usedColor });
    if (unusedPre > 0) slices.push({ name: 'Unused (before trigger)', value: unusedPre, color: unusedPreColor });
    if (usedOver > 0) slices.push({ name: 'Used (past trigger)', value: usedOver, color: usedOverColor });
    if (unusedOver > 0) slices.push({ name: 'Compaction zone', value: unusedOver, color: unusedOverColor });
    if (slices.length === 0) slices.push({ name: 'Empty', value: 1, color: emptyColor });
    return slices;
  }, [usedPre, unusedPre, usedOver, unusedOver]);

  // Center numeral:
  //   - with a session: show % of budget used (matches the chat panel)
  //   - without a session: show the static trigger %
  const centerLabel = hasSession ? `${usedPctOfBudget}%` : `${triggerPct}%`;
  const centerColor = !hasSession
    ? 'var(--c-slate-300)'
    : crossedTrigger
      ? 'var(--c-red-400)'
      : usedPctOfTrigger > 50
        ? 'var(--c-amber-400)'
        : 'var(--c-slate-300)';

  return (
    <div className="mt-1 mb-2 flex items-center gap-3 rounded border border-slate-800/60 bg-slate-900/40 px-2 py-1.5">
      <div className="relative flex-shrink-0" style={{ width: COMPACTION_DONUT_SIZE, height: COMPACTION_DONUT_SIZE }}>
        <PieChart width={COMPACTION_DONUT_SIZE} height={COMPACTION_DONUT_SIZE}>
          <Pie
            data={chartData}
            dataKey="value"
            cx="50%"
            cy="50%"
            innerRadius={22}
            outerRadius={34}
            startAngle={90}
            endAngle={-270}
            strokeWidth={0}
            isAnimationActive={false}
          >
            {chartData.map((entry, i) => (
              <Cell key={`cell-${i}`} fill={entry.color} />
            ))}
          </Pie>
        </PieChart>
        <span
          className="absolute inset-0 flex items-center justify-center text-[10px] font-bold tabular-nums"
          style={{ color: centerColor }}
          title={hasSession ? 'Active session usage / token budget' : 'Compaction triggers at this % of budget'}
        >
          {centerLabel}
        </span>
      </div>
      <div className="flex-1 min-w-0 text-[10px] leading-tight">
        <div className="font-semibold text-slate-300">
          {hasSession ? 'Session vs. compaction trigger' : 'Compaction trigger'}
        </div>
        {hasSession && (
          <div className="flex items-center gap-1 text-slate-500">
            <span
              className="h-2 w-2 rounded-sm flex-shrink-0"
              style={{ backgroundColor: crossedTrigger ? cssVar('--c-red-500') : cssVar('--c-blue-500') }}
            />
            <span>
              Used: {formatTokenCount(used)}
              {preCompaction > 0 && (
                <span className="text-slate-600"> ({usedPctOfTrigger}% of trigger)</span>
              )}
            </span>
          </div>
        )}
        <div className="flex items-center gap-1 text-slate-500">
          <span
            className="h-2 w-2 rounded-sm flex-shrink-0"
            style={{ backgroundColor: cssVar(hasSession ? '--c-slate-700' : '--c-blue-500') }}
          />
          <span>Before: {formatTokenCount(preCompaction)}</span>
        </div>
        <div className="flex items-center gap-1 text-slate-500">
          <span className="h-2 w-2 rounded-sm flex-shrink-0" style={{ backgroundColor: cssVar('--c-amber-500') }} />
          <span>Compaction zone: {formatTokenCount(compactionZone)}</span>
        </div>
        <div className="text-slate-600 text-[9px] mt-0.5">
          Budget: {formatTokenCount(budget)} tokens
          {!hasSession && ' · no active session'}
        </div>
      </div>
    </div>
  );
}
