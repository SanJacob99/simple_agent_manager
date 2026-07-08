import type {
  ResolvedA2AConfig,
  ResolvedA2ARemoteAgent,
  A2AAuthScheme,
} from '../../shared/agent-config';

/**
 * Agent-to-Agent (A2A) interop engine.
 *
 * An A2A node exposes this agent over the emerging Agent-to-Agent protocol
 * (agent cards, task/message envelopes, streaming updates) and/or registers
 * remote A2A agents as callable delegates. This module is the dependency-free
 * substrate the server/runtime call: it owns agent-card assembly and
 * validation, the `delegate_to_agent` tool spec, the `message/send` JSON-RPC
 * request shape, task-result parsing, auth-header construction, and the
 * delegation depth guard — while the server owns the HTTP transport, the
 * `/.well-known/agent-card.json` route, and the actual model calls.
 *
 * The orchestration the server / run-coordinator performs:
 *
 *   Server role (`exposeServer`):
 *     1. Serve `buildAgentCard(config, opts)` as JSON at
 *        `<serverPath>/.well-known/agent-card.json`.
 *     2. Accept `message/send` requests at `<serverPath>`, authenticate per
 *        `serverAuthScheme`, run the agent, and return a task/message result.
 *
 *   Client role (`exposeDelegateTool`):
 *     1. Expose `buildDelegateToolSpec(config)` to the agent.
 *     2. On a call, `resolveRemoteAgent(config, id)` → fetch+`validateAgentCard`
 *        the remote card → POST `buildMessageSendParams(...)` with
 *        `buildAuthHeaders(remote)` → `parseTaskResult(response)`.
 *     3. `canDelegate(config, depth)` guards against unbounded delegation loops.
 *
 * Wiring the HTTP routes and the tool handler into `server/` is the remaining
 * integration step; the API below is the stable surface that wiring targets.
 */

/** A2A protocol version this scaffold targets. */
export const A2A_PROTOCOL_VERSION = '0.3.0';

/** Well-known suffix under which an agent card is discoverable. */
export const AGENT_CARD_WELL_KNOWN_PATH = '/.well-known/agent-card.json';

/** A2A task lifecycle states (subset used by this scaffold). */
export type A2ATaskState =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'auth-required'
  | 'completed'
  | 'canceled'
  | 'failed'
  | 'rejected'
  | 'unknown';

/** A skill declared on the agent card. */
export interface A2AAgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

/** The discovery document served for the exposed agent. */
export interface A2AAgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  /** Absolute URL of the A2A endpoint. */
  url: string;
  version: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
  };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: A2AAgentSkill[];
  /** Named security schemes, keyed by scheme id. Empty when auth is `none`. */
  securitySchemes: Record<string, A2ASecurityScheme>;
  /** Security requirements: each entry names schemes that together authorize a call. */
  security: Record<string, string[]>[];
}

export interface A2ASecurityScheme {
  type: 'http' | 'apiKey';
  scheme?: string;
  in?: 'header';
  name?: string;
}

export interface BuildAgentCardOptions {
  /** Absolute base URL the server is reachable at, e.g. `http://localhost:3001`. */
  baseUrl: string;
  /** Agent version string to advertise. */
  version: string;
  /** Fallback name when the node's `agentName` is empty. */
  fallbackName: string;
  /** Fallback description when the node's `agentDescription` is empty. */
  fallbackDescription: string;
  /** Skills to declare on the card. */
  skills?: A2AAgentSkill[];
}

/** Join a base URL and a path without doubling or dropping the separating slash. */
function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

/**
 * Map a node auth scheme to the agent card's `securitySchemes` /`security`
 * pair. `none` yields empty maps (an unauthenticated endpoint).
 */
function securityForScheme(
  scheme: A2AAuthScheme,
): Pick<A2AAgentCard, 'securitySchemes' | 'security'> {
  if (scheme === 'bearer') {
    return {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
      security: [{ bearer: [] }],
    };
  }
  if (scheme === 'apiKey') {
    return {
      securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' } },
      security: [{ apiKey: [] }],
    };
  }
  return { securitySchemes: {}, security: [] };
}

/**
 * Assemble the agent card served at `<serverPath>/.well-known/agent-card.json`.
 * `name`/`description` fall back to the agent's own when the node leaves them
 * blank. Capabilities mirror the advertise toggles; security reflects the
 * server auth scheme.
 */
