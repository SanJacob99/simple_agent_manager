import type {
  ResolvedEvalsConfig,
  ResolvedEvalCase,
  EvalGraderType,
} from '../../shared/agent-config';
import {
  parseSchema,
  extractJson,
  validateAgainstSchema,
} from '../runtime/structured-output-engine';

/**
 * Evaluation runner.
 *
 * An evals node attaches a dataset of input → expected cases to an agent. This
 * module is the dependency-free scoring substrate behind the `sam eval` command
 * and the Settings evals panel. It does two things:
 *
 *   1. `gradeCase` scores a single reply against an expected value using the
 *      case's grader (exact-match, contains, regex, JSON-schema, or
 *      LLM-as-judge). Deterministic graders run inline; `llm_judge` delegates
 *      to an injected judge function so this module pulls in no model client.
 *   2. `EvalRunner.run` replays every case through an injected executor (the
 *      thing that actually prompts the resolved agent), scores each reply, and
 *      aggregates a weighted suite score with a pass/fail verdict and an
 *      optional regression check against a prior best score.
 *
 * The model execution and judge calls are injected rather than imported so the
 * runner stays free of runtime/React/network dependencies and is unit-testable
 * without touching a model. Wiring it to `server/agents/run-coordinator.ts`
 * (replay each case as a headless ephemeral run) and exposing a `sam eval`
 * subcommand is the remaining integration step; the API below is the stable
 * surface that wiring should target.
 */

export interface GradeResult {
  /** Whether this case is considered a pass (score === 1 for binary graders). */
  passed: boolean;
  /** Continuous score, 0..1. Binary graders return 0 or 1. */
  score: number;
  /** Human-readable explanation of the score. */
  detail: string;
}

export interface CaseResult extends GradeResult {
  caseId: string;
  grader: EvalGraderType;
  weight: number;
  input: string;
  expected: string;
  actual: string;
  /** Wall-clock latency of the case execution in ms, when measured by the caller. */
  latencyMs?: number;
  /** Set when the case executor or grader threw rather than producing a reply. */
  error?: string;
}

export interface EvalReport {
  evalsNodeId: string;
  label: string;
  /** Weighted mean score across cases, 0..1. */
  score: number;
  /** Fraction of cases that passed, 0..1 (unweighted). */
  passRate: number;
  /** True when `score >= passThreshold`. */
  passed: boolean;
  passThreshold: number;
  total: number;
  passedCount: number;
  results: CaseResult[];
  /**
   * Populated only when `failOnRegression` is set and a `previousBest` was
   * supplied: true when this run's score dropped below the prior best.
   */
  regressed?: boolean;
  previousBest?: number;
}

/** Executes one case input through the resolved agent and returns its final reply. */
export type CaseExecutor = (caseInput: string, evalCase: ResolvedEvalCase) => Promise<string>;

/** Scores a reply with a judge model. Returns a 0..1 score for `llm_judge` cases. */
export type JudgeFn = (params: {
  judgePrompt: string;
  judgeModelId: string;
  input: string;
  expected: string;
  actual: string;
}) => Promise<GradeResult>;

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function binary(passed: boolean, detail: string): GradeResult {
  return { passed, score: passed ? 1 : 0, detail };
}

/**
 * Score a reply with a deterministic grader (everything except `llm_judge`).
 * Returns null for `llm_judge`, which must be graded asynchronously by a judge.
 */
export function gradeDeterministic(
  grader: EvalGraderType,
  expected: string,
  actual: string,
): GradeResult | null {
  const reply = actual.trim();
  switch (grader) {
    case 'exact_match':
      return binary(reply === expected.trim(), reply === expected.trim() ? 'exact match' : 'reply did not equal expected');
    case 'contains': {
      const hit = reply.toLowerCase().includes(expected.trim().toLowerCase());
      return binary(hit, hit ? 'expected substring found' : 'expected substring not found');
    }
    case 'regex': {
      let re: RegExp;
      try {
        re = new RegExp(expected);
      } catch (err) {
        return binary(false, `invalid regex: ${(err as Error).message}`);
      }
      const hit = re.test(reply);
      return binary(hit, hit ? 'regex matched' : 'regex did not match');
    }
    case 'json_schema': {
      const schema = parseSchema(expected);
      if (!schema) return binary(false, 'expected is not a valid JSON Schema object');
      const parsed = extractJson(reply);
      if ('error' in parsed) return binary(false, `reply is not JSON: ${parsed.error}`);
      const result = validateAgainstSchema(parsed.value, schema);
      if (result.valid) return binary(true, 'reply satisfies schema');
      return binary(false, result.errors.map((e) => `${e.path}: ${e.message}`).join('; '));
    }
    case 'llm_judge':
      return null;
  }
}

