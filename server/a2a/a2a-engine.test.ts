import { describe, expect, it } from 'vitest';
import type { ResolvedA2AConfig } from '../../shared/agent-config';
import {
  A2A_PROTOCOL_VERSION,
  TaskConcurrencyGuard,
  authorizeInbound,
  buildAgentCard,
  delegateToolName,
  enabledRemotes,
  isTerminalTaskState,
  parseAgentCard,
  parseTaskRequest,
} from './a2a-engine';

function makeConfig(overrides: Partial<ResolvedA2AConfig> = {}): ResolvedA2AConfig {
  return {
    a2aNodeId: 'a1',
    label: 'A2A Interop',
    enabled: true,
    role: 'both',
    agentName: '',
    agentDescription: 'A test agent.',
    agentVersion: '2.1.0',
    serverPath: '/a2a',
    advertisedSkills: ['research', 'code review'],
    streaming: true,
    pushNotifications: false,
    requireAuth: false,
    inboundTokenEnv: '',
    remotes: [],
    maxConcurrentTasks: 2,
    taskTimeoutMs: 120000,
    ...overrides,
  };
}

describe('isTerminalTaskState', () => {
  it('marks completed / canceled / failed / rejected as terminal', () => {
    expect(isTerminalTaskState('completed')).toBe(true);
    expect(isTerminalTaskState('canceled')).toBe(true);
    expect(isTerminalTaskState('failed')).toBe(true);
    expect(isTerminalTaskState('rejected')).toBe(true);
  });

  it('marks submitted / working / input-required as non-terminal', () => {
    expect(isTerminalTaskState('submitted')).toBe(false);
    expect(isTerminalTaskState('working')).toBe(false);
    expect(isTerminalTaskState('input-required')).toBe(false);
  });
});

describe('buildAgentCard', () => {
  it('builds a card with the resolved protocol version, url, and capabilities', () => {
    const card = buildAgentCard(makeConfig(), {
      baseUrl: 'https://host.example',
      fallbackName: 'My Agent',
    });
    expect(card.protocolVersion).toBe(A2A_PROTOCOL_VERSION);
    expect(card.name).toBe('My Agent'); // agentName empty -> fallback
    expect(card.url).toBe('https://host.example/a2a');
    expect(card.version).toBe('2.1.0');
    expect(card.capabilities).toEqual({ streaming: true, pushNotifications: false });
    expect(card.defaultInputModes).toContain('text/plain');
  });

  it('prefers an explicit agentName over the fallback', () => {
    const card = buildAgentCard(makeConfig({ agentName: 'Named' }), {
      baseUrl: 'https://host.example',
      fallbackName: 'Fallback',
    });
    expect(card.name).toBe('Named');
  });

  it('turns advertised skills into slugged skill entries and drops blanks', () => {
    const card = buildAgentCard(makeConfig({ advertisedSkills: ['code review', '  ', 'research'] }), {
      baseUrl: 'https://host.example/',
      fallbackName: 'A',
    });
    expect(card.skills.map((s) => s.id)).toEqual(['code_review', 'research']);
    expect(card.skills[0].name).toBe('code review');
    // trailing slash on baseUrl does not double up
    expect(card.url).toBe('https://host.example/a2a');
  });

  it('defaults an empty version to 1.0.0', () => {
    const card = buildAgentCard(makeConfig({ agentVersion: '' }), {
      baseUrl: 'https://h',
      fallbackName: 'A',
    });
    expect(card.version).toBe('1.0.0');
  });
});

