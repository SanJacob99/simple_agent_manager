import express from 'express';
import type { AgentManager } from '../agents/agent-manager';
import { canonicalChannelKey } from '../comms/channel-key';

export function buildAgentChannelsRouter(mgr: AgentManager) {
  const r = express.Router();

  r.get('/api/agents/:agentId/channels', async (req, res) => {
    const managed = mgr.listAgents().find((a) => a.config.id === req.params.agentId);
    if (!managed) {
      res.status(404).json({ error: 'agent not found' });
      return;
    }
    const peers = (managed.config.agentComm ?? [])
      .filter((c) => c.protocol === 'direct' && c.targetAgentNodeId)
      .map((c) => ({
        channelKey: canonicalChannelKey(managed.config.id, c.targetAgentNodeId!),
        peerAgentId: c.targetAgentNodeId!,
        peerAgentName: c.targetAgentName ?? '',
      }));

    const out = await Promise.all(
      peers.map(async (p) => {
        try {
          const ch = await mgr.commBus.readChannel(p.channelKey);
          return {
            ...p,
            turns: ch.meta.turns,
            sealed: ch.meta.sealed,
            sealedReason: ch.meta.sealedReason ?? null,
            lastActivityAt: ch.meta.lastActivityAt ?? '',
          };
        } catch {
          return {
            ...p,
            turns: 0,
            sealed: false,
            sealedReason: null,
            lastActivityAt: '',
          };
        }
      }),
    );
    res.json(out);
  });

  r.get('/api/agents/:agentId/channels/:channelKey/transcript', async (req, res) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 500);
      const events = await mgr.commBus.readChannelTranscript(
        decodeURIComponent(req.params.channelKey),
        limit,
      );
      res.json(events);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'channel not found';
      res.status(404).json({ error: message });
    }
  });

  return r;
}
