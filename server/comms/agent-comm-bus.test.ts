import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentCommBus, type AgentCommBusDeps } from './agent-comm-bus';
import type { ResolvedAgentCommConfig } from '../../shared/agent-config';
import type { ChannelHandle } from './channel-session-store';
import type { ChannelSessionMeta } from '../../shared/agent-comm-types';

const peer = (overrides: Partial<ResolvedAgentCommConfig>): ResolvedAgentCommConfig => ({
  commNodeId: 'c?', label: 'x',
  targetAgentNodeId: null, targetAgentName: null,
  protocol: 'direct',
  maxTurns: 10, maxDepth: 3, tokenBudget: 100_000,
  rateLimitPerMinute: 30, messageSizeCap: 16_000,
  direction: 'bidirectional',
  ...overrides,
});

function meta(over: Partial<ChannelSessionMeta> = {}): ChannelSessionMeta {
  return {
    pair: ['a', 'b'], pairNames: ['alpha', 'beta'], ownerAgentId: 'a',
    turns: 0, tokensIn: 0, tokensOut: 0,
    sealed: false, sealedReason: null,
    lastActivityAt: '2026-05-05T00:00:00Z',
    ...over,
  };
}

function makeBus() {
  const channelStore = {
    open: vi.fn(async () => ({ key: 'channel:a:b', meta: meta() } as ChannelHandle)),
    read: vi.fn(async () => ({ key: 'channel:a:b', meta: meta() } as ChannelHandle)),
    appendUserMessage: vi.fn(async () => ({ ...meta(), turns: 1 })),
    appendAudit: vi.fn(async () => undefined),
    addUsage: vi.fn(async (_k: string, u: { tokensIn: number; tokensOut: number }) => ({ ...meta(), tokensIn: u.tokensIn, tokensOut: u.tokensOut })),
    seal: vi.fn(async () => meta({ sealed: true })),
    tail: vi.fn(async () => []),
  } as any;
  const queue = { enqueue: vi.fn(async (_k: string, fn: () => any) => fn()), isActive: vi.fn(() => false) } as any;
  const dispatch = vi.fn(async () => undefined);
  let nowMs = Date.parse('2026-05-05T00:00:00Z');
  const advance = (ms: number) => { nowMs += ms; };
  const deps: AgentCommBusDeps = {
    channelStore, queue, dispatchChannelWake: dispatch,
    now: () => new Date(nowMs).toISOString(),
  };
  return { bus: new AgentCommBus(deps), channelStore, queue, dispatch, advance };
}

function registerPair(bus: AgentCommBus, opts: {
  senderEdge?: Partial<ResolvedAgentCommConfig>;
  receiverEdge?: Partial<ResolvedAgentCommConfig>;
} = {}) {
  bus.register({
    agentId: 'a', agentName: 'alpha',
    agentComm: [peer({ commNodeId: 'a-to-b', targetAgentNodeId: 'b', targetAgentName: 'beta', ...opts.senderEdge })],
  });
  bus.register({
    agentId: 'b', agentName: 'beta',
    agentComm: [peer({ commNodeId: 'b-to-a', targetAgentNodeId: 'a', targetAgentName: 'alpha', ...opts.receiverEdge })],
  });
}

