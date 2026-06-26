import { describe, expect, it } from 'vitest';
import type { ResolvedBudgetConfig } from '../../shared/agent-config';
import type { PriceTable } from './telemetry-engine';
import { createGovernor, describeBreach } from './budget-engine';

const PRICES: PriceTable = {
  'anthropic/claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15 },
};

function makeConfig(overrides: Partial<ResolvedBudgetConfig> = {}): ResolvedBudgetConfig {
  return {
    budgetNodeId: 'b1',
    label: 'Test Budget',
    enabled: true,
    maxUsdPerSession: 0,
    maxUsdPerDay: 0,
    maxTokensPerRun: 0,
    maxToolCallsPerRun: 0,
    enforcement: 'warn',
    fallbackModelId: '',
    warnThreshold: 0.8,
    ...overrides,
  };
}

describe('BudgetGovernor', () => {
  it('is inactive when no config has an active ceiling', () => {
    expect(createGovernor([makeConfig()], PRICES).active).toBe(false);
    expect(createGovernor([], PRICES).active).toBe(false);
    expect(createGovernor([makeConfig({ enabled: false, maxTokensPerRun: 10 })], PRICES).active).toBe(false);
  });

  it('accumulates tokens and USD from turns', () => {
    const g = createGovernor([makeConfig({ maxTokensPerRun: 1_000_000 })], PRICES);
    g.recordTurn('anthropic/claude-sonnet-4-6', { promptTokens: 1_000_000, completionTokens: 1_000_000 });
    expect(g.runTokens).toBe(2_000_000);
    expect(g.runUsd).toBeCloseTo(18, 5); // 1M*3 + 1M*15 per MTok = $18
  });

  it('exceeds the per-run token ceiling', () => {
    const g = createGovernor([makeConfig({ maxTokensPerRun: 100, enforcement: 'block' })], PRICES);
    g.recordTurn('anthropic/claude-sonnet-4-6', { totalTokens: 150 });
    const d = g.evaluate();
    expect(d.status).toBe('exceeded');
    expect(d.enforcement).toBe('block');
    expect(d.breaches.some((b) => b.ceiling === 'tokensPerRun')).toBe(true);
    expect(g.shouldBlock()).toBe(true);
  });

  it('warns when crossing warnThreshold but below the limit', () => {
    const g = createGovernor([makeConfig({ maxToolCallsPerRun: 10, warnThreshold: 0.8 })], PRICES);
    for (let i = 0; i < 8; i++) g.recordToolCall();
    const d = g.evaluate();
    expect(d.status).toBe('warn');
    expect(d.warnings.some((w) => w.ceiling === 'toolCallsPerRun')).toBe(true);
    expect(d.breaches).toEqual([]);
  });

  it('folds prior session spend into the session ceiling', () => {
    const g = createGovernor(
      [makeConfig({ maxUsdPerSession: 1, enforcement: 'block' })],
      PRICES,
      { priorSessionUsd: 0.95 },
    );
    g.recordTurn('anthropic/claude-sonnet-4-6', { promptTokens: 20_000, completionTokens: 0 }); // $0.06
    const d = g.evaluate();
    expect(d.status).toBe('exceeded');
    expect(d.breaches.some((b) => b.ceiling === 'usdPerSession')).toBe(true);
  });

  it('selects the strongest enforcement and a downshift target', () => {
    const g = createGovernor(
      [
        makeConfig({ budgetNodeId: 'b1', maxToolCallsPerRun: 1, enforcement: 'warn' }),
        makeConfig({ budgetNodeId: 'b2', maxToolCallsPerRun: 1, enforcement: 'downshift', fallbackModelId: 'anthropic/claude-haiku-4-5' }),
      ],
      PRICES,
    );
    g.recordToolCall();
    g.recordToolCall();
    const d = g.evaluate();
    expect(d.enforcement).toBe('downshift');
    expect(d.fallbackModelId).toBe('anthropic/claude-haiku-4-5');
    expect(g.downshiftTarget()).toBe('anthropic/claude-haiku-4-5');
  });

  it('ignores unpriced models in cost (contributes 0)', () => {
    const g = createGovernor([makeConfig({ maxUsdPerSession: 1, enforcement: 'block' })], PRICES);
    g.recordTurn('mystery/model', { promptTokens: 5_000_000, completionTokens: 5_000_000 });
    expect(g.runUsd).toBe(0);
    expect(g.evaluate().status).toBe('ok');
  });
});

describe('describeBreach', () => {
  it('formats USD and count ceilings', () => {
    const g = createGovernor([makeConfig({ maxToolCallsPerRun: 2, enforcement: 'block' })], PRICES);
    g.recordToolCall();
    g.recordToolCall();
    const [breach] = g.evaluate().breaches;
    expect(describeBreach(breach)).toMatch(/toolCallsPerRun at 2 \/ 2 \(100%\)/);
  });
});
