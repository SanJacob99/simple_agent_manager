import { describe, expect, it } from 'vitest';
import type { ResolvedA2AConfig } from '../../shared/agent-config';
import {
  A2A_TASK_STATES,
  activeRemoteDelegates,
  agentCardUrl,
  buildAgentCard,
  buildMessageSendRequest,
  buildSecuritySchemes,
  canTransition,
  delegateToolName,
  isTerminalTaskState,
  parseTaskResult,
  remoteAgentToolSpec,
  shouldPublishCard,
  transportLabel,
  validateAgentCard,
} from './a2a-engine';

function makeConfig(overrides: Partial<ResolvedA2AConfig> = {}): ResolvedA2AConfig {
  return {
    a2aNodeId: 'a1',
    label: 'A2A Interop',
    enabled: true,
    role: 'both',
    protocolVersion: '0.3.0',
    transport: 'jsonrpc',
    exposeAgentCard: true,
    cardName: '',
    cardDescription: 'A test agent.',
    serverUrl: 'https://agent.example.com/',
    wellKnownPath: '/.well-known/agent-card.json',
    streaming: true,
    pushNotifications: false,
    authScheme: 'none',
    inputModes: ['text/plain'],
    outputModes: ['text/plain'],
    advertisedSkills: [
      { id: 'chat', name: 'Chat', description: 'General chat.', tags: ['chat'] },
    ],
    remoteAgents: [],
    taskTimeoutSec: 120,
    ...overrides,
  };
}

describe('transportLabel', () => {
  it('maps config transports to A2A identifiers', () => {
    expect(transportLabel('jsonrpc')).toBe('JSONRPC');
    expect(transportLabel('grpc')).toBe('GRPC');
    expect(transportLabel('rest')).toBe('HTTP+JSON');
  });
});

describe('buildSecuritySchemes', () => {
  it('omits schemes for none', () => {
    expect(buildSecuritySchemes('none')).toBeUndefined();
  });

  it('builds apiKey / bearer / oauth2 schemes', () => {
    expect(buildSecuritySchemes('apiKey')).toEqual({
      apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
    });
    expect(buildSecuritySchemes('bearer')).toEqual({
      bearer: { type: 'http', scheme: 'bearer' },
    });
    expect(buildSecuritySchemes('oauth2')).toHaveProperty('oauth2');
  });
});

describe('buildAgentCard', () => {
  it('builds a card from config, falling back to the agent identity', () => {
    const card = buildAgentCard(makeConfig(), 'My Agent', '2.1.0');
    expect(card.name).toBe('My Agent'); // cardName blank → falls back
    expect(card.version).toBe('2.1.0');
    expect(card.protocolVersion).toBe('0.3.0');
    expect(card.url).toBe('https://agent.example.com'); // trailing slash trimmed
    expect(card.preferredTransport).toBe('JSONRPC');
    expect(card.capabilities).toEqual({ streaming: true, pushNotifications: false });
    expect(card.skills).toHaveLength(1);
    expect(card.skills[0].id).toBe('chat');
  });

  it('prefers an explicit card name and omits security schemes when auth is none', () => {
    const card = buildAgentCard(makeConfig({ cardName: 'Named' }));
    expect(card.name).toBe('Named');
    expect(card.securitySchemes).toBeUndefined();
  });

  it('includes security schemes when an auth scheme is set', () => {
    const card = buildAgentCard(makeConfig({ authScheme: 'bearer' }));
    expect(card.securitySchemes).toEqual({ bearer: { type: 'http', scheme: 'bearer' } });
  });

  it('defaults empty input/output modes to text/plain', () => {
    const card = buildAgentCard(makeConfig({ inputModes: [], outputModes: [] }));
    expect(card.defaultInputModes).toEqual(['text/plain']);
    expect(card.defaultOutputModes).toEqual(['text/plain']);
  });
});

describe('agentCardUrl', () => {
  it('joins base and well-known path, normalizing slashes', () => {
    expect(agentCardUrl(makeConfig())).toBe(
      'https://agent.example.com/.well-known/agent-card.json',
    );
    expect(
      agentCardUrl(makeConfig({ serverUrl: 'https://x.dev', wellKnownPath: 'agent.json' })),
    ).toBe('https://x.dev/agent.json');
  });
});

