import type { ResolvedBudgetConfig } from '../../shared/agent-config';
import type { PriceTable, TokenUsage } from './telemetry-engine';

/**
 * Budget / rate-governance engine.
 *
 * A budget node attaches spend and rate ceilings to an agent: max USD per run,
 * max USD per rolling day, max tokens per run, max tool calls per run, and max
 * runs per minute. This module is the dependency-free enforcement substrate the
 * runtime calls around each turn and tool call. It complements the guardrails
 * engine (content safety) with cost safety, and consumes the same `PriceTable`
 * shape as the telemetry engine so a single price source feeds both.
 *
 * The runtime owns one `BudgetLedger` per agent (long-lived, to track the
 * per-day and per-minute rolling windows across runs) and calls:
 *   - `beginRun()` once when a run starts — enforces the run-rate ceiling,
 *   - `recordUsage()` after each turn — accrues tokens and USD,
 *   - `recordToolCall()` before/after each tool — accrues the tool-call count,
 * then inspects the returned `BudgetDecision` to apply the degrade policy.
 *
 * Wiring the ledger into `server/agents/run-coordinator.ts` (downshift the
 * model on `downshift`, abort with a `budget_exceeded` error on `block`, emit a
 * `budget:exceeded` event on `warn`) is the remaining integration step; the API
 * below is the stable surface that wiring should target.
 */

export type BudgetCeiling =
  | 'usd_per_run'
  | 'usd_per_day'
  | 'tokens_per_run'
  | 'tool_calls_per_run'
  | 'runs_per_minute';

export interface BudgetViolation {
  budgetNodeId: string;
  label: string;
  ceiling: BudgetCeiling;
  limit: number;
  observed: number;
  policy: ResolvedBudgetConfig['degradePolicy'];
  downshiftModelId: string;
  blockMessage: string;
}

export interface BudgetDecision {
  /** True when no enabled ceiling is exceeded. */
  ok: boolean;
  /** The strictest action implied by the violations: block > downshift > warn. */
  action: 'allow' | 'warn' | 'downshift' | 'block';
  violations: BudgetViolation[];
  /** When `action` is `downshift`, the model to switch to (first non-empty wins). */
  downshiftModelId: string | null;
}

