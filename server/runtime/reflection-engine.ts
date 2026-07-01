import type { ResolvedReflectionConfig } from '../../shared/agent-config';
import { extractJson } from './structured-output-engine';

/**
 * Reflection / self-critique engine.
 *
 * A reflection node wraps the runtime's finalize step with a Reflexion-style
 * "draft → critique → revise" loop: after the agent produces a candidate reply,
 * a critic pass scores it against a rubric and, while the score is below the
 * threshold, the critique is fed back for another revision. This module is the
 * dependency-free substrate the runtime calls; it owns prompt construction,
 * critic-reply parsing, the revise decision, and the exhaustion policy, while
 * the runtime owns the actual model calls.
 *
 * The orchestration the run-coordinator finalize step performs:
 *
 *   1. Produce candidate_0 (the agent's draft). When `injectRubricIntoPrompt`
 *      is set, `buildRubricPromptSection` was already appended to the system
 *      prompt so the draft targets the rubric.
 *   2. Ask the critic model `buildCritiquePrompt(...)`; parse its reply with
 *      `parseCritique(...)`.
 *   3. `shouldRevise(...)` decides whether to revise. If yes, re-prompt with
 *      `buildRevisionPrompt(...)` to get candidate_{n+1} and loop to step 2.
 *   4. When the loop ends, `selectFinal(...)` applies the exhaustion policy and
 *      returns the candidate to finalize plus whether the threshold was met.
 *
 * Wiring this into `server/agents/run-coordinator.ts` (run the loop around
 * `runtime.prompt()`, resolve `criticModelId` via the model resolver, emit a
 * `reflection:revised` / `reflection:below_threshold` event) is the remaining
 * integration step; the API below is the stable surface that wiring targets.
 */

/** One critic verdict on a candidate reply. */
export interface Critique {
  /** Normalized critic score, 0..1. */
  score: number;
  /** Whether the score met or exceeded the configured threshold. */
  pass: boolean;
  /** Actionable critique text fed back into a revision prompt. */
  feedback: string;
}

/** A candidate reply paired with the critique it earned. */
export interface ReflectionAttempt {
  candidate: string;
  critique: Critique;
}

/**
 * Normalize a raw critic score into 0..1. Critics are asked for 0..1, but they
 * commonly answer on a 0..10 or 0..100 scale; treat values above 1 as one of
 * those and rescale, then clamp. Non-finite input collapses to 0.
 */
export function normalizeScore(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0;
  let score = n;
  if (score > 1 && score <= 10) score = score / 10;
  else if (score > 10) score = score / 100;
  return Math.min(1, Math.max(0, score));
}

/**
 * Parse a critic model's reply into a `Critique`. Tolerates a bare JSON object,
 * a fenced ```json block, JSON embedded in prose (via `extractJson`), and a
 * plain `score: 0.7` line as a last resort. Returns `null` when no score can be
 * recovered, which the runtime treats as "cannot critique" (pass the draft
 * through unchanged rather than loop forever).
 */
export function parseCritique(text: string, threshold: number): Critique | null {
  const extracted = extractJson(text);
  if ('value' in extracted && extracted.value && typeof extracted.value === 'object') {
    const obj = extracted.value as Record<string, unknown>;
    if ('score' in obj) {
      const score = normalizeScore(obj.score);
      const feedback =
        typeof obj.feedback === 'string'
          ? obj.feedback
          : typeof obj.critique === 'string'
            ? obj.critique
            : '';
      const pass = typeof obj.pass === 'boolean' ? obj.pass : score >= threshold;
      return { score, pass, feedback };
    }
  }

  // Fallback: a `score: 0.7` / `score = 7/10` style line in free text.
  const match = /score\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)/i.exec(text);
  if (match) {
    const score = normalizeScore(Number(match[1]));
    return { score, pass: score >= threshold, feedback: text.trim() };
  }
  return null;
}

/**
 * System-prompt section that primes the agent to target the rubric on its first
 * draft. Appended to the agent prompt when `injectRubricIntoPrompt` is set.
 */
