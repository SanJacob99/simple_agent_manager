import { describe, expect, it } from 'vitest';
import type { ResolvedReflectionConfig } from '../../shared/agent-config';
import {
  buildCritiquePrompt,
  buildRevisionPrompt,
  buildRubricPromptSection,
  normalizeScore,
  parseCritique,
  selectFinal,
  shouldRevise,
  type ReflectionAttempt,
} from './reflection-engine';

function makeConfig(
  overrides: Partial<ResolvedReflectionConfig> = {},
): ResolvedReflectionConfig {
  return {
    reflectionNodeId: 'r1',
    label: 'Reflection',
    enabled: true,
    rubric: 'The answer is correct and complete.',
    scoreThreshold: 0.8,
    maxRevisions: 1,
    criticModelId: '',
    critiquePrompt: '',
    onExhaustion: 'use_best',
    injectRubricIntoPrompt: false,
    ...overrides,
  };
}

function critique(score: number, threshold = 0.8, feedback = ''): ReflectionAttempt['critique'] {
  return { score, pass: score >= threshold, feedback };
}

describe('normalizeScore', () => {
  it('keeps 0..1 scores as-is', () => {
    expect(normalizeScore(0.7)).toBe(0.7);
    expect(normalizeScore(1)).toBe(1);
    expect(normalizeScore(0)).toBe(0);
  });

  it('rescales 0..10 and 0..100 scores', () => {
    expect(normalizeScore(7)).toBeCloseTo(0.7);
    expect(normalizeScore(85)).toBeCloseTo(0.85);
  });

  it('clamps and defaults non-finite input', () => {
    expect(normalizeScore(-5)).toBe(0);
    expect(normalizeScore(1000)).toBe(1);
    expect(normalizeScore('nope')).toBe(0);
  });
});

describe('parseCritique', () => {
  it('parses a bare JSON verdict', () => {
    const c = parseCritique('{"score":0.9,"feedback":"good"}', 0.8);
    expect(c).toEqual({ score: 0.9, pass: true, feedback: 'good' });
  });

  it('parses a fenced json verdict and derives pass from threshold', () => {
    const c = parseCritique('Review:\n```json\n{"score":0.5,"feedback":"thin"}\n```', 0.8);
    expect(c?.pass).toBe(false);
    expect(c?.score).toBe(0.5);
  });

  it('honours an explicit pass flag over the threshold', () => {
    const c = parseCritique('{"score":0.5,"pass":true,"feedback":"ok"}', 0.8);
    expect(c?.pass).toBe(true);
  });

  it('falls back to a score: line in prose', () => {
    const c = parseCritique('Overall score: 0.4 — needs work', 0.8);
    expect(c?.score).toBe(0.4);
    expect(c?.pass).toBe(false);
  });

  it('returns null when no score can be recovered', () => {
    expect(parseCritique('looks fine to me', 0.8)).toBeNull();
  });
});

describe('shouldRevise', () => {
  it('stops when the critique passes', () => {
    expect(shouldRevise(makeConfig(), critique(0.9), 0)).toBe(false);
  });

  it('revises a failing draft while budget remains', () => {
    expect(shouldRevise(makeConfig({ maxRevisions: 2 }), critique(0.4), 0)).toBe(true);
  });

  it('stops once the revision budget is spent', () => {
    expect(shouldRevise(makeConfig({ maxRevisions: 1 }), critique(0.4), 1)).toBe(false);
  });

  it('never revises when disabled', () => {
    expect(shouldRevise(makeConfig({ enabled: false }), critique(0.1), 0)).toBe(false);
  });
});

describe('selectFinal', () => {
  it('returns the passing candidate regardless of policy', () => {
    const attempts: ReflectionAttempt[] = [
      { candidate: 'draft', critique: critique(0.5) },
      { candidate: 'revised', critique: critique(0.9) },
    ];
    const final = selectFinal(makeConfig({ onExhaustion: 'use_last' }), attempts);
    expect(final.reply).toBe('revised');
    expect(final.passed).toBe(true);
    expect(final.reason).toBe('passed');
  });

  it('use_best picks the highest-scored failing candidate', () => {
    const attempts: ReflectionAttempt[] = [
      { candidate: 'draft', critique: critique(0.7) },
      { candidate: 'revised', critique: critique(0.55) },
    ];
    const final = selectFinal(makeConfig({ onExhaustion: 'use_best' }), attempts);
    expect(final.reply).toBe('draft');
    expect(final.passed).toBe(false);
    expect(final.reason).toBe('use_best');
  });

  it('use_last keeps the final revision even if earlier scored higher', () => {
    const attempts: ReflectionAttempt[] = [
      { candidate: 'draft', critique: critique(0.7) },
      { candidate: 'revised', critique: critique(0.6) },
    ];
    const final = selectFinal(makeConfig({ onExhaustion: 'use_last' }), attempts);
    expect(final.reply).toBe('revised');
    expect(final.reason).toBe('use_last');
  });

  it('warn keeps the last revision and signals via reason', () => {
    const attempts: ReflectionAttempt[] = [
      { candidate: 'draft', critique: critique(0.6) },
    ];
    const final = selectFinal(makeConfig({ onExhaustion: 'warn' }), attempts);
    expect(final.reason).toBe('warn');
  });

  it('falls back benignly on an empty attempt list', () => {
    const final = selectFinal(makeConfig(), []);
    expect(final.reply).toBe('');
    expect(final.passed).toBe(false);
  });
});

describe('prompt builders', () => {
  it('rubric section embeds the rubric text', () => {
    expect(buildRubricPromptSection(makeConfig())).toContain('correct and complete');
  });

  it('critique prompt carries rubric, task, candidate, and extra guidance', () => {
    const prompt = buildCritiquePrompt(
      makeConfig({ critiquePrompt: 'Weight factual accuracy.' }),
      'What is 2+2?',
      'It is 5.',
    );
    expect(prompt).toContain('correct and complete');
    expect(prompt).toContain('What is 2+2?');
    expect(prompt).toContain('It is 5.');
    expect(prompt).toContain('Weight factual accuracy.');
  });

  it('revision prompt includes the score and feedback', () => {
    const prompt = buildRevisionPrompt(makeConfig(), 'It is 5.', critique(0.3, 0.8, 'Wrong: 2+2=4.'));
    expect(prompt).toContain('0.30');
    expect(prompt).toContain('Wrong: 2+2=4.');
    expect(prompt).toContain('It is 5.');
  });
});
