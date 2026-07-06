import { describe, expect, it } from 'vitest';
import type { ResolvedA2AConfig, A2ARemoteAgent } from '../../shared/agent-config';
import {
  A2A_PROTOCOL_VERSION,
  applyRemoteErrorPolicy,
  buildAgentCard,
  buildSecuritySchemes,
  buildSendMessageRequest,
  extractTextFromParts,
  joinUrl,
  parseTaskResult,
  remoteAgentToolName,
  remoteAgentsAsTools,
  resolveRemoteTimeout,
  validateRemoteAgent,
} from './a2a-engine';

function makeConfig(overrides: Partial<ResolvedA2AConfig> = {}): ResolvedA2AConfig {
  return {
    a2aNodeId: 'a1',
    label: 'A2A Interop',
    enabled: true,
    exposeAsServer: true,
    agentName: '',
    agentDescription: 'A helpful agent',
    serverPath: '/a2a',
    skills: [],
    streaming: true,
    pushNotifications: false,
    authScheme: 'none',
    authHeaderName: 'X-API-Key',
    remoteAgents: [],
    defaultTimeoutMs: 30000,
    onRemoteError: 'warn',
    ...overrides,
  };
}

function makeRemote(overrides: Partial<A2ARemoteAgent> = {}): A2ARemoteAgent {
  return {
    id: 'billing',
    name: 'Billing Agent',
    cardUrl: 'https://billing.example.com/.well-known/agent-card.json',
    enabled: true,
    exposeAsTool: true,
    timeoutMs: 0,
    authScheme: 'none',
    ...overrides,
  };
}

describe('joinUrl', () => {
  it('joins without doubling slashes', () => {
    expect(joinUrl('https://host', '/a2a')).toBe('https://host/a2a');
    expect(joinUrl('https://host/', '/a2a')).toBe('https://host/a2a');
    expect(joinUrl('https://host/', 'a2a')).toBe('https://host/a2a');
    expect(joinUrl('https://host', 'a2a')).toBe('https://host/a2a');
  });
});

describe('buildAgentCard', () => {
  it('uses the fallback name when agentName is blank', () => {
    const card = buildAgentCard(makeConfig(), 'https://host:3001', 'My Agent');
    expect(card.name).toBe('My Agent');
    expect(card.protocolVersion).toBe(A2A_PROTOCOL_VERSION);
    expect(card.url).toBe('https://host:3001/a2a');
  });

  it('prefers an explicit agentName', () => {
    const card = buildAgentCard(makeConfig({ agentName: 'Support Bot' }), 'https://host', 'X');
    expect(card.name).toBe('Support Bot');
  });

  it('reflects capabilities from config', () => {
    const card = buildAgentCard(
      makeConfig({ streaming: false, pushNotifications: true }),
      'https://host',
      'X',
    );
    expect(card.capabilities).toEqual({
      streaming: false,
      pushNotifications: true,
      stateTransitionHistory: false,
    });
  });

  it('maps skills and keeps examples only when present', () => {
    const card = buildAgentCard(
      makeConfig({
        skills: [
          { id: 's1', name: 'Refunds', description: 'Handle refunds', tags: ['billing'], examples: ['refund order 5'] },
          { id: 's2', name: 'Lookup', description: 'Look up orders', tags: [], examples: [] },
        ],
      }),
      'https://host',
      'X',
    );
    expect(card.skills[0]).toEqual({
      id: 's1',
      name: 'Refunds',
      description: 'Handle refunds',
      tags: ['billing'],
      examples: ['refund order 5'],
    });
    expect(card.skills[1].examples).toBeUndefined();
  });

  it('omits securitySchemes for open endpoints', () => {
    const card = buildAgentCard(makeConfig({ authScheme: 'none' }), 'https://host', 'X');
    expect(card.securitySchemes).toBeUndefined();
    expect(card.security).toBeUndefined();
  });

  it('emits an apiKey scheme with the configured header', () => {
    const card = buildAgentCard(
      makeConfig({ authScheme: 'apiKey', authHeaderName: 'X-Key' }),
      'https://host',
      'X',
    );
    expect(card.securitySchemes).toEqual({ apiKey: { type: 'apiKey', name: 'X-Key', in: 'header' } });
    expect(card.security).toEqual([{ apiKey: [] }]);
  });

  it('emits a bearer scheme', () => {
    const { securitySchemes, security } = buildSecuritySchemes(makeConfig({ authScheme: 'bearer' }));
    expect(securitySchemes).toEqual({ bearer: { type: 'http', scheme: 'bearer' } });
    expect(security).toEqual([{ bearer: [] }]);
  });
});

describe('buildSendMessageRequest', () => {
  it('builds a message/send envelope with a text part', () => {
    const req = buildSendMessageRequest('hello', 'req-1', 'msg-1');
    expect(req).toEqual({
      jsonrpc: '2.0',
      id: 'req-1',
      method: 'message/send',
      params: { message: { role: 'user', parts: [{ kind: 'text', text: 'hello' }], messageId: 'msg-1' } },
    });
  });

  it('switches to message/stream and carries task/context ids', () => {
    const req = buildSendMessageRequest('hi', 'r', 'm', { stream: true, taskId: 't1', contextId: 'c1' });
    expect(req.method).toBe('message/stream');
    expect(req.params.message.taskId).toBe('t1');
    expect(req.params.message.contextId).toBe('c1');
  });

  it('includes blocking configuration when specified', () => {
    const req = buildSendMessageRequest('hi', 'r', 'm', { blocking: true });
    expect(req.params.configuration).toEqual({ blocking: true });
  });
});

