import { describe, expect, it } from 'vitest';
import type { ResolvedA2AConfig } from '../../shared/agent-config';
import {
  A2A_PROTOCOL_VERSION,
  authorizeInbound,
  buildAgentCard,
  buildDelegateTools,
  canTransition,
  createInboundTask,
  isTerminalTaskState,
  messageToPromptText,
  normalizeModes,
  parseRemoteCard,
  slugifyToolName,
  validateInboundMessage,
  type A2AMessage,
} from './a2a-engine';

function makeConfig(overrides: Partial<ResolvedA2AConfig> = {}): ResolvedA2AConfig {
  return {
    a2aNodeId: 'a1',
    label: 'A2A',
    role: 'both',
    serverName: '',
    serverDescription: '',
    cardPath: '/.well-known/agent-card.json',
    streaming: true,
    pushNotifications: false,
    stateTransitionHistory: false,
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    requireAuth: false,
    authTokenEnvVar: '',
    delegates: [],
    delegateToolPrefix: 'a2a_',
    taskTimeoutMs: 60000,
    ...overrides,
  };
}

describe('normalizeModes', () => {
  it('trims, drops blanks, and dedupes order-preservingly', () => {
    expect(normalizeModes([' text/plain ', '', 'text/plain', 'application/json'], ['x'])).toEqual([
      'text/plain',
      'application/json',
    ]);
  });

  it('falls back when nothing survives', () => {
    expect(normalizeModes(['', '   '], ['text/plain'])).toEqual(['text/plain']);
  });
});

describe('task-state machine', () => {
  it('marks the four terminal states terminal and the rest not', () => {
    for (const s of ['completed', 'canceled', 'failed', 'rejected'] as const) {
      expect(isTerminalTaskState(s)).toBe(true);
    }
    for (const s of ['submitted', 'working', 'input-required', 'auth-required'] as const) {
      expect(isTerminalTaskState(s)).toBe(false);
    }
  });

  it('allows legal transitions and rejects illegal / self / terminal ones', () => {
    expect(canTransition('submitted', 'working')).toBe(true);
    expect(canTransition('working', 'completed')).toBe(true);
    expect(canTransition('input-required', 'working')).toBe(true);
    // illegal jump
    expect(canTransition('submitted', 'completed')).toBe(false);
    // self-transition is not legal
    expect(canTransition('working', 'working')).toBe(false);
    // terminal states have no outgoing transitions
    expect(canTransition('completed', 'working')).toBe(false);
    expect(canTransition('failed', 'submitted')).toBe(false);
  });
});

describe('buildAgentCard', () => {
  const meta = {
    name: 'Support Bot',
    description: 'Answers support questions',
    version: '2',
    url: 'https://agents.example.com/support',
    skills: [{ id: 's1', name: 'faq', description: 'Answer FAQs' }],
  };

  it('inherits agent name/description when the node leaves them blank', () => {
    const card = buildAgentCard(makeConfig(), meta);
    expect(card.name).toBe('Support Bot');
    expect(card.description).toBe('Answers support questions');
    expect(card.protocolVersion).toBe(A2A_PROTOCOL_VERSION);
    expect(card.capabilities.streaming).toBe(true);
    expect(card.skills).toHaveLength(1);
  });

  it('overrides name/description when the node sets them', () => {
    const card = buildAgentCard(
      makeConfig({ serverName: 'Public Name', serverDescription: 'Public desc' }),
      meta,
    );
    expect(card.name).toBe('Public Name');
    expect(card.description).toBe('Public desc');
  });

  it('advertises a bearer scheme only when auth is required', () => {
    expect(buildAgentCard(makeConfig(), meta).securitySchemes).toBeUndefined();
    const secured = buildAgentCard(makeConfig({ requireAuth: true }), meta);
    expect(secured.securitySchemes?.bearer).toEqual({ type: 'http', scheme: 'bearer' });
    expect(secured.security).toEqual([{ bearer: [] }]);
  });

  it('never advertises empty input/output modes', () => {
    const card = buildAgentCard(makeConfig({ defaultInputModes: [], defaultOutputModes: [] }), meta);
    expect(card.defaultInputModes).toEqual(['text/plain']);
    expect(card.defaultOutputModes).toEqual(['text/plain']);
  });
});

