import { describe, expect, it } from 'vitest';
import type { ResolvedA2AConfig } from '../../shared/agent-config';
import {
  A2A_PROTOCOL_VERSION,
  advanceTask,
  authHeaders,
  buildAgentCard,
  buildMessage,
  buildTask,
  extractText,
  isTerminalState,
  listDelegates,
  parseIncomingMessage,
  selectRemote,
  validateAgentCard,
  type A2AMessage,
} from './a2a-engine';

function makeConfig(overrides: Partial<ResolvedA2AConfig> = {}): ResolvedA2AConfig {
  return {
    a2aNodeId: 'a1',
    label: 'A2A Interop',
    enabled: true,
    exposeAsServer: true,
    agentName: 'Simple Agent',
    agentDescription: 'A test agent.',
    version: '1.2.3',
    serverPath: '/a2a',
    streaming: true,
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    remotes: [],
    authScheme: 'none',
    taskTimeoutMs: 60000,
    ...overrides,
  };
}

describe('buildAgentCard', () => {
  it('produces a spec-shaped card with the protocol version', () => {
    const card = buildAgentCard(makeConfig(), 'https://host:8080');
    expect(card.protocolVersion).toBe(A2A_PROTOCOL_VERSION);
    expect(card.name).toBe('Simple Agent');
    expect(card.version).toBe('1.2.3');
    expect(card.url).toBe('https://host:8080/a2a');
    expect(card.capabilities.streaming).toBe(true);
    expect(card.skills).toEqual([]);
  });

  it('joins base url and path without doubling slashes', () => {
    const card = buildAgentCard(makeConfig({ serverPath: 'a2a' }), 'https://host/');
    expect(card.url).toBe('https://host/a2a');
  });

  it('falls back to text modes when none are configured', () => {
    const card = buildAgentCard(
      makeConfig({ defaultInputModes: [], defaultOutputModes: [] }),
      'https://host',
    );
    expect(card.defaultInputModes).toEqual(['text']);
    expect(card.defaultOutputModes).toEqual(['text']);
  });

  it('carries advertised skills through', () => {
    const card = buildAgentCard(makeConfig(), 'https://host', [
      { id: 'search', name: 'Search', description: 'Web search', tags: ['tool'] },
    ]);
    expect(card.skills).toHaveLength(1);
    expect(card.skills[0].id).toBe('search');
  });
});

describe('validateAgentCard', () => {
  it('accepts a well-formed card', () => {
    const card = buildAgentCard(makeConfig(), 'https://host');
    expect(validateAgentCard(card)).toEqual([]);
  });

  it('flags a non-object', () => {
    expect(validateAgentCard(null)).toEqual(['agent card is not an object']);
  });

  it('collects missing required fields', () => {
    const errors = validateAgentCard({ name: '', url: 'ftp://x', version: '' });
    expect(errors).toContain('missing name');
    expect(errors).toContain('missing or non-http url');
    expect(errors).toContain('missing version');
  });
});

describe('parseIncomingMessage', () => {
  it('parses a wrapped message/send payload', () => {
    const result = parseIncomingMessage({
      message: {
        role: 'user',
        parts: [{ kind: 'text', text: 'hello' }],
        messageId: 'm1',
      },
    });
    expect('message' in result).toBe(true);
    if ('message' in result) {
      expect(result.message.role).toBe('user');
      expect(extractText(result.message)).toBe('hello');
    }
  });

  it('parses a bare message object', () => {
    const result = parseIncomingMessage({
      role: 'agent',
      parts: [{ kind: 'text', text: 'hi' }],
      messageId: 'm2',
    });
    expect('message' in result).toBe(true);
    if ('message' in result) expect(result.message.role).toBe('agent');
  });

  it('errors when there are no text parts', () => {
    const result = parseIncomingMessage({ role: 'user', parts: [], messageId: 'm3' });
    expect('error' in result).toBe(true);
  });

  it('errors on a non-object payload', () => {
    expect('error' in parseIncomingMessage('nope')).toBe(true);
  });

  it('ignores non-text parts but keeps text ones', () => {
    const result = parseIncomingMessage({
      role: 'user',
      parts: [{ kind: 'file' }, { kind: 'text', text: 'kept' }],
      messageId: 'm4',
    });
    expect('message' in result).toBe(true);
    if ('message' in result) expect(extractText(result.message)).toBe('kept');
  });
});

