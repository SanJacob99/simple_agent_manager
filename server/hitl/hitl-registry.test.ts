import { describe, expect, it } from 'vitest';
import { HitlRegistry, parseConfirm } from './hitl-registry';

describe('parseConfirm', () => {
  it('accepts exact yes/no (case-insensitive, whitespace-trimmed)', () => {
    expect(parseConfirm('yes')).toBe('yes');
    expect(parseConfirm('YES')).toBe('yes');
    expect(parseConfirm('  Yes  ')).toBe('yes');
    expect(parseConfirm('no')).toBe('no');
    expect(parseConfirm('No')).toBe('no');
  });

  it('rejects anything that is not exactly yes or no', () => {
    expect(parseConfirm('yeah')).toBeNull();
    expect(parseConfirm('ok')).toBeNull();
    expect(parseConfirm('sure')).toBeNull();
    expect(parseConfirm('y')).toBeNull();
    expect(parseConfirm('n')).toBeNull();
    expect(parseConfirm('nope')).toBeNull();
    expect(parseConfirm('')).toBeNull();
  });
});

describe('HitlRegistry', () => {
  it('resolves a pending text prompt via resolveForSession', async () => {
    const registry = new HitlRegistry();
    const pending = registry.register({
      agentId: 'a1',
      sessionKey: 's1',
      toolCallId: 'tc1',
      toolName: 'ask_user',
      kind: 'text',
      question: 'name?',
      timeoutMs: 60_000,
    });

    const routed = registry.resolveForSession('a1', 's1', 'Jordan');
    expect(routed).toBeTruthy();
    expect(routed && 'resolved' in routed && routed.resolved.toolCallId).toBe('tc1');

    const answer = await pending;
    expect(answer).toEqual({ kind: 'text', answer: 'Jordan' });
  });

  it('strict confirm: resolveForSession returns parseError for non-yes/no text', async () => {
    const registry = new HitlRegistry();
    void registry.register({
      agentId: 'a1',
      sessionKey: 's1',
      toolCallId: 'tc1',
      toolName: 'ask_user',
      kind: 'confirm',
      question: 'proceed?',
      timeoutMs: 60_000,
    });

    const result = registry.resolveForSession('a1', 's1', 'maybe');
    expect(result).toEqual({ parseError: expect.stringContaining('yes') });
    expect(registry.hasPendingForSession('a1', 's1')).toBe(true);
  });

  it('confirm: yes/no routes through and resolves the promise', async () => {
    const registry = new HitlRegistry();
    const pending = registry.register({
      agentId: 'a1',
      sessionKey: 's1',
      toolCallId: 'tc1',
      toolName: 'ask_user',
      kind: 'confirm',
      question: 'proceed?',
      timeoutMs: 60_000,
    });

    registry.resolveForSession('a1', 's1', 'YES');
    const answer = await pending;
    expect(answer).toEqual({ kind: 'confirm', answer: 'yes' });
  });

  it('times out and resolves with cancelled after timeoutMs', async () => {
    const registry = new HitlRegistry();
    const pending = registry.register({
      agentId: 'a1',
      sessionKey: 's1',
      toolCallId: 'tc1',
      toolName: 'ask_user',
      kind: 'text',
      question: 'name?',
      timeoutMs: 50,
    });

    await expect(pending).resolves.toEqual({ cancelled: true, reason: 'timeout' });
    expect(registry.hasPendingForSession('a1', 's1')).toBe(false);
  });

  it('cancelAllForSession cancels all pending prompts for that session only', async () => {
    const registry = new HitlRegistry();
    const p1 = registry.register({
      agentId: 'a1', sessionKey: 's1', toolCallId: 'tc1',
      toolName: 'ask_user', kind: 'text', question: 'q1', timeoutMs: 60_000,
    });
    const p2 = registry.register({
      agentId: 'a1', sessionKey: 's2', toolCallId: 'tc2',
      toolName: 'ask_user', kind: 'text', question: 'q2', timeoutMs: 60_000,
    });

    const cancelled = registry.cancelAllForSession('a1', 's1', 'aborted');
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0].toolCallId).toBe('tc1');

    await expect(p1).resolves.toEqual({ cancelled: true, reason: 'aborted' });
    expect(registry.hasPendingForSession('a1', 's2')).toBe(true);

    // p2 still pending — resolve it to clean up
    registry.resolveForSession('a1', 's2', 'ok');
    await p2;
  });

  it('listForSession returns every pending prompt for that session', () => {
    const registry = new HitlRegistry();
    void registry.register({
      agentId: 'a1', sessionKey: 's1', toolCallId: 'tc1',
      toolName: 'ask_user', kind: 'text', question: 'q1', timeoutMs: 60_000,
    });
    void registry.register({
      agentId: 'a1', sessionKey: 's1', toolCallId: 'tc2',
      toolName: 'ask_user', kind: 'confirm', question: 'q2', timeoutMs: 60_000,
    });
    void registry.register({
      agentId: 'a2', sessionKey: 's1', toolCallId: 'tc3',
      toolName: 'ask_user', kind: 'text', question: 'q3', timeoutMs: 60_000,
    });

    const list = registry.listForSession('a1', 's1');
    expect(list.map((e) => e.toolCallId).sort()).toEqual(['tc1', 'tc2']);
  });

  it('returns null for resolveForSession when nothing is pending', () => {
    const registry = new HitlRegistry();
    expect(registry.resolveForSession('a1', 's1', 'hello')).toBeNull();
  });
});