describe('AgentCommBus.send', () => {
  let ctx: ReturnType<typeof makeBus>;
  beforeEach(() => { ctx = makeBus(); });

  it('topology_violation when sender unmanaged', async () => {
    const r = await ctx.bus.send({ fromAgentId: 'ghost', toAgentName: 'beta', message: 'hi', end: false, currentDepth: 0 });
    expect(r).toEqual({ ok: false, error: 'topology_violation' });
  });

  it('topology_violation when peer not in sender comm nodes', async () => {
    registerPair(ctx.bus);
    const r = await ctx.bus.send({ fromAgentId: 'a', toAgentName: 'gamma', message: 'hi', end: false, currentDepth: 0 });
    expect(r).toEqual({ ok: false, error: 'topology_violation' });
  });

  it('receiver_unavailable when receiver unmanaged but sender edge declared', async () => {
    ctx.bus.register({
      agentId: 'a', agentName: 'alpha',
      agentComm: [peer({ commNodeId: 'a-to-b', targetAgentNodeId: 'b', targetAgentName: 'beta' })],
    });
    const r = await ctx.bus.send({ fromAgentId: 'a', toAgentName: 'beta', message: 'hi', end: false, currentDepth: 0 });
    expect(r).toEqual({ ok: false, error: 'receiver_unavailable' });
  });

  it('topology_violation when receiver lacks reciprocal edge', async () => {
    ctx.bus.register({
      agentId: 'a', agentName: 'alpha',
      agentComm: [peer({ commNodeId: 'a-to-b', targetAgentNodeId: 'b', targetAgentName: 'beta' })],
    });
    ctx.bus.register({ agentId: 'b', agentName: 'beta', agentComm: [] });
    const r = await ctx.bus.send({ fromAgentId: 'a', toAgentName: 'beta', message: 'hi', end: false, currentDepth: 0 });
    expect(r).toEqual({ ok: false, error: 'topology_violation' });
  });

  it('direction_violation when sender is inbound-only', async () => {
    registerPair(ctx.bus, { senderEdge: { direction: 'inbound' } });
    const r = await ctx.bus.send({ fromAgentId: 'a', toAgentName: 'beta', message: 'hi', end: false, currentDepth: 0 });
    expect(r).toEqual({ ok: false, error: 'direction_violation' });
  });

  it('direction_violation when receiver is outbound-only', async () => {
    registerPair(ctx.bus, { receiverEdge: { direction: 'outbound' } });
    const r = await ctx.bus.send({ fromAgentId: 'a', toAgentName: 'beta', message: 'hi', end: false, currentDepth: 0 });
    expect(r).toEqual({ ok: false, error: 'direction_violation' });
  });

  it('message_too_large rejects oversize', async () => {
    registerPair(ctx.bus, { senderEdge: { messageSizeCap: 5 } });
    const r = await ctx.bus.send({ fromAgentId: 'a', toAgentName: 'beta', message: 'hello world', end: false, currentDepth: 0 });
    expect(r).toEqual({ ok: false, error: 'message_too_large' });
  });

  it('depth_exceeded when current+1 > pair min maxDepth', async () => {
    registerPair(ctx.bus, { senderEdge: { maxDepth: 5 }, receiverEdge: { maxDepth: 2 } });
    const r = await ctx.bus.send({ fromAgentId: 'a', toAgentName: 'beta', message: 'x', end: false, currentDepth: 2 });
    expect(r).toEqual({ ok: false, error: 'depth_exceeded' });
  });

  it('happy path: append + audit + queueWake when !end', async () => {
    registerPair(ctx.bus);
    const r = await ctx.bus.send({ fromAgentId: 'a', toAgentName: 'beta', message: 'hi', end: false, currentDepth: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.depth).toBe(1);
    expect(r.queuedWake).toBe(true);
    expect(ctx.channelStore.appendUserMessage).toHaveBeenCalledOnce();
    expect(ctx.channelStore.appendAudit).toHaveBeenCalled();
    expect(ctx.dispatch).toHaveBeenCalledOnce();
  });

  it('end:true does not enqueue wake', async () => {
    registerPair(ctx.bus);
    const r = await ctx.bus.send({ fromAgentId: 'a', toAgentName: 'beta', message: 'hi', end: true, currentDepth: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.queuedWake).toBe(false);
    expect(ctx.dispatch).not.toHaveBeenCalled();
  });

  it('rate_limited after exceeding pair-min rate', async () => {
    registerPair(ctx.bus, {
      senderEdge: { rateLimitPerMinute: 2 },
      receiverEdge: { rateLimitPerMinute: 2 },
    });
    await ctx.bus.send({ fromAgentId: 'a', toAgentName: 'beta', message: 'a', end: true, currentDepth: 0 });
    await ctx.bus.send({ fromAgentId: 'a', toAgentName: 'beta', message: 'b', end: true, currentDepth: 0 });
    const r = await ctx.bus.send({ fromAgentId: 'a', toAgentName: 'beta', message: 'c', end: true, currentDepth: 0 });
    expect(r).toEqual({ ok: false, error: 'rate_limited' });
  });

  it('rate window resets after 60s', async () => {
    registerPair(ctx.bus, {
      senderEdge: { rateLimitPerMinute: 1 },
      receiverEdge: { rateLimitPerMinute: 1 },
    });
    await ctx.bus.send({ fromAgentId: 'a', toAgentName: 'beta', message: 'a', end: true, currentDepth: 0 });
    ctx.advance(61_000);
    const r = await ctx.bus.send({ fromAgentId: 'a', toAgentName: 'beta', message: 'b', end: true, currentDepth: 0 });
    expect(r.ok).toBe(true);
  });

  it('channel_sealed if open returns sealed meta', async () => {
    registerPair(ctx.bus);
    ctx.channelStore.open.mockResolvedValueOnce({ key: 'channel:a:b', meta: meta({ sealed: true, sealedReason: 'manual' }) });
    const r = await ctx.bus.send({ fromAgentId: 'a', toAgentName: 'beta', message: 'hi', end: false, currentDepth: 0 });
    expect(r).toEqual({ ok: false, error: 'channel_sealed' });
  });

  it('token_budget_exceeded seals channel and returns code', async () => {
    registerPair(ctx.bus, {
      senderEdge: { tokenBudget: 100 },
      receiverEdge: { tokenBudget: 100 },
    });
    ctx.channelStore.open.mockResolvedValueOnce({ key: 'channel:a:b', meta: meta({ tokensIn: 60, tokensOut: 50 }) });
    const r = await ctx.bus.send({ fromAgentId: 'a', toAgentName: 'beta', message: 'hi', end: false, currentDepth: 0 });
    expect(r).toEqual({ ok: false, error: 'token_budget_exceeded' });
    expect(ctx.channelStore.seal).toHaveBeenCalledWith('channel:a:b', 'token_budget_exceeded');
  });

  it('max_turns_reached seals channel and returns code on the over-the-limit attempt', async () => {
    registerPair(ctx.bus, { senderEdge: { maxTurns: 1 }, receiverEdge: { maxTurns: 1 } });
    // first send accepted (turns becomes 1)
    ctx.channelStore.appendUserMessage.mockResolvedValueOnce(meta({ turns: 1 }));
    await ctx.bus.send({ fromAgentId: 'a', toAgentName: 'beta', message: 'hi', end: false, currentDepth: 0 });
    // pre-emptive seal already happened on the boundary
    expect(ctx.channelStore.seal).toHaveBeenCalledWith('channel:a:b', 'max_turns_reached');
    // second send: open returns the sealed channel
    ctx.channelStore.open.mockResolvedValueOnce({ key: 'channel:a:b', meta: meta({ turns: 1, sealed: true, sealedReason: 'max_turns_reached' }) });
    const r2 = await ctx.bus.send({ fromAgentId: 'a', toAgentName: 'beta', message: 'no', end: false, currentDepth: 0 });
    expect(r2).toEqual({ ok: false, error: 'channel_sealed' });
  });

  it('isFinalTurn=true is reported to dispatchChannelWake when send reaches maxTurns', async () => {
    registerPair(ctx.bus, { senderEdge: { maxTurns: 1 }, receiverEdge: { maxTurns: 1 } });
    ctx.channelStore.appendUserMessage.mockResolvedValueOnce(meta({ turns: 1 }));
    await ctx.bus.send({ fromAgentId: 'a', toAgentName: 'beta', message: 'hi', end: false, currentDepth: 0 });
    expect(ctx.dispatch).toHaveBeenCalledWith(expect.objectContaining({ isFinalTurn: true }));
  });
});

describe('AgentCommBus.broadcast', () => {
  it('fans out to all direct peers in stable order', async () => {
    const ctx = makeBus();
    ctx.bus.register({
      agentId: 'a', agentName: 'alpha',
      agentComm: [
        peer({ commNodeId: 'a-to-b', targetAgentNodeId: 'b', targetAgentName: 'beta' }),
        peer({ commNodeId: 'a-to-c', targetAgentNodeId: 'c', targetAgentName: 'gamma' }),
      ],
    });
    ctx.bus.register({
      agentId: 'b', agentName: 'beta',
      agentComm: [peer({ commNodeId: 'b-to-a', targetAgentNodeId: 'a', targetAgentName: 'alpha' })],
    });
    ctx.bus.register({
      agentId: 'c', agentName: 'gamma',
      agentComm: [peer({ commNodeId: 'c-to-a', targetAgentNodeId: 'a', targetAgentName: 'alpha' })],
    });
    const r = await ctx.bus.broadcast({ fromAgentId: 'a', message: 'hi all', end: true, currentDepth: 0 });
    expect(r.results.map((x) => x.to)).toEqual(['beta', 'gamma']);
    expect(r.results.every((x) => x.ok)).toBe(true);
  });

  it('per-peer failure does not abort the rest', async () => {
    const ctx = makeBus();
    ctx.bus.register({
      agentId: 'a', agentName: 'alpha',
      agentComm: [
        peer({ commNodeId: 'a-to-b', targetAgentNodeId: 'b', targetAgentName: 'beta', messageSizeCap: 1 }),
        peer({ commNodeId: 'a-to-c', targetAgentNodeId: 'c', targetAgentName: 'gamma' }),
      ],
    });
    ctx.bus.register({ agentId: 'b', agentName: 'beta', agentComm: [peer({ commNodeId: 'b-to-a', targetAgentNodeId: 'a', targetAgentName: 'alpha' })] });
    ctx.bus.register({ agentId: 'c', agentName: 'gamma', agentComm: [peer({ commNodeId: 'c-to-a', targetAgentNodeId: 'a', targetAgentName: 'alpha' })] });
    const r = await ctx.bus.broadcast({ fromAgentId: 'a', message: 'hi', end: true, currentDepth: 0 });
    const beta = r.results.find((x) => x.to === 'beta')!;
    const gamma = r.results.find((x) => x.to === 'gamma')!;
    expect(beta.ok).toBe(false);
    expect(beta.error).toBe('message_too_large');
    expect(gamma.ok).toBe(true);
  });
});

describe('AgentCommBus.addUsage', () => {
  it('seals channel when totals reach pair budget', async () => {
    const ctx = makeBus();
    ctx.channelStore.addUsage.mockResolvedValueOnce(meta({ tokensIn: 50, tokensOut: 60 })); // 110 >= 100
    await ctx.bus.addUsage('channel:a:b', { tokensIn: 30, tokensOut: 40 }, 100);
    expect(ctx.channelStore.seal).toHaveBeenCalledWith('channel:a:b', 'token_budget_exceeded');
  });

  it('does not seal when totals stay under the budget', async () => {
    const ctx = makeBus();
    ctx.channelStore.addUsage.mockResolvedValueOnce(meta({ tokensIn: 50, tokensOut: 30 })); // 80 < 100
    await ctx.bus.addUsage('channel:a:b', { tokensIn: 30, tokensOut: 0 }, 100);
    expect(ctx.channelStore.seal).not.toHaveBeenCalled();
  });
});
