import { describe, expect, it } from 'vitest';
import type { ResolvedA2AConfig } from '../../shared/agent-config';
import {
  authHeader,
  buildAgentCard,
  buildSendMessageRequest,
  extractTextFromResult,
  remoteToolName,
  validateAgentCard,
  wellKnownCardUrl,
  WELL_KNOWN_A2A_PATH,
  JSON_RPC_VERSION,
} from './a2a-engine';

function makeConfig(overrides: Partial<ResolvedA2AConfig> = {}): ResolvedA2AConfig {
  return {
    a2aNodeId: 'a1',
    label: 'A2A',
    enabled: true,
    role: 'both',
    serverName: '',
    serverDescription: '',
    discoveryPath: WELL_KNOWN_A2A_PATH,
    version: '',
    streaming: true,
    pushNotifications: false,
    serverAuthScheme: 'none',
    defaultInputModes: [],
    defaultOutputModes: [],
    remoteAgents: [],
    exposeAsTools: true,
    maxConcurrentTasks: 4,
    taskTimeoutMs: 60_000,
    ...overrides,
  };
}

describe('buildAgentCard', () => {
  it('uses node config where set', () => {
    const card = buildAgentCard(
      makeConfig({
        serverName: 'Support Bot',
        serverDescription: 'Answers billing questions',
        version: '2.1.0',
        streaming: true,
        pushNotifications: true,
        defaultInputModes: ['text/plain', 'application/json'],
      }),
      { agentName: 'Fallback', baseUrl: 'https://agents.example.com/support' },
    );
    expect(card.name).toBe('Support Bot');
    expect(card.description).toBe('Answers billing questions');
    expect(card.version).toBe('2.1.0');
    expect(card.url).toBe('https://agents.example.com/support');
    expect(card.capabilities).toEqual({ streaming: true, pushNotifications: true });
    expect(card.defaultInputModes).toEqual(['text/plain', 'application/json']);
  });

  it('falls back to agent name, default version, and text modes', () => {
    const card = buildAgentCard(makeConfig(), {
      agentName: 'Research Agent',
      baseUrl: 'https://x.example',
    });
    expect(card.name).toBe('Research Agent');
    expect(card.version).toBe('0.1.0');
    expect(card.defaultInputModes).toEqual(['text/plain']);
    expect(card.defaultOutputModes).toEqual(['text/plain']);
  });

  it('maps supplied skills onto the card', () => {
    const card = buildAgentCard(makeConfig(), {
      agentName: 'A',
      baseUrl: 'https://x',
      skills: [
        { id: 'summarize', name: 'Summarize', description: 'Condense text', tags: ['nlp'] },
        { id: 'translate' },
      ],
    });
    expect(card.skills).toHaveLength(2);
    expect(card.skills[0]).toEqual({
      id: 'summarize',
      name: 'Summarize',
      description: 'Condense text',
      tags: ['nlp'],
    });
    // name defaults to id, description/tags default empty
    expect(card.skills[1]).toEqual({ id: 'translate', name: 'translate', description: '', tags: [] });
  });

  it('advertises a security scheme only when auth is required', () => {
    expect(buildAgentCard(makeConfig({ serverAuthScheme: 'none' }), {
      agentName: 'A',
      baseUrl: 'u',
    }).securitySchemes).toBeUndefined();

    const bearer = buildAgentCard(makeConfig({ serverAuthScheme: 'bearer' }), {
      agentName: 'A',
      baseUrl: 'u',
    });
    expect(bearer.securitySchemes).toEqual({ bearer: { type: 'http' } });
  });
});

describe('validateAgentCard', () => {
  const good = {
    name: 'Remote',
    url: 'https://remote.example',
    version: '1.0.0',
    capabilities: { streaming: true },
    skills: [{ id: 's1', name: 'Skill One', description: 'does a thing', tags: ['x'] }],
  };

  it('accepts a well-formed card object', () => {
    const res = validateAgentCard(good);
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.card?.name).toBe('Remote');
    expect(res.card?.capabilities).toEqual({ streaming: true, pushNotifications: false });
    expect(res.card?.skills[0].id).toBe('s1');
  });

  it('parses a card delivered as a JSON string', () => {
    const res = validateAgentCard(JSON.stringify(good));
    expect(res.valid).toBe(true);
    expect(res.card?.url).toBe('https://remote.example');
  });

  it('extracts a card embedded in prose', () => {
    const res = validateAgentCard(`Here is the card:\n${JSON.stringify(good)}\nEnjoy.`);
    expect(res.valid).toBe(true);
  });

  it('reports every missing required field', () => {
    const res = validateAgentCard({ description: 'x' });
    expect(res.valid).toBe(false);
    expect(res.card).toBeNull();
    expect(res.errors).toContain('missing "name"');
    expect(res.errors).toContain('missing "url"');
    expect(res.errors).toContain('missing "capabilities" object');
  });

  it('rejects non-objects', () => {
    expect(validateAgentCard(null).valid).toBe(false);
    expect(validateAgentCard(42).valid).toBe(false);
    expect(validateAgentCard([1, 2]).valid).toBe(false);
  });

  it('defaults optional fields on a minimal card', () => {
    const res = validateAgentCard({ name: 'M', url: 'u', capabilities: {} });
    expect(res.valid).toBe(true);
    expect(res.card?.version).toBe('0.1.0');
    expect(res.card?.skills).toEqual([]);
    expect(res.card?.defaultInputModes).toEqual(['text/plain']);
  });
});

