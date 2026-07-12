import type {
  ResolvedA2AConfig,
  A2AAuthScheme,
  A2ARemoteAgent,
} from '../../shared/agent-config';

/**
 * A2A (Agent-to-Agent) interop engine.
 *
 * An A2A node lets this agent talk to — and be talked to by — agents built on
 * *other* frameworks via the emerging Agent-to-Agent protocol: agents publish a
 * JSON **agent card** describing their skills and endpoints, and exchange work as
 * JSON-RPC 2.0 **task/message** envelopes (`message/send`, `message/stream`,
 * `tasks/get`, `tasks/cancel`). This is the cross-framework analogue of MCP —
 * where MCP standardized *tools*, A2A standardizes *agents*.
 *
 * This module is the dependency-free substrate the server calls; it owns:
 *
 *   - **Server side** — `buildAgentCard` / `validateAgentCard` construct and
 *     check the card this agent publishes at `/.well-known/agent-card.json`.
 *   - **Client side** — `resolveDelegates` turns the configured remotes into
 *     callable delegate descriptors; `buildMessageSendRequest` frames an outbound
 *     JSON-RPC task, and `parseTaskResponse` normalizes whatever comes back.
 *
 * It deliberately performs no I/O and generates no ids or timestamps (message
 * ids are injected by the caller) so it stays deterministic and unit-testable.
 * Wiring it into the server — serving the card route, registering the delegate
 * tools, and pumping the JSON-RPC transport — is the remaining integration step;
 * the API below is the stable surface that wiring targets.
 */

/** A2A protocol version this engine targets. */
export const A2A_PROTOCOL_VERSION = '0.3.0';

/** Well-known path an A2A agent card is served from. */
export const AGENT_CARD_WELL_KNOWN_PATH = '/.well-known/agent-card.json';

/** A2A task lifecycle states (the spec `TaskState` enum), plus `unknown`. */
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

/** States a task will not progress past without a new message. */
export const TERMINAL_TASK_STATES: ReadonlySet<A2ATaskState> = new Set<A2ATaskState>([
  'completed',
  'canceled',
  'failed',
  'rejected',
]);

const KNOWN_STATES: ReadonlySet<string> = new Set<string>([
  'submitted',
  'working',
  'input-required',
  'auth-required',
  'completed',
  'canceled',
  'failed',
  'rejected',
]);

/** Whether the task has reached a terminal state. */
export function isTerminalState(state: A2ATaskState): boolean {
  return TERMINAL_TASK_STATES.has(state);
}

/** Coerce a raw `status.state` into a known `A2ATaskState`, defaulting to `unknown`. */
export function normalizeState(raw: unknown): A2ATaskState {
  return typeof raw === 'string' && KNOWN_STATES.has(raw)
    ? (raw as A2ATaskState)
    : 'unknown';
}

// --- Agent card (server side) --------------------------------------------------

export interface A2AAgentCardSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  inputModes: string[];
  outputModes: string[];
}

export interface A2AAgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  url: string;
  version: string;
  preferredTransport: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransitionHistory: boolean;
  };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: A2AAgentCardSkill[];
  securitySchemes?: Record<string, unknown>;
  security?: Array<Record<string, string[]>>;
}

/**
 * Translate an auth scheme into the OpenAPI-style `securitySchemes` / `security`
 * pair the A2A card format uses. `none` returns an empty object (no auth).
 */
export function buildSecuritySchemes(scheme: A2AAuthScheme): {
  securitySchemes?: Record<string, unknown>;
  security?: Array<Record<string, string[]>>;
} {
  switch (scheme) {
    case 'apiKey':
      return {
        securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' } },
        security: [{ apiKey: [] }],
      };
    case 'bearer':
      return {
        securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
        security: [{ bearer: [] }],
      };
    case 'oauth2':
      return {
        securitySchemes: { oauth2: { type: 'oauth2', description: 'OAuth 2.0', flows: {} } },
        security: [{ oauth2: [] }],
      };
    case 'none':
    default:
      return {};
  }
}

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Build the agent card this agent publishes. `opts.url` is the public base URL of
 * this agent's A2A endpoint; input/output modes default to plain text.
 */
