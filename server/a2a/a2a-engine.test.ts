import { describe, expect, it } from 'vitest';
import type { ResolvedA2AConfig } from '../../shared/agent-config';
import {
  A2A_PROTOCOL_VERSION,
  buildAgentCard,
  buildRemoteDelegateTools,
  buildTaskEnvelope,
  enabledRemotes,
  isClientActive,
  isServerActive,
  parseTaskResult,
  remoteSlug,
  remoteToolName,
  securitySchemesFor,
  transportToken,
  validateA2AConfig,
} from './a2a-engine';

function makeConfig(overrides: Partial<ResolvedA2AConfig> = {}): ResolvedA2AConfig {
  return {
    a2aNodeId: 'a1',
    label: 'A2A',
    role: 'both',
    serverEnabled: true,
    agentName: '',
    agentDescription: 'A helpful agent',
    agentVersion: '2.1.0',
    publicUrl: 'https://agent.example.com/',
    cardPath: '/.well-known/agent-card.json',
    transport: 'jsonrpc',
    streaming: true,
    pushNotifications: false,
    serverAuthScheme: 'none',
    serverCredentialEnvVar: '',
    skills: [{ id: 's1', name: 'Summarize', description: 'Summarize text', tags: ['nlp'] }],
    remoteAgents: [],
    taskTimeoutMs: 120000,
    ...overrides,
  };
}

describe('transportToken', () => {
  it('maps node transports to A2A tokens', () => {
    expect(transportToken('jsonrpc')).toBe('JSONRPC');
    expect(transportToken('grpc')).toBe('GRPC');
    expect(transportToken('rest')).toBe('HTTP+JSON');
  });
});

describe('securitySchemesFor', () => {
  it('yields no entry for an open endpoint', () => {
    expect(securitySchemesFor('none')).toEqual({});
  });
  it('maps schemes to spec types', () => {
    expect(securitySchemesFor('apiKey')).toEqual({ apiKey: { type: 'apiKey' } });
    expect(securitySchemesFor('bearer')).toEqual({ bearer: { type: 'http' } });
    expect(securitySchemesFor('oauth2')).toEqual({ oauth2: { type: 'oauth2' } });
  });
});

describe('buildAgentCard', () => {
  it('assembles a card, trimming the trailing slash off the URL', () => {
    const card = buildAgentCard(makeConfig(), 'Fallback Agent');
    expect(card.protocolVersion).toBe(A2A_PROTOCOL_VERSION);
    expect(card.url).toBe('https://agent.example.com');
    expect(card.version).toBe('2.1.0');
    expect(card.preferredTransport).toBe('JSONRPC');
    expect(card.capabilities).toEqual({
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: false,
    });
    expect(card.skills).toEqual([
      { id: 's1', name: 'Summarize', description: 'Summarize text', tags: ['nlp'] },
    ]);
  });

  it('falls back to the agent name and default version when blank', () => {
    const card = buildAgentCard(
      makeConfig({ agentName: '   ', agentVersion: '' }),
      'Fallback Agent',
    );
    expect(card.name).toBe('Fallback Agent');
    expect(card.version).toBe('1.0.0');
  });
});

describe('role gating', () => {
  it('gates the server on role + serverEnabled', () => {
    expect(isServerActive(makeConfig({ role: 'both', serverEnabled: true }))).toBe(true);
    expect(isServerActive(makeConfig({ role: 'client', serverEnabled: true }))).toBe(false);
    expect(isServerActive(makeConfig({ role: 'server', serverEnabled: false }))).toBe(false);
  });
  it('gates the client on role', () => {
    expect(isClientActive(makeConfig({ role: 'client' }))).toBe(true);
    expect(isClientActive(makeConfig({ role: 'server' }))).toBe(false);
  });
});

describe('remote slugs and tool names', () => {
  it('slugifies names', () => {
    expect(remoteSlug('Weather Bot')).toBe('weather_bot');
    expect(remoteSlug('  Search!!  ')).toBe('search');
    expect(remoteSlug('')).toBe('agent');
  });
  it('derives a2a_<slug> tool names', () => {
    expect(
      remoteToolName({
        id: 'r1',
        name: 'Weather Bot',
        cardUrl: '',
        endpoint: '',
        authScheme: 'none',
        credentialEnvVar: '',
        enabled: true,
      }),
    ).toBe('a2a_weather_bot');
  });
});

