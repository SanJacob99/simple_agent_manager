import { describe, expect, it } from 'vitest';
import type { ResolvedReflectionConfig } from '../../shared/agent-config';
import {
  buildCritiquePrompt,
  buildRevisePrompt,
  parseCritique,
  runReflection,
  shouldReflect,
  type CriticFn,
  type ReviseFn,
} from './reflection-engine';

function makeConfig(
  overrides: Partial<ResolvedReflectionConfig> = {},
): ResolvedReflectionConfig {
  return {
    reflectionNodeId: 'r1',
    label: 'Reflection',
    enabled: true,
    rubric: 'Be correct and complete.',
    maxRevisions: 2,
    scoreThreshold: 0.7,
    criticModelId: '',
    onMaxRevisions: 'accept_best',
    includeCritiqueInTranscript: false,
    ...overrides,
  };
}

/** Critic that returns the next queued score, cycling the critique text. */
function scriptedCritic(scores: number[]): CriticFn {
  let i = 0;
  return async (reply) => {
    const score = scores[Math.min(i, scores.length - 1)];
    i++;
    return { score, critique: `improve: ${reply}` };
  };
}

/** Revise that appends a marker so we can tell revisions apart. */
const appendRevise: ReviseFn = async (reply) => `${reply}+`;

describe('shouldReflect', () => {
  it('is false for null / disabled config', () => {
    expect(shouldReflect(null)).toBe(false);
    expect(shouldReflect(undefined)).toBe(false);
    expect(shouldReflect(makeConfig({ enabled: false }))).toBe(false);
  });

  it('is true for an enabled config', () => {
    expect(shouldReflect(makeConfig())).toBe(true);
  });
});

describe('runReflection', () => {
  it('accepts the candidate immediately when it already passes', async () => {
    const result = await runReflection(makeConfig(), 'draft', {
      critic: scriptedCritic([0.9]),
      revise: appendRevise,
    });
    expect(result.accepted).toBe(true);
    expect(result.selection).toBe('threshold');
    expect(result.revisions).toBe(0);
    expect(result.finalReply).toBe('draft');
    expect(result.attempts).toHaveLength(1);
  });

  it('revises until an attempt reaches the threshold', async () => {
    const result = await runReflection(makeConfig({ maxRevisions: 3 }), 'draft', {
      critic: scriptedCritic([0.3, 0.5, 0.8]),
      revise: appendRevise,
    });
    expect(result.accepted).toBe(true);
    expect(result.revisions).toBe(2);
    expect(result.finalReply).toBe('draft++');
    expect(result.bestScore).toBe(0.8);
    expect(result.attempts.map((a) => a.iteration)).toEqual([0, 1, 2]);
  });

  it('stops after maxRevisions and applies accept_best', async () => {
    const result = await runReflection(
      makeConfig({ maxRevisions: 2, onMaxRevisions: 'accept_best' }),
      'draft',
      { critic: scriptedCritic([0.4, 0.6, 0.5]), revise: appendRevise },
    );
    expect(result.accepted).toBe(false);
    expect(result.revisions).toBe(2);
    expect(result.selection).toBe('accept_best');
    // Best attempt was the middle one (0.6 => "draft+").
    expect(result.finalReply).toBe('draft+');
    expect(result.bestScore).toBe(0.6);
  });

  it('applies accept_last when configured', async () => {
    const result = await runReflection(
      makeConfig({ maxRevisions: 1, onMaxRevisions: 'accept_last' }),
      'draft',
      { critic: scriptedCritic([0.5, 0.4]), revise: appendRevise },
    );
    expect(result.accepted).toBe(false);
    expect(result.selection).toBe('accept_last');
    expect(result.finalReply).toBe('draft+');
  });

  it('reports warn selection but still surfaces the best attempt', async () => {
    const result = await runReflection(
      makeConfig({ maxRevisions: 1, onMaxRevisions: 'warn' }),
      'draft',
      { critic: scriptedCritic([0.6, 0.3]), revise: appendRevise },
    );
    expect(result.accepted).toBe(false);
    expect(result.selection).toBe('warn');
    expect(result.finalReply).toBe('draft'); // 0.6 beat 0.3
  });

  it('never revises when maxRevisions is 0', async () => {
    let revised = false;
    const revise: ReviseFn = async (r) => {
      revised = true;
      return r;
    };
    const result = await runReflection(makeConfig({ maxRevisions: 0 }), 'draft', {
      critic: scriptedCritic([0.1]),
      revise,
    });
    expect(revised).toBe(false);
    expect(result.revisions).toBe(0);
    expect(result.attempts).toHaveLength(1);
  });

  it('clamps out-of-range scores into [0, 1]', async () => {
    const result = await runReflection(makeConfig({ maxRevisions: 0 }), 'draft', {
      critic: scriptedCritic([5]),
      revise: appendRevise,
    });
    expect(result.bestScore).toBe(1);
    expect(result.accepted).toBe(true);
  });
});

describe('parseCritique', () => {
  it('reads a SCORE header and keeps the prose as the critique', () => {
    const out = parseCritique('SCORE: 0.8\nMissing an edge case in the loop.');
    expect(out.score).toBe(0.8);
    expect(out.critique).toBe('Missing an edge case in the loop.');
  });

  it('accepts a bare leading number', () => {
    expect(parseCritique('0.42 needs sources').score).toBeCloseTo(0.42);
  });

  it('normalizes 0..10 and 0..100 scales', () => {
    expect(parseCritique('SCORE: 8').score).toBeCloseTo(0.8);
    expect(parseCritique('Score = 85 good enough').score).toBeCloseTo(0.85);
  });

  it('falls back to 0 when no score is present', () => {
    expect(parseCritique('no number here').score).toBe(0);
  });
});

describe('prompt builders', () => {
  it('includes rubric and reply in the critique prompt', () => {
    const prompt = buildCritiquePrompt('the answer', 'Be concise.');
    expect(prompt).toContain('Be concise.');
    expect(prompt).toContain('the answer');
    expect(prompt).toContain('SCORE:');
  });

  it('falls back to a default rubric when empty', () => {
    expect(buildCritiquePrompt('x', '   ')).toContain('answer quality');
    expect(buildRevisePrompt('x', 'c', '')).toContain('answer quality');
  });

  it('feeds the critique into the revise prompt', () => {
    const prompt = buildRevisePrompt('draft', 'add a test', 'Be correct.');
    expect(prompt).toContain('add a test');
    expect(prompt).toContain('draft');
    expect(prompt).toContain('Be correct.');
  });
});
