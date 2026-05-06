import { describe, it, expect } from 'vitest';
import { SamAgentHitlRegistry, buildSamAgentHitlTools } from './sam-agent-hitl';

describe('SamAgentHitlRegistry', () => {
  it('register/resolve round-trip', async () => {
    const reg = new SamAgentHitlRegistry();
    const promise = reg.register({ toolCallId: 't1', kind: 'text', question: 'why?', timeoutMs: 60_000 });
    const ok = reg.resolve('t1', { kind: 'text', answer: 'because' });
    expect(ok).toBe(true);
    const ans = await promise;
    expect(ans).toEqual({ kind: 'text', answer: 'because' });
  });

  it('returns false when resolving unknown id', () => {
    const reg = new SamAgentHitlRegistry();
    expect(reg.resolve('does-not-exist', { kind: 'text', answer: '' })).toBe(false);
  });

  it('cancelAll resolves pending requests with cancelled', async () => {
    const reg = new SamAgentHitlRegistry();
    const p = reg.register({ toolCallId: 't2', kind: 'confirm', question: 'go?', timeoutMs: 60_000 });
    reg.cancelAll('aborted');
    const ans = await p;
    expect(ans).toEqual({ cancelled: true, reason: 'aborted' });
  });

  it('emits hitl events via listener', async () => {
    const events: any[] = [];
    const reg = new SamAgentHitlRegistry((e) => events.push(e));
    const p = reg.register({ toolCallId: 't3', kind: 'text', question: 'hi', timeoutMs: 60_000 });
    expect(events.find((e) => e.type === 'hitl:input_required' && e.toolCallId === 't3')).toBeTruthy();
    reg.resolve('t3', { kind: 'text', answer: 'a' });
    await p;
    expect(events.find((e) => e.type === 'hitl:resolved' && e.toolCallId === 't3')).toBeTruthy();
  });
});

describe('samagent_ask / samagent_confirm tools', () => {
  it('samagent_ask resolves with the answer', async () => {
    const reg = new SamAgentHitlRegistry();
    const tools = buildSamAgentHitlTools(reg);
    const ask = tools.find((t) => t.name === 'samagent_ask')!;
    const promise = ask.execute('toolcall1', { question: 'why?' }, new AbortController().signal);
    setTimeout(() => reg.resolve('toolcall1', { kind: 'text', answer: 'reason' }), 10);
    const result = await promise;
    expect((result as any).content[0].text).toBe('reason');
  });

  it('samagent_confirm resolves with yes/no', async () => {
    const reg = new SamAgentHitlRegistry();
    const tools = buildSamAgentHitlTools(reg);
    const confirm = tools.find((t) => t.name === 'samagent_confirm')!;
    const promise = confirm.execute('toolcall2', { question: 'do it?' }, new AbortController().signal);
    setTimeout(() => reg.resolve('toolcall2', { kind: 'confirm', answer: 'no' }), 10);
    const result = await promise;
    expect((result as any).content[0].text).toBe('no');
  });
});