interface RunState {
  tokens: number;
  usd: number;
  toolCalls: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

function costUsd(modelId: string, usage: TokenUsage, prices: PriceTable): number {
  const price = prices[modelId];
  if (!price) return 0;
  const input = ((usage.promptTokens ?? 0) / 1_000_000) * price.inputPerMTok;
  const output = ((usage.completionTokens ?? 0) / 1_000_000) * price.outputPerMTok;
  return input + output;
}

function totalTokens(usage: TokenUsage): number {
  if (usage.totalTokens != null) return usage.totalTokens;
  return (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
}

/**
 * Tracks spend and rate across the lifetime of an agent. One ledger enforces
 * every budget node attached to that agent; the strictest reached ceiling wins.
 * The per-day USD window and per-minute run window are rolling, computed from
 * timestamps supplied by the caller (`now`) so the class stays deterministic
 * and testable without touching the clock.
 */
export class BudgetLedger {
  private readonly configs: ResolvedBudgetConfig[];
  private readonly prices: PriceTable;
  private readonly runStates = new Map<string, RunState>();
  private readonly daySpend: { at: number; usd: number }[] = [];
  private readonly runStarts: number[] = [];

  constructor(configs: ResolvedBudgetConfig[], prices: PriceTable = {}) {
    this.configs = configs.filter((c) => c.enabled);
    this.prices = prices;
  }

  /** Whether any enabled budget node governs this agent. */
  get active(): boolean {
    return this.configs.length > 0;
  }

  /** Register a run start and enforce the per-minute run-rate ceiling. */
  beginRun(runId: string, now: number): BudgetDecision {
    this.runStates.set(runId, { tokens: 0, usd: 0, toolCalls: 0 });
    this.pruneRunStarts(now);
    this.runStarts.push(now);
    const violations: BudgetViolation[] = [];
    for (const cfg of this.configs) {
      if (cfg.maxRunsPerMinute > 0 && this.runStarts.length > cfg.maxRunsPerMinute) {
        violations.push(this.violation(cfg, 'runs_per_minute', cfg.maxRunsPerMinute, this.runStarts.length));
      }
    }
    return this.decide(violations);
  }

  /** Accrue token usage and USD cost for a turn, then re-check the run ceilings. */
  recordUsage(runId: string, modelId: string, usage: TokenUsage, now: number): BudgetDecision {
    const state = this.runStates.get(runId) ?? { tokens: 0, usd: 0, toolCalls: 0 };
    state.tokens += totalTokens(usage);
    const spend = costUsd(modelId, usage, this.prices);
    state.usd += spend;
    this.runStates.set(runId, state);
    this.pruneDaySpend(now);
    this.daySpend.push({ at: now, usd: spend });
    return this.checkRun(runId);
  }

  /** Accrue one tool call against the run and re-check the tool-call ceiling. */
  recordToolCall(runId: string): BudgetDecision {
    const state = this.runStates.get(runId) ?? { tokens: 0, usd: 0, toolCalls: 0 };
    state.toolCalls += 1;
    this.runStates.set(runId, state);
    return this.checkRun(runId);
  }

  /** Drop per-run accounting once a run finalizes. Rolling windows are retained. */
  endRun(runId: string): void {
    this.runStates.delete(runId);
  }

  private checkRun(runId: string): BudgetDecision {
    const state = this.runStates.get(runId) ?? { tokens: 0, usd: 0, toolCalls: 0 };
    const dayUsd = this.daySpend.reduce((sum, e) => sum + e.usd, 0);
    const violations: BudgetViolation[] = [];
    for (const cfg of this.configs) {
      if (cfg.maxUsdPerRun > 0 && state.usd > cfg.maxUsdPerRun) {
        violations.push(this.violation(cfg, 'usd_per_run', cfg.maxUsdPerRun, round(state.usd)));
      }
      if (cfg.maxUsdPerDay > 0 && dayUsd > cfg.maxUsdPerDay) {
        violations.push(this.violation(cfg, 'usd_per_day', cfg.maxUsdPerDay, round(dayUsd)));
      }
      if (cfg.maxTokensPerRun > 0 && state.tokens > cfg.maxTokensPerRun) {
        violations.push(this.violation(cfg, 'tokens_per_run', cfg.maxTokensPerRun, state.tokens));
      }
      if (cfg.maxToolCallsPerRun > 0 && state.toolCalls > cfg.maxToolCallsPerRun) {
        violations.push(this.violation(cfg, 'tool_calls_per_run', cfg.maxToolCallsPerRun, state.toolCalls));
      }
    }
    return this.decide(violations);
  }

  private violation(
    cfg: ResolvedBudgetConfig,
    ceiling: BudgetCeiling,
    limit: number,
    observed: number,
  ): BudgetViolation {
    return {
      budgetNodeId: cfg.budgetNodeId,
      label: cfg.label,
      ceiling,
      limit,
      observed,
      policy: cfg.degradePolicy,
      downshiftModelId: cfg.downshiftModelId,
      blockMessage: cfg.blockMessage,
    };
  }

  private decide(violations: BudgetViolation[]): BudgetDecision {
    if (violations.length === 0) {
      return { ok: true, action: 'allow', violations, downshiftModelId: null };
    }
    // A `downshift` policy with no model configured degrades to `warn`.
    const effective = (v: BudgetViolation): 'warn' | 'downshift' | 'block' =>
      v.policy === 'downshift' && !v.downshiftModelId ? 'warn' : v.policy;
    const rank = { warn: 0, downshift: 1, block: 2 } as const;
    let action: 'warn' | 'downshift' | 'block' = 'warn';
    let downshiftModelId: string | null = null;
    for (const v of violations) {
      const a = effective(v);
      if (rank[a] >= rank[action]) action = a;
      if (a === 'downshift' && !downshiftModelId) downshiftModelId = v.downshiftModelId;
    }
    return { ok: false, action, violations, downshiftModelId: action === 'downshift' ? downshiftModelId : null };
  }

  private pruneDaySpend(now: number): void {
    const cutoff = now - DAY_MS;
    while (this.daySpend.length && this.daySpend[0].at < cutoff) this.daySpend.shift();
  }

  private pruneRunStarts(now: number): void {
    const cutoff = now - MINUTE_MS;
    while (this.runStarts.length && this.runStarts[0] < cutoff) this.runStarts.shift();
  }
}

function round(usd: number): number {
  return Number(usd.toFixed(6));
}

export function createBudgetLedger(
  configs: ResolvedBudgetConfig[] | undefined,
  prices: PriceTable = {},
): BudgetLedger {
  return new BudgetLedger(configs ?? [], prices);
}
