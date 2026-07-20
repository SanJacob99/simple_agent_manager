import { describe, expect, it } from 'vitest';
import type { ResolvedA2AConfig, ResolvedA2ARemoteAgent } from '../../shared/agent-config';
import {
  A2A_PROTOCOL_VERSION,
  buildAgentCard,
  buildDelegateToolSpec,
  delegateToolName,
  isTerminalTaskState,
  nextTaskState,
  partsToText,
  resolveDelegateTools,
  servesInbound,
  textToParts,
  validateMessageSend,
} from './a2a-engine';

function makeConfig(overrides: Partial<ResolvedA2AConfig> = {}): ResolvedA2AConfig {
  return {
    a2aNodeId: 'a1',
    label: 'A2A',
    enabled: true,
    mode: 'both',
    cardName: 'Simple Agent',
    cardDescription: 'An agent built with Simple Agent Manager.',
    serverPath: '/a2a',
    streaming: true,
    pushNotifications: false,
    stateTransitionHistory: true,
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
    authScheme: 'bearer',
    remoteAgents: [],
    taskTimeoutMs: 120000,
    maxConcurrentTasks: 4,
    ...overrides,
  };
}

function makeRemote(overrides: Partial<ResolvedA2ARemoteAgent> = {}): ResolvedA2ARemoteAgent {
  return {
    id: 'r1',
    name: 'Research Agent',
    cardUrl: 'https://example.com/.well-known/agent-card.json',
    transport: 'jsonrpc',
    authRef: 'RESEARCH_TOKEN',
    exposeAsTool: true,
    ...overrides,
  };
}

describe('buildAgentCard', () => {
  it('joins baseUrl and serverPath, collapsing duplicate slashes', () => {
    const card = buildAgentCard(makeConfig(), 'https://host:3000/');
    expect(card.url).toBe('https://host:3000/a2a');
    expect(card.protocolVersion).toBe(A2A_PROTOCOL_VERSION);
  });

  it('normalizes a serverPath without a leading slash', () => {
    const card = buildAgentCard(makeConfig({ serverPath: 'a2a' }), 'https://host');
    expect(card.url).toBe('https://host/a2a');
  });

  it('mirrors node capabilities into the card', () => {
    const card = buildAgentCard(
      makeConfig({ streaming: false, pushNotifications: true, stateTransitionHistory: false }),
      'https://host',
    );
    expect(card.capabilities).toEqual({
      streaming: false,
      pushNotifications: true,
      stateTransitionHistory: false,
    });
  });

  it('emits a bearer security scheme for bearer auth', () => {
    const card = buildAgentCard(makeConfig({ authScheme: 'bearer' }), 'https://host');
    expect(card.securitySchemes.bearer).toEqual({ type: 'http', scheme: 'bearer' });
  });

  it('emits an apiKey security scheme for apiKey auth', () => {
    const card = buildAgentCard(makeConfig({ authScheme: 'apiKey' }), 'https://host');
    expect(card.securitySchemes.apiKey).toMatchObject({ type: 'apiKey', in: 'header' });
  });

  it('emits no security schemes for auth none', () => {
    const card = buildAgentCard(makeConfig({ authScheme: 'none' }), 'https://host');
    expect(card.securitySchemes).toEqual({});
  });

  it('defaults empty input/output modes to text/plain', () => {
    const card = buildAgentCard(
      makeConfig({ defaultInputModes: [], defaultOutputModes: [] }),
      'https://host',
    );
    expect(card.defaultInputModes).toEqual(['text/plain']);
    expect(card.defaultOutputModes).toEqual(['text/plain']);
  });

  it('copies skill cards without aliasing the source arrays', () => {
    const config = makeConfig({
      skills: [{ id: 's1', name: 'Summarize', description: 'Summarize text', tags: ['nlp'] }],
    });
    const card = buildAgentCard(config, 'https://host');
    card.skills[0].tags.push('mutated');
    expect(config.skills[0].tags).toEqual(['nlp']);
  });
});

describe('task state machine', () => {
  it('advances submitted → working → completed', () => {
    expect(nextTaskState('submitted', 'start')).toBe('working');
    expect(nextTaskState('working', 'complete')).toBe('completed');
  });

  it('handles the input-required detour and resume', () => {
    expect(nextTaskState('working', 'need_input')).toBe('input-required');
    expect(nextTaskState('input-required', 'resume')).toBe('working');
  });

  it('allows cancel from any non-terminal state', () => {
    expect(nextTaskState('submitted', 'cancel')).toBe('canceled');
    expect(nextTaskState('working', 'cancel')).toBe('canceled');
    expect(nextTaskState('input-required', 'cancel')).toBe('canceled');
  });

  it('rejects events from terminal states', () => {
    expect(nextTaskState('completed', 'start')).toBeNull();
    expect(nextTaskState('failed', 'resume')).toBeNull();
    expect(nextTaskState('canceled', 'cancel')).toBeNull();
  });

  it('rejects illegal events from non-terminal states', () => {
    expect(nextTaskState('submitted', 'complete')).toBeNull();
    expect(nextTaskState('submitted', 'resume')).toBeNull();
  });

  it('classifies terminal states', () => {
    expect(isTerminalTaskState('completed')).toBe(true);
    expect(isTerminalTaskState('failed')).toBe(true);
    expect(isTerminalTaskState('canceled')).toBe(true);
    expect(isTerminalTaskState('working')).toBe(false);
    expect(isTerminalTaskState('submitted')).toBe(false);
  });
});

