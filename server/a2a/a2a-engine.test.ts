import { describe, expect, it } from 'vitest';
import type { ResolvedA2AConfig, ResolvedA2ARemoteAgent } from '../../shared/agent-config';
import {
  A2A_PROTOCOL_VERSION,
  buildAgentCard,
  buildMessageSendParams,
  isClient,
  isServer,
  isTerminalState,
  normalizeBasePath,
  parseTaskResult,
  resolveCardUrl,
  validateRemote,
  wellKnownCardPath,
  type AgentCardMeta,
} from './a2a-engine';

function makeConfig(overrides: Partial<ResolvedA2AConfig> = {}): ResolvedA2AConfig {
  return {
    a2aNodeId: 'a1',
    label: 'A2A',
    enabled: true,
    role: 'both',
    agentName: '',
    agentDescription: '',
    publishSkills: true,
    transport: 'jsonrpc',
    streaming: true,
    pushNotifications: false,
    serverAuth: 'bearer',
    basePath: '/a2a',
    remotes: [],
    taskTimeoutMs: 120000,
    maxConcurrentTasks: 4,
    ...overrides,
  };
}

function makeRemote(overrides: Partial<ResolvedA2ARemoteAgent> = {}): ResolvedA2ARemoteAgent {
  return {
    id: 'r1',
    name: 'Planner',
    cardUrl: 'https://planner.example.com/a2a',
    authScheme: 'bearer',
    credentialEnvVar: 'PLANNER_TOKEN',
    ...overrides,
  };
}

const meta: AgentCardMeta = {
  baseUrl: 'https://me.example.com/a2a',
  fallbackName: 'My Agent',
  fallbackDescription: 'Does things',
  agentVersion: '1.0.0',
  skills: [
    { id: 'summarize', name: 'Summarize', description: 'Summarize text', tags: ['text'] },
  ],
};

describe('normalizeBasePath', () => {
  it('adds a leading slash and strips trailing slashes', () => {
    expect(normalizeBasePath('a2a')).toBe('/a2a');
    expect(normalizeBasePath('/a2a/')).toBe('/a2a');
    expect(normalizeBasePath('/agents/x///')).toBe('/agents/x');
  });

  it('falls back to /a2a for empty input', () => {
    expect(normalizeBasePath('')).toBe('/a2a');
    expect(normalizeBasePath('   ')).toBe('/a2a');
    expect(normalizeBasePath('/')).toBe('/a2a');
  });
});

describe('wellKnownCardPath', () => {
  it('appends the well-known suffix to the normalized base', () => {
    expect(wellKnownCardPath('/a2a')).toBe('/a2a/.well-known/agent-card.json');
    expect(wellKnownCardPath('agents/x/')).toBe('/agents/x/.well-known/agent-card.json');
  });
});

describe('resolveCardUrl', () => {
  it('extends a bare origin to the well-known card path', () => {
    expect(resolveCardUrl('https://host.example.com/a2a')).toBe(
      'https://host.example.com/a2a/.well-known/agent-card.json',
    );
  });

  it('leaves an explicit card URL untouched', () => {
    const explicit = 'https://host.example.com/a2a/.well-known/agent-card.json';
    expect(resolveCardUrl(explicit)).toBe(explicit);
    expect(resolveCardUrl('https://host.example.com/card.json')).toBe(
      'https://host.example.com/card.json',
    );
  });

  it('returns empty for empty input', () => {
    expect(resolveCardUrl('')).toBe('');
  });
});

describe('isServer / isClient', () => {
  it('honours role and the enabled flag', () => {
    expect(isServer(makeConfig({ role: 'server' }))).toBe(true);
    expect(isClient(makeConfig({ role: 'server' }))).toBe(false);
    expect(isServer(makeConfig({ role: 'client' }))).toBe(false);
    expect(isClient(makeConfig({ role: 'client' }))).toBe(true);
    expect(isServer(makeConfig({ role: 'both' }))).toBe(true);
    expect(isClient(makeConfig({ role: 'both' }))).toBe(true);
    expect(isServer(makeConfig({ role: 'both', enabled: false }))).toBe(false);
    expect(isClient(makeConfig({ role: 'both', enabled: false }))).toBe(false);
  });
});

