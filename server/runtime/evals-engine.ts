import type {
  EvalAssertionType,
  ResolvedEvalAssertion,
  ResolvedEvalCase,
  ResolvedEvalConfig,
} from '../../shared/agent-config';

/**
 * Evals scoring core.
 *
 * This module is the deterministic half of eval-driven agent development: it
 * grades an agent's final response against the assertions defined on an Evals
 * node. It is intentionally pure (no I/O, no model calls) so it can be unit
 * tested in isolation and reused by whatever orchestration layer ends up
 * driving full per-case agent runs.
 *
 * Scope today (scaffold):
 *   - `contains`, `not_contains`, `equals`, `regex` are graded here and now.
 *   - `llm_judge` requires a model call and is reported as `pending`. Wiring a
 *     judge pass and a per-case agent execution loop into the run coordinator
 *     is a documented extension surface — see docs/concepts/evals-node.md.
 */

export type AssertionStatus = 'pass' | 'fail' | 'pending';

export interface AssertionResult {
  assertionId: string;
  type: EvalAssertionType;
  status: AssertionStatus;
  detail: string;
}

export interface CaseResult {
  caseId: string;
  name: string;
  /** True when no assertion failed, none are pending, and score >= threshold. */
  passed: boolean;
  /** Fraction of *resolved* (non-pending) assertions that passed, 0–1. */
  score: number;
  assertionResults: AssertionResult[];
}

export interface SuiteResult {
  evalNodeId: string;
  label: string;
  total: number;
  passed: number;
  failed: number;
  /** Cases that could not be fully graded because they contain pending assertions. */
  pending: number;
  /** Fraction of cases that passed, 0–1. */
  passRate: number;
  caseResults: CaseResult[];
}

function normalize(text: string, caseSensitive: boolean | undefined): string {
  return caseSensitive ? text : text.toLowerCase();
}

/** Grade a single assertion against the agent's response text. */
export function scoreAssertion(
  assertion: ResolvedEvalAssertion,
  output: string,
): AssertionResult {
  const base = { assertionId: assertion.id, type: assertion.type };
  const expected = assertion.value;

  switch (assertion.type) {
    case 'contains': {
      const hit = normalize(output, assertion.caseSensitive).includes(
        normalize(expected, assertion.caseSensitive),
      );
      return {
        ...base,
        status: hit ? 'pass' : 'fail',
        detail: hit ? `Found "${expected}".` : `Missing expected substring "${expected}".`,
      };
    }
    case 'not_contains': {
      const hit = normalize(output, assertion.caseSensitive).includes(
        normalize(expected, assertion.caseSensitive),
      );
      return {
        ...base,
        status: hit ? 'fail' : 'pass',
        detail: hit ? `Found forbidden substring "${expected}".` : `Absent as required.`,
      };
    }
    case 'equals': {
      const a = assertion.caseSensitive ? output.trim() : output.trim().toLowerCase();
      const b = assertion.caseSensitive ? expected.trim() : expected.trim().toLowerCase();
      const hit = a === b;
      return {
        ...base,
        status: hit ? 'pass' : 'fail',
        detail: hit ? 'Exact match.' : `Expected exact "${expected}".`,
      };
    }
    case 'regex': {
      let regex: RegExp;
      try {
        regex = new RegExp(expected, assertion.caseSensitive ? '' : 'i');
      } catch (err) {
        return {
          ...base,
          status: 'fail',
          detail: `Invalid regex "${expected}": ${(err as Error).message}`,
        };
      }
      const hit = regex.test(output);
      return {
        ...base,
        status: hit ? 'pass' : 'fail',
        detail: hit ? `Matched /${expected}/.` : `No match for /${expected}/.`,
      };
    }
    case 'llm_judge':
      return {
        ...base,
        status: 'pending',
        detail: 'Requires a judge-model pass (not yet wired into the runtime).',
      };
    default: {
      // Exhaustiveness guard — a new assertion type must be handled above.
      const _never: never = assertion.type;
      return {
        assertionId: assertion.id,
        type: _never,
        status: 'fail',
        detail: `Unknown assertion type.`,
      };
    }
  }
}

/** Grade a single case's response against all of its assertions. */
export function scoreCase(
  evalCase: ResolvedEvalCase,
  output: string,
  passThreshold: number,
): CaseResult {
  const assertionResults = evalCase.assertions.map((a) => scoreAssertion(a, output));
  const resolved = assertionResults.filter((r) => r.status !== 'pending');
  const passedCount = resolved.filter((r) => r.status === 'pass').length;
  const pendingCount = assertionResults.length - resolved.length;

  // No assertions at all → a case is vacuously a pass. Otherwise the score is
  // the fraction of resolved assertions that passed.
  const score = resolved.length === 0 ? 1 : passedCount / resolved.length;
  const passed = pendingCount === 0 && score >= passThreshold;

  return {
    caseId: evalCase.id,
    name: evalCase.name,
    passed,
    score,
    assertionResults,
  };
}

/**
 * Score a whole suite given the agent's output for each case, keyed by case id.
 * Cases with no recorded output are graded against the empty string, which
 * surfaces as failing assertions rather than being silently skipped.
 */
export function scoreSuite(
  suite: ResolvedEvalConfig,
  outputsByCaseId: Record<string, string>,
): SuiteResult {
  const caseResults = suite.cases.map((c) =>
    scoreCase(c, outputsByCaseId[c.id] ?? '', suite.passThreshold),
  );

  const passed = caseResults.filter((c) => c.passed).length;
  const pending = caseResults.filter((c) =>
    c.assertionResults.some((r) => r.status === 'pending'),
  ).length;
  const failed = caseResults.length - passed - pending;
  const passRate = caseResults.length === 0 ? 1 : passed / caseResults.length;

  return {
    evalNodeId: suite.evalNodeId,
    label: suite.label,
    total: caseResults.length,
    passed,
    failed: failed < 0 ? 0 : failed,
    pending,
    passRate,
    caseResults,
  };
}
