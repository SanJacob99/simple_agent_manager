import { describe, expect, it } from 'vitest';
import { createAskUserTool } from './ask-user';
import { HitlRegistry } from '../../../hitl/hitl-registry';

function makeCtx(sessionKey = 'session-1') {
  const registry = new HitlRegistry();
  const emitted: unknown[] = [];
  const tool = createAskUserTool({
    agentId: 'agent-1',
    getSessionKey: () => sessionKey,
    registry,
    emit: (event) => {
      emitted.push(event);
    },
  });
  return { tool, registry, emitted };
}

describe('ask_user tool (text)', () => {
  it('emits hitl:input_required with kind=text, registers pending, returns answer', async () => {
    const { tool, registry, emitted } = makeCtx();
    const exec = tool.execute(
      'tc1',
      { question: 'name?' },
      new AbortController().signal,
    );
    await new Promise((r) => setImmediate(r));

    expect((emitted[0] as any).type).toBe('hitl:input_required');
    expect((emitted[0] as any).kind).toBe('text');
    expect(registry.hasPendingForSession('agent-1', 'session-1')).toBe(true);

    registry.resolveForSession('agent-1', 'session-1', 'Jordan');
    const result = await exec;
    expect((result.content[0] as any).text).toBe('Jordan');
    expect((result.details as any).status).toBe('answered');
  });

  it('does not accept a kind parameter — the tool is text-only', async () => {
    const { tool, registry } = makeCtx();
    // Passing 'kind' should be ignored; the tool always emits text.
    const exec = tool.execute(
      'tc1',
      { question: 'name?', kind: 'confirm' } as any,
      new AbortController().signal,
    );
    await new Promise((r) => setImmediate(r));
    const snap = registry.listForSession('agent-1', 'session-1')[0];
    expect(snap.kind).toBe('text');
    registry.resolveForSession('agent-1', 'session-1', 'Jordan');
    await exec;
  });

  it('resolves with cancelled when abort signal fires', async () => {
    const { tool } = makeCtx();
    const controller = new AbortController();
    const exec = tool.execute('tc1', { question: 'name?' }, controller.signal);
    await new Promise((r) => setImmediate(r));

    controller.abort();
    const result = await exec;
    expect((result.details as any).status).toBe('cancelled');
    expect((result.details as any).reason).toBe('aborted');
  });

  it('times out using a short requested timeoutSeconds', async () => {
    const { tool } = makeCtx();
    const exec = tool.execute(
      'tc1',
      { question: 'name?', timeoutSeconds: 0.05 },
      new AbortController().signal,
    );
    const result = await exec;
    expect((result.details as any).reason).toBe('timeout');
  });

  it('caps timeoutSeconds at 55s', async () => {
    const { tool, registry } = makeCtx();
    const exec = tool.execute(
      'tc1',
      { question: 'name?', timeoutSeconds: 300 },
      new AbortController().signal,
    );
    await new Promise((r) => setImmediate(r));
    const snap = registry.listForSession('agent-1', 'session-1')[0];
    expect(snap.timeoutMs).toBe(55_000);
    registry.resolveForSession('agent-1', 'session-1', 'ok');
    await exec;
  });

  it('throws when getSessionKey returns empty', async () => {
    const registry = new HitlRegistry();
    const tool = createAskUserTool({
      agentId: 'agent-1',
      getSessionKey: () => '',
      registry,
      emit: () => {},
    });
    await expect(
      tool.execute('tc1', { question: 'name?' }, new AbortController().signal),
    ).rejects.toThrow(/no active session/);
  });
});
