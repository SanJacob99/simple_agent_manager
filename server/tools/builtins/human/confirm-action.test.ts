import { describe, expect, it } from 'vitest';
import { createConfirmActionTool } from './confirm-action';
import { HitlRegistry } from '../../../hitl/hitl-registry';

function makeCtx(sessionKey = 'session-1') {
  const registry = new HitlRegistry();
  const emitted: unknown[] = [];
  const tool = createConfirmActionTool({
    agentId: 'agent-1',
    getSessionKey: () => sessionKey,
    registry,
    emit: (event) => {
      emitted.push(event);
    },
  });
  return { tool, registry, emitted };
}

describe('confirm_action tool (strict y/n)', () => {
  it('emits hitl:input_required with kind=confirm and registers a confirm prompt', async () => {
    const { tool, registry, emitted } = makeCtx();
    const exec = tool.execute(
      'tc1',
      { question: 'delete 12 files — proceed?' },
      new AbortController().signal,
    );
    await new Promise((r) => setImmediate(r));

    expect((emitted[0] as any).type).toBe('hitl:input_required');
    expect((emitted[0] as any).kind).toBe('confirm');
    const snap = registry.listForSession('agent-1', 'session-1')[0];
    expect(snap.kind).toBe('confirm');

    registry.resolveForSession('agent-1', 'session-1', 'yes');
    const result = await exec;
    expect((result.content[0] as any).text).toBe('yes');
    expect((result.details as any).status).toBe('answered');
    expect((result.details as any).answer).toBe('yes');
  });

  it('rejects non-yes/no text via resolveForSession, prompt stays open', async () => {
    const { tool, registry } = makeCtx();
    const exec = tool.execute(
      'tc1',
      { question: 'proceed?' },
      new AbortController().signal,
    );
    await new Promise((r) => setImmediate(r));

    expect(registry.resolveForSession('agent-1', 'session-1', 'maybe')).toEqual({
      parseError: expect.any(String),
    });
    expect(registry.hasPendingForSession('agent-1', 'session-1')).toBe(true);

    registry.resolveForSession('agent-1', 'session-1', 'no');
    const result = await exec;
    expect((result.content[0] as any).text).toBe('no');
  });

  it('returns "no" (with details.status=cancelled) when aborted — fail-safe default', async () => {
    const { tool } = makeCtx();
    const controller = new AbortController();
    const exec = tool.execute('tc1', { question: 'proceed?' }, controller.signal);
    await new Promise((r) => setImmediate(r));
    controller.abort();
    const result = await exec;
    expect((result.content[0] as any).text).toBe('no');
    expect((result.details as any).status).toBe('cancelled');
    expect((result.details as any).reason).toBe('aborted');
  });

  it('returns "no" on timeout as a safe default', async () => {
    const { tool } = makeCtx();
    const exec = tool.execute(
      'tc1',
      { question: 'proceed?', timeoutSeconds: 0.05 },
      new AbortController().signal,
    );
    const result = await exec;
    expect((result.content[0] as any).text).toBe('no');
    expect((result.details as any).reason).toBe('timeout');
  });

  it('caps timeoutSeconds at 55s', async () => {
    const { tool, registry } = makeCtx();
    const exec = tool.execute(
      'tc1',
      { question: 'proceed?', timeoutSeconds: 9999 },
      new AbortController().signal,
    );
    await new Promise((r) => setImmediate(r));
    const snap = registry.listForSession('agent-1', 'session-1')[0];
    expect(snap.timeoutMs).toBe(55_000);
    registry.resolveForSession('agent-1', 'session-1', 'no');
    await exec;
  });
});
