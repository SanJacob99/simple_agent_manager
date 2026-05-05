import type { ResolvedAgentCommConfig } from '../../shared/agent-config';
import type { AgentCommErrorCode } from '../../shared/agent-comm-types';
import type { ChannelHandle, ChannelSessionStore } from './channel-session-store';
import type { ChannelRunQueue } from './channel-run-queue';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface BusAgentRegistration {
  agentId: string;
  agentName: string;
  agentComm: ResolvedAgentCommConfig[];
}

export interface SendArgs {
  fromAgentId: string;
  toAgentName: string;
  message: string;
  end: boolean;
  currentDepth: number;
}

export type SendResult =
  | { ok: true; depth: number; turns: number; queuedWake: boolean }
  | { ok: false; error: AgentCommErrorCode };

export interface BroadcastArgs {
  fromAgentId: string;
  message: string;
  end: boolean;
  currentDepth: number;
}

export interface BroadcastResult {
  results: Array<{ to: string; ok: boolean; error?: AgentCommErrorCode }>;
}

export interface DispatchChannelWakeArgs {
  channelKey: string;
  receiverAgentId: string;
  senderAgentName: string;
  depth: number;
  isFinalTurn: boolean;
}

export interface AgentCommBusDeps {
  channelStore: ChannelSessionStore;
  queue: ChannelRunQueue;
  dispatchChannelWake: (args: DispatchChannelWakeArgs) => Promise<void>;
  /** Injectable clock — returns an ISO timestamp. Defaults to `new Date().toISOString()`. */
  now?: () => string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function pairMin(a: number, b: number): number {
  return Math.min(a, b);
}

// ---------------------------------------------------------------------------
// AgentCommBus
// ---------------------------------------------------------------------------

export class AgentCommBus {
  private readonly registry = new Map<string, BusAgentRegistration>();
  /** agentId → array of accepted outbound ISO timestamps (rolling 60s window) */
  private readonly outboundLog = new Map<string, number[]>();

  private readonly channelStore: ChannelSessionStore;
  private readonly queue: ChannelRunQueue;
  private readonly dispatchChannelWake: (args: DispatchChannelWakeArgs) => Promise<void>;
  private readonly now: () => string;