export function buildRubricPromptSection(config: ResolvedReflectionConfig): string {
  return [
    '## Quality bar',
    '',
    'Before you answer, make sure your reply satisfies these criteria:',
    '',
    config.rubric.trim(),
  ].join('\n');
}

/**
 * Prompt handed to the critic model. Asks for a JSON verdict so `parseCritique`
 * can recover a score and actionable feedback.
 */
export function buildCritiquePrompt(
  config: ResolvedReflectionConfig,
  userTask: string,
  candidate: string,
): string {
  const lines = [
    'You are a strict reviewer. Score how well the CANDIDATE reply satisfies the',
    'RUBRIC for the given TASK. Respond with ONLY a JSON object of the form:',
    '{ "score": <number between 0 and 1>, "feedback": "<specific, actionable critique>" }',
    '',
    '## Rubric',
    config.rubric.trim(),
  ];
  if (config.critiquePrompt.trim()) {
    lines.push('', '## Additional guidance', config.critiquePrompt.trim());
  }
  lines.push(
    '',
    '## Task',
    userTask.trim(),
    '',
    '## Candidate',
    candidate.trim(),
    '',
    'Be concise. Lower the score for anything that fails the rubric, and explain',
    'in "feedback" exactly what to change to improve it.',
  );
  return lines.join('\n');
}

/**
 * Re-prompt text handed to the agent to produce a revised reply, carrying the
 * critic's feedback so the next draft is targeted.
 */
export function buildRevisionPrompt(
  config: ResolvedReflectionConfig,
  candidate: string,
  critique: Critique,
): string {
  return [
    `A reviewer scored your previous reply ${critique.score.toFixed(2)} out of 1.0,`,
    `below the required ${config.scoreThreshold.toFixed(2)}. Their feedback:`,
    '',
    critique.feedback.trim() || '- (no specific feedback provided)',
    '',
    'Revise your reply to address every point above while still fully answering',
    'the original request. Return only the improved reply.',
    '',
    '## Your previous reply',
    candidate.trim(),
  ].join('\n');
}

/**
 * Whether to spend another revision. False once the critique passes, once the
 * revision budget is spent, or when reflection is disabled.
 *
 * @param attempt zero-based index of the critique just produced (0 = the draft).
 */
export function shouldRevise(
  config: ResolvedReflectionConfig,
  critique: Critique,
  attempt: number,
): boolean {
  if (!config.enabled) return false;
  if (critique.pass) return false;
  return attempt < config.maxRevisions;
}

export interface ReflectionFinal {
  /** The candidate reply the runtime should finalize. */
  reply: string;
  /** Whether the chosen reply met the score threshold. */
  passed: boolean;
  /** Score of the chosen reply. */
  score: number;
  /** How the final reply was chosen. */
  reason: 'passed' | 'use_best' | 'use_last' | 'warn';
}

/**
 * Apply the exhaustion policy to the recorded attempts and return the reply to
 * finalize. If any attempt passed, that one wins regardless of policy. Otherwise
 * `use_best` picks the highest score, `use_last` / `warn` pick the final
 * revision (`warn` additionally signals the caller to emit a below-threshold
 * event). An empty list is a programming error guarded with a benign fallback.
 */
export function selectFinal(
  config: ResolvedReflectionConfig,
  attempts: ReflectionAttempt[],
): ReflectionFinal {
  if (attempts.length === 0) {
    return { reply: '', passed: false, score: 0, reason: 'warn' };
  }

  const passing = attempts.find((a) => a.critique.pass);
  if (passing) {
    return {
      reply: passing.candidate,
      passed: true,
      score: passing.critique.score,
      reason: 'passed',
    };
  }

  if (config.onExhaustion === 'use_best') {
    const best = attempts.reduce((a, b) =>
      b.critique.score > a.critique.score ? b : a,
    );
    return { reply: best.candidate, passed: false, score: best.critique.score, reason: 'use_best' };
  }

  const last = attempts[attempts.length - 1];
  return {
    reply: last.candidate,
    passed: false,
    score: last.critique.score,
    reason: config.onExhaustion === 'warn' ? 'warn' : 'use_last',
  };
}