export function buildAgentCard(
  config: ResolvedA2AConfig,
  opts: BuildAgentCardOptions,
): A2AAgentCard {
  const { securitySchemes, security } = securityForScheme(config.serverAuthScheme);
  return {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name: config.agentName.trim() || opts.fallbackName,
    description: config.agentDescription.trim() || opts.fallbackDescription,
    url: joinUrl(opts.baseUrl, config.serverPath),
    version: opts.version,
    capabilities: {
      streaming: config.advertiseStreaming,
      pushNotifications: config.advertisePushNotifications,
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: opts.skills ?? [],
    securitySchemes,
    security,
  };
}

/** Result of validating a fetched remote agent card. */
export type AgentCardValidation =
  | { valid: true; card: A2AAgentCard }
  | { valid: false; errors: string[] };

/**
 * Validate a remote agent card fetched from a delegate. Checks the fields the
 * client needs to actually call the agent (a name, a reachable `url`) plus a
 * usable capabilities object. Tolerant of missing optional fields — an older
 * card without `protocolVersion` or `skills` still validates, with sensible
 * defaults filled in.
 */
export function validateAgentCard(input: unknown): AgentCardValidation {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') {
    return { valid: false, errors: ['card is not an object'] };
  }
  const raw = input as Record<string, unknown>;

  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) errors.push('missing "name"');

  const url = typeof raw.url === 'string' ? raw.url.trim() : '';
  if (!url) errors.push('missing "url"');
  else if (!/^https?:\/\//i.test(url)) errors.push('"url" must be http(s)');

  if (errors.length > 0) return { valid: false, errors };

  const capsRaw =
    raw.capabilities && typeof raw.capabilities === 'object'
      ? (raw.capabilities as Record<string, unknown>)
      : {};

  const card: A2AAgentCard = {
    protocolVersion:
      typeof raw.protocolVersion === 'string'
        ? raw.protocolVersion
        : A2A_PROTOCOL_VERSION,
    name,
    description: typeof raw.description === 'string' ? raw.description : '',
    url,
    version: typeof raw.version === 'string' ? raw.version : '0.0.0',
    capabilities: {
      streaming: capsRaw.streaming === true,
      pushNotifications: capsRaw.pushNotifications === true,
    },
    defaultInputModes: Array.isArray(raw.defaultInputModes)
      ? (raw.defaultInputModes.filter((m) => typeof m === 'string') as string[])
      : ['text/plain'],
    defaultOutputModes: Array.isArray(raw.defaultOutputModes)
      ? (raw.defaultOutputModes.filter((m) => typeof m === 'string') as string[])
      : ['text/plain'],
    skills: Array.isArray(raw.skills)
      ? (raw.skills.filter(
          (s) => s && typeof s === 'object',
        ) as unknown as A2AAgentSkill[])
      : [],
    securitySchemes:
      raw.securitySchemes && typeof raw.securitySchemes === 'object'
        ? (raw.securitySchemes as Record<string, A2ASecurityScheme>)
        : {},
    security: Array.isArray(raw.security)
      ? (raw.security as Record<string, string[]>[])
      : [],
  };

  return { valid: true, card };
}

/** Find a registered remote agent by its local id. */
export function resolveRemoteAgent(
  config: ResolvedA2AConfig,
  id: string,
): ResolvedA2ARemoteAgent | null {
  return config.remoteAgents.find((r) => r.id === id) ?? null;
}

/**
 * Build the HTTP auth headers for a remote agent. `authToken` names an
 * environment variable so secrets never live in the graph; pass a `resolveEnv`
 * to read it (defaults to `process.env`). Returns an empty object for `none`,
 * an unset env var, or a missing token.
 */
export function buildAuthHeaders(
  remote: Pick<ResolvedA2ARemoteAgent, 'authScheme' | 'authToken'>,
  resolveEnv: (name: string) => string | undefined = (name) => process.env[name],
): Record<string, string> {
  if (remote.authScheme === 'none') return {};
  const token = remote.authToken ? resolveEnv(remote.authToken) : undefined;
  if (!token) return {};
  if (remote.authScheme === 'bearer') return { Authorization: `Bearer ${token}` };
  return { 'X-API-Key': token };
}

/**
 * Whether another delegation hop is allowed. False once A2A is disabled, the
 * delegate tool is off, there are no remotes, or `depth` has reached
 * `maxDelegationDepth`.
 *
 * @param depth number of delegation hops already taken (0 = the top-level run).
 */
