import { describe, expect, it } from 'vitest';
import type { ResolvedBudgetConfig } from '../../shared/agent-config';
import { BudgetLedger } from './budget-engine';
import type { PriceTable } from './telemetry-engine';

function makeBudget(overrides: Partial<ResolvedBudgetConfig> = {}): ResolvedBudgetConfig {
  return {
    budgetNodeId: 'b1',
    label: 'Budget',
    enabled: true,
    maxUsdPerRun: 0,
    maxUsdPerDay: 0,
    maxTokensPerRun: 0,
    maxToolCallsPerRun: 0,
    maxRunsPerMinute: 0,
    degradePolicy: 'warn',
    downshiftModelId: '',
    blockMessage: '',
    ...overrides,
  };
}

const PRICES: PriceTable = {
  'test/model': { inputPerMTok: 1_000_000, outputPerMTok: 1_000_000 }, // $1 per token, easy math
};

describe('BudgetLedger', () => {
  it('is inactive with no enabled budgets', () => {
    expect(new BudgetLedger([]).active).toBe(false);
    expect(new BudgetLedger([makeBudget({ enabled: false })]).active).toBe(false);
    expect(new BudgetLedger([makeBudget()]).active).toBe(true);
  });

  it('allows usage under all ceilings', () => {
    const ledger = new BudgetLedger([makeBudget({ maxTokensPerRun: 100 })]);
    ledger.beginRun('r1', 0);
    const decision = ledger.recordUsage('r1', 'test/model', { totalTokens: 50 }, 0);
    expect(decision.ok).toBe(true);
    expect(decision.action).toBe('allow');
  });

  it('flags a tokens-per-run ceiling', () => {
    const ledger = new BudgetLedger([makeBudget({ maxTokensPerRun: 100, degradePolicy: 'block' })]);
    ledger.beginRun('r1', 0);
    const decision = ledger.recordUsage('r1', 'test/model', { totalTokens: 150 }, 0);
    expect(decision.ok).toBe(false);
    expect(decision.action).toBe('block');
    expect(decision.violations[0].ceiling).toBe('tokens_per_run');
  });

  it('accrues USD cost from the price table', () => {
    const ledger = new BudgetLedger([makeBudget({ maxUsdPerRun: 2 })], PRICES);
    ledger.beginRun('r1', 0);
    const ok = ledger.recordUsage('r1', 'test/model', { promptTokens: 1, completionTokens: 0 }, 0);
    expect(ok.ok).toBe(true);
    const over = ledger.recordUsage('r1', 'test/model', { promptTokens: 2, completionTokens: 0 }, 0);
    expect(over.ok).toBe(false);
    expect(over.violations[0].ceiling).toBe('usd_per_run');
  });

  it('enforces a per-minute run-rate ceiling with a rolling window', () => {
    const ledger = new BudgetLedger([makeBudget({ maxRunsPerMinute: 2 })]);
    expect(ledger.beginRun('r1', 0).ok).toBe(true);
    expect(ledger.beginRun('r2', 1000).ok).toBe(true);
    expect(ledger.beginRun('r3', 2000).ok).toBe(false); // 3rd within the minute
    // After the window rolls past 60s, the earlier starts are pruned.
    expect(ledger.beginRun('r4', 70_000).ok).toBe(true);
  });

  it('counts tool calls per run', () => {
    const ledger = new BudgetLedger([makeBudget({ maxToolCallsPerRun: 1 })]);
    ledger.beginRun('r1', 0);
    expect(ledger.recordToolCall('r1').ok).toBe(true);
    expect(ledger.recordToolCall('r1').ok).toBe(false);
  });

  it('degrades downshift to warn when no model is configured', () => {
    const ledger = new BudgetLedger([
      makeBudget({ maxTokensPerRun: 10, degradePolicy: 'downshift', downshiftModelId: '' }),
    ]);
    ledger.beginRun('r1', 0);
    const decision = ledger.recordUsage('r1', 'test/model', { totalTokens: 20 }, 0);
    expect(decision.action).toBe('warn');
    expect(decision.downshiftModelId).toBeNull();
  });

  it('surfaces the downshift model when configured', () => {
    const ledger = new BudgetLedger([
      makeBudget({ maxTokensPerRun: 10, degradePolicy: 'downshift', downshiftModelId: 'cheap/model' }),
    ]);
    ledger.beginRun('r1', 0);
    const decision = ledger.recordUsage('r1', 'test/model', { totalTokens: 20 }, 0);
    expect(decision.action).toBe('downshift');
    expect(decision.downshiftModelId).toBe('cheap/model');
  });

  it('takes the strictest action across multiple budgets', () => {
    const ledger = new BudgetLedger([
      makeBudget({ budgetNodeId: 'warnB', maxTokensPerRun: 10, degradePolicy: 'warn' }),
      makeBudget({ budgetNodeId: 'blockB', maxTokensPerRun: 10, degradePolicy: 'block' }),
    ]);
    ledger.beginRun('r1', 0);
    const decision = ledger.recordUsage('r1', 'test/model', { totalTokens: 20 }, 0);
    expect(decision.action).toBe('block');
    expect(decision.violations).toHaveLength(2);
  });
});