describe('parseTaskRequest', () => {
  function envelope(overrides: Record<string, unknown> = {}) {
    return {
      jsonrpc: '2.0',
      id: 'req-1',
      method: 'message/send',
      params: {
        message: {
          role: 'user',
          messageId: 'm-1',
          parts: [
            { kind: 'text', text: 'Hello ' },
            { kind: 'text', text: 'world' },
          ],
        },
      },
      ...overrides,
    };
  }

  it('normalizes a valid message/send envelope', () => {
    const res = parseTaskRequest(envelope());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.requestId).toBe('req-1');
      expect(res.value.messageId).toBe('m-1');
      expect(res.value.text).toBe('Hello world');
    }
  });

  it('accepts message/stream as well', () => {
    const res = parseTaskRequest(envelope({ method: 'message/stream' }));
    expect(res.ok).toBe(true);
  });

  it.each([
    [{ jsonrpc: '1.0' }, 'jsonrpc'],
    [{ method: 'tasks/cancel' }, 'unsupported method'],
    [{ id: undefined }, 'missing JSON-RPC id'],
  ])('rejects a bad envelope (%o)', (override, needle) => {
    const res = parseTaskRequest(envelope(override as Record<string, unknown>));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain(needle);
  });

  it('rejects a non-user role and an empty parts list', () => {
    const wrongRole = parseTaskRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'message/send',
      params: { message: { role: 'assistant', parts: [{ kind: 'text', text: 'hi' }] } },
    });
    expect(wrongRole.ok).toBe(false);

    const noText = parseTaskRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'message/send',
      params: { message: { role: 'user', parts: [{ kind: 'file' }] } },
    });
    expect(noText.ok).toBe(false);
    if (!noText.ok) expect(noText.error).toContain('no text');
  });

  it('rejects non-object payloads', () => {
    expect(parseTaskRequest(null).ok).toBe(false);
    expect(parseTaskRequest('nope').ok).toBe(false);
  });
});

describe('parseAgentCard', () => {
  it('parses a well-formed card and coerces missing optionals', () => {
    const res = parseAgentCard(
      JSON.stringify({
        name: 'Remote',
        url: 'https://remote/a2a',
        capabilities: { streaming: true },
        skills: [{ id: 's1', name: 'Search', tags: ['web'] }],
      }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.name).toBe('Remote');
      expect(res.value.capabilities.streaming).toBe(true);
      expect(res.value.capabilities.pushNotifications).toBe(false);
      expect(res.value.skills[0].description).toBe('');
    }
  });

  it('rejects invalid JSON and cards missing name or url', () => {
    expect(parseAgentCard('{not json').ok).toBe(false);
    expect(parseAgentCard(JSON.stringify({ url: 'https://x' })).ok).toBe(false);
    expect(parseAgentCard(JSON.stringify({ name: 'x' })).ok).toBe(false);
  });
});

describe('enabledRemotes & delegateToolName', () => {
  it('filters to enabled remotes that carry a card url', () => {
    const config = makeConfig({
      remotes: [
        { id: 'r1', name: 'Research', cardUrl: 'https://a/card', authTokenEnv: '', enabled: true },
        { id: 'r2', name: 'Disabled', cardUrl: 'https://b/card', authTokenEnv: '', enabled: false },
        { id: 'r3', name: 'NoUrl', cardUrl: '', authTokenEnv: '', enabled: true },
      ],
    });
    expect(enabledRemotes(config).map((r) => r.id)).toEqual(['r1']);
  });

  it('derives a namespaced, slugged tool name', () => {
    expect(delegateToolName({ id: 'r1', name: 'Research Agent' })).toBe('a2a_research_agent');
    expect(delegateToolName({ id: 'r9', name: '' })).toBe('a2a_r9');
  });
});

describe('authorizeInbound', () => {
  it('passes everything when auth is not required', () => {
    expect(authorizeInbound(makeConfig({ requireAuth: false }), undefined, undefined).authorized).toBe(
      true,
    );
  });

  it('denies when auth is required but no expected token is configured (fail closed)', () => {
    const res = authorizeInbound(makeConfig({ requireAuth: true }), 'abc', '');
    expect(res.authorized).toBe(false);
    expect(res.reason).toContain('no inbound token');
  });

  it('denies a missing or mismatched token and accepts a matching one', () => {
    const config = makeConfig({ requireAuth: true });
    expect(authorizeInbound(config, undefined, 'secret').authorized).toBe(false);
    expect(authorizeInbound(config, 'wrong', 'secret').authorized).toBe(false);
    expect(authorizeInbound(config, 'secret', 'secret').authorized).toBe(true);
  });
});

describe('TaskConcurrencyGuard', () => {
  it('bounds in-flight tasks at the limit', () => {
    const guard = new TaskConcurrencyGuard(2);
    expect(guard.tryAcquire()).toBe(true);
    expect(guard.tryAcquire()).toBe(true);
    expect(guard.tryAcquire()).toBe(false);
    expect(guard.active).toBe(2);
    guard.release();
    expect(guard.tryAcquire()).toBe(true);
  });

  it('treats a zero limit as unbounded and never drops below zero', () => {
    const guard = new TaskConcurrencyGuard(0);
    for (let i = 0; i < 100; i++) expect(guard.tryAcquire()).toBe(true);
    guard.release();
    guard.release();
    expect(guard.active).toBe(98);
  });
});
