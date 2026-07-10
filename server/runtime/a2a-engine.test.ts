import { describe, expect, it } from 'vitest';
import type { ResolvedA2AConfig } from '../../shared/agent-config';
import {
  A2A_PROTOCOL_VERSION,
  buildAgentCard,
  buildSecuritySchemes,
  callableDelegates,
  canTransition,
  isServerExposed,
  isTerminalState,
  selectRemoteAgent,
  validateTaskEnvelope,
} from './a2a-engine';

function makeConfig(overrides: Partial<ResolvedA2AConfig> = {}): ResolvedA2AConfig {
  return {
    a2aNodeId: 'a1',
    label: 'A2A',
    enabled: true,
    exposeAsServer: true,
    agentName: '',
    agentDescription: 'A helpful research agent.',
    version: '1.2.0',
    serverUrl: 'https://host/a2a',
    transport: 'jsonrpc',
    streaming: true,
    pushNotifications: false,
    authScheme: 'none',
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    remoteAgents: [],
    ...overrides,
  };
}

describe('buildAgentCard', () => {
  it('falls back to the agent name and default version', () => {
    const card = buildAgentCard(makeConfig({ agentName: '', version: '' }), 'Research Bot');
    expect(card.name).toBe('Research Bot');
    expect(card.version).toBe('0.0.0');
    expect(card.protocolVersion).toBe(A2A_PROTOCOL_VERSION);
  });

  it('prefers the explicit card name over the fallback', () => {
    const card = buildAgentCard(makeConfig({ agentName: 'Custom' }), 'Fallback');
    expect(card.name).toBe('Custom');
  });

  it('projects capabilities and skills onto the card', () => {
    const card = buildAgentCard(
      makeConfig({ streaming: true, pushNotifications: true }),
      'Agent',
      [{ id: 's1', name: 'Summarize', description: 'Summarize text' }],
    );
    expect(card.capabilities.streaming).toBe(true);
    expect(card.capabilities.pushNotifications).toBe(true);
    expect(card.skills).toHaveLength(1);
    expect(card.skills[0].id).toBe('s1');
  });

  it('dedupes input/output modes and falls back when empty', () => {
    const card = buildAgentCard(
      makeConfig({ defaultInputModes: ['text/plain', 'text/plain', ' '], defaultOutputModes: [] }),
      'Agent',
    );
    expect(card.defaultInputModes).toEqual(['text/plain']);
    expect(card.defaultOutputModes).toEqual(['text/plain']);
  });
});

describe('buildSecuritySchemes', () => {
  it('advertises nothing for the none scheme', () => {
    const { securitySchemes, security } = buildSecuritySchemes('none');
    expect(securitySchemes).toEqual({});
    expect(security).toEqual([]);
  });

  it('advertises a bearer scheme', () => {
    const { securitySchemes, security } = buildSecuritySchemes('bearer');
    expect(securitySchemes.bearer.scheme).toBe('bearer');
    expect(security).toEqual([{ bearer: [] }]);
  });
});

describe('task lifecycle', () => {
  it('marks the four settled states as terminal', () => {
    expect(isTerminalState('completed')).toBe(true);
    expect(isTerminalState('failed')).toBe(true);
    expect(isTerminalState('canceled')).toBe(true);
    expect(isTerminalState('rejected')).toBe(true);
  });

  it('marks in-flight states as non-terminal', () => {
    expect(isTerminalState('submitted')).toBe(false);
    expect(isTerminalState('working')).toBe(false);
    expect(isTerminalState('input-required')).toBe(false);
  });

  it('allows legal forward transitions', () => {
    expect(canTransition('submitted', 'working')).toBe(true);
    expect(canTransition('working', 'input-required')).toBe(true);
    expect(canTransition('input-required', 'completed')).toBe(true);
  });

  it('rejects illegal or out-of-terminal transitions', () => {
    expect(canTransition('submitted', 'completed')).toBe(false);
    expect(canTransition('completed', 'working')).toBe(false);
    expect(canTransition('failed', 'submitted')).toBe(false);
  });
});

describe('validateTaskEnvelope', () => {
  it('accepts a well-formed message/send envelope', () => {
    const res = validateTaskEnvelope({
      message: { role: 'user', messageId: 'm1', parts: [{ text: 'hello' }] },
    });
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.message?.parts[0]).toEqual({ kind: 'text', text: 'hello' });
  });

  it('normalizes bare string parts to text parts', () => {
    const res = validateTaskEnvelope({ message: { messageId: 'm1', parts: ['hi'] } });
    expect(res.message?.parts[0]).toEqual({ kind: 'text', text: 'hi' });
    expect(res.message?.role).toBe('user');
  });

  it('flags a missing messageId and empty parts', () => {
    const res = validateTaskEnvelope({ message: { role: 'user', parts: [] } });
    expect(res.valid).toBe(false);
    expect(res.errors).toContain('messageId is required');
    expect(res.errors).toContain('message must carry at least one part');
  });

  it('rejects a non-object envelope', () => {
    const res = validateTaskEnvelope(null);
    expect(res.valid).toBe(false);
    expect(res.message).toBeNull();
  });
});

describe('remote delegate selection', () => {
  const config = makeConfig({
    remoteAgents: [
      { id: 'planner', name: 'Planner', cardUrl: 'https://a/card.json', enabled: true },
      { id: 'legacy', name: 'Legacy', cardUrl: 'https://b/card.json', enabled: false },
      { id: 'nocard', name: 'No card', cardUrl: '  ', enabled: true },
    ],
  });

  it('selects an enabled delegate by id', () => {
    expect(selectRemoteAgent(config, 'planner')?.name).toBe('Planner');
  });

  it('returns null for a disabled or unknown delegate', () => {
    expect(selectRemoteAgent(config, 'legacy')).toBeNull();
    expect(selectRemoteAgent(config, 'ghost')).toBeNull();
  });

  it('callableDelegates drops disabled and card-less delegates', () => {
    const callable = callableDelegates(config);
    expect(callable.map((d) => d.id)).toEqual(['planner']);
  });

  it('callableDelegates is empty when the node is disabled', () => {
    expect(callableDelegates(makeConfig({ enabled: false, remoteAgents: config.remoteAgents }))).toEqual([]);
  });
});

describe('isServerExposed', () => {
  it('is true when enabled, exposed, and given a url', () => {
    expect(isServerExposed(makeConfig())).toBe(true);
  });

  it('is false when disabled, not exposing, or missing a url', () => {
    expect(isServerExposed(makeConfig({ enabled: false }))).toBe(false);
    expect(isServerExposed(makeConfig({ exposeAsServer: false }))).toBe(false);
    expect(isServerExposed(makeConfig({ serverUrl: '  ' }))).toBe(false);
  });
});