describe('validateAgentCard', () => {
  it('accepts a well-formed card and narrows skills', () => {
    const result = validateAgentCard({
      name: 'Remote',
      url: 'https://remote.dev',
      version: '1.0.0',
      capabilities: { streaming: true },
      skills: [{ id: 's1', name: 'Do', description: 'does', tags: ['x', 1] }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.card.name).toBe('Remote');
      expect(result.card.capabilities.streaming).toBe(true);
      expect(result.card.skills[0].tags).toEqual(['x']); // non-strings dropped
    }
  });

  it('reports every missing required field', () => {
    const result = validateAgentCard({ description: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining(['missing name', 'missing url', 'missing version', 'missing skills array']),
      );
    }
  });

  it('rejects non-objects', () => {
    expect(validateAgentCard(null).ok).toBe(false);
    expect(validateAgentCard('nope').ok).toBe(false);
  });
});

describe('task lifecycle', () => {
  it('classifies terminal states', () => {
    expect(isTerminalTaskState('completed')).toBe(true);
    expect(isTerminalTaskState('failed')).toBe(true);
    expect(isTerminalTaskState('canceled')).toBe(true);
    expect(isTerminalTaskState('rejected')).toBe(true);
    expect(isTerminalTaskState('working')).toBe(false);
    expect(isTerminalTaskState('input-required')).toBe(false);
  });

  it('allows non-terminal transitions and blocks terminal / self ones', () => {
    expect(canTransition('submitted', 'working')).toBe(true);
    expect(canTransition('working', 'completed')).toBe(true);
    expect(canTransition('working', 'input-required')).toBe(true);
    expect(canTransition('completed', 'working')).toBe(false);
    expect(canTransition('working', 'working')).toBe(false);
  });

  it('exposes all documented states', () => {
    expect(A2A_TASK_STATES).toContain('submitted');
    expect(A2A_TASK_STATES).toContain('auth-required');
  });
});

describe('buildMessageSendRequest', () => {
  it('shapes a JSON-RPC 2.0 message/send request', () => {
    const req = buildMessageSendRequest({ requestId: 'r1', messageId: 'm1', text: 'hello' });
    expect(req.jsonrpc).toBe('2.0');
    expect(req.id).toBe('r1');
    expect(req.method).toBe('message/send');
    const message = req.params.message as Record<string, unknown>;
    expect(message.role).toBe('user');
    expect(message.messageId).toBe('m1');
    expect(message.parts).toEqual([{ kind: 'text', text: 'hello' }]);
    expect(message).not.toHaveProperty('taskId');
  });

  it('carries task and context ids when provided', () => {
    const req = buildMessageSendRequest({
      requestId: 'r1',
      messageId: 'm1',
      text: 'hi',
      taskId: 't1',
      contextId: 'c1',
    });
    const message = req.params.message as Record<string, unknown>;
    expect(message.taskId).toBe('t1');
    expect(message.contextId).toBe('c1');
  });
});

describe('parseTaskResult', () => {
  it('reads a Task result with status message and artifacts', () => {
    const res = parseTaskResult({
      result: {
        kind: 'task',
        status: { state: 'completed', message: { parts: [{ kind: 'text', text: 'done. ' }] } },
        artifacts: [{ parts: [{ kind: 'text', text: 'result body' }] }],
      },
    });
    expect(res.state).toBe('completed');
    expect(res.text).toBe('done. result body');
    expect(res.error).toBeUndefined();
  });

  it('reads a bare Message result as completed', () => {
    const res = parseTaskResult({
      result: { kind: 'message', parts: [{ kind: 'text', text: 'hi there' }] },
    });
    expect(res.state).toBe('completed');
    expect(res.text).toBe('hi there');
  });

  it('surfaces JSON-RPC errors', () => {
    const res = parseTaskResult({ error: { code: -32601, message: 'method not found' } });
    expect(res.state).toBeNull();
    expect(res.error).toBe('method not found');
  });

  it('handles empty / malformed responses', () => {
    expect(parseTaskResult(null).error).toBe('empty response');
    expect(parseTaskResult({}).error).toBe('missing result');
  });

  it('nulls out unknown task states', () => {
    const res = parseTaskResult({ result: { kind: 'task', status: { state: 'bogus' } } });
    expect(res.state).toBeNull();
  });
});

describe('remote agent delegation', () => {
  const remote = {
    id: 'weather',
    name: 'Weather Bot',
    cardUrl: 'https://weather.dev/.well-known/agent-card.json',
    transport: 'jsonrpc' as const,
    enabledAsTool: true,
  };

  it('derives a tool-safe delegate name', () => {
    expect(delegateToolName(remote)).toBe('a2a__weather_bot');
    expect(delegateToolName({ ...remote, name: '', id: '' })).toBe('a2a__agent');
  });

  it('builds a delegate tool spec with a task input', () => {
    const spec = remoteAgentToolSpec(remote);
    expect(spec.name).toBe('a2a__weather_bot');
    expect(spec.description).toContain('Weather Bot');
    expect(spec.inputSchema.required).toEqual(['task']);
  });

  it('lists only enabled remote delegates for client/both roles', () => {
    const config = makeConfig({
      role: 'both',
      remoteAgents: [
        remote,
        { ...remote, id: 'off', enabledAsTool: false },
        { ...remote, id: 'blank', cardUrl: '  ' },
      ],
    });
    const active = activeRemoteDelegates(config);
    expect(active.map((r) => r.id)).toEqual(['weather']);
  });

  it('exposes no delegates in server-only role or when disabled', () => {
    expect(activeRemoteDelegates(makeConfig({ role: 'server', remoteAgents: [remote] }))).toEqual([]);
    expect(
      activeRemoteDelegates(makeConfig({ enabled: false, role: 'client', remoteAgents: [remote] })),
    ).toEqual([]);
  });
});

describe('shouldPublishCard', () => {
  it('publishes for server/both when enabled and exposeAgentCard set', () => {
    expect(shouldPublishCard(makeConfig({ role: 'server' }))).toBe(true);
    expect(shouldPublishCard(makeConfig({ role: 'both' }))).toBe(true);
  });

  it('does not publish for client role, when disabled, or when card hidden', () => {
    expect(shouldPublishCard(makeConfig({ role: 'client' }))).toBe(false);
    expect(shouldPublishCard(makeConfig({ enabled: false }))).toBe(false);
    expect(shouldPublishCard(makeConfig({ exposeAgentCard: false }))).toBe(false);
  });
});
