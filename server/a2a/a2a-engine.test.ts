import { describe, expect, it } from 'vitest';
import type { ResolvedA2AConfig } from '../../shared/agent-config';
import {
  buildAgentCard,
  buildAuthHeaders,
  buildMessageSendRequest,
  buildSecuritySchemes,
  extractTextFromParts,
  isTerminalTaskState,
  normalizeExposePath,
  normalizeTaskState,
  parseTaskResult,
  resolveDelegateTools,
  slugifyToolName,
  validateAgentCard,
  A2A_MESSAGE_SEND_METHOD,
} from './a2a-engine';

function makeConfig(overrides: Partial<ResolvedA2AConfig> = {}): ResolvedA2AConfig {
  return {
    a2aNodeId: 'a1',
    label: 'A2A',
    enabled: true,
    role: 'both',
    agentCardName: '',
    agentCardDescription: '',
    exposePath: '/a2a',
    publishedSkills: [
      { id: 'summarize', name: 'Summarize', description: 'Summarize text', tags: ['nlp'] },
    ],
    advertiseStreaming: true,
    advertisePushNotifications: false,
    serverAuth: 'bearer',
    remoteAgents: [
      {
        id: 'r1',
        name: 'Research Bot',
        cardUrl: 'https://remote.example/.well-known/agent-card.json',
        authScheme: 'bearer',
        authEnvVar: 'REMOTE_TOKEN',
        toolName: '',
      },
    ],
    exposeDelegateTools: true,
    defaultInputModes: [],
    defaultOutputModes: [],
    taskTimeoutMs: 60000,
    ...overrides,
  };
}

describe('normalizeExposePath', () => {
  it('adds a leading slash and strips trailing slashes', () => {
    expect(normalizeExposePath('a2a/')).toBe('/a2a');
    expect(normalizeExposePath('/agents/')).toBe('/agents');
  });

  it('defaults blank / root to /a2a', () => {
    expect(normalizeExposePath('')).toBe('/a2a');
    expect(normalizeExposePath('   ')).toBe('/a2a');
    expect(normalizeExposePath('/')).toBe('/a2a');
  });
});

describe('buildSecuritySchemes', () => {
  it('emits nothing for an open server', () => {
    expect(buildSecuritySchemes('none')).toEqual({});
  });

  it('emits a bearer scheme + requirement', () => {
    const s = buildSecuritySchemes('bearer');
    expect(s.securitySchemes).toHaveProperty('bearer');
    expect(s.security).toEqual([{ bearer: [] }]);
  });

  it('emits an apiKey header scheme', () => {
    const s = buildSecuritySchemes('apiKey');
    expect(s.securitySchemes).toMatchObject({ apiKey: { in: 'header' } });
  });
});

describe('buildAgentCard', () => {
  const identity = {
    name: 'Fallback Agent',
    description: 'Fallback description',
    version: '2',
    url: 'https://me.example/a2a',
  };

  it('falls back to agent identity when card fields are blank', () => {
    const card = buildAgentCard(makeConfig(), identity);
    expect(card.name).toBe('Fallback Agent');
    expect(card.description).toBe('Fallback description');
    expect(card.url).toBe('https://me.example/a2a');
    expect(card.version).toBe('2');
  });

  it('prefers explicit card name/description over identity', () => {
    const card = buildAgentCard(
      makeConfig({ agentCardName: 'Public Name', agentCardDescription: 'Public desc' }),
      identity,
    );
    expect(card.name).toBe('Public Name');
    expect(card.description).toBe('Public desc');
  });

  it('reflects capabilities and default text modes', () => {
    const card = buildAgentCard(makeConfig(), identity);
    expect(card.capabilities).toEqual({ streaming: true, pushNotifications: false });
    expect(card.defaultInputModes).toEqual(['text/plain']);
    expect(card.defaultOutputModes).toEqual(['text/plain']);
  });

  it('carries published skills and the security scheme', () => {
    const card = buildAgentCard(makeConfig(), identity);
    expect(card.skills).toHaveLength(1);
    expect(card.skills[0].id).toBe('summarize');
    expect(card.securitySchemes).toHaveProperty('bearer');
  });

  it('omits security blocks for an open server', () => {
    const card = buildAgentCard(makeConfig({ serverAuth: 'none' }), identity);
    expect(card.securitySchemes).toBeUndefined();
    expect(card.security).toBeUndefined();
  });
});