export function buildAgentCard(
  config: ResolvedA2AConfig,
  opts: { url: string; inputModes?: string[]; outputModes?: string[] },
): A2AAgentCard {
  const defaultInputModes = opts.inputModes ?? ['text/plain'];
  const defaultOutputModes = opts.outputModes ?? ['text/plain'];
  const { securitySchemes, security } = buildSecuritySchemes(config.serverAuthScheme);

  const card: A2AAgentCard = {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name: config.agentName.trim() || config.label,
    description: config.agentDescription.trim(),
    url: stripTrailingSlashes(opts.url),
    version: config.agentVersion.trim() || '0.0.0',
    preferredTransport: 'JSONRPC',
    capabilities: {
      streaming: config.streaming,
      pushNotifications: config.pushNotifications,
      stateTransitionHistory: false,
    },
    defaultInputModes,
    defaultOutputModes,
    skills: config.advertisedSkills.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      tags: [],
      inputModes: defaultInputModes,
      outputModes: defaultOutputModes,
    })),
  };
  if (securitySchemes) card.securitySchemes = securitySchemes;
  if (security) card.security = security;
  return card;
}

/**
 * Validate a card before it is published. Enforces the fields a remote client
 * needs to discover and call this agent, and rejects duplicate skill ids.
 */
export function validateAgentCard(card: A2AAgentCard): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!card.name?.trim()) errors.push('name is required');
  if (!card.url?.trim()) errors.push('url is required');
  if (!card.version?.trim()) errors.push('version is required');
  if (!Array.isArray(card.skills) || card.skills.length === 0) {
    errors.push('at least one skill must be advertised');
  } else {
    const ids = new Set<string>();
    for (const s of card.skills) {
      if (!s.id?.trim()) errors.push('skill id is required');
      else if (ids.has(s.id)) errors.push(`duplicate skill id: ${s.id}`);
      else ids.add(s.id);
    }
  }
  return { valid: errors.length === 0, errors };
}

// --- Message / task envelopes (client side) ------------------------------------

export interface A2ATextPart {
  kind: 'text';
  text: string;
}

export type A2APart = A2ATextPart | { kind: string; [key: string]: unknown };

export interface A2AMessage {
  role: 'user' | 'agent';
  parts: A2APart[];
  messageId: string;
  kind: 'message';
  taskId?: string;
  contextId?: string;
}

export interface A2AJsonRpcRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params: unknown;
}

/**
 * Build the `params` for a `message/send` / `message/stream` call: a single user
 * text message. `messageId` is injected by the caller; the engine generates no
 * ids so it stays deterministic.
 */
export function buildMessageParams(
  text: string,
  opts: { messageId: string; taskId?: string; contextId?: string },
): { message: A2AMessage } {
  const message: A2AMessage = {
    role: 'user',
    parts: [{ kind: 'text', text }],
    messageId: opts.messageId,
    kind: 'message',
  };
  if (opts.taskId) message.taskId = opts.taskId;
  if (opts.contextId) message.contextId = opts.contextId;
  return { message };
}

/** Wrap a method + params in a JSON-RPC 2.0 request envelope. */
export function buildJsonRpcRequest(
  method: string,
  params: unknown,
  id: string,
): A2AJsonRpcRequest {
  return { jsonrpc: '2.0', id, method, params };
}

/**
 * Frame an outbound task as a JSON-RPC request. Uses `message/stream` when
 * `opts.streaming` is set (and the remote advertised streaming), else
 * `message/send`. The JSON-RPC `id` reuses the message id.
 */
export function buildMessageSendRequest(
  text: string,
  opts: { messageId: string; streaming?: boolean; taskId?: string; contextId?: string },
): A2AJsonRpcRequest {
  const method = opts.streaming ? 'message/stream' : 'message/send';
  return buildJsonRpcRequest(method, buildMessageParams(text, opts), opts.messageId);
}

// --- Response parsing -----------------------------------------------------------

export interface NormalizedA2AResult {
  /** Task id if the remote created a task; null for a direct message reply. */
  taskId: string | null;
  state: A2ATaskState;
  /** Concatenated text parts from artifacts or the status message. */
  text: string;
  isTerminal: boolean;
  /** Error message when the call failed or the task ended failed/rejected. */
  error: string | null;
}

