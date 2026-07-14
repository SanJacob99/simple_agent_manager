import { describe, expect, it } from 'vitest';
import type { ResolvedA2AConfig, SkillDefinition } from '../../shared/agent-config';
import {
  A2A_PROTOCOL_VERSION,
  agentCardUrl,
  buildAgentCard,
  buildSecuritySchemes,
  canTransition,
  extractMessageText,
  isTerminalState,
  joinUrl,
  selectRemoteAgent,
  validateIncomingMessage,
  type A2AMessage,
} from './a2a-engine';

function makeConfig(overrides: Partial<ResolvedA2AConfig> = {}): ResolvedA2AConfig {
  return {
    a2aNodeId: 'a1',
    label: 'A2A',
    enabled: true,
    exposeAsServer: true,
    agentName: 'Test Agent',
    agentDescription: 'A test agent.',
    serverPath: '/a2a',
    version: '0.1.0',
    streaming: true,
    pushNotifications: false,
    stateTransitionHistory: true,
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    publishSkills: true,
    authScheme: 'none',
    remoteAgents: [],
    ...overrides,
  };
}

describe('joinUrl', () => {
  it('joins without doubling or dropping slashes', () => {
    expect(joinUrl('https://host.example/', '/a2a')).toBe('https://host.example/a2a');
    expect(joinUrl('https://host.example', 'a2a')).toBe('https://host.example/a2a');
    expect(joinUrl('https://host.example//', '//a2a')).toBe('https://host.example//a2a');
  });
});

describe('agentCardUrl', () => {
  it('points at the well-known card path under the endpoint', () => {
    expect(agentCardUrl(makeConfig(), 'https://host.example')).toBe(
      'https://host.example/a2a/.well-known/agent-card.json',
    );
  });
});

describe('buildSecuritySchemes', () => {
  it('returns null for no auth', () => {
    expect(buildSecuritySchemes(makeConfig({ authScheme: 'none' }))).toBeNull();
  });
  it('maps bearer and apiKey schemes', () => {
    expect(buildSecuritySchemes(makeConfig({ authScheme: 'bearer' }))).toEqual({
      bearer: { type: 'http', scheme: 'bearer' },
    });
    expect(buildSecuritySchemes(makeConfig({ authScheme: 'apiKey' }))).toEqual({
      apiKey: { type: 'apiKey', in: 'header' },
    });
  });
});

describe('buildAgentCard', () => {
  it('builds a card advertising capabilities and endpoint', () => {
    const card = buildAgentCard(makeConfig(), 'https://host.example');
    expect(card).not.toBeNull();
    expect(card!.protocolVersion).toBe(A2A_PROTOCOL_VERSION);
    expect(card!.name).toBe('Test Agent');
    expect(card!.url).toBe('https://host.example/a2a');
    expect(card!.capabilities).toEqual({
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: true,
    });
    expect(card!.securitySchemes).toBeNull();
  });

  it('returns null when disabled or not exposed as server', () => {
    expect(buildAgentCard(makeConfig({ enabled: false }), 'https://h')).toBeNull();
    expect(buildAgentCard(makeConfig({ exposeAsServer: false }), 'https://h')).toBeNull();
  });

  it('publishes connected skills only when publishSkills is set', () => {
    const skills: SkillDefinition[] = [
      { id: 's1', name: 'Summarize', content: 'Summarize text\nmore', injectAs: 'system-prompt' },
    ];
    const withSkills = buildAgentCard(makeConfig({ publishSkills: true }), 'https://h', skills);
    expect(withSkills!.skills).toEqual([
      { id: 's1', name: 'Summarize', description: 'Summarize text', tags: ['skill'] },
    ]);
    const withoutSkills = buildAgentCard(makeConfig({ publishSkills: false }), 'https://h', skills);
    expect(withoutSkills!.skills).toEqual([]);
  });
});

describe('task-state machine', () => {
  it('flags terminal states', () => {
    expect(isTerminalState('completed')).toBe(true);
    expect(isTerminalState('failed')).toBe(true);
    expect(isTerminalState('working')).toBe(false);
    expect(isTerminalState('submitted')).toBe(false);
  });

  it('allows valid forward transitions and rejects invalid ones', () => {
    expect(canTransition('submitted', 'working')).toBe(true);
    expect(canTransition('working', 'completed')).toBe(true);
    expect(canTransition('working', 'input-required')).toBe(true);
    expect(canTransition('input-required', 'working')).toBe(true);
    // No transitions out of a terminal state.
    expect(canTransition('completed', 'working')).toBe(false);
    // Cannot skip straight from submitted to completed.
    expect(canTransition('submitted', 'completed')).toBe(false);
  });
});

describe('validateIncomingMessage', () => {
  it('accepts a well-formed text message', () => {
    const res = validateIncomingMessage({
      role: 'user',
      parts: [{ kind: 'text', text: 'hi' }],
      messageId: 'm1',
    });
    expect('message' in res).toBe(true);
    if ('message' in res) {
      expect(res.message.role).toBe('user');
      expect(res.message.messageId).toBe('m1');
    }
  });

  it('rejects a bad role, empty parts, and malformed parts', () => {
    expect('error' in validateIncomingMessage({ role: 'bot', parts: [{ kind: 'text', text: 'x' }] })).toBe(true);
    expect('error' in validateIncomingMessage({ role: 'user', parts: [] })).toBe(true);
    expect('error' in validateIncomingMessage({ role: 'user', parts: [{ kind: 'text' }] })).toBe(true);
    expect('error' in validateIncomingMessage({ role: 'user', parts: [{ kind: 'bogus' }] })).toBe(true);
    expect('error' in validateIncomingMessage(null)).toBe(true);
  });

  it('passes unknown fields on parts through untouched', () => {
    const res = validateIncomingMessage({
      role: 'agent',
      parts: [{ kind: 'data', payload: { a: 1 } }],
    });
    expect('message' in res).toBe(true);
  });
});

describe('extractMessageText', () => {
  it('concatenates text parts in order and skips non-text', () => {
    const message: A2AMessage = {
      role: 'user',
      parts: [
        { kind: 'text', text: 'line one' },
        { kind: 'data', payload: 1 },
        { kind: 'text', text: 'line two' },
      ],
    };
    expect(extractMessageText(message)).toBe('line one\nline two');
  });
});

describe('selectRemoteAgent', () => {
  it('finds a peer by alias and returns null when absent', () => {
    const config = makeConfig({
      remoteAgents: [
        { name: 'researcher', cardUrl: 'https://r/card.json', description: 'research' },
      ],
    });
    expect(selectRemoteAgent(config, 'researcher')?.cardUrl).toBe('https://r/card.json');
    expect(selectRemoteAgent(config, 'missing')).toBeNull();
  });
});
