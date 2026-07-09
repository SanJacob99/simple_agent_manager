import { describe, expect, it } from 'vitest';
import type {
  ResolvedA2AConfig,
  ResolvedRemoteA2AAgent,
} from '../../shared/agent-config';
import {
  authSchemesFor,
  buildAgentCard,
  buildTaskMessage,
  canTransition,
  extractTaskText,
  isTerminalState,
  joinUrl,
  selectDelegate,
  validateRemoteAgent,
} from './a2a-engine';

function makeConfig(overrides: Partial<ResolvedA2AConfig> = {}): ResolvedA2AConfig {
  return {
    a2aNodeId: 'a1',
    label: 'A2A',
    enabled: true,
    role: 'both',
    agentName: '',
    agentDescription: 'A helpful research agent.',
    serverPath: '/a2a',
    streaming: true,
    publishSkills: true,
    authScheme: 'bearer',
    remoteAgents: [],
    defaultTimeoutMs: 60000,
    maxConcurrentTasks: 4,
    ...overrides,
  };
}

function remote(overrides: Partial<ResolvedRemoteA2AAgent> = {}): ResolvedRemoteA2AAgent {
  return {
    id: 'researcher',
    name: 'Researcher',
    url: 'https://agents.example.com/a2a',
    description: '',
    ...overrides,
  };
}

describe('task lifecycle', () => {
  it('marks the terminal states', () => {
    expect(isTerminalState('completed')).toBe(true);
    expect(isTerminalState('failed')).toBe(true);
    expect(isTerminalState('working')).toBe(false);
    expect(isTerminalState('submitted')).toBe(false);
  });

  it('allows forward progress through the lifecycle', () => {
    expect(canTransition('submitted', 'working')).toBe(true);
    expect(canTransition('working', 'input-required')).toBe(true);
    expect(canTransition('input-required', 'working')).toBe(true);
    expect(canTransition('working', 'completed')).toBe(true);
  });

  it('never transitions out of a terminal state', () => {
    expect(canTransition('completed', 'working')).toBe(false);
    expect(canTransition('failed', 'completed')).toBe(false);
    expect(canTransition('canceled', 'working')).toBe(false);
  });
});

describe('joinUrl', () => {
  it('joins with exactly one slash', () => {
    expect(joinUrl('https://x.dev', '/a2a')).toBe('https://x.dev/a2a');
    expect(joinUrl('https://x.dev/', 'a2a')).toBe('https://x.dev/a2a');
    expect(joinUrl('https://x.dev/', '/a2a')).toBe('https://x.dev/a2a');
  });

  it('returns the base when the path is empty', () => {
    expect(joinUrl('https://x.dev/', '')).toBe('https://x.dev');
  });
});

describe('authSchemesFor', () => {
  it('maps each scheme, advertising none for none', () => {
    expect(authSchemesFor(makeConfig({ authScheme: 'bearer' }))).toEqual(['bearer']);
    expect(authSchemesFor(makeConfig({ authScheme: 'apiKey' }))).toEqual(['apiKey']);
    expect(authSchemesFor(makeConfig({ authScheme: 'none' }))).toEqual([]);
  });
});

describe('buildAgentCard', () => {
  it('builds a card, joining base + path and honouring capabilities', () => {
    const card = buildAgentCard(makeConfig(), {
      baseUrl: 'https://x.dev',
      version: '1.2.0',
      fallbackName: 'My Agent',
      skills: [{ id: 'web', name: 'Web', description: 'browse', tags: ['io'] }],
    });
    expect(card.name).toBe('My Agent');
    expect(card.url).toBe('https://x.dev/a2a');
    expect(card.version).toBe('1.2.0');
    expect(card.capabilities.streaming).toBe(true);
    expect(card.authentication.schemes).toEqual(['bearer']);
    expect(card.skills).toHaveLength(1);
  });

  it('prefers an explicit agent name over the fallback', () => {
    const card = buildAgentCard(makeConfig({ agentName: 'Named' }), {
      baseUrl: 'https://x.dev',
      version: '1.0.0',
      fallbackName: 'Fallback',
    });
    expect(card.name).toBe('Named');
  });

  it('omits skills when publishSkills is off', () => {
    const card = buildAgentCard(makeConfig({ publishSkills: false }), {
      baseUrl: 'https://x.dev',
      version: '1.0.0',
      fallbackName: 'A',
      skills: [{ id: 'web', name: 'Web', description: 'browse', tags: [] }],
    });
    expect(card.skills).toEqual([]);
  });
});

describe('validateRemoteAgent', () => {
  it('accepts a well-formed http(s) delegate', () => {
    expect(validateRemoteAgent(remote())).toEqual([]);
  });

  it('flags a missing id and url', () => {
    const errors = validateRemoteAgent(remote({ id: '', url: '' }));
    expect(errors.length).toBe(2);
  });

  it('rejects a non-http url', () => {
    const errors = validateRemoteAgent(remote({ url: 'ftp://nope' }));
    expect(errors.some((e) => e.includes('http(s)'))).toBe(true);
  });
});

describe('selectDelegate', () => {
  const config = makeConfig({
    remoteAgents: [remote({ id: 'researcher', name: 'Researcher' }), remote({ id: 'coder', name: 'Coder' })],
  });

  it('resolves by id', () => {
    expect(selectDelegate(config, 'coder')?.id).toBe('coder');
  });

  it('resolves by case-insensitive name when id misses', () => {
    expect(selectDelegate(config, 'researcher')?.id).toBe('researcher');
    expect(selectDelegate(config, 'CODER')?.id).toBe('coder');
  });

  it('returns null for an unknown handle', () => {
    expect(selectDelegate(config, 'nobody')).toBeNull();
  });

  it('returns null when the node is server-only', () => {
    expect(selectDelegate(makeConfig({ ...config, role: 'server' }), 'coder')).toBeNull();
  });
});

describe('buildTaskMessage', () => {
  it('wraps text in a single user text part and defaults to blocking', () => {
    const params = buildTaskMessage('find the answer');
    expect(params.message.role).toBe('user');
    expect(params.message.parts).toEqual([{ kind: 'text', text: 'find the answer' }]);
    expect(params.configuration?.blocking).toBe(true);
  });

  it('carries a message id and blocking override', () => {
    const params = buildTaskMessage('hi', { messageId: 'm1', blocking: false });
    expect(params.message.messageId).toBe('m1');
    expect(params.configuration?.blocking).toBe(false);
  });
});

describe('extractTaskText', () => {
  it('prefers artifact text parts', () => {
    const text = extractTaskText({
      status: { state: 'completed' },
      artifacts: [{ parts: [{ kind: 'text', text: 'the answer' }] }],
      history: [{ role: 'agent', parts: [{ kind: 'text', text: 'ignored' }] }],
    });
    expect(text).toBe('the answer');
  });

  it('falls back to the last agent message', () => {
    const text = extractTaskText({
      history: [
        { role: 'user', parts: [{ kind: 'text', text: 'q' }] },
        { role: 'agent', parts: [{ kind: 'text', text: 'reply' }] },
      ],
    });
    expect(text).toBe('reply');
  });

  it('returns empty string when nothing is recoverable', () => {
    expect(extractTaskText({})).toBe('');
  });
});
