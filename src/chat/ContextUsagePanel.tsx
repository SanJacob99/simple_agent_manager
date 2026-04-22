import { useMemo } from 'react';
import { PieChart, Pie, Cell } from 'recharts';
import type { ContextWindowInfo, ContextSource } from './useContextWindow';
import type { ContextUsage } from '../../shared/context-usage';
import { cssVar } from '../utils/css-var';

interface ContextUsagePanelProps {
  contextInfo: ContextWindowInfo;
  usage: ContextUsage | undefined;
}

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}

function sourceLabel(source: ContextSource): string {
  switch (source) {
    case 'override': return 'override';
    case 'catalog': return 'catalog';
    case 'default': return 'default 128K';
  }
}

function kindLabel(source: ContextUsage['source'] | undefined): string | null {
  if (!source) return null;
  switch (source) {
    case 'actual': return null;      // no badge -- ground truth is default
    case 'preview': return 'preview';
    case 'persisted': return 'last known';
  }
}

const MINI_DONUT_SIZE = 36;

export default function ContextUsagePanel({
  contextInfo,
  usage,
}: ContextUsagePanelProps) {
  const usedTokens = usage?.contextTokens ?? 0;
  const contextWindow = usage?.contextWindow ?? contextInfo.contextWindow;
  const lastTurnUsage = usage?.usage;

  const available = Math.max(0, contextWindow - usedTokens);
  const usedPercent = contextWindow > 0
    ? Math.round((usedTokens / contextWindow) * 100)
    : 0;

  const chartData = useMemo(() => {
    const usedColor = cssVar('--c-blue-500');
    const availableColor = cssVar('--c-slate-800');
    const emptyColor = cssVar('--c-slate-900');
    const data = [];
    if (usedTokens > 0) {
      data.push({ name: 'Used', value: usedTokens, color: usedColor });
    }
    if (available > 0) {
      data.push({ name: 'Available', value: available, color: availableColor });
    }
    if (data.length === 0) {
      data.push({ name: 'Empty', value: 1, color: emptyColor });
    }
    return data;
  }, [usedTokens, available]);

  const kind = kindLabel(usage?.source);

  return (
    <div className="border-t border-slate-800">
      <div className="flex items-center gap-2.5 px-3 py-1.5">
        <div className="relative flex-shrink-0" style={{ width: MINI_DONUT_SIZE, height: MINI_DONUT_SIZE }}>
          <PieChart width={MINI_DONUT_SIZE} height={MINI_DONUT_SIZE}>
            <Pie
              data={chartData}
              dataKey="value"
              cx="50%"
              cy="50%"
              innerRadius={11}
              outerRadius={17}
              startAngle={90}
              endAngle={-270}
              strokeWidth={0}
              isAnimationActive={false}
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
          </PieChart>
          <span
            className="absolute inset-0 flex items-center justify-center text-[7px] font-bold tabular-nums"
            style={{ color: usedPercent > 80 ? 'var(--c-red-400)' : usedPercent > 50 ? 'var(--c-amber-400)' : 'var(--c-slate-400)' }}
          >
            {usedPercent}%
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-[10px]">
            <span className="text-slate-400">
              <span className="font-semibold text-slate-300">{formatTokenCount(usedTokens)}</span>
              {' / '}
              {formatTokenCount(contextWindow)}
            </span>
            <span className="rounded bg-slate-800 px-1 py-0.5 text-[8px] text-slate-500 font-medium">
              {sourceLabel(contextInfo.source)}
            </span>
            {kind && (
              <span
                className="rounded bg-slate-800 px-1 py-0.5 text-[8px] text-slate-400 font-medium"
                title={
                  usage?.source === 'preview'
                    ? 'Predicted context for the next turn -- will be replaced when the model responds'
                    : 'Last value persisted for this session -- waiting for a new turn to refresh'
                }
              >
                {kind}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-[9px] text-slate-500 mt-0.5">
            <span>Available: {formatTokenCount(available)}</span>
          </div>
        </div>

        {lastTurnUsage && (
          <div className="flex-shrink-0 text-right text-[9px] text-slate-500 hidden sm:block">
            <div>In: {formatTokenCount(lastTurnUsage.input)} Out: {formatTokenCount(lastTurnUsage.output)}</div>
            {(lastTurnUsage.cacheRead > 0 || lastTurnUsage.cacheWrite > 0) && (
              <div className="text-emerald-500/60">
                Cache: R{formatTokenCount(lastTurnUsage.cacheRead)} W{formatTokenCount(lastTurnUsage.cacheWrite)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
