import { describe, expect, it } from 'vitest';
import type { ResolvedA2AConfig } from '../../shared/agent-config';
import {
  A2A_PROTOCOL_VERSION,
  WELL_KNOWN_CARD_PATH,
  buildAgentCard,
  buildJsonRpcRequest,
  buildMessageSendParams,
  isTerminalState,
  joinUrl,
  normalizeCardUrl,
  parseTaskResult,
  securitySchemesFor,
  servesCard,
  toDelegateDescriptors,
  toToolToken,
} from './a2a-engine';

function makeConfig(overrides: Partial<ResolvedA2AConfig> = {}): ResolvedA2AConfig {
  return {
    a2aNodeId: 'a1',
    label: 'A2A Interop',
    enabled: true,
    role: 'both',
    agentName: 'Research Agent',
    agentDescription: 'Answers research questions.',
    serverPath: '/a2a',
    version: '0.1.0',
    advertiseStreaming: true,
    advertisePushNotifications: false,
    inputModes: ['text/plain'],
    outputModes: ['text/plain'],
    authScheme: 'none',
    skills: [],
    remoteAgents: [],
    forwardArtifacts: true,
    ...overrides,
  };
}

describe('isTerminalState', () => {
  it('treats completed/failed/canceled/rejected as terminal', () => {
    expect(isTerminalState('completed')).toBe(true);
    expect(isTerminalState('failed')).toBe(true);
    expect(isTerminalState('canceled')).toBe(true);
    expect(isTerminalState('rejected')).toBe(true);
  });

  it('treats submitted/working/input-required as non-terminal', () => {
    expect(isTerminalState('submitted')).toBe(false);
    expect(isTerminalState('working')).toBe(false);
    expect(isTerminalState('input-required')).toBe(false);
    expect(isTerminalState('auth-required')).toBe(false);
  });

  it('treats unknown states as non-terminal', () => {
    expect(isTerminalState('nonsense')).toBe(false);
  });
});

describe('joinUrl', () => {
  it('joins without doubling or dropping the slash', () => {
    expect(joinUrl('https://host.dev', '/a2a')).toBe('https://host.dev/a2a');
    expect(joinUrl('https://host.dev/', '/a2a')).toBe('https://host.dev/a2a');
    expect(joinUrl('https://host.dev', 'a2a')).toBe('https://host.dev/a2a');
    expect(joinUrl('https://host.dev///', '/a2a')).toBe('https://host.dev/a2a');
  });

  it('returns the path when the base is empty', () => {
    expect(joinUrl('', '/a2a')).toBe('/a2a');
  });
});

describe('securitySchemesFor', () => {
  it('maps each scheme, none yielding an empty object', () => {
    expect(securitySchemesFor('none')).toEqual({});
    expect(securitySchemesFor('bearer')).toEqual({ bearer: { type: 'http', scheme: 'bearer' } });
    expect(securitySchemesFor('apiKey').apiKey.type).toBe('apiKey');
    expect(securitySchemesFor('oauth2').oauth2.type).toBe('oauth2');
  });
});

describe('buildAgentCard', () => {
  it('assembles a card from config with capabilities and skills', () => {
    const card = buildAgentCard(
      makeConfig({
        advertiseStreaming: true,
        advertisePushNotifications: true,
        skills: [{ id: 's1', name: 'Search', description: 'Web search', tags: ['web', 'rag'] }],
      }),
    );
    expect(card.name).toBe('Research Agent');
    expect(card.protocolVersion).toBe(A2A_PROTOCOL_VERSION);
    expect(card.capabilities).toEqual({
      streaming: true,
      pushNotifications: true,
      stateTransitionHistory: false,
    });
    expect(card.skills).toHaveLength(1);
    expect(card.skills[0].tags).toEqual(['web', 'rag']);
    expect(card.url).toBeUndefined();
  });

  it('sets an absolute url when a base url is supplied', () => {
    const card = buildAgentCard(makeConfig({ serverPath: '/a2a' }), 'https://host.dev/');
    expect(card.url).toBe('https://host.dev/a2a');
  });

  it('falls back to text/plain modes when none are configured', () => {
    const card = buildAgentCard(makeConfig({ inputModes: [], outputModes: [] }));
    expect(card.defaultInputModes).toEqual(['text/plain']);
    expect(card.defaultOutputModes).toEqual(['text/plain']);
  });
});

describe('buildMessageSendParams', () => {
  it('wraps text in a user message with a single text part', () => {
    const params = buildMessageSendParams('hello', { messageId: 'm1' });
    expect(params.message).toEqual({
      role: 'user',
      parts: [{ kind: 'text', text: 'hello' }],
      messageId: 'm1',
      kind: 'message',
    });
    expect(params.configuration).toBeUndefined();
  });

  it('threads context/task ids and configuration when provided', () => {
    const params = buildMessageSendParams('hi', {
      messageId: 'm2',
      contextId: 'c1',
      taskId: 't1',
      blocking: true,
      acceptedOutputModes: ['text/plain'],
    });
    expect(params.message.contextId).toBe('c1');
    expect(params.message.taskId).toBe('t1');
    expect(params.configuration).toEqual({ blocking: true, acceptedOutputModes: ['text/plain'] });
  });
});

