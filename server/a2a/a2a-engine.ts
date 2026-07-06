import type {
  ResolvedA2AConfig,
  A2ARemoteAgent,
  A2ASkillDescriptor,
} from '../../shared/agent-config';

/**
 * Agent-to-Agent (A2A) interop engine.
 *
 * An A2A node gives an agent two surfaces:
 *
 *   - **Server** — expose this agent as an A2A endpoint by publishing an *agent
 *     card* (a JSON document at `/.well-known/agent-card.json` describing the
 *     agent's identity, capabilities, skills, and auth) and accepting inbound
 *     `message/send` / `message/stream` task envelopes.
 *   - **Client** — call *other* agents (built on any A2A-speaking framework) by
 *     fetching their card and sending JSON-RPC message envelopes, optionally
 *     surfacing each remote agent to the model as a callable delegate tool.
 *
 * This module is the dependency-free substrate the server calls: it builds the
 * spec-shaped agent card, constructs and parses the JSON-RPC message/task
 * envelopes, decides which remote agents become tools, and encodes the
 * remote-error policy. The server (`server/a2a/` HTTP surface + tool factory)
 * owns the actual fetch/serve; wiring it into `server/agents/run-coordinator.ts`
 * (mount the card route when `exposeAsServer`, register delegate tools for
 * `remoteAgents`, emit `a2a:remote_error`) is the remaining integration step.
 *
 * The protocol structures below track the A2A specification: an `AgentCard`
 * with `capabilities`, `skills`, and `securitySchemes`, and JSON-RPC 2.0
 * `message/send` requests whose result is a `Task` or `Message` carrying
 * text/data `parts`.
 */

/** A2A protocol version this engine targets. */
export const A2A_PROTOCOL_VERSION = '0.2.0';

/** Well-known path where an A2A agent card is published. */
export const AGENT_CARD_PATH = '/.well-known/agent-card.json';

// --- Agent card (server surface) ---

export interface AgentCardSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
}

export interface AgentCardCapabilities {
  streaming: boolean;
  pushNotifications: boolean;
  stateTransitionHistory: boolean;
}

export interface AgentCardSecurityScheme {
  type: 'apiKey' | 'http';
  /** Header name for `apiKey` schemes. */
  name?: string;
  in?: 'header';
  /** Bearer for `http` schemes. */
  scheme?: 'bearer';
}

export interface AgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: AgentCardCapabilities;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: AgentCardSkill[];
  securitySchemes?: Record<string, AgentCardSecurityScheme>;
  security?: Array<Record<string, string[]>>;
}

/**
 * Join a base URL and a path without doubling or dropping the slash between
 * them. Dependency-free (no `URL`) so the result is stable across runtimes.
 */
export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

function toCardSkill(skill: A2ASkillDescriptor): AgentCardSkill {
  const card: AgentCardSkill = {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    tags: skill.tags,
  };
  if (skill.examples.length > 0) card.examples = skill.examples;
  return card;
}

/**
 * Build the security-scheme + security requirement pair for the card from the
 * configured inbound auth. `none` yields no schemes (open endpoint).
 */
export function buildSecuritySchemes(
  config: ResolvedA2AConfig,
): Pick<AgentCard, 'securitySchemes' | 'security'> {
  if (config.authScheme === 'none') return {};
  const headerName = config.authHeaderName.trim() || 'Authorization';
  if (config.authScheme === 'apiKey') {
    return {
      securitySchemes: {
        apiKey: { type: 'apiKey', name: headerName, in: 'header' },
      },
      security: [{ apiKey: [] }],
    };
  }
  // bearer
  return {
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    security: [{ bearer: [] }],
  };
}

/**
 * Build a spec-shaped `AgentCard` for this agent from the resolved config.
 *
 * @param config resolved A2A config (server surface).
 * @param baseUrl the origin the server is reachable at (e.g. `https://host:3001`).
 * @param fallbackName agent name to advertise when `agentName` is blank.
 * @param version agent/build version string to advertise.
 */
