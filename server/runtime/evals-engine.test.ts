import { describe, expect, it } from 'vitest';
import { scoreAssertion, scoreCase, scoreSuite } from './evals-engine';
import type {
  ResolvedEvalAssertion,
  ResolvedEvalCase,
  ResolvedEvalConfig,
} from '../../shared/agent-config';

function assertion(over: Partial<ResolvedEvalAssertion>): ResolvedEvalAssertion {
  return { id: 'a1', type: 'contains', value: 'hello', ...over };
}

function evalCase(over: Partial<ResolvedEvalCase>): ResolvedEvalCase {
  return { id: 'c1', name: 'Case', input: 'hi', assertions: [], ...over };
}

function suite(over: Partial<ResolvedEvalConfig>): ResolvedEvalConfig {
  return {
    evalNodeId: 'node_evals',
    label: 'Evals',
    enabled: true,
    cases: [],
    passThreshold: 1,
    judgeModelId: '',
    maxConcurrency: 2,
    ...over,
  };
}

describe('scoreAssertion', () => {
  it('passes contains when substring present (case-insensitive by default)', () => {
    const r = scoreAssertion(assertion({ value: 'Hello' }), 'well, hello there');
    expect(r.status).toBe('pass');
  });

  it('respects caseSensitive for contains', () => {
    const r = scoreAssertion(
      assertion({ value: 'Hello', caseSensitive: true }),
      'hello there',
    );
    expect(r.status).toBe('fail');
  });

  it('grades not_contains as pass when absent', () => {
    const r = scoreAssertion(
      assertion({ type: 'not_contains', value: 'secret' }),
      'public info only',
    );
    expect(r.status).toBe('pass');
  });

  it('grades equals after trim', () => {
    const r = scoreAssertion(assertion({ type: 'equals', value: 'yes' }), '  YES  ');
    expect(r.status).toBe('pass');
  });

  it('grades regex matches', () => {
    const r = scoreAssertion(
      assertion({ type: 'regex', value: '^\\d{3}-\\d{4}$' }),
      '123-4567',
    );
    expect(r.status).toBe('pass');
  });

  it('fails gracefully on an invalid regex', () => {
    const r = scoreAssertion(assertion({ type: 'regex', value: '(' }), 'anything');
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('Invalid regex');
  });

  it('reports llm_judge as pending', () => {
    const r = scoreAssertion(assertion({ type: 'llm_judge', value: 'is polite' }), 'hi');
    expect(r.status).toBe('pending');
  });
});

describe('scoreCase', () => {
  it('passes when all resolved assertions pass and threshold is met', () => {
    const c = scoreCase(
      evalCase({
        assertions: [
          assertion({ id: 'a1', value: 'hello' }),
          assertion({ id: 'a2', type: 'not_contains', value: 'error' }),
        ],
      }),
      'hello world, no problems',
      1,
    );
    expect(c.passed).toBe(true);
    expect(c.score).toBe(1);
  });

  it('fails when score is below threshold', () => {
    const c = scoreCase(
      evalCase({
        assertions: [
          assertion({ id: 'a1', value: 'hello' }),
          assertion({ id: 'a2', value: 'goodbye' }),
        ],
      }),
      'hello world',
      1,
    );
    expect(c.score).toBe(0.5);
    expect(c.passed).toBe(false);
  });

  it('never passes a case with a pending assertion', () => {
    const c = scoreCase(
      evalCase({
        assertions: [
          assertion({ id: 'a1', value: 'hello' }),
          assertion({ id: 'a2', type: 'llm_judge', value: 'is correct' }),
        ],
      }),
      'hello world',
      0.5,
    );
    expect(c.passed).toBe(false);
  });

  it('treats a case with no assertions as a vacuous pass', () => {
    const c = scoreCase(evalCase({ assertions: [] }), 'whatever', 1);
    expect(c.passed).toBe(true);
    expect(c.score).toBe(1);
  });
});

describe('scoreSuite', () => {
  it('aggregates pass/fail/pending counts and pass rate', () => {
    const s = scoreSuite(
      suite({
        passThreshold: 1,
        cases: [
          evalCase({ id: 'c1', assertions: [assertion({ value: 'hello' })] }),
          evalCase({ id: 'c2', assertions: [assertion({ value: 'absent' })] }),
          evalCase({
            id: 'c3',
            assertions: [assertion({ type: 'llm_judge', value: 'graded' })],
          }),
        ],
      }),
      { c1: 'hello there', c2: 'nope', c3: 'anything' },
    );

    expect(s.total).toBe(3);
    expect(s.passed).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.pending).toBe(1);
    expect(s.passRate).toBeCloseTo(1 / 3);
  });

  it('grades cases with missing output against the empty string', () => {
    const s = scoreSuite(
      suite({ cases: [evalCase({ id: 'c1', assertions: [assertion({ value: 'hello' })] })] }),
      {},
    );
    expect(s.passed).toBe(0);
    expect(s.failed).toBe(1);
  });
});
