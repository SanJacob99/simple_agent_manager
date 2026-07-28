import { describe, expect, it } from 'vitest';
import type { ResolvedA2AConfig } from '../../shared/agent-config';
import {
  A2A_WELL_KNOWN_PATH,
  buildAgentCard,
  buildDelegateTools,
  cardUrlFor,
  delegatesRemotely,
  joinUrl,
  servesCard,
  transportFor,
  validateA2AConfig,
} from './a2a-engine';

function makeConfig(overrides: Partial<ResolvedA2AConfig> = {}): ResolvedA2AConfig {
  return {
    a2aNodeId: 'a1',
    label: 'A2A Interop',
    enabled: true,
    role: 'both',
    agentName: '',
    agentDescription: 'A helpful agent.',
    serverUrl: 'https://host.example',
    cardVersion: '1.2.0',
    advertisedSkills: [
      { id: 'summarize', name: 'Summarize', description: 'Summarize text', tags: ['nlp'] },
    ],
    streaming: true,
    pushNotifications: false,
    serverAuthScheme: 'bearer',
    remoteAgents: [
      {
        id: 'planner',
        name: 'Planner',
        cardUrl: 'https://remote.example/.well-known/agent-card.json',
        transport: 'jsonrpc',
        authScheme: 'apiKey',
        authRef: 'PLANNER_KEY',
        exposeAsTool: true,
      },
    ],
    defaultTransport: 'jsonrpc',
    ...overrides,
  };
}

describe('joinUrl', () => {
  it('joins without doubling the slash', () => {
    expect(joinUrl('https://h.example/', '/x')).toBe('https://h.example/x');
    expect(joinUrl('https://h.example', 'x')).toBe('https://h.example/x');
  });
});

describe('cardUrlFor', () => {
  it('anchors the well-known path on the server url', () => {
    expect(cardUrlFor(makeConfig())).toBe(`https://host.example${A2A_WELL_KNOWN_PATH}`);
  });
  it('returns null without a server url', () => {
    expect(cardUrlFor(makeConfig({ serverUrl: '  ' }))).toBeNull();
  });
});

describe('role predicates', () => {
  it('server role serves a card, client role does not', () => {
    expect(servesCard(makeConfig({ role: 'server' }))).toBe(true);
    expect(servesCard(makeConfig({ role: 'client' }))).toBe(false);
    expect(servesCard(makeConfig({ role: 'both' }))).toBe(true);
  });
  it('client role delegates, server role does not', () => {
    expect(delegatesRemotely(makeConfig({ role: 'client' }))).toBe(true);
    expect(delegatesRemotely(makeConfig({ role: 'server' }))).toBe(false);
  });
  it('a disabled node does neither', () => {
    expect(servesCard(makeConfig({ enabled: false }))).toBe(false);
    expect(delegatesRemotely(makeConfig({ enabled: false }))).toBe(false);
  });
});

describe('buildAgentCard', () => {
  it('builds a card from config with the agent name fallback', () => {
    const card = buildAgentCard(makeConfig({ agentName: '' }), 'Fallback Agent');
    expect(card.name).toBe('Fallback Agent');
    expect(card.url).toBe(`https://host.example${A2A_WELL_KNOWN_PATH}`);
    expect(card.version).toBe('1.2.0');
    expect(card.capabilities).toEqual({ streaming: true, pushNotifications: false });
    expect(card.transports).toEqual(['jsonrpc']);
    expect(card.securitySchemes).toEqual(['bearer']);
    expect(card.skills).toHaveLength(1);
    expect(card.skills[0].id).toBe('summarize');
  });
  it('prefers an explicit agent name over the fallback', () => {
    const card = buildAgentCard(makeConfig({ agentName: 'Named' }), 'Fallback');
    expect(card.name).toBe('Named');
  });
  it('reports "none" security when unauthenticated', () => {
    const card = buildAgentCard(makeConfig({ serverAuthScheme: 'none' }), 'A');
    expect(card.securitySchemes).toEqual(['none']);
  });
});

describe('validateA2AConfig', () => {
  it('accepts a complete both-role config', () => {
    expect(validateA2AConfig(makeConfig())).toEqual([]);
  });
  it('treats a disabled config as valid regardless of holes', () => {
    expect(
      validateA2AConfig(makeConfig({ enabled: false, serverUrl: '', remoteAgents: [] })),
    ).toEqual([]);
  });
  it('flags a server role missing its base url', () => {
    const issues = validateA2AConfig(makeConfig({ role: 'server', serverUrl: '' }));
    expect(issues.some((i) => i.field === 'serverUrl')).toBe(true);
  });
  it('flags duplicate advertised skill ids', () => {
    const issues = validateA2AConfig(
      makeConfig({
        role: 'server',
        advertisedSkills: [
          { id: 'x', name: 'X', description: '', tags: [] },
          { id: 'x', name: 'X2', description: '', tags: [] },
        ],
      }),
    );
    expect(issues.some((i) => i.message.includes('Duplicate skill id'))).toBe(true);
  });
  it('flags a remote agent without a card url and without an auth ref', () => {
    const issues = validateA2AConfig(
      makeConfig({
        role: 'client',
        remoteAgents: [
          {
            id: 'r',
            name: 'R',
            cardUrl: '',
            transport: 'grpc',
            authScheme: 'oauth2',
            authRef: '',
            exposeAsTool: false,
          },
        ],
      }),
    );
    expect(issues.some((i) => i.field === 'remoteAgents[0].cardUrl')).toBe(true);
    expect(issues.some((i) => i.field === 'remoteAgents[0].authRef')).toBe(true);
  });
  it('does not require an auth ref when the scheme is none', () => {
    const issues = validateA2AConfig(
      makeConfig({
        role: 'client',
        remoteAgents: [
          {
            id: 'r',
            name: 'R',
            cardUrl: 'https://r.example/card',
            transport: 'http+json',
            authScheme: 'none',
            authRef: '',
            exposeAsTool: false,
          },
        ],
      }),
    );
    expect(issues).toEqual([]);
  });
});

describe('transportFor', () => {
  it('uses the remote pin over the node default', () => {
    const config = makeConfig({ defaultTransport: 'grpc' });
    expect(transportFor(config, config.remoteAgents[0])).toBe('jsonrpc');
  });
});

describe('buildDelegateTools', () => {
  it('builds one tool per exposed remote agent with a safe name', () => {
    const tools = buildDelegateTools(makeConfig());
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('a2a_delegate_planner');
    expect(tools[0].remoteAgentId).toBe('planner');
    expect(tools[0].transport).toBe('jsonrpc');
  });
  it('excludes remote agents that are not exposed as tools', () => {
    const config = makeConfig({
      remoteAgents: [
        { ...makeConfig().remoteAgents[0], exposeAsTool: false },
      ],
    });
    expect(buildDelegateTools(config)).toEqual([]);
  });
  it('returns nothing for a server-only config', () => {
    expect(buildDelegateTools(makeConfig({ role: 'server' }))).toEqual([]);
  });
  it('sanitizes a messy id into a tool-name-safe suffix', () => {
    const config = makeConfig({
      remoteAgents: [
        { ...makeConfig().remoteAgents[0], id: 'My Remote Agent!' },
      ],
    });
    expect(buildDelegateTools(config)[0].name).toBe('a2a_delegate_my_remote_agent');
  });
});
