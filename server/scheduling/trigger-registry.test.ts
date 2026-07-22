import { describe, expect, it } from 'vitest';
import type { ResolvedTriggerConfig } from '../../shared/agent-config';
import {
  describeTrigger,
  evaluateFilter,
  matchesFileEvent,
  renderPrompt,
  TriggerGate,
  validateTrigger,
  webhookAuthRequired,
  type TriggerEvent,
} from './trigger-registry';

function makeConfig(overrides: Partial<ResolvedTriggerConfig> = {}): ResolvedTriggerConfig {
  return {
    triggerNodeId: 't1',
    label: 'Trigger',
    enabled: true,
    source: 'webhook',
    prompt: 'Handle: {{event.action}}',
    sessionMode: 'ephemeral',
    filter: '',
    debounceMs: 0,
    maxConcurrent: 1,
    retentionDays: 7,
    webhookPath: '/hooks/incoming',
    webhookMethod: 'POST',
    webhookSecretEnvVar: '',
    watchPath: '',
    watchGlob: '',
    watchEvents: ['create', 'modify'],
    queueTarget: '',
    queueConnectionEnvVar: '',
    emailAddress: '',
    ...overrides,
  };
}

function makeEvent(overrides: Partial<TriggerEvent> = {}): TriggerEvent {
  return { source: 'webhook', payload: {}, ...overrides };
}

describe('renderPrompt', () => {
  it('substitutes a single field', () => {
    const out = renderPrompt(makeConfig(), makeEvent({ payload: { action: 'opened' } }));
    expect(out).toBe('Handle: opened');
  });

  it('expands nested fields and the whole event', () => {
    const cfg = makeConfig({ prompt: 'repo={{event.repo.name}} all={{event}}' });
    const out = renderPrompt(cfg, makeEvent({ payload: { repo: { name: 'sam' } } }));
    expect(out).toContain('repo=sam');
    expect(out).toContain('"name": "sam"');
  });

  it('renders missing fields as empty and leaves unknown placeholders untouched', () => {
    const cfg = makeConfig({ prompt: 'a={{event.missing}} b={{other}}' });
    expect(renderPrompt(cfg, makeEvent())).toBe('a= b={{other}}');
  });

  it('serializes object fields as compact JSON', () => {
    const cfg = makeConfig({ prompt: '{{event.data}}' });
    const out = renderPrompt(cfg, makeEvent({ payload: { data: { x: 1 } } }));
    expect(out).toBe('{"x":1}');
  });
});

describe('evaluateFilter', () => {
  it('matches everything when empty', () => {
    expect(evaluateFilter('', makeEvent()).reason).toBe('empty');
    expect(evaluateFilter('', makeEvent()).matched).toBe(true);
  });

  it('handles equality and inequality on strings', () => {
    const ev = makeEvent({ payload: { action: 'opened' } });
    expect(evaluateFilter('event.action == "opened"', ev).matched).toBe(true);
    expect(evaluateFilter('event.action != "closed"', ev).matched).toBe(true);
    expect(evaluateFilter('event.action == "closed"', ev).matched).toBe(false);
  });

  it('compares numbers, booleans, and null', () => {
    expect(evaluateFilter('event.count == 0', makeEvent({ payload: { count: 0 } })).matched).toBe(true);
    expect(evaluateFilter('event.merged == true', makeEvent({ payload: { merged: true } })).matched).toBe(true);
    expect(evaluateFilter('event.ref == null', makeEvent({ payload: {} })).matched).toBe(true);
  });

  it('evaluates bare-field truthiness', () => {
    expect(evaluateFilter('event.merged', makeEvent({ payload: { merged: true } })).matched).toBe(true);
    expect(evaluateFilter('event.merged', makeEvent({ payload: { merged: false } })).matched).toBe(false);
    expect(evaluateFilter('event', makeEvent({ payload: { a: 1 } })).matched).toBe(true);
    expect(evaluateFilter('event', makeEvent({ payload: {} })).matched).toBe(false);
  });

  it('fails closed on an unparseable expression', () => {
    const res = evaluateFilter('event.action AND something', makeEvent());
    expect(res.matched).toBe(false);
    expect(res.reason).toBe('parse_error');
    expect(res.error).toBeTruthy();
  });
});

