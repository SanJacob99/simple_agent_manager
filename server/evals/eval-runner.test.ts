import { describe, expect, it } from 'vitest';
import type { ResolvedEvalsConfig, ResolvedEvalCase } from '../../shared/agent-config';
import { EvalRunner, gradeDeterministic, scoreSuite } from './eval-runner';

function makeCase(overrides: Partial<ResolvedEvalCase> = {}): ResolvedEvalCase {
  return {
    id: 'c1',
    input: 'say hello',
    expected: 'hello',
    grader: 'contains',
    weight: 1,
    ...overrides,
  };
}

function makeSuite(
  cases: ResolvedEvalCase[],
  overrides: Partial<ResolvedEvalsConfig> = {},
): ResolvedEvalsConfig {
  return {
    evalsNodeId: 'e1',
    label: 'Suite',
    enabled: true,
    cases,
    passThreshold: 0.8,
    judgeModelId: '',
    judgePrompt: '',
    maxConcurrency: 2,
    failOnRegression: false,
    ...overrides,
  };
}

describe('gradeDeterministic', () => {
  it('scores exact_match', () => {
    expect(gradeDeterministic('exact_match', 'hi', '  hi  ')?.passed).toBe(true);
    expect(gradeDeterministic('exact_match', 'hi', 'hello')?.passed).toBe(false);
  });

  it('scores contains case-insensitively', () => {
    expect(gradeDeterministic('contains', 'Ready', 'I am READY now')?.passed).toBe(true);
    expect(gradeDeterministic('contains', 'ready', 'not yet')?.passed).toBe(false);
  });

  it('scores regex', () => {
    expect(gradeDeterministic('regex', '^\\d{3}$', '123')?.passed).toBe(true);
    expect(gradeDeterministic('regex', '^\\d{3}$', '12')?.passed).toBe(false);
    expect(gradeDeterministic('regex', '(', 'x')?.passed).toBe(false); // invalid regex fails closed
  });

  it('scores json_schema', () => {
    const schema = JSON.stringify({
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
    });
    expect(gradeDeterministic('json_schema', schema, '{"ok": true}')?.passed).toBe(true);
    expect(gradeDeterministic('json_schema', schema, '{"ok": "yes"}')?.passed).toBe(false);
    expect(gradeDeterministic('json_schema', schema, 'not json')?.passed).toBe(false);
  });

  it('returns null for llm_judge', () => {
    expect(gradeDeterministic('llm_judge', 'x', 'y')).toBeNull();
  });
});

describe('scoreSuite', () => {
  it('computes a weighted score', () => {
    const results = [
      { caseId: 'a', grader: 'contains' as const, weight: 3, input: '', expected: '', actual: '', passed: true, score: 1, detail: '' },
      { caseId: 'b', grader: 'contains' as const, weight: 1, input: '', expected: '', actual: '', passed: false, score: 0, detail: '' },
    ];
    const agg = scoreSuite(results, 0.7);
    expect(agg.score).toBeCloseTo(0.75);
    expect(agg.passRate).toBeCloseTo(0.5);
    expect(agg.passed).toBe(true);
    expect(agg.passedCount).toBe(1);
  });

  it('handles an empty suite', () => {
    expect(scoreSuite([], 0.5)).toEqual({ score: 0, passRate: 0, passed: false, passedCount: 0 });
  });
});

describe('EvalRunner', () => {
  it('runs all cases and aggregates', async () => {
    const suite = makeSuite([
      makeCase({ id: 'a', expected: 'hello' }),
      makeCase({ id: 'b', expected: 'world' }),
    ]);
    const runner = new EvalRunner(suite, {
      execute: async (input) => (input === 'say hello' ? 'hello there' : 'goodbye'),
    });
    const report = await runner.run();
    expect(report.total).toBe(2);
    expect(report.passedCount).toBe(1);
    expect(report.score).toBeCloseTo(0.5);
    expect(report.passed).toBe(false);
  });

  it('delegates llm_judge cases to the judge', async () => {
    const suite = makeSuite([makeCase({ grader: 'llm_judge' })]);
    const runner = new EvalRunner(suite, {
      execute: async () => 'some answer',
      judge: async () => ({ passed: true, score: 1, detail: 'judged good' }),
    });
    const report = await runner.run();
    expect(report.passedCount).toBe(1);
    expect(report.results[0].detail).toBe('judged good');
  });

  it('fails llm_judge cases gracefully without a judge', async () => {
    const suite = makeSuite([makeCase({ grader: 'llm_judge' })]);
    const runner = new EvalRunner(suite, { execute: async () => 'x' });
    const report = await runner.run();
    expect(report.results[0].passed).toBe(false);
  });

  it('captures executor errors per case', async () => {
    const suite = makeSuite([makeCase()]);
    const runner = new EvalRunner(suite, {
      execute: async () => {
        throw new Error('model exploded');
      },
    });
    const report = await runner.run();
    expect(report.results[0].error).toBe('model exploded');
    expect(report.results[0].passed).toBe(false);
  });

  it('flags a regression when enabled', async () => {
    const suite = makeSuite([makeCase({ expected: 'nope' })], { failOnRegression: true });
    const runner = new EvalRunner(suite, { execute: async () => 'wrong' });
    const report = await runner.run(0.9);
    expect(report.regressed).toBe(true);
    expect(report.previousBest).toBe(0.9);
  });
});
