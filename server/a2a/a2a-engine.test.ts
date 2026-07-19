import { describe, expect, it } from 'vitest';
import type { ResolvedA2AConfig } from '../../shared/agent-config';
import {
  A2A_ERROR,
  A2A_PROTOCOL_VERSION,
  AGENT_CARD_WELL_KNOWN,
  advanceTask,
  buildAgentCard,
  buildAgentMessage,
  buildDelegateRequest,
  buildJsonRpcError,
  buildJsonRpcResult,
  buildTask,
  canTransition,
  effectiveTimeoutMs,
  isKnownMethod,
  isTerminalState,
  joinUrl,
  messageToPrompt,
  parseIncomingMessage,
  parseRpcRequest,
  selectDelegate,
  type A2AMessage,
} from './a2a-engine';

function makeConfig(overrides: Partial<ResolvedA2AConfig> = {}): ResolvedA2AConfig {
  return {
    a2aNodeId: 'a1',
    label: 'A2A Interop',
    enabled: true,
    mode: 'both',
    server: {
      agentName: 'Research Agent',
      agentDescription: 'Answers research questions',
      agentVersion: '1.0.0',
      path: '/a2a',
      streaming: true,
      pushNotifications: false,
      requireAuth: false,
      skills: [
        { id: 's1', name: 'summarize', description: 'Summarize a document', tags: ['text', 'nlp'] },
      ],
    },
    client: {
      remotes: [
        { id: 'r1', name: 'Coder', url: 'https://coder.example.com/a2a', description: 'Writes code' },
        { id: 'r2', name: 'Planner', url: 'https://planner.example.com/a2a', description: 'Plans tasks' },
      ],
      defaultTimeoutMs: 60000,
      maxConcurrentTasks: 4,
    },
    onError: 'warn',
    ...overrides,
  };
}

function userMessage(text: string): A2AMessage {
  return { role: 'user', parts: [{ kind: 'text', text }], messageId: 'm1' };
}

describe('isTerminalState / canTransition', () => {
  it('marks the four terminal states as terminal', () => {
    expect(isTerminalState('completed')).toBe(true);
    expect(isTerminalState('canceled')).toBe(true);
    expect(isTerminalState('failed')).toBe(true);
    expect(isTerminalState('rejected')).toBe(true);
  });

  it('does not mark active states as terminal', () => {
    expect(isTerminalState('submitted')).toBe(false);
    expect(isTerminalState('working')).toBe(false);
    expect(isTerminalState('input-required')).toBe(false);
  });

  it('allows valid transitions and rejects invalid ones', () => {
    expect(canTransition('submitted', 'working')).toBe(true);
    expect(canTransition('working', 'completed')).toBe(true);
    expect(canTransition('input-required', 'working')).toBe(true);
    expect(canTransition('completed', 'working')).toBe(false);
    expect(canTransition('failed', 'completed')).toBe(false);
    expect(canTransition('working', 'submitted')).toBe(false);
  });
});

describe('joinUrl', () => {
  it('joins with exactly one slash', () => {
    expect(joinUrl('https://x.com', '/a2a')).toBe('https://x.com/a2a');
    expect(joinUrl('https://x.com/', '/a2a')).toBe('https://x.com/a2a');
    expect(joinUrl('https://x.com/', 'a2a')).toBe('https://x.com/a2a');
    expect(joinUrl('https://x.com///', '///a2a')).toBe('https://x.com/a2a');
  });

  it('returns the trimmed origin for an empty path', () => {
    expect(joinUrl('https://x.com/', '')).toBe('https://x.com');
  });
});

