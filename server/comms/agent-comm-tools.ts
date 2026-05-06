import type { AgentCommBus } from './agent-comm-bus';

export interface AgentCommToolsCtx {
  bus: AgentCommBus;
  fromAgentId: string;
  fromAgentName: string;
  currentDepth: number;
  directPeerNames: string[];
  hasBroadcastNode: boolean;
  readChannelHistory: (args: { channelKey: string; limit: number }) => Promise<unknown[]>;
  pairNamesToChannelKey: (peerName: string) => string;
}

export interface AgentCommTool {
  name: 'agent_send' | 'agent_broadcast' | 'agent_channel_history';
  description: string;
  parameters: object;
  execute: (input: any) => Promise<unknown>;
}

export function createAgentCommTools(ctx: AgentCommToolsCtx): AgentCommTool[] {
  const tools: AgentCommTool[] = [];
  const hasDirects = ctx.directPeerNames.length > 0;
  if (!hasDirects && !ctx.hasBroadcastNode) return tools;

  if (hasDirects) {
    tools.push({
      name: 'agent_send',
      description:
        'Send a message to a peer agent. Wakes the peer unless end:true (which appends without waking).',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', enum: ctx.directPeerNames, description: 'peer agent name' },
          message: { type: 'string' },
          end: { type: 'boolean', default: false },
        },
        required: ['to', 'message'],
        additionalProperties: false,
      },
      execute: async (input: { to: string; message: string; end?: boolean }) => {
        return ctx.bus.send({
          fromAgentId: ctx.fromAgentId,
          toAgentName: input.to,
          message: input.message,
          end: input.end === true,
          currentDepth: ctx.currentDepth,
        });
      },
    });

    tools.push({
      name: 'agent_channel_history',
      description: 'Return the last N transcript events from your channel with a peer.',
      parameters: {
        type: 'object',
        properties: {
          with: { type: 'string', enum: ctx.directPeerNames },
          limit: { type: 'number', minimum: 1, maximum: 100, default: 20 },
        },
        required: ['with'],
        additionalProperties: false,
      },
      execute: async (input: { with: string; limit?: number }) => {
        const requested = input.limit ?? 20;
        const limit = Math.min(Math.max(requested, 1), 100);
        return ctx.readChannelHistory({
          channelKey: ctx.pairNamesToChannelKey(input.with),
          limit,
        });
      },
    });
  }

  if (ctx.hasBroadcastNode && hasDirects) {
    tools.push({
      name: 'agent_broadcast',
      description:
        'Send the same message to every direct peer; per-recipient outcomes are returned.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          end: { type: 'boolean', default: false },
        },
        required: ['message'],
        additionalProperties: false,
      },
      execute: async (input: { message: string; end?: boolean }) => {
        return ctx.bus.broadcast({
          fromAgentId: ctx.fromAgentId,
          message: input.message,
          end: input.end === true,
          currentDepth: ctx.currentDepth,
        });
      },
    });
  }

  return tools;
}
