export const AGENT_COMM_ERROR_CODES = [
  'topology_violation',
  'direction_violation',
  'message_too_large',
  'rate_limited',
  'receiver_unavailable',
  'channel_sealed',
  'depth_exceeded',
  'token_budget_exceeded',
  'max_turns_reached',
  'internal_error',
] as const;

export type AgentCommErrorCode = (typeof AGENT_COMM_ERROR_CODES)[number];

export function isAgentCommErrorCode(v: unknown): v is AgentCommErrorCode {
  return typeof v === 'string' && (AGENT_COMM_ERROR_CODES as readonly string[]).includes(v);
}

export type AgentCommSealReason =
  | 'max_turns_reached'
  | 'token_budget_exceeded'
  | 'manual';

export interface ChannelSessionMeta {
  /** Sorted [lo, hi] agent node IDs. */
  pair: [string, string];
  /** Names in the same order as `pair`. */
  pairNames: [string, string];
  /** lo — the canonical owner agent id whose StorageEngine holds this entry. */
  ownerAgentId: string;
  /** Accepted send count, monotonic. */
  turns: number;
  tokensIn: number;
  tokensOut: number;
  sealed: boolean;
  sealedReason: AgentCommSealReason | null;
  /** ISO timestamp of last accepted activity. */
  lastActivityAt: string;
}

export type AgentCommAuditEvent = {
  kind: 'agent-comm-audit';
  ts: string;
  event:
    | { type: 'send'; from: string; to: string; depth: number; chars: number; end: boolean }
    | { type: 'limit-tripped'; code: AgentCommErrorCode; from: string; to: string }
    | { type: 'wake-cancelled'; code: AgentCommErrorCode; from: string; to: string; depth: number }
    | { type: 'sealed'; reason: AgentCommSealReason };
};

/** Metadata stamped onto every channel-session user-role transcript event. */
export interface AgentSendMessageMeta {
  /** 'agent:<senderName>' */
  from: string;
  fromAgentId: string;
  /** 'agent:<receiverName>' */
  to: string;
  toAgentId: string;
  depth: number;
  channelKey: string;
}