describe('buildAgentCard', () => {
  it('builds a spec-shaped card at the mount path', () => {
    const card = buildAgentCard(makeConfig(), 'https://host.example.com');
    expect(card.protocolVersion).toBe(A2A_PROTOCOL_VERSION);
    expect(card.name).toBe('Research Agent');
    expect(card.url).toBe('https://host.example.com/a2a');
    expect(card.capabilities.streaming).toBe(true);
    expect(card.capabilities.pushNotifications).toBe(false);
    expect(card.skills).toHaveLength(1);
    expect(card.skills[0]).toEqual({
      id: 's1',
      name: 'summarize',
      description: 'Summarize a document',
      tags: ['text', 'nlp'],
    });
  });

  it('omits security schemes unless auth is required', () => {
    expect(buildAgentCard(makeConfig(), 'https://h.com').securitySchemes).toBeUndefined();
    const secured = buildAgentCard(
      makeConfig({ server: { ...makeConfig().server, requireAuth: true } }),
      'https://h.com',
    );
    expect(secured.securitySchemes).toEqual({ bearer: { type: 'http', scheme: 'bearer' } });
  });

  it('serves its card at the well-known path', () => {
    expect(AGENT_CARD_WELL_KNOWN).toBe('/.well-known/agent-card.json');
  });
});

describe('parseRpcRequest', () => {
  it('accepts a well-formed request', () => {
    const parsed = parseRpcRequest(
      { jsonrpc: '2.0', id: 7, method: 'message/send', params: { message: {} } },
      makeConfig(),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.id).toBe(7);
      expect(parsed.method).toBe('message/send');
    }
  });

  it('rejects a non-object body', () => {
    const parsed = parseRpcRequest('nope', makeConfig());
    expect(parsed).toMatchObject({ ok: false, code: A2A_ERROR.invalidRequest });
  });

  it('rejects a wrong jsonrpc version', () => {
    const parsed = parseRpcRequest({ jsonrpc: '1.0', id: 1, method: 'tasks/get' }, makeConfig());
    expect(parsed).toMatchObject({ ok: false, code: A2A_ERROR.invalidRequest });
  });

  it('rejects an unknown method', () => {
    const parsed = parseRpcRequest({ jsonrpc: '2.0', id: 1, method: 'do/thing' }, makeConfig());
    expect(parsed).toMatchObject({ ok: false, code: A2A_ERROR.methodNotFound });
  });

  it('refuses streaming when the server does not advertise it', () => {
    const config = makeConfig({ server: { ...makeConfig().server, streaming: false } });
    const parsed = parseRpcRequest({ jsonrpc: '2.0', id: 1, method: 'message/stream' }, config);
    expect(parsed).toMatchObject({ ok: false, code: A2A_ERROR.unsupportedOperation });
  });

  it('preserves a null id on malformed requests', () => {
    const parsed = parseRpcRequest({ jsonrpc: '2.0', method: 'do/thing' }, makeConfig());
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.id).toBeNull();
  });
});

describe('isKnownMethod', () => {
  it('recognizes the four A2A methods', () => {
    expect(isKnownMethod('message/send')).toBe(true);
    expect(isKnownMethod('tasks/cancel')).toBe(true);
    expect(isKnownMethod('unknown')).toBe(false);
  });
});

describe('parseIncomingMessage', () => {
  it('extracts text parts from a user message', () => {
    const msg = parseIncomingMessage({
      message: {
        role: 'user',
        messageId: 'abc',
        parts: [
          { kind: 'text', text: 'hello' },
          { kind: 'text', text: 'world' },
        ],
      },
    });
    expect(msg).not.toBeNull();
    expect(msg?.messageId).toBe('abc');
    expect(msg?.parts).toHaveLength(2);
  });

  it('rejects a missing message', () => {
    expect(parseIncomingMessage({})).toBeNull();
  });

  it('rejects a non-user role', () => {
    expect(
      parseIncomingMessage({ message: { role: 'agent', parts: [{ kind: 'text', text: 'x' }] } }),
    ).toBeNull();
  });

  it('rejects a message with no text parts', () => {
    expect(
      parseIncomingMessage({ message: { role: 'user', parts: [{ kind: 'file', uri: 'x' }] } }),
    ).toBeNull();
  });

  it('carries taskId and contextId through when present', () => {
    const msg = parseIncomingMessage({
      message: {
        role: 'user',
        messageId: 'm',
        taskId: 't1',
        contextId: 'c1',
        parts: [{ kind: 'text', text: 'go' }],
      },
    });
    expect(msg?.taskId).toBe('t1');
    expect(msg?.contextId).toBe('c1');
  });
});