describe('validateAgentCard', () => {
  const good = {
    name: 'Remote',
    url: 'https://remote.example/a2a',
    version: '1.0',
    capabilities: { streaming: false },
    skills: [{ id: 's1', name: 'Do', description: '', tags: [] }],
  };

  it('accepts a well-formed card', () => {
    expect(validateAgentCard(good)).toEqual({ valid: true, errors: [] });
  });

  it('rejects a non-object', () => {
    expect(validateAgentCard(null).valid).toBe(false);
    expect(validateAgentCard('nope').valid).toBe(false);
  });

  it('flags a missing name and a non-http url', () => {
    const res = validateAgentCard({ ...good, name: '', url: 'ftp://x' });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('name'))).toBe(true);
    expect(res.errors.some((e) => e.includes('url'))).toBe(true);
  });

  it('flags a malformed skill entry', () => {
    const res = validateAgentCard({ ...good, skills: [{ name: 'no id' }] });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('skill[0]'))).toBe(true);
  });

  it('tolerates an absent skills array', () => {
    const { skills, ...noSkills } = good;
    expect(validateAgentCard(noSkills).valid).toBe(true);
  });
});

describe('buildAuthHeaders', () => {
  it('builds a bearer header', () => {
    expect(buildAuthHeaders('bearer', 'tok')).toEqual({ Authorization: 'Bearer tok' });
  });

  it('builds an apiKey header', () => {
    expect(buildAuthHeaders('apiKey', 'k')).toEqual({ 'X-API-Key': 'k' });
  });

  it('treats oauth2 credentials as bearer tokens', () => {
    expect(buildAuthHeaders('oauth2', 'tok')).toEqual({ Authorization: 'Bearer tok' });
  });

  it('returns nothing for none or a blank credential', () => {
    expect(buildAuthHeaders('none', 'tok')).toEqual({});
    expect(buildAuthHeaders('bearer', '  ')).toEqual({});
  });
});

describe('slugifyToolName', () => {
  it('lowercases and collapses non-alphanumerics', () => {
    expect(slugifyToolName('My Agent!')).toBe('my_agent');
    expect(slugifyToolName('  Research/Bot 2 ')).toBe('research_bot_2');
  });
});

describe('resolveDelegateTools', () => {
  it('derives one tool per remote with a fallback name', () => {
    const tools = resolveDelegateTools(makeConfig());
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('a2a_call_research_bot');
    expect(tools[0].remoteId).toBe('r1');
    expect(tools[0].inputSchema.required).toEqual(['message']);
  });

  it('honours an explicit tool name', () => {
    const cfg = makeConfig();
    cfg.remoteAgents[0].toolName = 'ask_researcher';
    expect(resolveDelegateTools(cfg)[0].name).toBe('ask_researcher');
  });

  it('skips remotes with no card url', () => {
    const cfg = makeConfig();
    cfg.remoteAgents[0].cardUrl = '';
    expect(resolveDelegateTools(cfg)).toHaveLength(0);
  });

  it('returns nothing when client role or the toggle is off', () => {
    expect(resolveDelegateTools(makeConfig({ role: 'server' }))).toHaveLength(0);
    expect(resolveDelegateTools(makeConfig({ exposeDelegateTools: false }))).toHaveLength(0);
    expect(resolveDelegateTools(makeConfig({ enabled: false }))).toHaveLength(0);
  });
});

