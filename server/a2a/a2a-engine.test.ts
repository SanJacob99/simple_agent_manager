import { describe, expect, it } from 'vitest';
import type { ResolvedA2AConfig, ResolvedA2ARemoteAgent } from '../../shared/agent-config';
import {
  A2A_PROTOCOL_VERSION,
  buildAgentCard,
  buildAuthHeaders,
  buildDelegateToolSpec,
  buildMessageSendParams,
  canDelegate,
  parseTaskResult,
  resolveRemoteAgent,
  validateAgentCard,
} from './a2a-engine';

function makeRemote(overrides: Partial<ResolvedA2ARemoteAgent> = {}): ResolvedA2ARemoteAgent {
  return {
    id: 'r1',
    name: 'Researcher',
    cardUrl: 'https://remote.example/.well-known/agent-card.json',
    authScheme: 'none',
    authToken: '',
    ...overrides,
  };
}

function makeConfig(overrides: Partial<ResolvedA2AConfig> = {}): ResolvedA2AConfig {
  return {
    a2aNodeId: 'a1',
    label: 'A2A Interop',
    enabled: true,
    exposeServer: false,
    agentName: '',
    agentDescription: '',
    serverPath: '/a2a',
    advertiseStreaming: true,
    advertisePushNotifications: false,
    serverAuthScheme: 'none',
    remoteAgents: [],
    exposeDelegateTool: true,
    maxDelegationDepth: 2,
    taskTimeoutMs: 60000,
    ...overrides,
  };
}

const cardOpts = {
  baseUrl: 'http://localhost:3001',
  version: '1.2.3',
  fallbackName: 'My Agent',
  fallbackDescription: 'Does things',
};

describe('buildAgentCard', () => {
  it('assembles a card with protocol version, url, and capabilities', () => {
    const card = buildAgentCard(makeConfig(), cardOpts);
    expect(card.protocolVersion).toBe(A2A_PROTOCOL_VERSION);
    expect(card.url).toBe('http://localhost:3001/a2a');
    expect(card.version).toBe('1.2.3');
    expect(card.capabilities).toEqual({ streaming: true, pushNotifications: false });
  });

  it('falls back to agent name/description when the node leaves them blank', () => {
    const card = buildAgentCard(makeConfig(), cardOpts);
    expect(card.name).toBe('My Agent');
    expect(card.description).toBe('Does things');
  });

  it('prefers the node name/description when set', () => {
    const card = buildAgentCard(
      makeConfig({ agentName: 'Card Name', agentDescription: 'Card Desc' }),
      cardOpts,
    );
    expect(card.name).toBe('Card Name');
    expect(card.description).toBe('Card Desc');
  });

  it('joins base url and server path without doubling slashes', () => {
    const card = buildAgentCard(makeConfig({ serverPath: 'a2a' }), {
      ...cardOpts,
      baseUrl: 'http://localhost:3001/',
    });
    expect(card.url).toBe('http://localhost:3001/a2a');
  });

  it('emits a bearer security scheme when server auth is bearer', () => {
    const card = buildAgentCard(makeConfig({ serverAuthScheme: 'bearer' }), cardOpts);
    expect(card.securitySchemes).toEqual({ bearer: { type: 'http', scheme: 'bearer' } });
    expect(card.security).toEqual([{ bearer: [] }]);
  });

  it('emits an apiKey security scheme when server auth is apiKey', () => {
    const card = buildAgentCard(makeConfig({ serverAuthScheme: 'apiKey' }), cardOpts);
    expect(card.securitySchemes.apiKey).toEqual({
      type: 'apiKey',
      in: 'header',
      name: 'X-API-Key',
    });
    expect(card.security).toEqual([{ apiKey: [] }]);
  });

  it('leaves security empty for an unauthenticated server', () => {
    const card = buildAgentCard(makeConfig({ serverAuthScheme: 'none' }), cardOpts);
    expect(card.securitySchemes).toEqual({});
    expect(card.security).toEqual([]);
  });
});

describe('validateAgentCard', () => {
  it('accepts a minimal valid card and fills defaults', () => {
    const res = validateAgentCard({ name: 'Remote', url: 'https://x.example/a2a' });
    expect(res.valid).toBe(true);
    if (res.valid) {
      expect(res.card.protocolVersion).toBe(A2A_PROTOCOL_VERSION);
      expect(res.card.defaultInputModes).toEqual(['text/plain']);
      expect(res.card.capabilities).toEqual({ streaming: false, pushNotifications: false });
    }
  });

  it('rejects a non-object', () => {
    const res = validateAgentCard('nope');
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.errors).toContain('card is not an object');
  });

  it('rejects a card missing name and url', () => {
    const res = validateAgentCard({});
    expect(res.valid).toBe(false);
    if (!res.valid) {
      expect(res.errors).toContain('missing "name"');
      expect(res.errors).toContain('missing "url"');
    }
  });

  it('rejects a non-http url', () => {
    const res = validateAgentCard({ name: 'X', url: 'ftp://x.example' });
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.errors).toContain('"url" must be http(s)');
  });

  it('preserves declared capabilities', () => {
    const res = validateAgentCard({
      name: 'X',
      url: 'https://x.example',
      capabilities: { streaming: true, pushNotifications: true },
    });
    expect(res.valid).toBe(true);
    if (res.valid) {
      expect(res.card.capabilities).toEqual({ streaming: true, pushNotifications: true });
    }
  });
});

