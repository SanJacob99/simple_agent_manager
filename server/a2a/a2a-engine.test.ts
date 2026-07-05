import { describe, expect, it } from 'vitest';
import type {
  ResolvedA2AConfig,
  ResolvedA2ARemoteAgent,
} from '../../shared/agent-config';
import {
  A2A_PROTOCOL_VERSION,
  WELL_KNOWN_CARD_PATH,
  buildAgentCard,
  buildAuthHeaders,
  buildMessageSendEnvelope,
  buildSecuritySchemes,
  delegateToolName,
  extractTextFromResult,
  isSuccessTaskState,
  isTerminalTaskState,
  servesAgentCard,
  shouldDelegate,
  slugify,
  validateRemoteAgent,
} from './a2a-engine';

function makeConfig(overrides: Partial<ResolvedA2AConfig> = {}): ResolvedA2AConfig {
  return {
    a2aNodeId: 'a1',
    label: 'A2A Interop',
    enabled: true,
    role: 'both',
    agentName: '',
    agentDescription: 'A helpful research agent.',
    agentVersion: '',
    publicUrl: '',
    streaming: true,
    advertisedSkills: [],
    inboundAuthScheme: 'bearer',
    remoteAgents: [],
    exposeAsTools: true,
    taskTimeoutMs: 60000,
    maxDelegationsPerRun: 8,
    ...overrides,
  };
}

function makeRemote(overrides: Partial<ResolvedA2ARemoteAgent> = {}): ResolvedA2ARemoteAgent {
  return {
    id: 'r1',
    name: 'Weather Bot',
    url: 'https://weather.example.com',
    authScheme: 'bearer',
    authValue: 'WEATHER_TOKEN',
    ...overrides,
  };
}

describe('slugify', () => {
  it('lowercases and replaces non-alnum runs with single underscores', () => {
    expect(slugify('Weather Bot 2.0!')).toBe('weather_bot_2_0');
  });

  it('falls back to "agent" for empty/punctuation-only input', () => {
    expect(slugify('')).toBe('agent');
    expect(slugify('!!!')).toBe('agent');
  });
});

describe('delegateToolName', () => {
  it('prefixes a slugified name with a2a_', () => {
    expect(delegateToolName(makeRemote())).toBe('a2a_weather_bot');
  });

  it('falls back to the id when the name is blank', () => {
    expect(delegateToolName(makeRemote({ name: '  ', id: 'abc123' }))).toBe('a2a_abc123');
  });
});

describe('buildSecuritySchemes', () => {
  it('maps each auth scheme to a card securityScheme; none is empty', () => {
    expect(buildSecuritySchemes('none')).toEqual({});
    expect(buildSecuritySchemes('bearer').bearer.scheme).toBe('bearer');
    expect(buildSecuritySchemes('apiKey').apiKey.type).toBe('apiKey');
    expect(buildSecuritySchemes('oauth2').oauth2.type).toBe('oauth2');
  });
});

describe('buildAgentCard', () => {
  const ctx = { fallbackName: 'Fallback Agent', fallbackUrl: 'http://localhost:3210' };

  it('produces a spec-shaped card and honors context fallbacks', () => {
    const card = buildAgentCard(makeConfig(), ctx);
    expect(card.protocolVersion).toBe(A2A_PROTOCOL_VERSION);
    expect(card.name).toBe('Fallback Agent'); // agentName blank -> fallback
    expect(card.url).toBe('http://localhost:3210'); // publicUrl blank -> fallback
    expect(card.version).toBe('1.0.0'); // agentVersion blank -> default
    expect(card.capabilities.streaming).toBe(true);
    expect(card.defaultInputModes).toContain('text/plain');
  });

  it('prefers explicit fields over fallbacks and maps advertised skills', () => {
    const card = buildAgentCard(
      makeConfig({
        agentName: 'Research Agent',
        publicUrl: 'https://agent.example.com',
        agentVersion: '2.3.1',
        advertisedSkills: ['Deep Research', '', '  Code Review  '],
        streaming: false,
      }),
      ctx,
    );
    expect(card.name).toBe('Research Agent');
    expect(card.url).toBe('https://agent.example.com');
    expect(card.version).toBe('2.3.1');
    expect(card.capabilities.streaming).toBe(false);
    expect(card.skills.map((s) => s.id)).toEqual(['deep_research', 'code_review']);
    expect(card.skills[0].name).toBe('Deep Research');
  });
});

