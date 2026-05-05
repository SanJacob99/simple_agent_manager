import { describe, it, expect } from 'vitest';
import {
  AGENT_COMM_ERROR_CODES,
  isAgentCommErrorCode,
  type AgentCommAuditEvent,
} from './agent-comm-types';

describe('agent-comm-types', () => {
  it('exposes the v1 error code set', () => {
    expect(AGENT_COMM_ERROR_CODES).toEqual([
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
    ]);
  });

  it('isAgentCommErrorCode rejects unknown codes', () => {
    expect(isAgentCommErrorCode('rate_limited')).toBe(true);
    expect(isAgentCommErrorCode('something_else')).toBe(false);
    expect(isAgentCommErrorCode(42)).toBe(false);
    expect(isAgentCommErrorCode(undefined)).toBe(false);
  });

  it('audit event shapes are exhaustive', () => {
    const send: AgentCommAuditEvent = {
      kind: 'agent-comm-audit',
      ts: '2026-05-05T00:00:00Z',
      event: { type: 'send', from: 'a', to: 'b', depth: 1, chars: 10, end: false },
    };
    const trip: AgentCommAuditEvent = {
      kind: 'agent-comm-audit',
      ts: '2026-05-05T00:00:00Z',
      event: { type: 'limit-tripped', code: 'max_turns_reached', from: 'a', to: 'b' },
    };
    const cancelled: AgentCommAuditEvent = {
      kind: 'agent-comm-audit',
      ts: '2026-05-05T00:00:00Z',
      event: { type: 'wake-cancelled', code: 'token_budget_exceeded', from: 'a', to: 'b', depth: 2 },
    };
    const sealed: AgentCommAuditEvent = {
      kind: 'agent-comm-audit',
      ts: '2026-05-05T00:00:00Z',
      event: { type: 'sealed', reason: 'token_budget_exceeded' },
    };
    expect(send.event.type).toBe('send');
    expect(trip.event.type).toBe('limit-tripped');
    expect(cancelled.event.type).toBe('wake-cancelled');
    expect(sealed.event.type).toBe('sealed');
  });
});