describe('buildMessageSendRequest', () => {
  it('frames a JSON-RPC message/send envelope', () => {
    const req = buildMessageSendRequest({ requestId: '1', messageId: 'm1', text: 'hello' });
    expect(req.jsonrpc).toBe('2.0');
    expect(req.method).toBe(A2A_MESSAGE_SEND_METHOD);
    expect(req.params.message.parts).toEqual([{ kind: 'text', text: 'hello' }]);
    expect(req.params.message.taskId).toBeUndefined();
  });

  it('carries continuation ids and blocking config', () => {
    const req = buildMessageSendRequest({
      requestId: '2',
      messageId: 'm2',
      text: 'more',
      taskId: 't1',
      contextId: 'c1',
      blocking: true,
    });
    expect(req.params.message.taskId).toBe('t1');
    expect(req.params.message.contextId).toBe('c1');
    expect(req.params.configuration).toEqual({ blocking: true });
  });
});

describe('extractTextFromParts', () => {
  it('joins text parts and tolerates the older type key', () => {
    expect(
      extractTextFromParts([
        { kind: 'text', text: 'a' },
        { kind: 'file', file: {} },
        { type: 'text', text: 'b' },
      ]),
    ).toBe('a\nb');
  });

  it('returns empty for non-arrays', () => {
    expect(extractTextFromParts(undefined)).toBe('');
    expect(extractTextFromParts({})).toBe('');
  });
});

describe('normalizeTaskState / isTerminalTaskState', () => {
  it('passes through known states and defaults unknown', () => {
    expect(normalizeTaskState('working')).toBe('working');
    expect(normalizeTaskState('bogus')).toBe('unknown');
  });

  it('classifies terminal states', () => {
    expect(isTerminalTaskState('completed')).toBe(true);
    expect(isTerminalTaskState('failed')).toBe(true);
    expect(isTerminalTaskState('working')).toBe(false);
    expect(isTerminalTaskState('submitted')).toBe(false);
  });
});

describe('parseTaskResult', () => {
  it('surfaces a JSON-RPC error', () => {
    const res = parseTaskResult({ jsonrpc: '2.0', id: '1', error: { code: -32000, message: 'boom' } });
    expect(res.ok).toBe(false);
    expect(res.state).toBe('failed');
    expect(res.error).toEqual({ code: -32000, message: 'boom' });
  });

  it('parses a completed Task with a status message', () => {
    const res = parseTaskResult({
      result: {
        id: 't1',
        contextId: 'c1',
        status: { state: 'completed', message: { parts: [{ kind: 'text', text: 'done' }] } },
      },
    });
    expect(res.ok).toBe(true);
    expect(res.state).toBe('completed');
    expect(res.text).toBe('done');
    expect(res.taskId).toBe('t1');
    expect(res.contextId).toBe('c1');
  });

  it('falls back to the last artifact when there is no status message', () => {
    const res = parseTaskResult({
      result: {
        id: 't2',
        status: { state: 'completed' },
        artifacts: [{ parts: [{ kind: 'text', text: 'from-artifact' }] }],
      },
    });
    expect(res.text).toBe('from-artifact');
  });

  it('parses a bare Message result', () => {
    const res = parseTaskResult({
      result: { kind: 'message', parts: [{ kind: 'text', text: 'hi' }], contextId: 'c9' },
    });
    expect(res.ok).toBe(true);
    expect(res.state).toBe('completed');
    expect(res.text).toBe('hi');
    expect(res.contextId).toBe('c9');
  });

  it('marks a non-completed task as not ok', () => {
    const res = parseTaskResult({ result: { id: 't3', status: { state: 'working' } } });
    expect(res.ok).toBe(false);
    expect(res.state).toBe('working');
  });

  it('collapses empty / malformed responses', () => {
    expect(parseTaskResult(null).state).toBe('unknown');
    expect(parseTaskResult({}).state).toBe('unknown');
  });
});
