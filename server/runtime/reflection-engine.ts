import type {
  ReflectionExhaustionPolicy,
  ResolvedReflectionConfig,
} from '../../shared/agent-config';

/**
 * Reflection / self-critique engine.
 *
 * A reflection node wraps the finalize step in a Reflexion-style
 * draft → critique → revise loop. This module is the dependency-free
 * orchestration substrate the runtime calls once the agent has produced a
 * candidate reply. It does three things:
 *
 *   1. `runReflection` drives the loop: critique the candidate, and while its
 *      score is below the threshold and revisions remain, feed the critique
 *      back for another revision. The critic and revise passes are injected as
 *      functions so the loop is fully testable without a model client — the
 *      runtime supplies real model-backed implementations.
 *   2. `buildCritiquePrompt` / `buildRevisePrompt` produce the prompt text for
 *      those two passes (the stable surface the run-coordinator wiring targets).
 *   3. `parseCritique` extracts a `{ score, critique }` outcome from a judge
 *      reply, tolerating a `SCORE: 0.8` header or a bare leading number, so the
 *      same cheap-judge convention the Evals node uses works here too.
 *
 * Wiring `runReflection` into `server/agents/run-coordinator.ts`'s finalize step
 * (run it after the streamed reply, before Structured Output / Guardrails,
 * replacing the reply with `result.finalReply` and emitting a
 * `reflection:below_threshold` event when `selection` is `warn`) is the
 * remaining integration step; the API below is the stable surface that wiring
 * should target.
 */

export interface CritiqueOutcome {
  /** Quality score in [0, 1]. Values outside the range are clamped. */
  score: number;
  /** Free-text critique fed into the next revision prompt. */
  critique: string;
}

/** Scores a candidate reply against the rubric. Injected by the runtime. */
export type CriticFn = (reply: string, rubric: string) => Promise<CritiqueOutcome>;

/** Produces a revised reply from the prior reply and its critique. Injected by the runtime. */
export type ReviseFn = (
  reply: string,
  critique: string,
  rubric: string,
) => Promise<string>;

export interface ReflectionAttempt {
  /** 0 = the original candidate, 1 = after the first revision, and so on. */
  iteration: number;
  reply: string;
  score: number;
  critique: string;
}

