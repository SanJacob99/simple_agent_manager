import { useMemo, useState } from 'react';
import { PieChart, Pie, Cell } from 'recharts';
import { ChevronDown, ChevronUp, Cpu, Wrench, BookOpen, MessageSquare } from 'lucide-react';
import type { ContextWindowInfo, ContextSource } from './useContextWindow';
import type { ContextUsage, ContextUsageEntry } from '../../shared/context-usage';
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
    case 'actual': return null;
    case 'preview': return 'preview';
    case 'persisted': return 'last known';
  }
}

const MINI_DONUT_SIZE = 36;

/** Aggregate (numeric) section keys; excludes the per-entry arrays. */
type SectionKey = 'systemPrompt' | 'skills' | 'tools' | 'messages';

const SECTION_META: Record<
  SectionKey,
  { label: string; icon: typeof Cpu; colorVar: string }
> = {
  systemPrompt: { label: 'System prompt', icon: Cpu, colorVar: '--c-blue-500' },
  skills: { label: 'Skills', icon: BookOpen, colorVar: '--c-emerald-500' },
  tools: { label: 'Tools', icon: Wrench, colorVar: '--c-amber-500' },
  messages: { label: 'Messages', icon: MessageSquare, colorVar: '--c-violet-500' },
};

const SECTION_ORDER: SectionKey[] = ['systemPrompt', 'skills', 'tools', 'messages'];

/** Cap per-entry rows in the expanded view so the panel stays compact. */
const ENTRY_DISPLAY_CAP = 8;

function EntryList({
  label,
  entries,
  colorVar,
}: {
  label: string;
  entries: ContextUsageEntry[] | undefined;
  colorVar: string;
}) {
  if (!entries || entries.length === 0) return null;
  const shown = entries.slice(0, ENTRY_DISPLAY_CAP);
  const omitted = Math.max(0, entries.length - shown.length);
  return (
    <div className="pt-1 mt-1 border-t border-slate-800/40">
      <div className="text-[9px] uppercase tracking-wider text-slate-600 font-semibold mb-0.5">
        {label}
      </div>
      {shown.map((entry) => (
        <div
          key={entry.name}
          className="flex items-center gap-2 text-[10px] pl-2"
        >
          <span
            className="h-1 w-1 rounded-full flex-shrink-0"
            style={{ backgroundColor: cssVar(colorVar) }}
          />
          <span className="flex-1 text-slate-400 truncate">{entry.name}</span>
          <span className="tabular-nums text-slate-500 font-mono">
            {formatTokenCount(entry.tokens)}
          </span>
        </div>
      ))}
      {omitted > 0 && (
        <div className="text-[9px] text-slate-600 italic pl-2">
          + {omitted} more
        </div>
      )}
    </div>
  );
}

export default function ContextUsagePanel({
  contextInfo,
  usage,
}: ContextUsagePanelProps) {
  const [expanded, setExpanded] = useState(false);

  const usedTokens = usage?.contextTokens ?? 0;
  const contextWindow = usage?.contextWindow ?? contextInfo.contextWindow;
  const lastTurnUsage = usage?.usage;
  const breakdown = usage?.breakdown;

  const available = Math.max(0, contextWindow - usedTokens);
  const usedPercent = contextWindow > 0
    ? Math.round((usedTokens / contextWindow) * 100)
    : 0;

  // Donut: when a breakdown is present, stack each section as its own
  // wedge so the donut visualizes where context is going. Otherwise
  // fall back to a single Used/Available split.
  const chartData = useMemo(() => {
    const availableColor = cssVar('--c-slate-800');
    const emptyColor = cssVar('--c-slate-900');

    const data: Array<{ name: string; value: number; color: string }> = [];

    if (breakdown) {
      for (const key of SECTION_ORDER) {
        const value = breakdown[key];
        if (value > 0) {
          data.push({
            name: SECTION_META[key].label,
            value,
            color: cssVar(SECTION_META[key].colorVar),
          });
        }
      }
    } else if (usedTokens > 0) {
      data.push({ name: 'Used', value: usedTokens, color: cssVar('--c-blue-500') });
    }

    if (available > 0) {
      data.push({ name: 'Available', value: available, color: availableColor });
    }
    if (data.length === 0) {
      data.push({ name: 'Empty', value: 1, color: emptyColor });
    }
    return data;
  }, [breakdown, usedTokens, available]);

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

        <button
          onClick={() => setExpanded(!expanded)}
          className="flex-shrink-0 rounded p-0.5 text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition"
          title={expanded ? 'Hide breakdown' : 'Show per-section breakdown'}
        >
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-slate-800/60 px-3 py-2 space-y-1.5">
          <div className="text-[9px] uppercase tracking-wider text-slate-600 font-semibold mb-1">
            Context breakdown
          </div>
          {breakdown ? (
            <>
              {SECTION_ORDER.map((key) => {
                const tokens = breakdown[key];
                const meta = SECTION_META[key];
                const Icon = meta.icon;
                const pct = usedTokens > 0 ? Math.round((tokens / usedTokens) * 100) : 0;
                return (
                  <div key={key} className="flex items-center gap-2 text-[10px]">
                    <Icon size={10} style={{ color: cssVar(meta.colorVar) }} />
                    <span className="flex-1 text-slate-400">{meta.label}</span>
                    <span className="tabular-nums text-slate-500 font-mono">
                      {formatTokenCount(tokens)}
                    </span>
                    <span className="tabular-nums text-slate-600 font-mono text-[9px] w-8 text-right">
                      {pct}%
                    </span>
                  </div>
                );
              })}
              <EntryList
                label="Top skills"
                entries={breakdown.skillsEntries}
                colorVar="--c-emerald-500"
              />
              <EntryList
                label="Top tools"
                entries={breakdown.toolsEntries}
                colorVar="--c-amber-500"
              />
              <p className="text-[8px] text-slate-600 italic mt-1">
                System prompt, skills, and tools are fixed within a turn. Messages grows as the conversation does.
              </p>
            </>
          ) : (
            <p className="text-[10px] text-slate-500 italic py-1">
              Send a message to see the per-section breakdown (system prompt, skills, tools, messages).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
