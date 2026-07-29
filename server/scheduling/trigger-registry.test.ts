import { describe, expect, it } from 'vitest';
import type { ResolvedTriggerConfig } from '../../shared/agent-config';
import {
  TriggerRegistry,
  buildRunPrompt,
  parseWatchGlobs,
  validateTriggerConfig,
  verifyWebhookSignature,
  type TriggerEvent,
} from './trigger-registry';

function makeTrigger(overrides: Partial<ResolvedTriggerConfig> = {}): ResolvedTriggerConfig {
  return {
    triggerNodeId: 't1',
    label: 'Trigger',
    enabled: true,
    kind: 'webhook',
    prompt: 'Handle the event.',
    sessionMode: 'ephemeral',
    webhookPath: '/hook',
    webhookSecret: '',
    watchPaths: '',
    watchEvents: ['add', 'change'],
    queueName: '',
    debounceMs: 0,
    maxRunDurationMs: 300000,
    retentionDays: 7,
    ...overrides,
  };
}

function evt(overrides: Partial<TriggerEvent> = {}): TriggerEvent {
  return { triggerNodeId: 't1', kind: 'webhook', at: 1000, ...overrides };
}

describe('verifyWebhookSignature', () => {
  it('accepts any request when no secret is configured', () => {
    expect(verifyWebhookSignature('', undefined)).toBe(true);
    expect(verifyWebhookSignature('', 'anything')).toBe(true);
  });

  it('requires a matching signature when a secret is set', () => {
    expect(verifyWebhookSignature('s3cret', 's3cret')).toBe(true);
    expect(verifyWebhookSignature('s3cret', 'nope')).toBe(false);
    expect(verifyWebhookSignature('s3cret', undefined)).toBe(false);
    expect(verifyWebhookSignature('s3cret', 's3cre')).toBe(false); // length mismatch
  });
});

describe('validateTriggerConfig', () => {
  it('passes a well-formed webhook trigger', () => {
    expect(validateTriggerConfig(makeTrigger())).toEqual([]);
  });

  it('flags an empty prompt', () => {
    expect(validateTriggerConfig(makeTrigger({ prompt: '  ' }))).toContain(
      'prompt is empty; a triggered run has nothing to do',
    );
  });

  it('flags a webhook path without a leading slash', () => {
    const problems = validateTriggerConfig(makeTrigger({ webhookPath: 'hook' }));
    expect(problems).toContain('webhookPath must start with "/"');
  });

  it('requires paths and events for a fileWatch trigger', () => {
    const problems = validateTriggerConfig(
      makeTrigger({ kind: 'fileWatch', watchPaths: '', watchEvents: [] }),
    );
    expect(problems).toContain('fileWatch trigger needs at least one watch path');
    expect(problems).toContain('fileWatch trigger needs at least one watch event');
  });

  it('requires a queue name for a queue trigger', () => {
    expect(validateTriggerConfig(makeTrigger({ kind: 'queue', queueName: '' }))).toContain(
      'queue trigger needs a queueName',
    );
  });

  it('accepts a manual trigger with no extra config', () => {
    expect(validateTriggerConfig(makeTrigger({ kind: 'manual' }))).toEqual([]);
  });
});

describe('buildRunPrompt', () => {
  it('returns the bare prompt when there is no payload', () => {
    expect(buildRunPrompt(makeTrigger(), evt())).toBe('Handle the event.');
  });

  it('appends a string payload in a fenced block', () => {
    const out = buildRunPrompt(makeTrigger(), evt({ payload: 'deploy #42 succeeded' }));
    expect(out).toContain('## Event payload (webhook)');
    expect(out).toContain('deploy #42 succeeded');
  });

  it('serializes an object payload as JSON', () => {
    const out = buildRunPrompt(makeTrigger(), evt({ payload: { ref: 'main', ok: true } }));
    expect(out).toContain('"ref": "main"');
    expect(out).toContain('"ok": true');
  });
});

describe('parseWatchGlobs', () => {
  it('splits, trims, and drops empties', () => {
    expect(parseWatchGlobs('src/**/*.ts, , docs/** ')).toEqual(['src/**/*.ts', 'docs/**']);
    expect(parseWatchGlobs('')).toEqual([]);
  });
});

describe('TriggerRegistry', () => {
  it('is inactive with no enabled sources', () => {
    expect(new TriggerRegistry([]).active).toBe(false);
    expect(new TriggerRegistry([makeTrigger({ enabled: false })]).active).toBe(false);
    expect(new TriggerRegistry([makeTrigger()]).active).toBe(true);
  });

  it('fires a matching event and returns the run prompt + session mode', () => {
    const reg = new TriggerRegistry([makeTrigger({ sessionMode: 'persistent' })]);
    const decision = reg.fire(evt({ payload: 'hi' }));
    expect(decision.fire).toBe(true);
    expect(decision.reason).toBe('fired');
    expect(decision.sessionMode).toBe('persistent');
    expect(decision.runPrompt).toContain('hi');
  });

  it('does not fire for an unknown source', () => {
    const reg = new TriggerRegistry([makeTrigger()]);
    expect(reg.fire(evt({ triggerNodeId: 'other' }))).toEqual({
      fire: false,
      reason: 'unknown_source',
    });
  });

  it('does not fire when the event kind mismatches the source', () => {
    const reg = new TriggerRegistry([makeTrigger({ kind: 'webhook' })]);
    expect(reg.fire(evt({ kind: 'queue' })).reason).toBe('kind_mismatch');
  });

  it('rejects a webhook with a bad signature', () => {
    const reg = new TriggerRegistry([makeTrigger({ webhookSecret: 'abc' })]);
    expect(reg.fire(evt({ signature: 'xyz' })).reason).toBe('bad_signature');
    expect(reg.fire(evt({ signature: 'abc' })).fire).toBe(true);
  });

  it('debounces bursts inside the window but fires again after it', () => {
    const reg = new TriggerRegistry([makeTrigger({ debounceMs: 1000 })]);
    expect(reg.fire(evt({ at: 0 })).fire).toBe(true);
    expect(reg.fire(evt({ at: 500 })).reason).toBe('debounced');
    expect(reg.fire(evt({ at: 1000 })).fire).toBe(true); // exactly at the window edge
    expect(reg.fire(evt({ at: 1500 })).reason).toBe('debounced');
  });

  it('does not advance the debounce clock on a rejected event', () => {
    const reg = new TriggerRegistry([makeTrigger({ debounceMs: 1000, webhookSecret: 'abc' })]);
    expect(reg.fire(evt({ at: 0, signature: 'abc' })).fire).toBe(true);
    // A bad-signature event inside the window must not reset the debounce timer.
    expect(reg.fire(evt({ at: 200, signature: 'bad' })).reason).toBe('bad_signature');
    expect(reg.fire(evt({ at: 1000, signature: 'abc' })).fire).toBe(true);
  });

  it('reconcile drops disabled sources and their debounce state', () => {
    const reg = new TriggerRegistry([makeTrigger({ debounceMs: 1000 })]);
    expect(reg.fire(evt({ at: 0 })).fire).toBe(true);
    reg.reconcile([makeTrigger({ enabled: false })]);
    expect(reg.active).toBe(false);
    // Re-enabling starts fresh — no lingering debounce from before.
    reg.reconcile([makeTrigger({ debounceMs: 1000 })]);
    expect(reg.fire(evt({ at: 100 })).fire).toBe(true);
  });
});