describe('buildJsonRpcRequest', () => {
  it('wraps a method and params in a 2.0 envelope', () => {
    expect(buildJsonRpcRequest('message/send', { a: 1 }, 7)).toEqual({
      jsonrpc: '2.0',
      id: 7,
      method: 'message/send',
      params: { a: 1 },
    });
  });
});

describe('parseTaskResult', () => {
  it('parses a bare message reply', () => {
    const parsed = parseTaskResult({
      result: { kind: 'message', role: 'agent', parts: [{ kind: 'text', text: 'answer' }] },
    });
    expect(parsed.state).toBeNull();
    expect(parsed.text).toBe('answer');
    expect(parsed.error).toBeNull();
  });

  it('parses a task reply with artifacts', () => {
    const parsed = parseTaskResult({
      result: {
        kind: 'task',
        status: { state: 'completed' },
        artifacts: [{ parts: [{ kind: 'text', text: 'final' }] }],
      },
    });
    expect(parsed.state).toBe('completed');
    expect(parsed.text).toBe('final');
    expect(parsed.artifacts).toHaveLength(1);
  });

  it('falls back to the last agent message in history when no artifacts', () => {
    const parsed = parseTaskResult({
      result: {
        kind: 'task',
        status: { state: 'completed' },
        history: [
          { role: 'user', parts: [{ kind: 'text', text: 'q' }] },
          { role: 'agent', parts: [{ kind: 'text', text: 'a1' }] },
          { role: 'agent', parts: [{ kind: 'text', text: 'a2' }] },
        ],
      },
    });
    expect(parsed.text).toBe('a2');
  });

  it('surfaces a JSON-RPC error', () => {
    const parsed = parseTaskResult({ error: { code: -32001, message: 'task not found' } });
    expect(parsed.error).toBe('task not found');
    expect(parsed.state).toBeNull();
  });

  it('collapses malformed input to an empty result', () => {
    expect(parseTaskResult(null).text).toBe('');
    expect(parseTaskResult(42).state).toBeNull();
    expect(parseTaskResult('nope').artifacts).toEqual([]);
  });

  it('accepts a bare (unwrapped) result object', () => {
    const parsed = parseTaskResult({
      kind: 'message',
      parts: [{ kind: 'text', text: 'x' }],
    });
    expect(parsed.text).toBe('x');
  });
});

describe('toToolToken', () => {
  it('slugifies to a tool-safe token', () => {
    expect(toToolToken('Research Agent')).toBe('research_agent');
    expect(toToolToken('  a--b  ')).toBe('a_b');
    expect(toToolToken('!!!')).toBe('agent');
  });
});

describe('toDelegateDescriptors', () => {
  it('maps remote agents to delegate descriptors', () => {
    const delegates = toDelegateDescriptors(
      makeConfig({
        role: 'client',
        remoteAgents: [
          { id: 'r1', name: 'Coder', cardUrl: 'https://c.dev', authScheme: 'bearer' },
        ],
      }),
    );
    expect(delegates).toHaveLength(1);
    expect(delegates[0].toolName).toBe('a2a_delegate_coder');
    expect(delegates[0].authScheme).toBe('bearer');
  });

  it('returns nothing for a disabled node or a pure server', () => {
    const remoteAgents = [{ id: 'r1', name: 'Coder', cardUrl: 'https://c.dev', authScheme: 'none' as const }];
    expect(toDelegateDescriptors(makeConfig({ enabled: false, remoteAgents }))).toEqual([]);
    expect(toDelegateDescriptors(makeConfig({ role: 'server', remoteAgents }))).toEqual([]);
  });

  it('drops remote agents without a card url', () => {
    const delegates = toDelegateDescriptors(
      makeConfig({
        role: 'both',
        remoteAgents: [
          { id: 'r1', name: 'Coder', cardUrl: '', authScheme: 'none' },
          { id: 'r2', name: 'Writer', cardUrl: 'https://w.dev', authScheme: 'none' },
        ],
      }),
    );
    expect(delegates.map((d) => d.id)).toEqual(['r2']);
  });
});

describe('normalizeCardUrl', () => {
  it('appends the well-known path to a bare origin', () => {
    expect(normalizeCardUrl('https://host.dev')).toBe(`https://host.dev${WELL_KNOWN_CARD_PATH}`);
    expect(normalizeCardUrl('https://host.dev/')).toBe(`https://host.dev${WELL_KNOWN_CARD_PATH}`);
  });

  it('leaves an explicit .json card url untouched', () => {
    expect(normalizeCardUrl('https://host.dev/custom/card.json')).toBe(
      'https://host.dev/custom/card.json',
    );
  });

  it('returns empty input untouched', () => {
    expect(normalizeCardUrl('   ')).toBe('');
  });
});

describe('servesCard', () => {
  it('is true for enabled server/both roles only', () => {
    expect(servesCard(makeConfig({ role: 'server' }))).toBe(true);
    expect(servesCard(makeConfig({ role: 'both' }))).toBe(true);
    expect(servesCard(makeConfig({ role: 'client' }))).toBe(false);
    expect(servesCard(makeConfig({ role: 'both', enabled: false }))).toBe(false);
  });
});