export interface ReflectionResult {
  /** The reply the runtime should emit as the final answer. */
  finalReply: string;
  /** True when some attempt reached `scoreThreshold`. */
  accepted: boolean;
  /** Number of revise passes actually performed. */
  revisions: number;
  /** Highest score across all attempts. */
  bestScore: number;
  /** Every attempt in order, including the original candidate. */
  attempts: ReflectionAttempt[];
  /**
   * How the final reply was chosen once the loop stopped: `threshold` when an
   * attempt passed, otherwise the node's exhaustion policy. When `warn`, the
   * runtime should surface a `reflection:below_threshold` signal.
   */
  selection: 'threshold' | ReflectionExhaustionPolicy;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Whether an enabled reflection node governs this agent's finalize step. */
export function shouldReflect(
  config: ResolvedReflectionConfig | null | undefined,
): config is ResolvedReflectionConfig {
  return !!config && config.enabled;
}

/**
 * Drive the draft → critique → revise loop for a single candidate reply.
 *
 * The loop critiques the current reply; if the score meets `scoreThreshold` it
 * accepts immediately, otherwise — while revise passes remain — it revises and
 * repeats. When revisions are exhausted without meeting the threshold, the
 * node's `onMaxRevisions` policy selects the returned reply.
 */
export async function runReflection(
  config: ResolvedReflectionConfig,
  candidate: string,
  fns: { critic: CriticFn; revise: ReviseFn },
): Promise<ReflectionResult> {
  const threshold = clamp01(config.scoreThreshold);
  const maxRevisions = Math.max(0, Math.floor(config.maxRevisions ?? 0));
  const attempts: ReflectionAttempt[] = [];
  let current = candidate;
  let accepted = false;

  for (let iteration = 0; ; iteration++) {
    const outcome = await fns.critic(current, config.rubric);
    const score = clamp01(outcome.score);
    attempts.push({ iteration, reply: current, score, critique: outcome.critique });

    if (score >= threshold) {
      accepted = true;
      break;
    }
    if (iteration >= maxRevisions) break;
    current = await fns.revise(current, outcome.critique, config.rubric);
  }

  const best = attempts.reduce((a, b) => (b.score > a.score ? b : a), attempts[0]);
  const last = attempts[attempts.length - 1];

  let finalReply: string;
  let selection: ReflectionResult['selection'];
  if (accepted) {
    // The passing attempt is always the most recent one.
    finalReply = last.reply;
    selection = 'threshold';
  } else if (config.onMaxRevisions === 'accept_last') {
    finalReply = last.reply;
    selection = 'accept_last';
  } else {
    // `accept_best` and `warn` both surface the highest-scoring attempt; only
    // the reported selection differs so the runtime can raise a warning.
    finalReply = best.reply;
    selection = config.onMaxRevisions;
  }

  return {
    finalReply,
    accepted,
    revisions: attempts.length - 1,
    bestScore: best.score,
    attempts,
    selection,
  };
}

const RUBRIC_FALLBACK =
  'Judge overall answer quality: correctness, completeness, and how directly it addresses the request.';

/**
 * Prompt for the critic pass. Asks for a `SCORE: <0..1>` header followed by a
 * short critique, which `parseCritique` can read back.
 */
export function buildCritiquePrompt(reply: string, rubric: string): string {
  const criteria = rubric.trim() || RUBRIC_FALLBACK;
  return [
    'You are a strict reviewer scoring a candidate answer.',
    '',
    'Rubric:',
    criteria,
    '',
    'Candidate answer:',
    '"""',
    reply,
    '"""',
    '',
    'Reply with a first line exactly of the form `SCORE: <number between 0 and 1>`,',
    'then, on the following lines, a concise critique naming concrete problems and',
    'the changes that would raise the score. If the answer is already excellent,',
    'give a high score and state that no changes are needed.',
  ].join('\n');
}

/** Prompt for the revise pass. Feeds the critique back and asks for a rewrite. */
export function buildRevisePrompt(
  reply: string,
  critique: string,
  rubric: string,
): string {
  const criteria = rubric.trim() || RUBRIC_FALLBACK;
  return [
    'Revise the answer below so it fully satisfies the rubric and resolves every',
    'issue raised in the critique. Return only the improved answer — no preamble,',
    'no commentary about the changes.',
    '',
    'Rubric:',
    criteria,
    '',
    'Critique to address:',
    critique.trim() || '(no critique provided)',
    '',
    'Current answer:',
    '"""',
    reply,
    '"""',
  ].join('\n');
}

/**
 * Read a `{ score, critique }` outcome out of a judge reply. Accepts a
 * `SCORE: 0.8` header, a `Score - 0.8` variant, or a bare leading number, and
 * treats the remaining text as the critique. Falls back to a neutral 0 when no
 * score can be found so a malformed judge reply forces (rather than skips) a
 * revision.
 */
export function parseCritique(text: string): CritiqueOutcome {
  const trimmed = text.trim();
  const headerMatch = /score\s*[:\-=]?\s*(\d+(?:\.\d+)?|\.\d+)/i.exec(trimmed);
  const leadingMatch = /^\s*(\d+(?:\.\d+)?|\.\d+)/.exec(trimmed);
  const raw = headerMatch?.[1] ?? leadingMatch?.[1];
  let score = 0;
  if (raw != null) {
    let n = Number(raw);
    // Tolerate a 0..100 or 0..10 scale by normalizing anything above 1.
    if (n > 1 && n <= 10) n = n / 10;
    else if (n > 10) n = n / 100;
    score = clamp01(n);
  }

  let critique = trimmed;
  if (headerMatch) {
    // Drop the matched header line so the critique is just the prose.
    const idx = trimmed.indexOf('\n', headerMatch.index);
    critique = idx >= 0 ? trimmed.slice(idx + 1).trim() : '';
  }
  return { score, critique };
}