  constructor(deps: AgentCommBusDeps) {
    this.channelStore = deps.channelStore;
    this.queue = deps.queue;
    this.dispatchChannelWake = deps.dispatchChannelWake;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  // -------------------------------------------------------------------------
  // Registry
  // -------------------------------------------------------------------------

  register(reg: BusAgentRegistration): void {
    this.registry.set(reg.agentId, reg);
  }

  unregister(agentId: string): void {
    this.registry.delete(agentId);
    this.outboundLog.delete(agentId);
  }

  listManaged(): BusAgentRegistration[] {
    return Array.from(this.registry.values());
  }

  // -------------------------------------------------------------------------
  // send
  // -------------------------------------------------------------------------

  async send(args: SendArgs): Promise<SendResult> {
    const { fromAgentId, toAgentName, message, end, currentDepth } = args;

    // ------------------------------------------------------------------
    // 1. Topology
    // ------------------------------------------------------------------
    const senderReg = this.registry.get(fromAgentId);
    if (!senderReg) {
      return { ok: false, error: 'topology_violation' };
    }

    const senderEdge = senderReg.agentComm.find(
      (c) => c.protocol === 'direct' && c.targetAgentName === toAgentName,
    );
    if (!senderEdge) {
      return { ok: false, error: 'topology_violation' };
    }

    // Find receiver by name
    const receiverReg = Array.from(this.registry.values()).find(
      (r) => r.agentName === toAgentName,
    );
    if (!receiverReg) {
      // Sender edge declared but receiver not registered
      return { ok: false, error: 'receiver_unavailable' };
    }

    // Receiver must have a reciprocal direct edge back to the sender
    const receiverEdge = receiverReg.agentComm.find(
      (c) => c.protocol === 'direct' && c.targetAgentNodeId === fromAgentId,
    );
    if (!receiverEdge) {
      return { ok: false, error: 'topology_violation' };
    }

    // ------------------------------------------------------------------
    // 2. Direction
    // ------------------------------------------------------------------
    if (senderEdge.direction === 'inbound') {
      return { ok: false, error: 'direction_violation' };
    }
    if (receiverEdge.direction === 'outbound') {
      return { ok: false, error: 'direction_violation' };
    }

    // ------------------------------------------------------------------
    // 3. Size
    // ------------------------------------------------------------------
    if (message.length > senderEdge.messageSizeCap) {
      return { ok: false, error: 'message_too_large' };
    }

    // ------------------------------------------------------------------
    // 4. Rate limit
    // ------------------------------------------------------------------
    const nowMs = Date.parse(this.now());
    const windowStart = nowMs - 60_000;
    const outboundTimestamps = this.outboundLog.get(fromAgentId) ?? [];
    const recentTimestamps = outboundTimestamps.filter((ts) => ts > windowStart);
    const pairRateLimit = pairMin(senderEdge.rateLimitPerMinute, receiverEdge.rateLimitPerMinute);
    if (recentTimestamps.length >= pairRateLimit) {
      return { ok: false, error: 'rate_limited' };
    }

    // ------------------------------------------------------------------
    // 5. Channel state
    // ------------------------------------------------------------------
    const senderName = senderReg.agentName;
    const receiverName = receiverReg.agentName;
    const receiverAgentId = receiverReg.agentId;

    // Sort agent IDs and names to produce the canonical pair
    const swap = fromAgentId > receiverAgentId;
    const pairIds: [string, string] = swap
      ? [receiverAgentId, fromAgentId]
      : [fromAgentId, receiverAgentId];
    const pairNames: [string, string] = swap
      ? [receiverName, senderName]
      : [senderName, receiverName];

    const handle: ChannelHandle = await this.channelStore.open({
      pair: pairIds,
      pairNames,
    });
    const channelKey = handle.key;
    const channelMeta = handle.meta;

    if (channelMeta.sealed) {
      return { ok: false, error: 'channel_sealed' };
    }

    // ------------------------------------------------------------------
    // 6. Token budget
    // ------------------------------------------------------------------
    const pairTokenBudget = pairMin(senderEdge.tokenBudget, receiverEdge.tokenBudget);
    if (channelMeta.tokensIn + channelMeta.tokensOut >= pairTokenBudget) {
      await this.channelStore.appendAudit(channelKey, {
        kind: 'agent-comm-audit',
        ts: this.now(),
        event: { type: 'limit-tripped', code: 'token_budget_exceeded', from: senderName, to: receiverName },
      });
      await this.channelStore.seal(channelKey, 'token_budget_exceeded');
      return { ok: false, error: 'token_budget_exceeded' };
    }

    // ------------------------------------------------------------------
    // 7. Depth
    // ------------------------------------------------------------------
    const depth = currentDepth + 1;
    const pairMaxDepth = pairMin(senderEdge.maxDepth, receiverEdge.maxDepth);
    if (depth > pairMaxDepth) {
      return { ok: false, error: 'depth_exceeded' };
    }

    // ------------------------------------------------------------------
    // 8. Turn count (pre-check — actual bump happens after appendUserMessage)
    // ------------------------------------------------------------------
    const pairMaxTurns = pairMin(senderEdge.maxTurns, receiverEdge.maxTurns);
    if (channelMeta.turns + 1 > pairMaxTurns) {
      await this.channelStore.appendAudit(channelKey, {
        kind: 'agent-comm-audit',
        ts: this.now(),
        event: { type: 'limit-tripped', code: 'max_turns_reached', from: senderName, to: receiverName },
      });
      await this.channelStore.seal(channelKey, 'max_turns_reached');
      return { ok: false, error: 'max_turns_reached' };
    }

    // ------------------------------------------------------------------
    // Success path
    // ------------------------------------------------------------------

    // Build message meta
    const msgMeta = {
      from: `agent:${senderName}`,
      fromAgentId,
      to: `agent:${receiverName}`,
      toAgentId: receiverAgentId,
      depth,
      channelKey,
    };

    // Append user message (bumps turns)
    const updatedMeta = await this.channelStore.appendUserMessage(channelKey, {
      content: message,
      meta: msgMeta,
    });

    // Append audit event
    await this.channelStore.appendAudit(channelKey, {
      kind: 'agent-comm-audit',
      ts: this.now(),
      event: {
        type: 'send',
        from: senderName,
        to: receiverName,
        depth,
        chars: message.length,
        end,
      },
    });

    // Record rate usage
    const updatedTimestamps = [...recentTimestamps, nowMs];
    this.outboundLog.set(fromAgentId, updatedTimestamps);

    // Determine if this send reached the maxTurns boundary
    const isFinalTurn = updatedMeta.turns >= pairMaxTurns;

    // Pre-emptive seal when we've hit the turn cap
    if (isFinalTurn) {
      await this.channelStore.seal(channelKey, 'max_turns_reached');
    }

    // Wake the receiver unless the sender signalled end
    if (!end) {
      await this.dispatchChannelWake({
        channelKey,
        receiverAgentId,
        senderAgentName: senderName,
        depth,
        isFinalTurn,
      });
    }

    return { ok: true, depth, turns: updatedMeta.turns, queuedWake: !end };
  }

  // -------------------------------------------------------------------------
  // broadcast
  // -------------------------------------------------------------------------

  async broadcast(args: BroadcastArgs): Promise<BroadcastResult> {
    const { fromAgentId, message, end, currentDepth } = args;

    const senderReg = this.registry.get(fromAgentId);
    if (!senderReg) {
      return { results: [] };
    }

    // Enumerate direct peers with a non-null targetAgentName, sorted by name
    const peers = senderReg.agentComm
      .filter((c) => c.protocol === 'direct' && c.targetAgentName !== null)
      .sort((a, b) => (a.targetAgentName! < b.targetAgentName! ? -1 : 1));

    const results: Array<{ to: string; ok: boolean; error?: AgentCommErrorCode }> = [];

    for (const edge of peers) {
      const toAgentName = edge.targetAgentName!;
      const result = await this.send({ fromAgentId, toAgentName, message, end, currentDepth });
      if (result.ok) {
        results.push({ to: toAgentName, ok: true });
      } else {
        results.push({ to: toAgentName, ok: false, error: result.error });
      }
    }

    return { results };
  }

  // -------------------------------------------------------------------------
  // addUsage
  // -------------------------------------------------------------------------

  async addUsage(
    channelKey: string,
    usage: { tokensIn: number; tokensOut: number },
    pairBudget: number,
  ): Promise<void> {
    const updatedMeta = await this.channelStore.addUsage(channelKey, usage);
    if (!updatedMeta.sealed && updatedMeta.tokensIn + updatedMeta.tokensOut >= pairBudget) {
      await this.channelStore.seal(channelKey, 'token_budget_exceeded');
    }
  }

  // -------------------------------------------------------------------------
  // Read-only pass-throughs (for channels REST route — Task 14)
  // -------------------------------------------------------------------------

  async readChannel(channelKey: string): Promise<ChannelHandle> {
    return this.channelStore.read(channelKey);
  }

  async readChannelTranscript(channelKey: string, limit: number): Promise<unknown[]> {
    return this.channelStore.tail(channelKey, limit);
  }
}
