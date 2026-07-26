import { describe, expect, it } from 'vitest';
import type { ResolvedA2AConfig } from '../../shared/agent-config';
import {
  A2A_PROTOCOL_VERSION,
  A2A_WELL_KNOWN_PATH,
  buildAgentCard,
  buildMessageSendRequest,
  buildSecurity,
  cardUrlFor,
  normalizeMessageParts,
  parseRemoteAgentCard,
  parseTaskResult,
  resolveAuthHeader,
  scoreDelegateMatch,
  selectDelegate,
  slugifySkillId,
  validateAgentCard,
  type A2ACardFallback,
  type DelegateCandidate,
} from './a2a-engine';

function makeConfig(overrides: Partial<ResolvedA2AConfig> = {}): ResolvedA2AConfig {
  return {
    a2aNodeId: 'a1',
    label: 'A2A Interop',
    enabled: true,
    exposureMode: 'both',
    serverName: '',
    serverDescription: '',
    serverUrl: 'https://agent.example.com/a2a',
    advertisedSkills: [],
    supportsStreaming: true,
    serverAuth: 'none',
    remoteAgents: [],
    exposeDelegateTool: true,
    taskTimeoutMs: 120000,
    ...overrides,
  };
}

const fallback: A2ACardFallback = {
  name: 'Fallback Agent',
  description: 'Fallback description',
  skills: ['Summarize Text', 'Translate'],
  version: '2',
};

describe('slugifySkillId', () => {
  it('slugifies names into stable ids', () => {
    expect(slugifySkillId('Summarize Text')).toBe('summarize-text');
    expect(slugifySkillId('  Code Review!! ')).toBe('code-review');
    expect(slugifySkillId('a/b_c')).toBe('a-b-c');
  });

  it('never yields an empty id', () => {
    expect(slugifySkillId('   ')).toBe('skill');
    expect(slugifySkillId('!!!')).toBe('skill');
  });
});

describe('buildSecurity', () => {
  it('returns empty for none', () => {
    expect(buildSecurity('none')).toEqual({});
  });

  it('builds apiKey / bearer / oauth2 schemes', () => {
    expect(buildSecurity('apiKey').securitySchemes?.apiKey.type).toBe('apiKey');
    expect(buildSecurity('bearer').securitySchemes?.bearer.scheme).toBe('bearer');
    expect(buildSecurity('oauth2').securitySchemes?.oauth2.type).toBe('oauth2');
    expect(buildSecurity('bearer').security).toEqual([{ bearer: [] }]);
  });
});

describe('buildAgentCard', () => {
  it('falls back to the agent name/description/skills when node fields are blank', () => {
    const card = buildAgentCard(makeConfig(), fallback);
    expect(card.name).toBe('Fallback Agent');
    expect(card.description).toBe('Fallback description');
    expect(card.protocolVersion).toBe(A2A_PROTOCOL_VERSION);
    expect(card.skills.map((s) => s.id)).toEqual(['summarize-text', 'translate']);
    expect(card.version).toBe('2');
  });

  it('prefers explicit node fields and advertised skills', () => {
    const card = buildAgentCard(
      makeConfig({
        serverName: 'Public Name',
        serverDescription: 'Public desc',
        advertisedSkills: ['Do A Thing'],
      }),
      fallback,
    );
    expect(card.name).toBe('Public Name');
    expect(card.description).toBe('Public desc');
    expect(card.skills).toEqual([{ id: 'do-a-thing', name: 'Do A Thing', description: '', tags: [] }]);
  });

  it('reflects streaming and auth into the card', () => {
    const card = buildAgentCard(makeConfig({ supportsStreaming: false, serverAuth: 'bearer' }), fallback);
    expect(card.capabilities.streaming).toBe(false);
    expect(card.securitySchemes?.bearer).toBeDefined();
  });

  it('dedupes skills that slug to the same id and drops blanks', () => {
    const card = buildAgentCard(
      makeConfig({ advertisedSkills: ['Code Review', 'code-review', '  ', 'Translate'] }),
      fallback,
    );
    expect(card.skills.map((s) => s.id)).toEqual(['code-review', 'translate']);
  });

  it('produces a card that passes validation', () => {
    expect(validateAgentCard(buildAgentCard(makeConfig(), fallback)).ok).toBe(true);
  });
});

describe('validateAgentCard', () => {
  it('flags missing required fields', () => {
    const result = validateAgentCard({ name: '', skills: [] });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('name is required');
    expect(result.errors).toContain('url is required');
  });

  it('requires non-empty input/output modes', () => {
    const result = validateAgentCard({
      name: 'x',
      description: 'x',
      url: 'x',
      version: '1',
      capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
      defaultInputModes: [],
      defaultOutputModes: ['text/plain'],
      skills: [],
    });
    expect(result.errors).toContain('defaultInputModes must be a non-empty array');
  });
});

describe('cardUrlFor', () => {
  it('appends the well-known path to the base url', () => {
    expect(cardUrlFor({ url: 'https://remote.example.com/' })).toBe(
      `https://remote.example.com${A2A_WELL_KNOWN_PATH}`,
    );
    expect(cardUrlFor({ url: 'https://remote.example.com' })).toBe(
      `https://remote.example.com${A2A_WELL_KNOWN_PATH}`,
    );
  });

  it('uses an explicit cardUrl override', () => {
    expect(cardUrlFor({ url: 'https://remote.example.com', cardUrl: 'https://cdn/card.json' })).toBe(
      'https://cdn/card.json',
    );
  });
});

