import { describe, expect, it } from 'vitest';
import type { ResolvedA2AConfig } from '../../shared/agent-config';
import {
  A2A_PROTOCOL_VERSION,
  AGENT_CARD_PATH,
  buildAgentCard,
  buildMessage,
  buildSendMessageRequest,
  delegatesToRemotes,
  isTerminalState,
  normalizeTaskState,
  parseTaskResult,
  selectDelegate,
  servesCard,
  validateAgentCard,
} from './a2a-engine';

function makeConfig(overrides: Partial<ResolvedA2AConfig> = {}): ResolvedA2AConfig {
  return {
    a2aNodeId: 'a1',
    label: 'A2A',
    enabled: true,
    mode: 'both',
    agentName: 'Researcher',
    agentDescription: 'Answers research questions.',
    agentUrl: 'http://localhost:8787',
    version: '1.2.0',
    streaming: true,
    pushNotifications: false,
    authScheme: 'none',
    skills: [
      { id: 'research', name: 'Deep research', description: 'Multi-source research', tags: ['web', 'search'] },
    ],
    remotes: [],
    taskTimeoutMs: 60000,
    maxConcurrentTasks: 4,
    onRemoteError: 'warn',
    ...overrides,
  };
}

describe('buildAgentCard', () => {
  it('assembles a card from the resolved config', () => {
    const card = buildAgentCard(makeConfig());
    expect(card.name).toBe('Researcher');
    expect(card.description).toBe('Answers research questions.');
    expect(card.version).toBe('1.2.0');
    expect(card.protocolVersion).toBe(A2A_PROTOCOL_VERSION);
    expect(card.capabilities).toEqual({ streaming: true, pushNotifications: false });
    expect(card.defaultInputModes).toContain('text');
    expect(card.skills).toEqual([
      { id: 'research', name: 'Deep research', description: 'Multi-source research', tags: ['web', 'search'] },
    ]);
  });

  it('falls back to the label when agentName is blank and strips trailing slashes from url', () => {
    const card = buildAgentCard(makeConfig({ agentName: '  ', label: 'Fallback', agentUrl: 'https://x.io/' }));
    expect(card.name).toBe('Fallback');
    expect(card.url).toBe('https://x.io');
  });

  it('defaults a blank version', () => {
    expect(buildAgentCard(makeConfig({ version: '' })).version).toBe('0.1.0');
  });

  it('drops empty skill tags', () => {
    const card = buildAgentCard(
      makeConfig({ skills: [{ id: 's', name: 'n', description: 'd', tags: ['a', '', '  ', 'b'] }] }),
    );
    expect(card.skills[0].tags).toEqual(['a', 'b']);
  });

  it('emits a bearer security scheme', () => {
    const card = buildAgentCard(makeConfig({ authScheme: 'bearer' }));
    expect(card.securitySchemes.bearer).toEqual({ type: 'http', scheme: 'bearer' });
    expect(card.security).toEqual([{ bearer: [] }]);
  });

  it('emits an apiKey security scheme', () => {
    const card = buildAgentCard(makeConfig({ authScheme: 'apiKey' }));
    expect(card.securitySchemes.apiKey).toMatchObject({ type: 'apiKey', in: 'header' });
  });

  it('emits no security for an open agent', () => {
    const card = buildAgentCard(makeConfig({ authScheme: 'none' }));
    expect(card.securitySchemes).toEqual({});
    expect(card.security).toEqual([]);
  });
});

describe('validateAgentCard', () => {
  it('accepts a minimal valid card', () => {
    expect(validateAgentCard({ name: 'X', url: 'http://x', version: '1' })).toEqual([]);
  });

  it('rejects non-objects', () => {
    expect(validateAgentCard(null)).toContain('card is not an object');
    expect(validateAgentCard('nope')).toContain('card is not an object');
  });

  it('flags each missing required field', () => {
    const errs = validateAgentCard({});
    expect(errs).toEqual(expect.arrayContaining(['missing name', 'missing url', 'missing version']));
  });

  it('flags malformed skills / capabilities but tolerates extra fields', () => {
    const errs = validateAgentCard({ name: 'X', url: 'u', version: '1', skills: 'bad', capabilities: 3, extra: 1 });
    expect(errs).toContain('skills must be an array');
    expect(errs).toContain('capabilities must be an object');
  });
});

describe('task state helpers', () => {
  it('classifies terminal vs non-terminal states', () => {
    expect(isTerminalState('completed')).toBe(true);
    expect(isTerminalState('failed')).toBe(true);
    expect(isTerminalState('canceled')).toBe(true);
    expect(isTerminalState('rejected')).toBe(true);
    expect(isTerminalState('working')).toBe(false);
    expect(isTerminalState('input-required')).toBe(false);
    expect(isTerminalState('submitted')).toBe(false);
  });

  it('normalizes known states and underscores', () => {
    expect(normalizeTaskState('completed')).toBe('completed');
    expect(normalizeTaskState('INPUT_REQUIRED')).toBe('input-required');
    expect(normalizeTaskState(' Working ')).toBe('working');
  });

  it('maps unknown or non-string states to working', () => {
    expect(normalizeTaskState('bananas')).toBe('working');
    expect(normalizeTaskState(undefined)).toBe('working');
    expect(normalizeTaskState(42)).toBe('working');
  });
});

