import { describe, expect, it } from 'vitest';
import type { ResolvedA2AConfig } from '../../shared/agent-config';
import {
  A2A_PROTOCOL_VERSION,
  AGENT_CARD_WELL_KNOWN_PATH,
  buildAgentCard,
  buildMessageSendRequest,
  buildSecuritySchemes,
  extractText,
  isClientEnabled,
  isServerEnabled,
  isTerminalState,
  normalizeState,
  parseTaskResponse,
  resolveDelegates,
  selectRemoteById,
  toDelegateToolName,
  validateAgentCard,
} from './a2a-engine';

function makeConfig(overrides: Partial<ResolvedA2AConfig> = {}): ResolvedA2AConfig {
  return {
    a2aNodeId: 'a1',
    label: 'A2A Interop',
    enabled: true,
    role: 'both',
    agentName: 'Support Bot',
    agentDescription: 'Answers billing questions.',
    agentVersion: '1.2.0',
    advertisedSkills: [
      { id: 'billing', name: 'Billing', description: 'Resolve billing issues.' },
    ],
    streaming: true,
    pushNotifications: false,
    serverAuthScheme: 'bearer',
    remotes: [
      { id: 'research', name: 'Research Agent', url: 'https://r.example/', authScheme: 'apiKey', enabled: true },
      { id: 'off', name: 'Disabled', url: 'https://x.example', authScheme: 'none', enabled: false },
    ],
    taskTimeoutMs: 120000,
    maxConcurrentTasks: 2,
    ...overrides,
  };
}

describe('buildAgentCard', () => {
  it('assembles a card from config', () => {
    const card = buildAgentCard(makeConfig(), { url: 'https://me.example/a2a/' });
    expect(card.protocolVersion).toBe(A2A_PROTOCOL_VERSION);
    expect(card.name).toBe('Support Bot');
    expect(card.version).toBe('1.2.0');
    expect(card.url).toBe('https://me.example/a2a'); // trailing slash stripped
    expect(card.capabilities.streaming).toBe(true);
    expect(card.skills).toHaveLength(1);
    expect(card.skills[0].id).toBe('billing');
    expect(card.skills[0].inputModes).toEqual(['text/plain']);
  });

  it('falls back to label when agentName is empty and to 0.0.0 for version', () => {
    const card = buildAgentCard(
      makeConfig({ agentName: '  ', agentVersion: '' }),
      { url: 'https://me.example' },
    );
    expect(card.name).toBe('A2A Interop');
    expect(card.version).toBe('0.0.0');
  });

  it('embeds the security scheme for the configured auth', () => {
    const card = buildAgentCard(makeConfig({ serverAuthScheme: 'bearer' }), {
      url: 'https://me.example',
    });
    expect(card.securitySchemes).toEqual({ bearer: { type: 'http', scheme: 'bearer' } });
    expect(card.security).toEqual([{ bearer: [] }]);
  });

  it('omits security for the none scheme', () => {
    const card = buildAgentCard(makeConfig({ serverAuthScheme: 'none' }), {
      url: 'https://me.example',
    });
    expect(card.securitySchemes).toBeUndefined();
    expect(card.security).toBeUndefined();
  });
});

describe('buildSecuritySchemes', () => {
  it('maps each scheme', () => {
    expect(buildSecuritySchemes('none')).toEqual({});
    expect(buildSecuritySchemes('apiKey').security).toEqual([{ apiKey: [] }]);
    expect(buildSecuritySchemes('oauth2').securitySchemes).toHaveProperty('oauth2');
  });
});

describe('validateAgentCard', () => {
  it('accepts a well-formed card', () => {
    const card = buildAgentCard(makeConfig(), { url: 'https://me.example' });
    expect(validateAgentCard(card)).toEqual({ valid: true, errors: [] });
  });

  it('rejects a card with no skills', () => {
    const card = buildAgentCard(makeConfig({ advertisedSkills: [] }), {
      url: 'https://me.example',
    });
    const res = validateAgentCard(card);
    expect(res.valid).toBe(false);
    expect(res.errors).toContain('at least one skill must be advertised');
  });

  it('flags duplicate skill ids', () => {
    const card = buildAgentCard(
      makeConfig({
        advertisedSkills: [
          { id: 'x', name: 'X', description: '' },
          { id: 'x', name: 'X2', description: '' },
        ],
      }),
      { url: 'https://me.example' },
    );
    expect(validateAgentCard(card).errors).toContain('duplicate skill id: x');
  });
});

describe('message envelopes', () => {
  it('builds a message/send request when not streaming', () => {
    const req = buildMessageSendRequest('hello', { messageId: 'm1' });
    expect(req).toEqual({
      jsonrpc: '2.0',
      id: 'm1',
      method: 'message/send',
      params: {
        message: {
          role: 'user',
          parts: [{ kind: 'text', text: 'hello' }],
          messageId: 'm1',
          kind: 'message',
        },
      },
    });
  });

  it('uses message/stream when streaming and threads task/context ids', () => {
    const req = buildMessageSendRequest('hi', {
      messageId: 'm2',
      streaming: true,
      taskId: 't1',
      contextId: 'c1',
    });
    expect(req.method).toBe('message/stream');
    const msg = (req.params as { message: Record<string, unknown> }).message;
    expect(msg.taskId).toBe('t1');
    expect(msg.contextId).toBe('c1');
  });
});