export function buildAgentCard(
  config: ResolvedA2AConfig,
  baseUrl: string,
  fallbackName: string,
  version = '1.0.0',
): AgentCard {
  const name = config.agentName.trim() || fallbackName;
  const card: AgentCard = {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name,
    description: config.agentDescription.trim(),
    url: joinUrl(baseUrl, config.serverPath),
    version,
    capabilities: {
      streaming: config.streaming,
      pushNotifications: config.pushNotifications,
      stateTransitionHistory: false,
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: config.skills.map(toCardSkill),
  };
  const security = buildSecuritySchemes(config);
  if (security.securitySchemes) card.securitySchemes = security.securitySchemes;
  if (security.security) card.security = security.security;
  return card;
}

// --- Message / task envelopes (client surface) ---

export interface A2ATextPart {
  kind: 'text';
  text: string;
}

export interface A2AMessage {
  role: 'user' | 'agent';
  parts: A2ATextPart[];
  messageId: string;
  taskId?: string;
  contextId?: string;
}

export interface A2ASendMessageRequest {
  jsonrpc: '2.0';
  id: string;
  method: 'message/send' | 'message/stream';
  params: {
    message: A2AMessage;
    configuration?: { blocking?: boolean };
  };
}

/**
 * Build a JSON-RPC `message/send` request envelope carrying a single text part.
 * The caller supplies `messageId`/`requestId` (the runtime uses monotonically
 * increasing ids); keeping them as params makes this pure and unit-testable.
 */
export function buildSendMessageRequest(
  text: string,
  requestId: string,
  messageId: string,
  opts: { stream?: boolean; taskId?: string; contextId?: string; blocking?: boolean } = {},
): A2ASendMessageRequest {
  const message: A2AMessage = {
    role: 'user',
    parts: [{ kind: 'text', text }],
    messageId,
  };
  if (opts.taskId) message.taskId = opts.taskId;
  if (opts.contextId) message.contextId = opts.contextId;
  return {
    jsonrpc: '2.0',
    id: requestId,
    method: opts.stream ? 'message/stream' : 'message/send',
    params: {
      message,
      ...(opts.blocking === undefined ? {} : { configuration: { blocking: opts.blocking } }),
    },
  };
}

/**
 * Concatenate the text from a list of A2A `parts`, ignoring non-text parts
 * (files, structured data) which this text-first engine does not surface.
 */
export function extractTextFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .map((p) => {
      if (p && typeof p === 'object' && (p as { kind?: unknown }).kind === 'text') {
        const t = (p as { text?: unknown }).text;
        return typeof t === 'string' ? t : '';
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

export interface A2ATaskResult {
  /** Text recovered from the task's final artifacts / the returned message. */
  text: string;
  /** Task lifecycle state, when the result was a Task rather than a Message. */
  state: string | null;
  /** Task id, when present. */
  taskId: string | null;
}

/**
 * Parse a JSON-RPC response from a remote agent into an `A2ATaskResult`.
 *
 * A2A `message/send` returns either a `Message` (immediate reply) or a `Task`
 * (with `status.state`, `history`, and `artifacts`). This recovers text from a
 * Task's artifacts first, then its final history message, then a bare Message.
 * A JSON-RPC `error` member is thrown so the caller's error policy applies.
 */
export function parseTaskResult(response: unknown): A2ATaskResult {
  if (!response || typeof response !== 'object') {
    throw new Error('A2A response was not a JSON-RPC object');
  }
  const rpc = response as Record<string, unknown>;
  if (rpc.error && typeof rpc.error === 'object') {
    const err = rpc.error as { message?: unknown; code?: unknown };
    const msg = typeof err.message === 'string' ? err.message : 'unknown A2A error';
    const code = typeof err.code === 'number' ? ` (code ${err.code})` : '';
    throw new Error(`A2A remote error: ${msg}${code}`);
  }
  const result = rpc.result;
  if (!result || typeof result !== 'object') {
    throw new Error('A2A response missing result');
  }
  const obj = result as Record<string, unknown>;

  // Task shape: has a `status` and optionally `artifacts` / `history`.
  if ('status' in obj || obj.kind === 'task') {
    const status = (obj.status ?? {}) as Record<string, unknown>;
    const state = typeof status.state === 'string' ? status.state : null;
    const taskId = typeof obj.id === 'string' ? obj.id : null;

    // Prefer artifacts, then the last history message, then the status message.
    const artifacts = Array.isArray(obj.artifacts) ? obj.artifacts : [];
    const artifactText = artifacts
      .map((a) => extractTextFromParts((a as { parts?: unknown }).parts))
      .filter(Boolean)
      .join('\n');
    if (artifactText) return { text: artifactText, state, taskId };

    const history = Array.isArray(obj.history) ? obj.history : [];
    const lastAgent = [...history]
      .reverse()
      .find((m) => (m as { role?: unknown }).role === 'agent');
    if (lastAgent) {
      return { text: extractTextFromParts((lastAgent as { parts?: unknown }).parts), state, taskId };
    }

    const statusMsg = status.message as { parts?: unknown } | undefined;
    return { text: extractTextFromParts(statusMsg?.parts), state, taskId };
  }

  // Message shape: a direct reply with parts.
  return {
    text: extractTextFromParts(obj.parts),
    state: null,
    taskId: null,
  };
}

// --- Remote-agent selection & policy (client surface) ---

/**
 * The remote agents that should be registered as callable delegate tools:
 * enabled, flagged `exposeAsTool`, and carrying a non-empty `cardUrl`. Returns
 * an empty list when A2A is disabled.
 */
export function remoteAgentsAsTools(config: ResolvedA2AConfig): A2ARemoteAgent[] {
  if (!config.enabled) return [];
  return config.remoteAgents.filter(
    (a) => a.enabled && a.exposeAsTool && a.cardUrl.trim().length > 0,
  );
}

/** The tool name a remote agent is exposed under (`a2a__<sanitized id>`). */
export function remoteAgentToolName(agent: A2ARemoteAgent): string {
  const slug = agent.id.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return `a2a__${slug || 'agent'}`;
}

/** Effective timeout for a remote call: the agent's own, else the config default. */
export function resolveRemoteTimeout(config: ResolvedA2AConfig, agent: A2ARemoteAgent): number {
  const t = agent.timeoutMs > 0 ? agent.timeoutMs : config.defaultTimeoutMs;
  return t > 0 ? t : 30000;
}

export interface RemoteErrorDecision {
  /** Whether to abort the delegating tool call and propagate the error. */
  rethrow: boolean;
  /** Whether the caller should emit an `a2a:remote_error` event. */
  emitEvent: boolean;
  /** Text to hand back to the model as the tool result (when not rethrowing). */
  toolResult: string;
}

/**
 * Apply the configured remote-error policy to a failed remote call.
 * - `fail`: rethrow, abort the tool call.
 * - `warn`: surface the error to the model and emit an event so it can route around.
 * - `ignore`: swallow silently and return an empty result.
 */
export function applyRemoteErrorPolicy(
  config: ResolvedA2AConfig,
  agent: A2ARemoteAgent,
  error: Error,
): RemoteErrorDecision {
  switch (config.onRemoteError) {
    case 'fail':
      return { rethrow: true, emitEvent: true, toolResult: '' };
    case 'ignore':
      return { rethrow: false, emitEvent: false, toolResult: '' };
    case 'warn':
    default:
      return {
        rethrow: false,
        emitEvent: true,
        toolResult: `Remote agent "${agent.name || agent.id}" failed: ${error.message}`,
      };
  }
}

/**
 * Validate a remote-agent descriptor, returning a list of human-readable
 * problems (empty when valid). Used by the Settings/property surfaces to flag
 * misconfigured delegates before a run.
 */
export function validateRemoteAgent(agent: A2ARemoteAgent): string[] {
  const problems: string[] = [];
  if (!agent.id.trim()) problems.push('id is required');
  if (!agent.cardUrl.trim()) {
    problems.push('cardUrl is required');
  } else if (!/^https?:\/\//i.test(agent.cardUrl.trim())) {
    problems.push('cardUrl must be an http(s) URL');
  }
  if (agent.timeoutMs < 0) problems.push('timeoutMs must be >= 0');
  return problems;
}