describe('buildAgentCard', () => {
  it('uses node name/description when set, else falls back to agent metadata', () => {
    const withNames = buildAgentCard(
      makeConfig({ agentName: 'Card Name', agentDescription: 'Card desc' }),
      meta,
    );
    expect(withNames.name).toBe('Card Name');
    expect(withNames.description).toBe('Card desc');

    const fallback = buildAgentCard(makeConfig(), meta);
    expect(fallback.name).toBe('My Agent');
    expect(fallback.description).toBe('Does things');
  });

  it('advertises the protocol version, url, and capabilities', () => {
    const card = buildAgentCard(makeConfig({ streaming: true, pushNotifications: true }), meta);
    expect(card.protocolVersion).toBe(A2A_PROTOCOL_VERSION);
    expect(card.url).toBe('https://me.example.com/a2a');
    expect(card.preferredTransport).toBe('JSONRPC');
    expect(card.capabilities).toEqual({ streaming: true, pushNotifications: true });
  });

  it('maps the transport label', () => {
    expect(buildAgentCard(makeConfig({ transport: 'grpc' }), meta).preferredTransport).toBe('GRPC');
    expect(buildAgentCard(makeConfig({ transport: 'rest' }), meta).preferredTransport).toBe(
      'HTTP+JSON',
    );
  });

  it('lists skills only when publishSkills is set', () => {
    expect(buildAgentCard(makeConfig({ publishSkills: true }), meta).skills).toHaveLength(1);
    expect(buildAgentCard(makeConfig({ publishSkills: false }), meta).skills).toHaveLength(0);
  });

  it('declares a security scheme for authed servers and none for open ones', () => {
    const bearer = buildAgentCard(makeConfig({ serverAuth: 'bearer' }), meta);
    expect(bearer.securitySchemes?.default).toEqual({ type: 'http', scheme: 'bearer' });
    expect(bearer.security).toEqual([{ default: [] }]);

    const open = buildAgentCard(makeConfig({ serverAuth: 'none' }), meta);
    expect(open.securitySchemes).toBeUndefined();
    expect(open.security).toBeUndefined();

    const apiKey = buildAgentCard(makeConfig({ serverAuth: 'apiKey' }), meta);
    expect(apiKey.securitySchemes?.default.type).toBe('apiKey');
  });
});

describe('validateRemote', () => {
  it('accepts a well-formed authed remote', () => {
    expect(validateRemote(makeRemote())).toEqual({ ok: true, errors: [] });
  });

  it('rejects a missing or non-http card URL', () => {
    expect(validateRemote(makeRemote({ cardUrl: '' })).ok).toBe(false);
    expect(validateRemote(makeRemote({ cardUrl: 'ftp://x/y' })).errors).toContain(
      'cardUrl must be an http(s) URL',
    );
  });

  it('requires a credential env var when auth is not none', () => {
    const r = validateRemote(makeRemote({ authScheme: 'bearer', credentialEnvVar: '' }));
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/credentialEnvVar/);
  });

  it('does not require a credential when auth is none', () => {
    expect(validateRemote(makeRemote({ authScheme: 'none', credentialEnvVar: '' })).ok).toBe(true);
  });
});

describe('buildMessageSendParams', () => {
  it('builds a JSON-RPC 2.0 message/send request', () => {
    const req = buildMessageSendParams('hello', { messageId: 'm1', requestId: 'q1' });
    expect(req.jsonrpc).toBe('2.0');
    expect(req.id).toBe('q1');
    expect(req.method).toBe('message/send');
    expect(req.params.message.parts).toEqual([{ kind: 'text', text: 'hello' }]);
    expect(req.params.message.messageId).toBe('m1');
    expect(req.params.configuration?.blocking).toBe(true);
  });

  it('honours a non-blocking send', () => {
    const req = buildMessageSendParams('hi', { messageId: 'm', requestId: 'q', blocking: false });
    expect(req.params.configuration?.blocking).toBe(false);
  });
});

describe('parseTaskResult', () => {
  it('parses a completed Task with an artifact', () => {
    const res = parseTaskResult({
      jsonrpc: '2.0',
      id: 'q1',
      result: {
        kind: 'task',
        id: 't1',
        status: { state: 'completed' },
        artifacts: [{ parts: [{ kind: 'text', text: 'done' }] }],
      },
    });
    expect(res).toEqual({ text: 'done', state: 'completed', taskId: 't1' });
  });

  it('falls back to the status message when there is no artifact', () => {
    const res = parseTaskResult({
      result: {
        kind: 'task',
        id: 't2',
        status: { state: 'input-required', message: { parts: [{ kind: 'text', text: 'more?' }] } },
      },
    });
    expect(res.text).toBe('more?');
    expect(res.state).toBe('input-required');
  });

  it('parses a bare Message result', () => {
    const res = parseTaskResult({
      result: { kind: 'message', role: 'agent', parts: [{ kind: 'text', text: 'hi back' }] },
    });
    expect(res).toEqual({ text: 'hi back', state: 'completed', taskId: '' });
  });

  it('surfaces a JSON-RPC error', () => {
    const res = parseTaskResult({ error: { code: -32000, message: 'nope' } });
    expect(res.state).toBe('failed');
    expect(res.error).toBe('nope');
  });

  it('collapses unknown shapes to unknown state without throwing', () => {
    expect(parseTaskResult(null).state).toBe('unknown');
    expect(parseTaskResult({}).state).toBe('unknown');
    expect(parseTaskResult({ result: 42 }).state).toBe('unknown');
  });
});

describe('isTerminalState', () => {
  it('classifies terminal vs non-terminal states', () => {
    expect(isTerminalState('completed')).toBe(true);
    expect(isTerminalState('failed')).toBe(true);
    expect(isTerminalState('canceled')).toBe(true);
    expect(isTerminalState('rejected')).toBe(true);
    expect(isTerminalState('working')).toBe(false);
    expect(isTerminalState('input-required')).toBe(false);
    expect(isTerminalState('submitted')).toBe(false);
  });
});