describe('buildRemoteDelegateTools', () => {
  const remote = (id: string, name: string, enabled = true) => ({
    id,
    name,
    cardUrl: `https://${id}.example.com/.well-known/agent-card.json`,
    endpoint: '',
    authScheme: 'none' as const,
    credentialEnvVar: '',
    enabled,
  });

  it('only builds tools for enabled remotes when the client is active', () => {
    const tools = buildRemoteDelegateTools(
      makeConfig({
        role: 'both',
        remoteAgents: [remote('r1', 'Alpha'), remote('r2', 'Beta', false)],
      }),
    );
    expect(tools.map((t) => t.name)).toEqual(['a2a_alpha']);
    expect(tools[0].timeoutMs).toBe(120000);
  });

  it('builds nothing when the node is server-only', () => {
    expect(
      buildRemoteDelegateTools(makeConfig({ role: 'server', remoteAgents: [remote('r1', 'Alpha')] })),
    ).toEqual([]);
  });

  it('numbers colliding tool names', () => {
    const tools = buildRemoteDelegateTools(
      makeConfig({ role: 'client', remoteAgents: [remote('r1', 'Search'), remote('r2', 'search')] }),
    );
    expect(tools.map((t) => t.name)).toEqual(['a2a_search', 'a2a_search_2']);
  });
});

describe('enabledRemotes', () => {
  it('is empty for a server-only node', () => {
    expect(enabledRemotes(makeConfig({ role: 'server' }))).toEqual([]);
  });
});

describe('buildTaskEnvelope', () => {
  it('wraps text in a JSON-RPC message/send request', () => {
    expect(buildTaskEnvelope('hello', 'req-1', 'msg-1')).toEqual({
      jsonrpc: '2.0',
      id: 'req-1',
      method: 'message/send',
      params: {
        message: {
          role: 'user',
          parts: [{ kind: 'text', text: 'hello' }],
          messageId: 'msg-1',
        },
      },
    });
  });
});

describe('parseTaskResult', () => {
  it('extracts a Message result', () => {
    expect(
      parseTaskResult({ result: { parts: [{ kind: 'text', text: 'hi' }, { kind: 'text', text: ' there' }] } }),
    ).toBe('hi there');
  });
  it('extracts a Task status message', () => {
    expect(
      parseTaskResult({ result: { status: { message: { parts: [{ text: 'done' }] } } } }),
    ).toBe('done');
  });
  it('extracts Task artifacts', () => {
    expect(
      parseTaskResult({
        result: { artifacts: [{ parts: [{ text: 'a' }] }, { parts: [{ text: 'b' }] }] },
      }),
    ).toBe('a\nb');
  });
  it('accepts a bare result object', () => {
    expect(parseTaskResult({ parts: [{ text: 'bare' }] })).toBe('bare');
  });
  it('returns empty string when no text can be recovered', () => {
    expect(parseTaskResult(null)).toBe('');
    expect(parseTaskResult({ result: {} })).toBe('');
    expect(parseTaskResult({ result: { parts: [{ kind: 'file' }] } })).toBe('');
  });
});

describe('validateA2AConfig', () => {
  it('passes a well-formed config with no issues', () => {
    expect(validateA2AConfig(makeConfig({ role: 'server' }))).toEqual([]);
  });

  it('errors when a server has no public URL', () => {
    const issues = validateA2AConfig(makeConfig({ role: 'server', publicUrl: '' }));
    expect(issues).toContainEqual({ level: 'error', message: 'Server is enabled but Public URL is empty.' });
  });

  it('errors when the card path is not absolute', () => {
    const issues = validateA2AConfig(makeConfig({ role: 'server', cardPath: 'agent.json' }));
    expect(issues.some((i) => i.level === 'error' && /Card path/.test(i.message))).toBe(true);
  });

  it('warns on server auth without a credential env var', () => {
    const issues = validateA2AConfig(
      makeConfig({ role: 'server', serverAuthScheme: 'bearer', serverCredentialEnvVar: '' }),
    );
    expect(issues.some((i) => i.level === 'warning' && /credential env var/.test(i.message))).toBe(true);
  });

  it('errors when an enabled remote has neither card URL nor endpoint', () => {
    const issues = validateA2AConfig(
      makeConfig({
        role: 'client',
        remoteAgents: [
          { id: 'r1', name: 'Alpha', cardUrl: '', endpoint: '', authScheme: 'none', credentialEnvVar: '', enabled: true },
        ],
      }),
    );
    expect(issues.some((i) => i.level === 'error' && /neither a card URL nor an endpoint/.test(i.message))).toBe(true);
  });

  it('ignores disabled remotes', () => {
    const issues = validateA2AConfig(
      makeConfig({
        role: 'client',
        remoteAgents: [
          { id: 'r1', name: 'Alpha', cardUrl: '', endpoint: '', authScheme: 'none', credentialEnvVar: '', enabled: false },
        ],
      }),
    );
    expect(issues).toEqual([]);
  });

  it('warns on delegate tool-name collisions', () => {
    const issues = validateA2AConfig(
      makeConfig({
        role: 'client',
        remoteAgents: [
          { id: 'r1', name: 'Search', cardUrl: 'https://a/c', endpoint: '', authScheme: 'none', credentialEnvVar: '', enabled: true },
          { id: 'r2', name: 'search', cardUrl: 'https://b/c', endpoint: '', authScheme: 'none', credentialEnvVar: '', enabled: true },
        ],
      }),
    );
    expect(issues.some((i) => i.level === 'warning' && /resolve to tool "a2a_search"/.test(i.message))).toBe(true);
  });
});