describe('messageToPrompt', () => {
  it('joins text parts and trims', () => {
    expect(messageToPrompt({ role: 'user', messageId: 'm', parts: [
      { kind: 'text', text: '  a' },
      { kind: 'text', text: 'b  ' },
    ] })).toBe('a\nb');
  });
});

describe('task lifecycle', () => {
  it('starts a task in submitted with the incoming message in history', () => {
    const task = buildTask('t1', 'c1', userMessage('do it'));
    expect(task.status.state).toBe('submitted');
    expect(task.history).toHaveLength(1);
  });

  it('advances through legal transitions and appends agent messages', () => {
    const task = buildTask('t1', 'c1', userMessage('do it'));
    expect(advanceTask(task, 'working')).not.toBeNull();
    const done = buildAgentMessage('a1', 'here you go', 't1', 'c1');
    expect(advanceTask(task, 'completed', done)).not.toBeNull();
    expect(task.status.state).toBe('completed');
    expect(task.status.message).toEqual(done);
    expect(task.history).toHaveLength(2);
  });

  it('refuses an illegal transition and leaves the task untouched', () => {
    const task = buildTask('t1', 'c1', userMessage('do it'));
    advanceTask(task, 'working');
    advanceTask(task, 'completed');
    expect(advanceTask(task, 'working')).toBeNull();
    expect(task.status.state).toBe('completed');
    expect(task.history).toHaveLength(1);
  });
});

describe('selectDelegate', () => {
  it('matches an explicit agentId', () => {
    expect(selectDelegate(makeConfig(), { agentId: 'r2' })?.name).toBe('Planner');
  });

  it('matches by name substring, case-insensitively', () => {
    expect(selectDelegate(makeConfig(), { name: 'cod' })?.id).toBe('r1');
  });

  it('matches by capability against the description', () => {
    expect(selectDelegate(makeConfig(), { capability: 'plans' })?.id).toBe('r2');
  });

  it('returns the first remote when the query is empty', () => {
    expect(selectDelegate(makeConfig(), {})?.id).toBe('r1');
  });

  it('returns null when nothing matches', () => {
    expect(selectDelegate(makeConfig(), { name: 'nonexistent' })).toBeNull();
  });

  it('returns null when the client side is disabled', () => {
    expect(selectDelegate(makeConfig({ mode: 'server' }), { agentId: 'r1' })).toBeNull();
    expect(selectDelegate(makeConfig({ enabled: false }), { agentId: 'r1' })).toBeNull();
  });
});

describe('buildDelegateRequest / envelopes', () => {
  it('wraps text in a message/send request', () => {
    const req = buildDelegateRequest('mid', 'help me', 9);
    expect(req.method).toBe('message/send');
    expect(req.id).toBe(9);
    expect(req.params.message.role).toBe('user');
    expect(req.params.message.parts[0]).toEqual({ kind: 'text', text: 'help me' });
  });

  it('builds JSON-RPC result and error envelopes', () => {
    expect(buildJsonRpcResult(1, { ok: true })).toEqual({ jsonrpc: '2.0', id: 1, result: { ok: true } });
    const err = buildJsonRpcError(2, A2A_ERROR.taskNotFound, 'no task', { taskId: 't' });
    expect(err).toEqual({
      jsonrpc: '2.0',
      id: 2,
      error: { code: A2A_ERROR.taskNotFound, message: 'no task', data: { taskId: 't' } },
    });
  });

  it('omits the data field when not provided', () => {
    expect(buildJsonRpcError(1, A2A_ERROR.internalError, 'boom').error).not.toHaveProperty('data');
  });
});

describe('effectiveTimeoutMs', () => {
  it('uses the configured default', () => {
    expect(effectiveTimeoutMs(makeConfig())).toBe(60000);
  });

  it('floors a non-positive default to a sane minimum', () => {
    expect(effectiveTimeoutMs(makeConfig({ client: { ...makeConfig().client, defaultTimeoutMs: 0 } }))).toBe(30000);
  });
});