describe('validateInboundMessage', () => {
  it('accepts a well-formed text message', () => {
    const res = validateInboundMessage({ role: 'user', parts: [{ kind: 'text', text: 'hi' }] });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.parts[0]).toEqual({ kind: 'text', text: 'hi' });
  });

  it('rejects a bad role, empty parts, and unknown part kinds', () => {
    expect(validateInboundMessage({ role: 'system', parts: [] }).ok).toBe(false);
    expect(validateInboundMessage({ role: 'user', parts: [] }).ok).toBe(false);
    expect(validateInboundMessage({ role: 'user', parts: [{ kind: 'video' }] }).ok).toBe(false);
    expect(validateInboundMessage(null).ok).toBe(false);
  });

  it('requires text parts to carry a string', () => {
    expect(validateInboundMessage({ role: 'user', parts: [{ kind: 'text' }] }).ok).toBe(false);
  });
});

describe('createInboundTask / messageToPromptText', () => {
  const message: A2AMessage = {
    role: 'user',
    parts: [
      { kind: 'text', text: 'line one' },
      { kind: 'data', data: { x: 1 } },
      { kind: 'text', text: 'line two' },
    ],
  };

  it('creates a submitted task with the supplied id', () => {
    const task = createInboundTask('t-42', message);
    expect(task).toEqual({ id: 't-42', state: 'submitted', message });
  });

  it('concatenates only text parts', () => {
    expect(messageToPromptText(message)).toBe('line one\nline two');
  });
});

describe('authorizeInbound', () => {
  it('passes everything when auth is not required', () => {
    expect(authorizeInbound({ requireAuth: false }, '', undefined).ok).toBe(true);
  });

  it('fails closed when required but no token configured', () => {
    expect(authorizeInbound({ requireAuth: true }, '', 'Bearer x').ok).toBe(false);
  });

  it('accepts a matching bearer token and rejects others', () => {
    expect(authorizeInbound({ requireAuth: true }, 'secret', 'Bearer secret').ok).toBe(true);
    expect(authorizeInbound({ requireAuth: true }, 'secret', 'Bearer nope').ok).toBe(false);
    expect(authorizeInbound({ requireAuth: true }, 'secret', 'secret').ok).toBe(false);
    expect(authorizeInbound({ requireAuth: true }, 'secret', undefined).ok).toBe(false);
  });
});

describe('slugifyToolName / buildDelegateTools', () => {
  it('slugifies names and falls back to the id', () => {
    expect(slugifyToolName('Weather Agent!', 'x')).toBe('weather_agent');
    expect(slugifyToolName('   ', 'Remote-7')).toBe('remote_7');
    expect(slugifyToolName('', '')).toBe('agent');
  });

  it('builds one tool per enabled delegate with a cardUrl, skipping the rest', () => {
    const tools = buildDelegateTools(
      makeConfig({
        delegates: [
          { id: 'd1', name: 'Weather', cardUrl: 'https://w/card.json', description: 'weather', enabled: true },
          { id: 'd2', name: 'Off', cardUrl: 'https://o/card.json', description: '', enabled: false },
          { id: 'd3', name: 'NoUrl', cardUrl: '', description: '', enabled: true },
        ],
      }),
    );
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('a2a_weather');
    expect(tools[0].cardUrl).toBe('https://w/card.json');
    expect(tools[0].inputSchema.required).toEqual(['message']);
  });

  it('disambiguates colliding tool names', () => {
    const tools = buildDelegateTools(
      makeConfig({
        delegateToolPrefix: '',
        delegates: [
          { id: 'a', name: 'Search', cardUrl: 'https://1', description: '', enabled: true },
          { id: 'b', name: 'search!', cardUrl: 'https://2', description: '', enabled: true },
        ],
      }),
    );
    expect(tools.map((t) => t.name)).toEqual(['search', 'search_2']);
  });

  it('synthesizes a description when the delegate omits one', () => {
    const tools = buildDelegateTools(
      makeConfig({
        delegates: [{ id: 'd', name: 'Planner', cardUrl: 'https://p', description: '', enabled: true }],
      }),
    );
    expect(tools[0].description).toContain('Planner');
  });
});

describe('parseRemoteCard', () => {
  it('normalizes a valid card and defaults missing fields', () => {
    const res = parseRemoteCard({ name: 'Remote', url: 'https://r', capabilities: { streaming: true } });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.name).toBe('Remote');
      expect(res.value.capabilities.streaming).toBe(true);
      expect(res.value.capabilities.pushNotifications).toBe(false);
      expect(res.value.defaultInputModes).toEqual(['text/plain']);
    }
  });

  it('rejects cards missing a name or url', () => {
    expect(parseRemoteCard({ url: 'https://r' }).ok).toBe(false);
    expect(parseRemoteCard({ name: 'Remote' }).ok).toBe(false);
    expect(parseRemoteCard('nope').ok).toBe(false);
  });
});