/**
 * Grade one case end-to-end. Deterministic graders resolve inline; `llm_judge`
 * cases require `judge`. A missing judge for an `llm_judge` case is reported as
 * a failed case rather than thrown, so a suite can mix grader types freely.
 */
export async function gradeCase(
  config: ResolvedEvalsConfig,
  evalCase: ResolvedEvalCase,
  actual: string,
  judge?: JudgeFn,
): Promise<GradeResult> {
  const deterministic = gradeDeterministic(evalCase.grader, evalCase.expected, actual);
  if (deterministic) return deterministic;
  // llm_judge
  if (!judge) return binary(false, 'llm_judge case has no judge function configured');
  const result = await judge({
    judgePrompt: config.judgePrompt,
    judgeModelId: config.judgeModelId,
    input: evalCase.input,
    expected: evalCase.expected,
    actual,
  });
  return { ...result, score: clamp01(result.score) };
}

/** Aggregate per-case results into a weighted suite score and verdict. */
export function scoreSuite(
  results: CaseResult[],
  passThreshold: number,
): { score: number; passRate: number; passed: boolean; passedCount: number } {
  if (results.length === 0) {
    return { score: 0, passRate: 0, passed: false, passedCount: 0 };
  }
  const totalWeight = results.reduce((sum, r) => sum + r.weight, 0) || 1;
  const weighted = results.reduce((sum, r) => sum + r.score * r.weight, 0);
  const score = clamp01(weighted / totalWeight);
  const passedCount = results.filter((r) => r.passed).length;
  return {
    score,
    passRate: passedCount / results.length,
    passed: score >= passThreshold,
    passedCount,
  };
}

/**
 * Runs an eval suite by replaying every case through an injected executor and
 * scoring each reply. Concurrency is bounded by `config.maxConcurrency`.
 */
export class EvalRunner {
  private readonly config: ResolvedEvalsConfig;
  private readonly execute: CaseExecutor;
  private readonly judge?: JudgeFn;

  constructor(
    config: ResolvedEvalsConfig,
    deps: { execute: CaseExecutor; judge?: JudgeFn },
  ) {
    this.config = config;
    this.execute = deps.execute;
    this.judge = deps.judge;
  }

  /** Run the full suite. `previousBest` enables the regression check when set. */
  async run(previousBest?: number): Promise<EvalReport> {
    const cases = this.config.cases;
    const concurrency = Math.max(1, this.config.maxConcurrency || 1);
    const results: CaseResult[] = new Array(cases.length);
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (cursor < cases.length) {
        const index = cursor++;
        results[index] = await this.runOne(cases[index]);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, cases.length) }, () => worker()),
    );

    const agg = scoreSuite(results, this.config.passThreshold);
    const report: EvalReport = {
      evalsNodeId: this.config.evalsNodeId,
      label: this.config.label,
      score: agg.score,
      passRate: agg.passRate,
      passed: agg.passed,
      passThreshold: this.config.passThreshold,
      total: results.length,
      passedCount: agg.passedCount,
      results,
    };
    if (this.config.failOnRegression && typeof previousBest === 'number') {
      report.previousBest = previousBest;
      report.regressed = agg.score < previousBest;
    }
    return report;
  }

  private async runOne(evalCase: ResolvedEvalCase): Promise<CaseResult> {
    const base = {
      caseId: evalCase.id,
      grader: evalCase.grader,
      weight: evalCase.weight,
      input: evalCase.input,
      expected: evalCase.expected,
    };
    let actual = '';
    try {
      actual = await this.execute(evalCase.input, evalCase);
    } catch (err) {
      return { ...base, actual: '', passed: false, score: 0, detail: 'execution failed', error: (err as Error).message };
    }
    try {
      const grade = await gradeCase(this.config, evalCase, actual, this.judge);
      return { ...base, actual, ...grade };
    } catch (err) {
      return { ...base, actual, passed: false, score: 0, detail: 'grading failed', error: (err as Error).message };
    }
  }
}

export function createEvalRunner(
  config: ResolvedEvalsConfig,
  deps: { execute: CaseExecutor; judge?: JudgeFn },
): EvalRunner {
  return new EvalRunner(config, deps);
}