describe('extractTextFromParts', () => {
  it('concatenates text parts and ignores others', () => {
    const text = extractTextFromParts([
      { kind: 'text', text: 'line 1' },
      { kind: 'file', file: {} },
      { kind: 'text', text: 'line 2' },
    ]);
    expect(text).toBe('line 1\nline 2');
  });

  it('returns empty for non-array input', () => {
    expect(extractTextFromParts(undefined)).toBe('');
    expect(extractTextFromParts('nope')).toBe('');
  });
});

describe('parseTaskResult', () => {
  it('recovers text from task artifacts', () => {
    const res = parseTaskResult({
      jsonrpc: '2.0',
      id: '1',
      result: {
        kind: 'task',
        id: 'task-1',
        status: { state: 'completed' },
        artifacts: [{ parts: [{ kind: 'text', text: 'the answer' }] }],
      },
    });
    expect(res).toEqual({ text: 'the answer', state: 'completed', taskId: 'task-1' });
  });

  it('falls back to the last agent history message', () => {
    const res = parseTaskResult({
      result: {
        status: { state: 'completed' },
        id: 't2',
        history: [
          { role: 'user', parts: [{ kind: 'text', text: 'q' }] },
          { role: 'agent', parts: [{ kind: 'text', text: 'a' }] },
        ],
      },
    });
    expect(res.text).toBe('a');
    expect(res.state).toBe('completed');
  });

  it('parses a bare message reply', () => {
    const res = parseTaskResult({
      result: { kind: 'message', role: 'agent', parts: [{ kind: 'text', text: 'direct reply' }] },
    });
    expect(res).toEqual({ text: 'direct reply', state: null, taskId: null });
  });

  it('throws on a JSON-RPC error member', () => {
    expect(() =>
      parseTaskResult({ jsonrpc: '2.0', id: '1', error: { code: -32601, message: 'method not found' } }),
    ).toThrow(/method not found.*code -32601/);
  });

  it('throws when result is missing', () => {
    expect(() => parseTaskResult({ jsonrpc: '2.0', id: '1' })).toThrow(/missing result/);
  });

  it('throws for non-object input', () => {
    expect(() => parseTaskResult(null)).toThrow(/JSON-RPC object/);
  });
});

describe('remoteAgentsAsTools', () => {
  it('keeps only enabled, exposed, non-empty-url agents', () => {
    const config = makeConfig({
      remoteAgents: [
        makeRemote({ id: 'a' }),
        makeRemote({ id: 'b', enabled: false }),
        makeRemote({ id: 'c', exposeAsTool: false }),
        makeRemote({ id: 'd', cardUrl: '  ' }),
      ],
    });
    expect(remoteAgentsAsTools(config).map((a) => a.id)).toEqual(['a']);
  });

  it('returns nothing when A2A is disabled', () => {
    const config = makeConfig({ enabled: false, remoteAgents: [makeRemote()] });
    expect(remoteAgentsAsTools(config)).toEqual([]);
  });
});

describe('remoteAgentToolName', () => {
  it('sanitizes ids into a2a__ tool names', () => {
    expect(remoteAgentToolName(makeRemote({ id: 'Billing Agent' }))).toBe('a2a__billing_agent');
    expect(remoteAgentToolName(makeRemote({ id: 'weather-svc.v2' }))).toBe('a2a__weather_svc_v2');
    expect(remoteAgentToolName(makeRemote({ id: '  ' }))).toBe('a2a__agent');
  });
});

describe('resolveRemoteTimeout', () => {
  it('prefers the agent timeout, then the default, then a floor', () => {
    const config = makeConfig({ defaultTimeoutMs: 15000 });
    expect(resolveRemoteTimeout(config, makeRemote({ timeoutMs: 5000 }))).toBe(5000);
    expect(resolveRemoteTimeout(config, makeRemote({ timeoutMs: 0 }))).toBe(15000);
    expect(resolveRemoteTimeout(makeConfig({ defaultTimeoutMs: 0 }), makeRemote({ timeoutMs: 0 }))).toBe(30000);
  });
});

describe('applyRemoteErrorPolicy', () => {
  const err = new Error('boom');
  const agent = makeRemote();

  it('rethrows on fail', () => {
    const d = applyRemoteErrorPolicy(makeConfig({ onRemoteError: 'fail' }), agent, err);
    expect(d.rethrow).toBe(true);
  });

  it('swallows on ignore', () => {
    const d = applyRemoteErrorPolicy(makeConfig({ onRemoteError: 'ignore' }), agent, err);
    expect(d).toEqual({ rethrow: false, emitEvent: false, toolResult: '' });
  });

  it('surfaces the error to the model on warn', () => {
    const d = applyRemoteErrorPolicy(makeConfig({ onRemoteError: 'warn' }), agent, err);
    expect(d.rethrow).toBe(false);
    expect(d.emitEvent).toBe(true);
    expect(d.toolResult).toContain('boom');
    expect(d.toolResult).toContain('Billing Agent');
  });
});

describe('validateRemoteAgent', () => {
  it('accepts a well-formed agent', () => {
    expect(validateRemoteAgent(makeRemote())).toEqual([]);
  });

  it('flags a missing id and bad url', () => {
    const problems = validateRemoteAgent(makeRemote({ id: '', cardUrl: 'ftp://x' }));
    expect(problems).toContain('id is required');
    expect(problems).toContain('cardUrl must be an http(s) URL');
  });

  it('flags a negative timeout', () => {
    expect(validateRemoteAgent(makeRemote({ timeoutMs: -1 }))).toContain('timeoutMs must be >= 0');
  });
});