describe('parseRemoteAgentCard', () => {
  const valid = {
    protocolVersion: '0.3.0',
    name: 'Remote',
    description: 'A remote agent',
    url: 'https://remote.example.com',
    version: '1.0',
    capabilities: { streaming: true, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
  };

  it('parses a valid card from a string', () => {
    const result = parseRemoteAgentCard(JSON.stringify(valid));
    expect('value' in result && result.value.name).toBe('Remote');
  });

  it('parses a valid card from an object', () => {
    const result = parseRemoteAgentCard(valid);
    expect('value' in result).toBe(true);
  });

  it('rejects invalid JSON', () => {
    expect(parseRemoteAgentCard('{not json')).toEqual({ error: 'agent card is not valid JSON' });
  });

  it('rejects a card missing required fields', () => {
    const result = parseRemoteAgentCard({ name: 'x' });
    expect('error' in result).toBe(true);
  });
});

describe('normalizeMessageParts', () => {
  it('wraps a bare string as a single text part', () => {
    expect(normalizeMessageParts('hi')).toEqual([{ kind: 'text', text: 'hi' }]);
  });

  it('passes through existing parts and coerces unknowns to text', () => {
    const parts = normalizeMessageParts([
      { kind: 'text', text: 'a' },
      // @ts-expect-error deliberately malformed to exercise coercion
      42,
    ]);
    expect(parts[0]).toEqual({ kind: 'text', text: 'a' });
    expect(parts[1]).toEqual({ kind: 'text', text: '42' });
  });
});

describe('buildMessageSendRequest', () => {
  it('builds a message/send JSON-RPC envelope with caller-supplied ids', () => {
    const req = buildMessageSendRequest('do the thing', { requestId: 'r1', messageId: 'm1' });
    expect(req.jsonrpc).toBe('2.0');
    expect(req.id).toBe('r1');
    expect(req.method).toBe('message/send');
    expect(req.params.message.messageId).toBe('m1');
    expect(req.params.message.role).toBe('user');
    expect(req.params.message.parts).toEqual([{ kind: 'text', text: 'do the thing' }]);
  });

  it('switches to message/stream and carries context/task ids', () => {
    const req = buildMessageSendRequest('follow up', {
      requestId: 2,
      messageId: 'm2',
      contextId: 'ctx',
      taskId: 'task',
      stream: true,
    });
    expect(req.method).toBe('message/stream');
    expect(req.params.message.contextId).toBe('ctx');
    expect(req.params.message.taskId).toBe('task');
  });
});

describe('parseTaskResult', () => {
  it('extracts text from an immediate message reply', () => {
    const result = parseTaskResult({
      jsonrpc: '2.0',
      id: 'r1',
      result: { kind: 'message', parts: [{ kind: 'text', text: 'answer' }] },
    });
    expect('value' in result && result.value.text).toBe('answer');
  });

  it('extracts text + state + artifacts from a task reply', () => {
    const result = parseTaskResult({
      result: {
        id: 'task-1',
        status: { state: 'completed', message: { parts: [{ kind: 'text', text: 'done' }] } },
        artifacts: [{ parts: [{ kind: 'data', data: { k: 1 } }, { kind: 'text', text: 'note' }] }],
      },
    });
    expect('value' in result).toBe(true);
    if ('value' in result) {
      expect(result.value.state).toBe('completed');
      expect(result.value.text).toContain('done');
      expect(result.value.text).toContain('note');
      expect(result.value.artifacts).toEqual([{ kind: 'data', data: { k: 1 } }]);
      expect(result.value.taskId).toBe('task-1');
    }
  });

  it('surfaces a JSON-RPC error', () => {
    const result = parseTaskResult({ error: { code: -32000, message: 'boom' } });
    expect(result).toEqual({ error: 'boom' });
  });

  it('rejects a response with no result', () => {
    expect('error' in parseTaskResult({ jsonrpc: '2.0', id: 1 })).toBe(true);
  });
});

describe('scoreDelegateMatch / selectDelegate', () => {
  const remotes: DelegateCandidate[] = [
    { id: 'sum', name: 'Summarizer', skills: ['summarize', 'condense'], enabled: true },
    { id: 'tr', name: 'Translator', skills: ['translate'], enabled: true },
    { id: 'off', name: 'Offline', skills: ['translate'], enabled: false },
  ];

  it('scores exact skill matches highest', () => {
    expect(scoreDelegateMatch(remotes[0], 'summarize')).toBe(1);
    expect(scoreDelegateMatch(remotes[0], 'Summarize')).toBe(1);
  });

  it('scores substring matches lower than exact', () => {
    expect(scoreDelegateMatch(remotes[0], 'summar')).toBeCloseTo(0.6);
  });

  it('falls back to a name match at the lowest weight', () => {
    expect(scoreDelegateMatch(remotes[1], 'Translator')).toBeCloseTo(0.3);
  });

  it('scores disabled agents zero', () => {
    expect(scoreDelegateMatch(remotes[2], 'translate')).toBe(0);
  });

  it('selects the best-matching enabled remote', () => {
    expect(selectDelegate(remotes, 'translate')?.id).toBe('tr');
    expect(selectDelegate(remotes, 'summarize')?.id).toBe('sum');
  });

  it('returns null when nothing matches', () => {
    expect(selectDelegate(remotes, 'paint a picture')).toBeNull();
  });
});

describe('resolveAuthHeader', () => {
  it('returns empty for none or missing credential', () => {
    expect(resolveAuthHeader('none', 'x')).toEqual({});
    expect(resolveAuthHeader('bearer', undefined)).toEqual({});
  });

  it('builds the header for each scheme', () => {
    expect(resolveAuthHeader('apiKey', 'k')).toEqual({ 'X-API-Key': 'k' });
    expect(resolveAuthHeader('bearer', 't')).toEqual({ Authorization: 'Bearer t' });
    expect(resolveAuthHeader('oauth2', 't')).toEqual({ Authorization: 'Bearer t' });
  });
});
