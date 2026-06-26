import type { ResolvedBudgetConfig, BudgetEnforcement } from '../../shared/agent-config';
import type { PriceTable, TokenUsage } from './telemetry-engine';

/**
 * Budget / rate-governance engine.
 *
 * A budget node enforces spend and rate ceilings on a run, complementing
 * guardrails (content safety) with cost safety. This module accumulates a run's
 * token usage, USD cost, and tool-call count, and — combined with prior
 * session/day spend supplied by the caller — decides whether any ceiling is
 * breached and what to do about it (warn, downshift to a cheaper model, or
 * block the run).
 *
 * Dependency-free and React-free per the runtime convention. It reuses the same
 * `PriceTable` shape as the telemetry engine to convert tokens into USD. Wiring
 * the governor into `server/agents/run-coordinator.ts` (call `recordTurn` /
 * `recordToolCall` as the run progresses, consult `evaluate()` before each turn
 * and tool call, and act on the decision) is the remaining integration step;
 * the `BudgetGovernor` API below is the stable surface that wiring should target.
 */

export type BudgetCeiling =
  | 'usdPerSession'
  | 'usdPerDay'
  | 'tokensPerRun'
  | 'toolCallsPerRun';

export interface BudgetBreach {
  budgetNodeId: string;
  label: string;
  ceiling: BudgetCeiling;
  limit: number;
  observed: number;
  /** observed / limit, e.g. 1.2 means 20% over. */
  fraction: number;
}

export interface BudgetDecision {
  status: 'ok' | 'warn' | 'exceeded';
  /** Ceilings at or above their limit. */
  breaches: BudgetBreach[];
  /** Ceilings past `warnThreshold` but not yet exceeded. */
  warnings: BudgetBreach[];
  /** Strongest enforcement among exceeded ceilings: block > downshift > warn. */
  enforcement: BudgetEnforcement | null;
  /** Set when `enforcement === 'downshift'` and a fallback model is configured. */
  fallbackModelId: string | null;
}

/** Prior spend accumulated before this run, supplied by the caller's accounting. */
export interface SpendContext {
  /** USD already spent in the current session (excluding this run). */
  priorSessionUsd?: number;
  /** USD already spent in the current UTC day (excluding this run). */
  priorDayUsd?: number;
}

function estimateCostUsd(modelId: string, usage: TokenUsage, prices: PriceTable): number {
  const price = prices[modelId];
  if (!price) return 0;
  const input = ((usage.promptTokens ?? 0) / 1_000_000) * price.inputPerMTok;
  const output = ((usage.completionTokens ?? 0) / 1_000_000) * price.outputPerMTok;
  return input + output;
}

const ENFORCEMENT_RANK: Record<BudgetEnforcement, number> = {
  warn: 0,
  downshift: 1,
  block: 2,
};

/**
 * Governs one run against a set of resolved budget configs. Created via
 * `createGovernor`. The governor is a no-op (`active === false`) when no enabled
 * config has any active ceiling, so callers can govern unconditionally.
 */
export class BudgetGovernor {
  readonly active: boolean;
  private readonly configs: ResolvedBudgetConfig[];
  private readonly prices: PriceTable;
  private readonly priorSessionUsd: number;
  private readonly priorDayUsd: number;

  private tokensThisRun = 0;
  private toolCallsThisRun = 0;
  private usdThisRun = 0;

  constructor(
    configs: ResolvedBudgetConfig[],
    prices: PriceTable = {},
    spend: SpendContext = {},
  ) {
    this.configs = configs.filter((c) => c.enabled && hasActiveCeiling(c));
    this.prices = prices;
    this.priorSessionUsd = spend.priorSessionUsd ?? 0;
    this.priorDayUsd = spend.priorDayUsd ?? 0;
    this.active = this.configs.length > 0;
  }

  /** USD attributed to this run so far. */
  get runUsd(): number {
    return Number(this.usdThisRun.toFixed(6));
  }

  get runTokens(): number {
    return this.tokensThisRun;
  }

  get runToolCalls(): number {
    return this.toolCallsThisRun;
  }