export function canDelegate(config: ResolvedA2AConfig, depth: number): boolean {
  if (!config.enabled) return false;
  if (!config.exposeDelegateTool) return false;
  if (config.remoteAgents.length === 0) return false;
  return depth < config.maxDelegationDepth;
}

/** A tool definition surfaced to the agent, JSON-Schema parameters and all. */
export interface DelegateToolSpec {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

/**
 * Build the `delegate_to_agent` tool spec, enumerating the registered remotes
 * as an enum of ids so the model can only target a configured agent. Returns
 * `null` when delegation is disabled or no remotes are registered — the caller
 * then exposes no tool.
 */
export function buildDelegateToolSpec(config: ResolvedA2AConfig): DelegateToolSpec | null {
  if (!config.enabled || !config.exposeDelegateTool) return null;
  if (config.remoteAgents.length === 0) return null;

  const ids = config.remoteAgents.map((r) => r.id);
  const roster = config.remoteAgents
    .map((r) => `- ${r.id}: ${r.name || '(unnamed)'}`)
    .join('\n');

  return {
    name: 'delegate_to_agent',
    description:
      'Delegate a task to a registered remote agent over the A2A protocol and ' +
      'return its result. Available agents:\n' +
      roster,
    parameters: {
      type: 'object',
      properties: {
        agent_id: {
          type: 'string',
          enum: ids,
          description: 'Which registered remote agent to delegate to.',
        },
        task: {
          type: 'string',
          description: 'The task/message to send to the remote agent.',
        },
      },
      required: ['agent_id', 'task'],
    },
  };
}

/** JSON-RPC `params` object for an A2A `message/send` call. */
export interface MessageSendParams {
  message: {
    role: 'user';
    parts: { kind: 'text'; text: string }[];
    messageId: string;
  };
}

/**
 * Build the `params` for an A2A `message/send` request. The caller wraps this
 * in the JSON-RPC 2.0 envelope (`{ jsonrpc, id, method: 'message/send', params }`)
 * and supplies a unique `messageId`.
 */
export function buildMessageSendParams(text: string, messageId: string): MessageSendParams {
  return {
    message: {
      role: 'user',
      parts: [{ kind: 'text', text }],
      messageId,
    },
  };
}

/** Concatenate the text of every `text` part in a parts array. */
function extractTextParts(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter(
      (p): p is { kind: string; text: string } =>
        !!p &&
        typeof p === 'object' &&
        (p as Record<string, unknown>).kind === 'text' &&
        typeof (p as Record<string, unknown>).text === 'string',
    )
    .map((p) => p.text)
    .join('');
}

/** Normalized outcome of an A2A `message/send` result. */
export interface ParsedTaskResult {
  state: A2ATaskState;
  /** Best-effort text of the reply (artifacts preferred, else status message). */
  text: string;
  /** Populated when the task failed / was rejected. */
  error?: string;
}

/**
 * Parse the `result` of an A2A `message/send` response. The result is either a
 * Task (`{ status: { state, message }, artifacts }`) or a bare Message
 * (`{ role, parts }`) for agents that answer synchronously. Text is taken from
 * artifacts first, then the status message; on `failed`/`rejected` the status
 * message becomes the `error`.
 */
export function parseTaskResult(result: unknown): ParsedTaskResult {
  if (!result || typeof result !== 'object') {
    return { state: 'unknown', text: '' };
  }
  const raw = result as Record<string, unknown>;

  // Bare Message result (no task wrapper).
  if (!('status' in raw) && Array.isArray(raw.parts)) {
    return { state: 'completed', text: extractTextParts(raw.parts) };
  }

  const status =
    raw.status && typeof raw.status === 'object'
      ? (raw.status as Record<string, unknown>)
      : {};
  const state: A2ATaskState =
    typeof status.state === 'string' ? (status.state as A2ATaskState) : 'unknown';

  // Prefer artifact text; fall back to the status message text.
  let text = '';
  if (Array.isArray(raw.artifacts)) {
    text = raw.artifacts
      .map((a) =>
        a && typeof a === 'object'
          ? extractTextParts((a as Record<string, unknown>).parts)
          : '',
      )
      .filter(Boolean)
      .join('\n');
  }
  const statusMsg =
    status.message && typeof status.message === 'object'
      ? extractTextParts((status.message as Record<string, unknown>).parts)
      : '';
  if (!text) text = statusMsg;

  if (state === 'failed' || state === 'rejected') {
    return { state, text, error: statusMsg || `task ${state}` };
  }
  return { state, text };
}
