import { useState, useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { ChevronDown, ChevronUp, AlertCircle, Cpu, Wrench, BookOpen, Layers, Plug } from 'lucide-react';
import type { Message } from '../store/chat-store';
import type { ContextWindowInfo, PeripheralReservation, ContextSource } from './useContextWindow';

interface ContextUsagePanelProps {
  messages: Message[];
  contextInfo: ContextWindowInfo;
  peripheralReservations: PeripheralReservation[];
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

const USED_COLOR = '#3b82f6';       // blue-500
const RESERVED_COLOR = '#f59e0b';   // amber-500
const AVAILABLE_COLOR = '#1e293b';  // slate-800
const EMPTY_BG_COLOR = '#0f172a';   // slate-900 for truly empty

const peripheralIcon = (type: string) => {
  switch (type) {
    case 'system-prompt': return <Cpu size={10} className="text-slate-400" />;
    case 'tools': return <Wrench size={10} className="text-slate-400" />;
    case 'skills': return <BookOpen size={10} className="text-slate-400" />;
    case 'context-engine': return <Layers size={10} className="text-slate-400" />;
    default: return <Plug size={10} className="text-slate-400" />;
  }
};

export default function ContextUsagePanel({
  messages,
  contextInfo,
  peripheralReservations,
}: ContextUsagePanelProps) {
  const [expanded, setExpanded] = useState(false);

  const { usedTokens, lastTurnUsage } = useMemo(() => {
    let total = 0;
    let lastUsage: Message['usage'] | undefined;

    for (const msg of messages) {
      if (msg.tokenCount) {
        total += msg.tokenCount;
      }
      if (msg.role === 'assistant' && msg.usage) {
        lastUsage = msg.usage;
      }
    }

    return { usedTokens: total, lastTurnUsage: lastUsage };
  }, [messages]);

  const reservedTokens = useMemo(() => {
    return peripheralReservations.reduce((sum, r) => sum + r.tokenEstimate, 0);
  }, [peripheralReservations]);

  const { contextWindow } = contextInfo;
  const available = Math.max(0, contextWindow - usedTokens - reservedTokens);
  const usedPercent = Math.round((usedTokens / contextWindow) * 100);

  // Donut chart data
  const chartData = useMemo(() => {
    const data = [];
    if (usedTokens > 0) {
      data.push({ name: 'Used', value: usedTokens, color: USED_COLOR });
    }
    if (reservedTokens > 0) {
      data.push({ name: 'Reserved', value: reservedTokens, color: RESERVED_COLOR });
    }
    const avail = Math.max(0, contextWindow - usedTokens - reservedTokens);
    if (avail > 0) {
      data.push({ name: 'Available', value: avail, color: AVAILABLE_COLOR });
    }
    // If nothing, show a full empty ring
    if (data.length === 0) {
      data.push({ name: 'Empty', value: 1, color: EMPTY_BG_COLOR });
    }
    return data;
  }, [usedTokens, reservedTokens, contextWindow]);

  return (
    <div className="border-t border-slate-800">
      {/* Compact always-visible bar with donut */}
      <div className="flex items-center gap-2.5 px-3 py-1.5">
        {/* Mini donut */}
        <div className="h-[36px] w-[36px] flex-shrink-0 relative">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
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
          </ResponsiveContainer>
          {/* Center percentage */}
          <span
            className="absolute inset-0 flex items-center justify-center text-[7px] font-bold tabular-nums"
            style={{ color: usedPercent > 80 ? '#f87171' : usedPercent > 50 ? '#fbbf24' : '#94a3b8' }}
          >
            {usedPercent}%
          </span>
        </div>

        {/* Stats */}
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
          </div>
          <div className="flex items-center gap-2 text-[9px] text-slate-500 mt-0.5">
            <span>Available: {formatTokenCount(available)}</span>
            {reservedTokens > 0 && (
              <span className="text-amber-500/70">
                Reserved: {formatTokenCount(reservedTokens)}
              </span>
            )}
          </div>
        </div>

        {/* Last turn usage */}
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

        {/* Expand button */}
        {peripheralReservations.length > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex-shrink-0 rounded p-0.5 text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition"
            title={expanded ? 'Hide reservations' : 'Show context reservations'}
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        )}
      </div>

      {/* Expanded: Peripheral reservations */}
      {expanded && peripheralReservations.length > 0 && (
        <div className="border-t border-slate-800/60 px-3 py-2 space-y-1.5">
          <div className="text-[9px] uppercase tracking-wider text-slate-600 font-semibold mb-1">
            Context Reservations
          </div>
          {peripheralReservations.map((reservation, i) => (
            <div key={i} className="flex items-center gap-2 text-[10px]">
              {peripheralIcon(reservation.type)}
              <span className="flex-1 text-slate-400 truncate">{reservation.label}</span>
              <span className="tabular-nums text-slate-500 font-mono">
                ~{formatTokenCount(reservation.tokenEstimate)}
              </span>
              {reservation.isTodo && (
                <span
                  className="flex items-center gap-0.5 rounded bg-amber-500/10 px-1 py-0.5 text-[8px] text-amber-400 font-medium"
                  title="This estimate will improve when peripheral nodes report their actual context footprint"
                >
                  <AlertCircle size={8} />
                  TODO
                </span>
              )}
            </div>
          ))}
          <p className="text-[8px] text-slate-600 italic mt-1">
            Estimates will improve when peripheral nodes report their actual context footprint.
          </p>
        </div>
      )}
    </div>
  );
}
