import { describe, it, expect, vi } from 'vitest';
import { createAgentCommTools } from './agent-comm-tools';
import type { AgentCommBus } from './agent-comm-bus';

describe('createAgentCommTools', () => {
  function makeCtx(overrides: Partial<Parameters<typeof createAgentCommTools>[0]> = {}) {
    const bus = {
      send: vi.fn().mockResolvedValue({ ok: true, depth: 1, turns: 1, queuedWake: true }),
      broadcast: vi.fn().mockResolvedValue({ results: [{ to: 'beta', ok: true }] }),
    } as unknown as AgentCommBus;
    return {
      bus,
      fromAgentId: 'a',
      fromAgentName: 'alpha',
      currentDepth: 0,
      directPeerNames: ['beta'],
      hasBroadcastNode: true,
      readChannelHistory: vi.fn().mockResolvedValue([{ role: 'user', content: 'hi' }]),
      pairNamesToChannelKey: vi.fn().mockReturnValue('channel:a:b'),
      ...overrides,
    };
  }

  it('agent_send is exposed when at least one direct peer exists', () => {
    const tools = createAgentCommTools(makeCtx());
    expect(tools.find((t) => t.name === 'agent_send')).toBeDefined();
  });

  it('agent_send is NOT exposed when no direct peers', () => {
    const tools = createAgentCommTools(makeCtx({ directPeerNames: [], hasBroadcastNode: false }));
    expect(tools).toEqual([]);
  });

  it('agent_broadcast exposed only when hasBroadcastNode AND direct peers exist', () => {
    const yes = createAgentCommTools(makeCtx());
    expect(yes.find((t) => t.name === 'agent_broadcast')).toBeDefined();

    const noBroadcast = createAgentCommTools(makeCtx({ hasBroadcastNode: false }));
    expect(noBroadcast.find((t) => t.name === 'agent_broadcast')).toBeUndefined();

    const noDirects = createAgentCommTools(
      makeCtx({ hasBroadcastNode: true, directPeerNames: [] }),
    );
    expect(noDirects.find((t) => t.name === 'agent_broadcast')).toBeUndefined();
  });

  it('agent_channel_history exposed only when agent_send is enabled', () => {
    const yes = createAgentCommTools(makeCtx());
    expect(yes.find((t) => t.name === 'agent_channel_history')).toBeDefined();

    const no = createAgentCommTools(makeCtx({ directPeerNames: [], hasBroadcastNode: false }));
    expect(no.find((t) => t.name === 'agent_channel_history')).toBeUndefined();
  });

  it('agent_send invokes bus.send with run context', async () => {
    const ctx = makeCtx();
    const tools = createAgentCommTools(ctx);
    const send = tools.find((t) => t.name === 'agent_send')!;
    const result = await send.execute({ to: 'beta', message: 'hi' });
    expect(ctx.bus.send).toHaveBeenCalledWith({
      fromAgentId: 'a',
      toAgentName: 'beta',
      message: 'hi',
      end: false,
      currentDepth: 0,
    });
    expect(result).toMatchObject({ ok: true, depth: 1 });
  });

  it('agent_send forwards end:true', async () => {
    const ctx = makeCtx();
    const tools = createAgentCommTools(ctx);
    const send = tools.find((t) => t.name === 'agent_send')!;
    await send.execute({ to: 'beta', message: 'bye', end: true });
    expect(ctx.bus.send).toHaveBeenCalledWith(expect.objectContaining({ end: true }));
  });

  it('agent_send returns shaped error for non-peer attempt', async () => {
    const ctx = makeCtx();
    (ctx.bus.send as any).mockResolvedValueOnce({ ok: false, error: 'topology_violation' });
    const tools = createAgentCommTools(ctx);
    const send = tools.find((t) => t.name === 'agent_send')!;
    const result = await send.execute({ to: 'beta', message: 'hi' });
    expect(result).toEqual({ ok: false, error: 'topology_violation' });
  });

  it('agent_send schema lists peer names as enum', () => {
    const tools = createAgentCommTools(
      makeCtx({ directPeerNames: ['beta', 'gamma'] }),
    );
    const send = tools.find((t) => t.name === 'agent_send')!;
    const params = send.parameters as any;
    expect(params.properties.to.enum).toEqual(['beta', 'gamma']);
    expect(params.required).toEqual(['to', 'message']);
  });

  it('agent_broadcast invokes bus.broadcast', async () => {
    const ctx = makeCtx();
    const tools = createAgentCommTools(ctx);
    const bc = tools.find((t) => t.name === 'agent_broadcast')!;
    const result = await bc.execute({ message: 'hello peers' });
    expect(ctx.bus.broadcast).toHaveBeenCalledWith({
      fromAgentId: 'a',
      message: 'hello peers',
      end: false,
      currentDepth: 0,
    });
    expect(result).toEqual({ results: [{ to: 'beta', ok: true }] });
  });

  it('agent_broadcast forwards end:true', async () => {
    const ctx = makeCtx();
    const tools = createAgentCommTools(ctx);
    const bc = tools.find((t) => t.name === 'agent_broadcast')!;
    await bc.execute({ message: 'final', end: true });
    expect(ctx.bus.broadcast).toHaveBeenCalledWith(expect.objectContaining({ end: true }));
  });

  it('agent_channel_history reads through the provided reader with default limit 20', async () => {
    const ctx = makeCtx();
    const tools = createAgentCommTools(ctx);
    const hist = tools.find((t) => t.name === 'agent_channel_history')!;
    const result = await hist.execute({ with: 'beta' });
    expect(ctx.pairNamesToChannelKey).toHaveBeenCalledWith('beta');
    expect(ctx.readChannelHistory).toHaveBeenCalledWith({ channelKey: 'channel:a:b', limit: 20 });
    expect(result).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('agent_channel_history clamps limit to [1, 100]', async () => {
    const ctx = makeCtx();
    const tools = createAgentCommTools(ctx);
    const hist = tools.find((t) => t.name === 'agent_channel_history')!;
    await hist.execute({ with: 'beta', limit: 0 });
    expect(ctx.readChannelHistory).toHaveBeenLastCalledWith({ channelKey: 'channel:a:b', limit: 1 });
    await hist.execute({ with: 'beta', limit: 5000 });
    expect(ctx.readChannelHistory).toHaveBeenLastCalledWith({ channelKey: 'channel:a:b', limit: 100 });
  });
});