  /** Record a completed model turn: adds tokens and derived USD cost. */
  recordTurn(modelId: string, usage: TokenUsage): void {
    const total =
      usage.totalTokens ?? (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
    this.tokensThisRun += total;
    this.usdThisRun += estimateCostUsd(modelId, usage, this.prices);
  }

  /** Record a tool invocation against the per-run tool-call ceiling. */
  recordToolCall(): void {
    this.toolCallsThisRun += 1;
  }

  /**
   * Evaluate every active ceiling against current usage and return a decision.
   * `status` is `exceeded` if any ceiling is at/over its limit, else `warn` if
   * any is past its `warnThreshold`, else `ok`. The decision is pure — call it
   * as often as needed (e.g. before each turn and tool call).
   */
  evaluate(): BudgetDecision {
    if (!this.active) {
      return { status: 'ok', breaches: [], warnings: [], enforcement: null, fallbackModelId: null };
    }

    const sessionUsd = this.priorSessionUsd + this.usdThisRun;
    const dayUsd = this.priorDayUsd + this.usdThisRun;
    const breaches: BudgetBreach[] = [];
    const warnings: BudgetBreach[] = [];
    let enforcement: BudgetEnforcement | null = null;
    let fallbackModelId: string | null = null;

    for (const c of this.configs) {
      const checks: { ceiling: BudgetCeiling; limit: number; observed: number }[] = [
        { ceiling: 'usdPerSession', limit: c.maxUsdPerSession, observed: sessionUsd },
        { ceiling: 'usdPerDay', limit: c.maxUsdPerDay, observed: dayUsd },
        { ceiling: 'tokensPerRun', limit: c.maxTokensPerRun, observed: this.tokensThisRun },
        { ceiling: 'toolCallsPerRun', limit: c.maxToolCallsPerRun, observed: this.toolCallsThisRun },
      ];

      for (const { ceiling, limit, observed } of checks) {
        if (limit <= 0) continue; // disabled ceiling
        const fraction = observed / limit;
        const breach: BudgetBreach = { budgetNodeId: c.budgetNodeId, label: c.label, ceiling, limit, observed, fraction };
        if (observed >= limit) {
          breaches.push(breach);
          if (enforcement === null || ENFORCEMENT_RANK[c.enforcement] > ENFORCEMENT_RANK[enforcement]) {
            enforcement = c.enforcement;
          }
          if (c.enforcement === 'downshift' && c.fallbackModelId) {
            fallbackModelId = c.fallbackModelId;
          }
        } else if (fraction >= c.warnThreshold && c.warnThreshold > 0) {
          warnings.push(breach);
        }
      }
    }

    const status = breaches.length > 0 ? 'exceeded' : warnings.length > 0 ? 'warn' : 'ok';
    return { status, breaches, warnings, enforcement, fallbackModelId };
  }

  /** Convenience: the run must hard-stop. */
  shouldBlock(): boolean {
    return this.evaluate().enforcement === 'block';
  }

  /** Convenience: the model the run should switch to, or null. */
  downshiftTarget(): string | null {
    const d = this.evaluate();
    return d.enforcement === 'downshift' ? d.fallbackModelId : null;
  }
}

function hasActiveCeiling(c: ResolvedBudgetConfig): boolean {
  return (
    c.maxUsdPerSession > 0 ||
    c.maxUsdPerDay > 0 ||
    c.maxTokensPerRun > 0 ||
    c.maxToolCallsPerRun > 0
  );
}

export function createGovernor(
  configs: ResolvedBudgetConfig[],
  prices: PriceTable = {},
  spend: SpendContext = {},
): BudgetGovernor {
  return new BudgetGovernor(configs, prices, spend);
}

/** Human-readable one-line summary of a breach, for logs and warnings. */
export function describeBreach(b: BudgetBreach): string {
  const pct = Math.round(b.fraction * 100);
  const fmt = (n: number) =>
    b.ceiling.startsWith('usd') ? `$${n.toFixed(2)}` : String(Math.round(n));
  return `${b.label}: ${b.ceiling} at ${fmt(b.observed)} / ${fmt(b.limit)} (${pct}%)`;
}