function coerceObject(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Concatenate the text of every `{ kind: 'text' }` part in a parts array. */
export function extractText(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter(
      (p): p is A2ATextPart =>
        !!p &&
        typeof p === 'object' &&
        (p as { kind?: unknown }).kind === 'text' &&
        typeof (p as { text?: unknown }).text === 'string',
    )
    .map((p) => p.text)
    .join('');
}

/**
 * Normalize a JSON-RPC response from a remote A2A agent. Handles three shapes:
 * a JSON-RPC error, a direct `message` reply (no task), and a `task` with a
 * status + artifacts. Accepts either a parsed object or a raw JSON string.
 */
export function parseTaskResponse(raw: unknown): NormalizedA2AResult {
  const obj = coerceObject(raw);
  if (!obj) {
    return {
      taskId: null,
      state: 'unknown',
      text: '',
      isTerminal: false,
      error: 'unparseable A2A response',
    };
  }

  if (obj.error && typeof obj.error === 'object') {
    const msg = (obj.error as { message?: unknown }).message;
    return {
      taskId: null,
      state: 'failed',
      text: '',
      isTerminal: true,
      error: typeof msg === 'string' ? msg : 'A2A error',
    };
  }

  const result = (obj.result ?? obj) as Record<string, unknown>;

  if (result.kind === 'message') {
    return {
      taskId: null,
      state: 'completed',
      text: extractText(result.parts),
      isTerminal: true,
      error: null,
    };
  }

  const status = (result.status ?? {}) as Record<string, unknown>;
  const state = normalizeState(status.state);
  const taskId = typeof result.id === 'string' ? result.id : null;

  let text = '';
  const artifacts = result.artifacts;
  if (Array.isArray(artifacts) && artifacts.length) {
    text = artifacts
      .map((a) => extractText((a as { parts?: unknown })?.parts))
      .filter(Boolean)
      .join('\n');
  }
  if (!text) {
    const statusMessage = status.message as { parts?: unknown } | undefined;
    if (statusMessage) text = extractText(statusMessage.parts);
  }

  const error =
    state === 'failed' || state === 'rejected' ? text || `task ${state}` : null;

  return { taskId, state, text, isTerminal: isTerminalState(state), error };
}

// --- Delegate resolution --------------------------------------------------------

export interface A2ADelegate {
  id: string;
  name: string;
  url: string;
  cardUrl: string;
  authScheme: A2AAuthScheme;
  /** Generated tool name the runtime exposes for delegating to this remote. */
  toolName: string;
}

/** Derive a stable, safe tool name (`a2a_<slug>`) from a remote id. */
export function toDelegateToolName(id: string): string {
  const slug = id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `a2a_${slug || 'remote'}`;
}

/** Whether this agent should serve an agent card (server or both, and enabled). */
export function isServerEnabled(config: ResolvedA2AConfig): boolean {
  return config.enabled && (config.role === 'server' || config.role === 'both');
}

/** Whether this agent should register remote delegates (client or both, and enabled). */
export function isClientEnabled(config: ResolvedA2AConfig): boolean {
  return config.enabled && (config.role === 'client' || config.role === 'both');
}

/**
 * Resolve the enabled remotes into callable delegate descriptors. Returns an
 * empty list when the client side is disabled or a remote has no URL.
 */
export function resolveDelegates(config: ResolvedA2AConfig): A2ADelegate[] {
  if (!isClientEnabled(config)) return [];
  return config.remotes
    .filter((r) => r.enabled && r.url.trim())
    .map((r) => {
      const url = stripTrailingSlashes(r.url.trim());
      return {
        id: r.id,
        name: r.name,
        url,
        cardUrl: url + AGENT_CARD_WELL_KNOWN_PATH,
        authScheme: r.authScheme,
        toolName: toDelegateToolName(r.id),
      };
    });
}

/** Look up a configured remote by its local id. */
export function selectRemoteById(
  config: ResolvedA2AConfig,
  id: string,
): A2ARemoteAgent | null {
  return config.remotes.find((r) => r.id === id) ?? null;
}