describe('validateRemoteAgent', () => {
  it('accepts a well-formed remote', () => {
    expect(validateRemoteAgent(makeRemote())).toEqual({ ok: true, errors: [] });
  });

  it('rejects a missing or non-http URL', () => {
    expect(validateRemoteAgent(makeRemote({ url: '' })).ok).toBe(false);
    expect(validateRemoteAgent(makeRemote({ url: 'ftp://x' })).ok).toBe(false);
    expect(validateRemoteAgent(makeRemote({ url: 'not a url' })).ok).toBe(false);
  });

  it('requires a credential for an authenticated scheme but not for none', () => {
    expect(validateRemoteAgent(makeRemote({ authValue: '' })).ok).toBe(false);
    expect(validateRemoteAgent(makeRemote({ authScheme: 'none', authValue: '' })).ok).toBe(true);
  });
});

describe('buildAuthHeaders', () => {
  it('always sets content-type', () => {
    expect(buildAuthHeaders('none', '')['content-type']).toBe('application/json');
  });

  it('maps bearer/oauth2 to Authorization and apiKey to x-api-key', () => {
    expect(buildAuthHeaders('bearer', 'tok')['authorization']).toBe('Bearer tok');
    expect(buildAuthHeaders('oauth2', 'tok')['authorization']).toBe('Bearer tok');
    expect(buildAuthHeaders('apiKey', 'key')['x-api-key']).toBe('key');
  });

  it('omits the auth header when the token is blank', () => {
    expect(buildAuthHeaders('bearer', '  ')['authorization']).toBeUndefined();
  });
});

describe('buildMessageSendEnvelope', () => {
  it('builds a JSON-RPC 2.0 message/send request with a text part', () => {
    const env = buildMessageSendEnvelope('hello', { requestId: 'req1', messageId: 'msg1' });
    expect(env.jsonrpc).toBe('2.0');
    expect(env.method).toBe('message/send');
    expect(env.id).toBe('req1');
    expect(env.params.message.messageId).toBe('msg1');
    expect(env.params.message.parts).toEqual([{ kind: 'text', text: 'hello' }]);
  });
});

describe('task state helpers', () => {
  it('classifies terminal and success states', () => {
    expect(isTerminalTaskState('working')).toBe(false);
    expect(isTerminalTaskState('completed')).toBe(true);
    expect(isTerminalTaskState('failed')).toBe(true);
    expect(isTerminalTaskState('bogus')).toBe(false);
    expect(isSuccessTaskState('completed')).toBe(true);
    expect(isSuccessTaskState('failed')).toBe(false);
  });
});

describe('extractTextFromResult', () => {
  it('reads a bare Message', () => {
    const msg = { role: 'agent', parts: [{ kind: 'text', text: 'hi' }, { kind: 'text', text: 'there' }] };
    expect(extractTextFromResult(msg)).toBe('hi\nthere');
  });

  it('reads a Task via artifacts and status.message', () => {
    const task = {
      id: 't1',
      status: { state: 'completed', message: { parts: [{ kind: 'text', text: 'status note' }] } },
      artifacts: [{ parts: [{ kind: 'text', text: 'the answer' }] }],
    };
    expect(extractTextFromResult(task)).toBe('status note\nthe answer');
  });

  it('tolerates legacy type:text parts', () => {
    expect(extractTextFromResult({ parts: [{ type: 'text', text: 'legacy' }] })).toBe('legacy');
  });

  it('returns null when no text is present', () => {
    expect(extractTextFromResult(null)).toBeNull();
    expect(extractTextFromResult({})).toBeNull();
    expect(extractTextFromResult({ parts: [{ kind: 'file', uri: 'x' }] })).toBeNull();
  });
});

describe('shouldDelegate', () => {
  it('is false when disabled or when the role excludes client', () => {
    expect(shouldDelegate(makeConfig({ enabled: false }), 0)).toBe(false);
    expect(shouldDelegate(makeConfig({ role: 'server' }), 0)).toBe(false);
  });

  it('enforces the per-run ceiling and treats 0 as unlimited', () => {
    expect(shouldDelegate(makeConfig({ maxDelegationsPerRun: 2 }), 1)).toBe(true);
    expect(shouldDelegate(makeConfig({ maxDelegationsPerRun: 2 }), 2)).toBe(false);
    expect(shouldDelegate(makeConfig({ maxDelegationsPerRun: 0 }), 999)).toBe(true);
  });
});

describe('servesAgentCard', () => {
  it('is true only for enabled server/both roles', () => {
    expect(servesAgentCard(makeConfig({ role: 'both' }))).toBe(true);
    expect(servesAgentCard(makeConfig({ role: 'server' }))).toBe(true);
    expect(servesAgentCard(makeConfig({ role: 'client' }))).toBe(false);
    expect(servesAgentCard(makeConfig({ enabled: false }))).toBe(false);
  });
});

describe('constants', () => {
  it('exposes the well-known card path', () => {
    expect(WELL_KNOWN_CARD_PATH).toBe('/.well-known/agent-card.json');
  });
});