describe('resolveRemoteAgent', () => {
  it('finds a remote by id', () => {
    const config = makeConfig({ remoteAgents: [makeRemote({ id: 'a' }), makeRemote({ id: 'b' })] });
    expect(resolveRemoteAgent(config, 'b')?.id).toBe('b');
  });

  it('returns null for an unknown id', () => {
    expect(resolveRemoteAgent(makeConfig(), 'missing')).toBeNull();
  });
});

describe('buildAuthHeaders', () => {
  it('returns no headers for none', () => {
    expect(buildAuthHeaders(makeRemote({ authScheme: 'none' }))).toEqual({});
  });

  it('builds a bearer header from the env var', () => {
    const headers = buildAuthHeaders(
      makeRemote({ authScheme: 'bearer', authToken: 'REMOTE_TOKEN' }),
      (name) => (name === 'REMOTE_TOKEN' ? 'secret' : undefined),
    );
    expect(headers).toEqual({ Authorization: 'Bearer secret' });
  });

  it('builds an X-API-Key header from the env var', () => {
    const headers = buildAuthHeaders(
      makeRemote({ authScheme: 'apiKey', authToken: 'REMOTE_KEY' }),
      () => 'k123',
    );
    expect(headers).toEqual({ 'X-API-Key': 'k123' });
  });

  it('returns no headers when the env var is unset', () => {
    const headers = buildAuthHeaders(
      makeRemote({ authScheme: 'bearer', authToken: 'MISSING' }),
      () => undefined,
    );
    expect(headers).toEqual({});
  });
});

describe('canDelegate', () => {
  const withRemotes = makeConfig({ remoteAgents: [makeRemote()] });

  it('allows delegation below the depth ceiling', () => {
    expect(canDelegate(withRemotes, 0)).toBe(true);
    expect(canDelegate(withRemotes, 1)).toBe(true);
  });

  it('refuses at or above the depth ceiling', () => {
    expect(canDelegate(withRemotes, 2)).toBe(false);
    expect(canDelegate(withRemotes, 3)).toBe(false);
  });

  it('refuses when disabled, tool off, or no remotes', () => {
    expect(canDelegate(makeConfig({ ...withRemotes, enabled: false }), 0)).toBe(false);
    expect(canDelegate(makeConfig({ ...withRemotes, exposeDelegateTool: false }), 0)).toBe(false);
    expect(canDelegate(makeConfig({ remoteAgents: [] }), 0)).toBe(false);
  });
});

describe('buildDelegateToolSpec', () => {
  it('returns null when disabled or without remotes', () => {
    expect(buildDelegateToolSpec(makeConfig({ enabled: false }))).toBeNull();
    expect(buildDelegateToolSpec(makeConfig({ exposeDelegateTool: false }))).toBeNull();
    expect(buildDelegateToolSpec(makeConfig({ remoteAgents: [] }))).toBeNull();
  });

  it('enumerates remote ids as an enum and lists them in the description', () => {
    const config = makeConfig({
      remoteAgents: [makeRemote({ id: 'a', name: 'Alpha' }), makeRemote({ id: 'b', name: 'Beta' })],
    });
    const spec = buildDelegateToolSpec(config);
    expect(spec).not.toBeNull();
    expect(spec!.name).toBe('delegate_to_agent');
    expect(spec!.parameters.properties.agent_id).toMatchObject({ enum: ['a', 'b'] });
    expect(spec!.parameters.required).toEqual(['agent_id', 'task']);
    expect(spec!.description).toContain('a: Alpha');
    expect(spec!.description).toContain('b: Beta');
  });
});

describe('buildMessageSendParams', () => {
  it('wraps text in a user message with a single text part', () => {
    const params = buildMessageSendParams('hello', 'm-1');
    expect(params).toEqual({
      message: {
        role: 'user',
        parts: [{ kind: 'text', text: 'hello' }],
        messageId: 'm-1',
      },
    });
  });
});

describe('parseTaskResult', () => {
  it('parses a completed task with artifact text', () => {
    const res = parseTaskResult({
      status: { state: 'completed' },
      artifacts: [{ parts: [{ kind: 'text', text: 'the answer' }] }],
    });
    expect(res).toEqual({ state: 'completed', text: 'the answer' });
  });

  it('falls back to the status message when there are no artifacts', () => {
    const res = parseTaskResult({
      status: { state: 'working', message: { parts: [{ kind: 'text', text: 'thinking' }] } },
    });
    expect(res).toEqual({ state: 'working', text: 'thinking' });
  });

  it('parses a bare message result', () => {
    const res = parseTaskResult({ role: 'agent', parts: [{ kind: 'text', text: 'hi' }] });
    expect(res).toEqual({ state: 'completed', text: 'hi' });
  });

  it('surfaces an error on a failed task', () => {
    const res = parseTaskResult({
      status: { state: 'failed', message: { parts: [{ kind: 'text', text: 'boom' }] } },
    });
    expect(res.state).toBe('failed');
    expect(res.error).toBe('boom');
  });

  it('defaults a rejected task without a message to a generic error', () => {
    const res = parseTaskResult({ status: { state: 'rejected' } });
    expect(res.state).toBe('rejected');
    expect(res.error).toBe('task rejected');
  });

  it('returns unknown for a non-object or shapeless result', () => {
    expect(parseTaskResult(null)).toEqual({ state: 'unknown', text: '' });
    expect(parseTaskResult({})).toEqual({ state: 'unknown', text: '' });
  });

  it('joins text across multiple artifacts', () => {
    const res = parseTaskResult({
      status: { state: 'completed' },
      artifacts: [
        { parts: [{ kind: 'text', text: 'one' }] },
        { parts: [{ kind: 'text', text: 'two' }] },
      ],
    });
    expect(res.text).toBe('one\ntwo');
  });
});