describe('extractText', () => {
  it('joins text parts and ignores non-text parts', () => {
    const text = extractText([
      { kind: 'text', text: 'a' },
      { kind: 'file', file: {} },
      { kind: 'text', text: 'b' },
    ]);
    expect(text).toBe('ab');
  });

  it('returns empty for non-arrays', () => {
    expect(extractText(undefined)).toBe('');
    expect(extractText('nope')).toBe('');
  });
});

describe('normalizeState / isTerminalState', () => {
  it('keeps known states and defaults the rest to unknown', () => {
    expect(normalizeState('working')).toBe('working');
    expect(normalizeState('bogus')).toBe('unknown');
    expect(normalizeState(42)).toBe('unknown');
  });

  it('classifies terminal states', () => {
    expect(isTerminalState('completed')).toBe(true);
    expect(isTerminalState('failed')).toBe(true);
    expect(isTerminalState('working')).toBe(false);
    expect(isTerminalState('input-required')).toBe(false);
  });
});

describe('parseTaskResponse', () => {
  it('parses a completed task with artifacts', () => {
    const res = parseTaskResponse({
      jsonrpc: '2.0',
      id: 'm1',
      result: {
        id: 'task-1',
        kind: 'task',
        status: { state: 'completed' },
        artifacts: [{ parts: [{ kind: 'text', text: 'answer' }] }],
      },
    });
    expect(res.taskId).toBe('task-1');
    expect(res.state).toBe('completed');
    expect(res.text).toBe('answer');
    expect(res.isTerminal).toBe(true);
    expect(res.error).toBeNull();
  });

  it('falls back to the status message when there are no artifacts', () => {
    const res = parseTaskResponse({
      result: {
        id: 'task-2',
        status: { state: 'working', message: { parts: [{ kind: 'text', text: 'thinking' }] } },
      },
    });
    expect(res.text).toBe('thinking');
    expect(res.state).toBe('working');
    expect(res.isTerminal).toBe(false);
  });

  it('parses a direct message reply with no task', () => {
    const res = parseTaskResponse({
      result: { kind: 'message', role: 'agent', parts: [{ kind: 'text', text: 'hi back' }] },
    });
    expect(res.taskId).toBeNull();
    expect(res.state).toBe('completed');
    expect(res.text).toBe('hi back');
  });

  it('surfaces a JSON-RPC error', () => {
    const res = parseTaskResponse({ error: { code: -32601, message: 'method not found' } });
    expect(res.state).toBe('failed');
    expect(res.error).toBe('method not found');
    expect(res.isTerminal).toBe(true);
  });

  it('reports an error for failed/rejected tasks', () => {
    const res = parseTaskResponse({ result: { id: 't', status: { state: 'rejected' } } });
    expect(res.error).toBe('task rejected');
  });

  it('accepts a raw JSON string and rejects garbage', () => {
    const res = parseTaskResponse('{"result":{"kind":"message","parts":[{"kind":"text","text":"ok"}]}}');
    expect(res.text).toBe('ok');
    expect(parseTaskResponse('not json').error).toBe('unparseable A2A response');
    expect(parseTaskResponse(null).state).toBe('unknown');
  });
});

describe('delegate resolution', () => {
  it('resolves only enabled remotes with a URL', () => {
    const delegates = resolveDelegates(makeConfig());
    expect(delegates).toHaveLength(1);
    expect(delegates[0].id).toBe('research');
    expect(delegates[0].url).toBe('https://r.example'); // trailing slash stripped
    expect(delegates[0].cardUrl).toBe('https://r.example' + AGENT_CARD_WELL_KNOWN_PATH);
    expect(delegates[0].toolName).toBe('a2a_research');
  });

  it('returns no delegates when the client side is disabled', () => {
    expect(resolveDelegates(makeConfig({ role: 'server' }))).toEqual([]);
    expect(resolveDelegates(makeConfig({ enabled: false }))).toEqual([]);
  });

  it('selects a remote by id', () => {
    expect(selectRemoteById(makeConfig(), 'research')?.name).toBe('Research Agent');
    expect(selectRemoteById(makeConfig(), 'missing')).toBeNull();
  });
});

describe('toDelegateToolName', () => {
  it('slugifies ids and guards empties', () => {
    expect(toDelegateToolName('Research Agent')).toBe('a2a_research_agent');
    expect(toDelegateToolName('  ')).toBe('a2a_remote');
    expect(toDelegateToolName('--x--')).toBe('a2a_x');
  });
});

describe('role gating', () => {
  it('gates server and client sides on role + enabled', () => {
    expect(isServerEnabled(makeConfig({ role: 'client' }))).toBe(false);
    expect(isServerEnabled(makeConfig({ role: 'both' }))).toBe(true);
    expect(isClientEnabled(makeConfig({ role: 'server' }))).toBe(false);
    expect(isClientEnabled(makeConfig({ role: 'client' }))).toBe(true);
    expect(isServerEnabled(makeConfig({ enabled: false }))).toBe(false);
  });
});