describe('extractText', () => {
  it('concatenates multiple text parts', () => {
    const msg: A2AMessage = {
      role: 'user',
      parts: [
        { kind: 'text', text: 'a' },
        { kind: 'text', text: 'b' },
      ],
      messageId: 'm',
    };
    expect(extractText(msg)).toBe('ab');
  });
});

describe('task lifecycle', () => {
  it('opens a task in submitted with the request in history', () => {
    const req = buildMessage('user', 'do it', { messageId: 'm1' });
    const task = buildTask(req, { taskId: 't1', contextId: 'c1' });
    expect(task.status.state).toBe('submitted');
    expect(task.history).toHaveLength(1);
  });

  it('advances and appends the agent message', () => {
    const req = buildMessage('user', 'do it', { messageId: 'm1' });
    let task = buildTask(req, { taskId: 't1', contextId: 'c1' });
    task = advanceTask(task, 'working');
    expect(task.status.state).toBe('working');
    const reply = buildMessage('agent', 'done', { messageId: 'm2', taskId: 't1' });
    task = advanceTask(task, 'completed', reply);
    expect(task.status.state).toBe('completed');
    expect(task.history).toHaveLength(2);
    expect(task.status.message).toBe(reply);
  });

  it('refuses to advance out of a terminal state', () => {
    const req = buildMessage('user', 'do it', { messageId: 'm1' });
    let task = buildTask(req, { taskId: 't1', contextId: 'c1' });
    task = advanceTask(task, 'failed');
    const after = advanceTask(task, 'working');
    expect(after.status.state).toBe('failed');
  });

  it('classifies terminal states', () => {
    expect(isTerminalState('completed')).toBe(true);
    expect(isTerminalState('failed')).toBe(true);
    expect(isTerminalState('working')).toBe(false);
    expect(isTerminalState('submitted')).toBe(false);
  });
});

describe('buildMessage', () => {
  it('attaches optional ids only when present', () => {
    const bare = buildMessage('user', 'x', { messageId: 'm' });
    expect(bare.taskId).toBeUndefined();
    const full = buildMessage('agent', 'y', {
      messageId: 'm',
      taskId: 't',
      contextId: 'c',
    });
    expect(full.taskId).toBe('t');
    expect(full.contextId).toBe('c');
  });
});

describe('selectRemote / listDelegates', () => {
  const config = makeConfig({
    remotes: [
      { id: 'planner', name: 'Planner Agent', cardUrl: 'https://p/card', enabled: true },
      { id: 'coder', name: 'Coder Agent', cardUrl: 'https://c/card', enabled: false },
    ],
  });

  it('resolves by id case-insensitively', () => {
    expect(selectRemote(config, 'PLANNER')?.id).toBe('planner');
  });

  it('resolves by name', () => {
    expect(selectRemote(config, 'Planner Agent')?.id).toBe('planner');
  });

  it('ignores disabled remotes', () => {
    expect(selectRemote(config, 'coder')).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(selectRemote(config, 'ghost')).toBeNull();
  });

  it('lists only enabled delegates', () => {
    expect(listDelegates(config).map((r) => r.id)).toEqual(['planner']);
  });
});

describe('authHeaders', () => {
  it('returns no headers for none', () => {
    expect(authHeaders('none', 'secret')).toEqual({});
  });

  it('returns no headers when the credential is empty', () => {
    expect(authHeaders('bearer', '   ')).toEqual({});
  });

  it('builds a bearer header', () => {
    expect(authHeaders('bearer', 'tok')).toEqual({ Authorization: 'Bearer tok' });
  });

  it('builds an api-key header', () => {
    expect(authHeaders('apiKey', 'k')).toEqual({ 'X-API-Key': 'k' });
  });
});