describe('message parts', () => {
  it('round-trips text through parts', () => {
    expect(partsToText(textToParts('hello'))).toBe('hello');
  });

  it('concatenates text parts and ignores non-text parts', () => {
    const text = partsToText([
      { kind: 'text', text: 'a' },
      { kind: 'data', data: { x: 1 } },
      { kind: 'text', text: 'b' },
    ]);
    expect(text).toBe('ab');
  });
});

describe('validateMessageSend', () => {
  it('accepts a well-formed text message', () => {
    const result = validateMessageSend({
      message: { role: 'user', parts: [{ kind: 'text', text: 'hi' }], messageId: 'm1' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message.messageId).toBe('m1');
  });

  it('rejects a missing message', () => {
    const result = validateMessageSend({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/message is required/);
  });

  it('rejects a bad role', () => {
    const result = validateMessageSend({ message: { role: 'system', parts: [{ kind: 'text', text: 'x' }] } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => /role/.test(e))).toBe(true);
  });

  it('rejects empty parts', () => {
    const result = validateMessageSend({ message: { role: 'user', parts: [] } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => /non-empty array/.test(e))).toBe(true);
  });

  it('rejects a part with an unknown kind', () => {
    const result = validateMessageSend({ message: { role: 'user', parts: [{ kind: 'video' }] } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => /unknown kind/.test(e))).toBe(true);
  });

  it('rejects a text part missing its text', () => {
    const result = validateMessageSend({ message: { role: 'user', parts: [{ kind: 'text' }] } });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-string messageId', () => {
    const result = validateMessageSend({
      message: { role: 'user', parts: [{ kind: 'text', text: 'x' }], messageId: 7 },
    });
    expect(result.ok).toBe(false);
  });
});

describe('delegate tools', () => {
  it('derives a slugified, prefixed tool name', () => {
    expect(delegateToolName(makeRemote({ name: 'Research Agent' }))).toBe('a2a_research_agent');
    expect(delegateToolName(makeRemote({ name: '  Weird!!Name  ' }))).toBe('a2a_weird_name');
  });

  it('falls back to the id when the name has no usable characters', () => {
    expect(delegateToolName(makeRemote({ id: 'r9', name: '!!!' }))).toBe('a2a_r9');
  });

  it('builds a task-shaped input schema', () => {
    const spec = buildDelegateToolSpec(makeRemote());
    expect(spec.inputSchema.required).toEqual(['task']);
    expect(spec.remoteAgentId).toBe('r1');
    expect(spec.cardUrl).toContain('agent-card.json');
  });

  it('resolves only remotes flagged exposeAsTool', () => {
    const config = makeConfig({
      remoteAgents: [
        makeRemote({ id: 'r1', name: 'A', exposeAsTool: true }),
        makeRemote({ id: 'r2', name: 'B', exposeAsTool: false }),
      ],
    });
    const tools = resolveDelegateTools(config);
    expect(tools).toHaveLength(1);
    expect(tools[0].remoteAgentId).toBe('r1');
  });

  it('de-duplicates colliding tool names', () => {
    const config = makeConfig({
      remoteAgents: [
        makeRemote({ id: 'r1', name: 'Research' }),
        makeRemote({ id: 'r2', name: 'Research' }),
      ],
    });
    const tools = resolveDelegateTools(config);
    expect(tools.map((t) => t.name)).toEqual(['a2a_research', 'a2a_research_2']);
  });

  it('resolves no delegates in server-only mode or when disabled', () => {
    const remotes = [makeRemote()];
    expect(resolveDelegateTools(makeConfig({ mode: 'server', remoteAgents: remotes }))).toEqual([]);
    expect(resolveDelegateTools(makeConfig({ enabled: false, remoteAgents: remotes }))).toEqual([]);
  });
});

describe('servesInbound', () => {
  it('is true for server and both, false for client-only and disabled', () => {
    expect(servesInbound(makeConfig({ mode: 'server' }))).toBe(true);
    expect(servesInbound(makeConfig({ mode: 'both' }))).toBe(true);
    expect(servesInbound(makeConfig({ mode: 'client' }))).toBe(false);
    expect(servesInbound(makeConfig({ mode: 'both', enabled: false }))).toBe(false);
  });
});
