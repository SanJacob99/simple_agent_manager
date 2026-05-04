/**
 * Shared WebSocket protocol types for the SAMAgent feature.
 *
 * These types are used by both the browser client and the Express/WebSocket
 * server so that message contracts are defined in one place. Do NOT import
 * from `src/` or `server/` here — shared/ must remain boundary-free.
 */

// ---------------------------------------------------------------------------
// Transcript message types (previously defined in server/sam-agent/sam-agent-transcript.ts)
// ---------------------------------------------------------------------------

export type SamAgentToolResult = {
  toolName: string;
  toolCallId: string;
  resultJson: string;
  patchState?: 'pending' | 'applied' | 'discarded' | 'failed';
};

export type SamAgentMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'hitl';
  text: string;
  timestamp: number;
  toolResults?: SamAgentToolResult[];
};

// ---------------------------------------------------------------------------
// HITL answer (previously inlined in server/sam-agent/sam-agent-hitl.ts)
// Duplicated here as a lightweight alias so shared/ stays free of server/ imports.
// ---------------------------------------------------------------------------

export type SamAgentHitlAnswer =
  | { kind: 'text'; answer: string }
  | { kind: 'confirm'; answer: 'yes' | 'no' }
  | { cancelled: true; reason: 'timeout' | 'aborted' };

// ---------------------------------------------------------------------------
// Events (backend → frontend, previously in server/sam-agent/sam-agent-coordinator.ts)
// ---------------------------------------------------------------------------

export type SamAgentEvent =
  | { type: 'message:start'; messageId: string }
  | { type: 'message:delta'; messageId: string; textDelta: string }
  | { type: 'message:end'; messageId: string; text: string }
  | { type: 'tool:start'; toolCallId: string; toolName: string; argsJson: string }
  | { type: 'tool:end'; toolCallId: string; resultJson: string }
  | { type: 'lifecycle:start' }
  | { type: 'lifecycle:end' }
  | { type: 'lifecycle:error'; error: string }
  | { type: 'hitl:input_required'; toolCallId: string; kind: 'text' | 'confirm'; question: string; timeoutMs: number }
  | { type: 'hitl:resolved'; toolCallId: string; answer: SamAgentHitlAnswer };

export type SamAgentEventEnvelope =
  | { type: 'samAgent:event'; event: SamAgentEvent }
  | { type: 'samAgent:transcript'; messages: SamAgentMessage[] };