describe('buildMessage / buildSendMessageRequest', () => {
  it('builds a text message with the supplied id', () => {
    const msg = buildMessage({ role: 'user', text: 'hi', messageId: 'm1' });
    expect(msg).toEqual({ kind: 'message', role: 'user', parts: [{ kind: 'text', text: 'hi' }], messageId: 'm1' });
  });

  it('includes taskId/contextId only when provided', () => {
    const msg = buildMessage({ role: 'agent', text: 'x', messageId: 'm2', taskId: 't', contextId: 'c' });
    expect(msg.taskId).toBe('t');
    expect(msg.contextId).toBe('c');
  });

  it('wraps a message in a message/send JSON-RPC request', () => {
    const req = buildSendMessageRequest(buildMessage({ role: 'user', text: 'hi', messageId: 'm1' }), 7);
    expect(req).toMatchObject({ jsonrpc: '2.0', id: 7, method: 'message/send' });
    expect(req.params.message.parts[0].text).toBe('hi');
  });

  it('uses message/stream when streaming is requested', () => {
    const req = buildSendMessageRequest(buildMessage({ role: 'user', text: 'hi', messageId: 'm1' }), 1, { stream: true });
    expect(req.method).toBe('message/stream');
  });
});

describe('parseTaskResult', () => {
  it('parses a bare Message result as completed', () => {
    const res = parseTaskResult({
      result: { kind: 'message', messageId: 'm', contextId: 'c', parts: [{ kind: 'text', text: 'hello' }] },
    });
    expect(res).toEqual({ id: 'm', contextId: 'c', state: 'completed', text: 'hello', terminal: true });
  });

  it('parses a Task with artifacts', () => {
    const res = parseTaskResult({
      result: {
        id: 't1',
        contextId: 'c1',
        status: { state: 'completed' },
        artifacts: [{ parts: [{ kind: 'text', text: 'answer' }] }],
      },
    });
    expect(res).toMatchObject({ id: 't1', contextId: 'c1', state: 'completed', text: 'answer', terminal: true });
  });

  it('falls back to the last agent message in history', () => {
    const res = parseTaskResult({
      result: {
        id: 't2',
        status: { state: 'completed' },
        history: [
          { role: 'user', parts: [{ kind: 'text', text: 'q' }] },
          { role: 'agent', parts: [{ kind: 'text', text: 'final' }] },
        ],
      },
    });
    expect(res?.text).toBe('final');
  });

  it('reports a non-terminal working task', () => {
    const res = parseTaskResult({ result: { id: 't3', status: { state: 'working' } } });
    expect(res).toMatchObject({ state: 'working', terminal: false });
  });

  it('returns null on a JSON-RPC error or bad payload', () => {
    expect(parseTaskResult({ error: { code: -32000, message: 'boom' } })).toBeNull();
    expect(parseTaskResult(null)).toBeNull();
    expect(parseTaskResult('nope')).toBeNull();
  });

  it('accepts a result at the top level (no rpc envelope)', () => {
    const res = parseTaskResult({ id: 't4', status: { state: 'failed' } });
    expect(res).toMatchObject({ id: 't4', state: 'failed', terminal: true });
  });
});

describe('selectDelegate', () => {
  const remotes = [
    { id: 'search', name: 'Search agent', cardUrl: 'u1', authScheme: 'none' as const, authTokenRef: '' },
    { id: 'coder', name: 'Coding agent', cardUrl: 'u2', authScheme: 'none' as const, authTokenRef: '' },
  ];

  it('returns null when no remotes are registered', () => {
    expect(selectDelegate(makeConfig({ remotes: [] }), 'anything')).toBeNull();
  });

  it('matches on remote id', () => {
    expect(selectDelegate(makeConfig({ remotes }), 'coder')?.id).toBe('coder');
  });

  it('matches on a name substring, case-insensitively', () => {
    expect(selectDelegate(makeConfig({ remotes }), 'SEARCH')?.id).toBe('search');
  });

  it('falls back to the first remote when nothing matches or hint is blank', () => {
    expect(selectDelegate(makeConfig({ remotes }), 'unrelated')?.id).toBe('search');
    expect(selectDelegate(makeConfig({ remotes }), '  ')?.id).toBe('search');
  });
});

describe('mode gates', () => {
  it('servesCard respects mode and enabled', () => {
    expect(servesCard(makeConfig({ mode: 'both' }))).toBe(true);
    expect(servesCard(makeConfig({ mode: 'server' }))).toBe(true);
    expect(servesCard(makeConfig({ mode: 'client' }))).toBe(false);
    expect(servesCard(makeConfig({ mode: 'both', enabled: false }))).toBe(false);
  });

  it('delegatesToRemotes respects mode and enabled', () => {
    expect(delegatesToRemotes(makeConfig({ mode: 'both' }))).toBe(true);
    expect(delegatesToRemotes(makeConfig({ mode: 'client' }))).toBe(true);
    expect(delegatesToRemotes(makeConfig({ mode: 'server' }))).toBe(false);
    expect(delegatesToRemotes(makeConfig({ mode: 'client', enabled: false }))).toBe(false);
  });
});

describe('constants', () => {
  it('exposes the well-known card path', () => {
    expect(AGENT_CARD_PATH).toBe('/.well-known/agent-card.json');
  });
});