describe('wellKnownCardUrl', () => {
  it('appends the well-known path to a bare origin', () => {
    expect(wellKnownCardUrl('https://x.example')).toBe(
      'https://x.example/.well-known/agent.json',
    );
  });

  it('collapses a trailing slash', () => {
    expect(wellKnownCardUrl('https://x.example/')).toBe(
      'https://x.example/.well-known/agent.json',
    );
  });

  it('returns a concrete .json card url untouched', () => {
    expect(wellKnownCardUrl('https://x.example/cards/agent.json')).toBe(
      'https://x.example/cards/agent.json',
    );
  });

  it('honors a custom discovery path', () => {
    expect(wellKnownCardUrl('https://x.example', '/a2a/card')).toBe('https://x.example/a2a/card');
  });
});

describe('authHeader', () => {
  it('produces no headers for none or empty value', () => {
    expect(authHeader('none', 'tok')).toEqual({});
    expect(authHeader('bearer', '  ')).toEqual({});
  });

  it('builds a bearer header, adding the prefix when absent', () => {
    expect(authHeader('bearer', 'abc')).toEqual({ Authorization: 'Bearer abc' });
    expect(authHeader('bearer', 'Bearer xyz')).toEqual({ Authorization: 'Bearer xyz' });
  });

  it('uses X-API-Key for apiKey', () => {
    expect(authHeader('apiKey', 'k1')).toEqual({ 'X-API-Key': 'k1' });
  });
});

describe('buildSendMessageRequest', () => {
  it('constructs a JSON-RPC message/send envelope', () => {
    const req = buildSendMessageRequest('do the thing', {
      requestId: 'req-1',
      messageId: 'msg-1',
    });
    expect(req.jsonrpc).toBe(JSON_RPC_VERSION);
    expect(req.id).toBe('req-1');
    expect(req.method).toBe('message/send');
    expect(req.params.message).toEqual({
      role: 'user',
      parts: [{ kind: 'text', text: 'do the thing' }],
      messageId: 'msg-1',
    });
  });
});

describe('extractTextFromResult', () => {
  it('reads text from a bare message result', () => {
    const out = extractTextFromResult({
      result: { parts: [{ kind: 'text', text: 'hello' }, { kind: 'text', text: 'world' }] },
    });
    expect(out).toBe('hello\nworld');
  });

  it('reads text from a task status message', () => {
    const out = extractTextFromResult({
      result: {
        id: 't1',
        status: { state: 'completed', message: { parts: [{ kind: 'text', text: 'done' }] } },
      },
    });
    expect(out).toBe('done');
  });

  it('reads text from task artifacts', () => {
    const out = extractTextFromResult({
      result: { artifacts: [{ parts: [{ type: 'text', text: 'artifact text' }] }] },
    });
    expect(out).toBe('artifact text');
  });

  it('surfaces a JSON-RPC error message', () => {
    expect(extractTextFromResult({ error: { code: -32000, message: 'task failed' } })).toBe(
      'task failed',
    );
  });

  it('handles an unwrapped payload', () => {
    expect(extractTextFromResult({ parts: [{ kind: 'text', text: 'bare' }] })).toBe('bare');
  });

  it('returns empty string when nothing textual is present', () => {
    expect(extractTextFromResult({ result: { status: { state: 'working' } } })).toBe('');
    expect(extractTextFromResult(null)).toBe('');
  });
});

describe('remoteToolName', () => {
  it('slugifies the agent name', () => {
    expect(remoteToolName({ id: 'r1', name: 'Weather Service!' })).toBe('a2a_send_weather_service');
  });

  it('falls back to the id when the name has no usable characters', () => {
    expect(remoteToolName({ id: 'remote-9', name: '***' })).toBe('a2a_send_remote_9');
  });

  it('falls back to a bare name as a last resort', () => {
    expect(remoteToolName({ id: '', name: '' })).toBe('a2a_send');
  });
});