describe('matchesFileEvent', () => {
  it('rejects file events not in watchEvents', () => {
    const cfg = makeConfig({ source: 'fileWatch', watchEvents: ['create'] });
    expect(matchesFileEvent(cfg, makeEvent({ fileEvent: 'delete', path: 'a.ts' }))).toBe(false);
    expect(matchesFileEvent(cfg, makeEvent({ fileEvent: 'create', path: 'a.ts' }))).toBe(true);
  });

  it('applies the glob within and across segments', () => {
    const seg = makeConfig({ source: 'fileWatch', watchGlob: 'src/*.ts' });
    expect(matchesFileEvent(seg, makeEvent({ fileEvent: 'modify', path: 'src/a.ts' }))).toBe(true);
    expect(matchesFileEvent(seg, makeEvent({ fileEvent: 'modify', path: 'src/nested/a.ts' }))).toBe(false);

    const deep = makeConfig({ source: 'fileWatch', watchGlob: 'src/**/*.ts' });
    expect(matchesFileEvent(deep, makeEvent({ fileEvent: 'modify', path: 'src/nested/a.ts' }))).toBe(true);
  });

  it('matches everything when the glob is empty', () => {
    const cfg = makeConfig({ source: 'fileWatch', watchGlob: '' });
    expect(matchesFileEvent(cfg, makeEvent({ fileEvent: 'create', path: 'anything' }))).toBe(true);
  });
});

describe('validateTrigger', () => {
  it('accepts a coherent webhook trigger', () => {
    expect(validateTrigger(makeConfig())).toEqual([]);
  });

  it('flags source-specific gaps', () => {
    expect(validateTrigger(makeConfig({ source: 'webhook', webhookPath: '' }))).toContain(
      'webhook source needs a webhookPath',
    );
    expect(validateTrigger(makeConfig({ source: 'fileWatch', watchPath: '' })).join()).toContain(
      'fileWatch source needs a watchPath',
    );
    expect(validateTrigger(makeConfig({ source: 'queue', queueTarget: '' }))).toContain(
      'queue source needs a queueTarget',
    );
    expect(validateTrigger(makeConfig({ source: 'emailInbound', emailAddress: '' }))).toContain(
      'emailInbound source needs an emailAddress',
    );
  });

  it('flags an empty prompt and bad limits', () => {
    const problems = validateTrigger(makeConfig({ prompt: '  ', maxConcurrent: 0, debounceMs: -1 }));
    expect(problems.some((p) => p.includes('prompt is empty'))).toBe(true);
    expect(problems.some((p) => p.includes('maxConcurrent'))).toBe(true);
    expect(problems.some((p) => p.includes('debounceMs'))).toBe(true);
  });
});

describe('webhookAuthRequired / describeTrigger', () => {
  it('reports signed webhooks', () => {
    expect(webhookAuthRequired(makeConfig({ webhookSecretEnvVar: 'HOOK_SECRET' }))).toBe(true);
    expect(webhookAuthRequired(makeConfig({ webhookSecretEnvVar: '' }))).toBe(false);
  });

  it('summarizes each source', () => {
    expect(describeTrigger(makeConfig())).toBe('POST /hooks/incoming');
    expect(describeTrigger(makeConfig({ webhookSecretEnvVar: 'S' }))).toContain('(signed)');
    expect(describeTrigger(makeConfig({ source: 'manual' }))).toBe('manual dispatch');
  });
});

describe('TriggerGate', () => {
  it('admits an enabled, matching event and renders its prompt', () => {
    const gate = new TriggerGate();
    const res = gate.admit(makeConfig(), makeEvent({ payload: { action: 'opened' } }), 1000);
    expect(res).toEqual({ action: 'run', prompt: 'Handle: opened' });
    expect(gate.activeRuns('t1')).toBe(1);
  });

  it('skips disabled, invalid, and filtered events', () => {
    const gate = new TriggerGate();
    expect(gate.admit(makeConfig({ enabled: false }), makeEvent(), 0).action).toBe('skip');
    expect(gate.admit(makeConfig({ webhookPath: '' }), makeEvent(), 0)).toMatchObject({
      reason: 'invalid',
    });
    expect(
      gate.admit(makeConfig({ filter: 'event.action == "closed"' }), makeEvent({ payload: { action: 'opened' } }), 0),
    ).toMatchObject({ reason: 'filtered' });
  });

  it('coalesces a burst within the debounce window', () => {
    const gate = new TriggerGate();
    const cfg = makeConfig({ debounceMs: 500, maxConcurrent: 5 });
    expect(gate.admit(cfg, makeEvent({ payload: { action: 'a' } }), 1000).action).toBe('run');
    gate.complete('t1');
    expect(gate.admit(cfg, makeEvent({ payload: { action: 'a' } }), 1200)).toMatchObject({ reason: 'debounced' });
    gate.complete('t1');
    expect(gate.admit(cfg, makeEvent({ payload: { action: 'a' } }), 1600).action).toBe('run');
  });

  it('enforces the concurrency ceiling and releases on complete', () => {
    const gate = new TriggerGate();
    const cfg = makeConfig({ maxConcurrent: 2 });
    expect(gate.admit(cfg, makeEvent(), 1).action).toBe('run');
    expect(gate.admit(cfg, makeEvent(), 2).action).toBe('run');
    expect(gate.admit(cfg, makeEvent(), 3)).toMatchObject({ reason: 'at_capacity' });
    gate.complete('t1');
    expect(gate.admit(cfg, makeEvent(), 4).action).toBe('run');
    expect(gate.activeRuns('t1')).toBe(2);
  });
});
