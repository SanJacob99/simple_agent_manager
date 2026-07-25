import type { ResolvedA2AConfig, A2AAuthScheme } from '../../shared/agent-config';

/**
 * Agent-to-Agent (A2A) interop engine.
 *
 * An A2A node lets this agent speak the emerging Agent-to-Agent protocol:
 * publish an agent card and accept remote tasks (server role), and/or discover
 * remote agents and delegate work to them (client role). A2A standardizes
 * cross-framework agent interop — agent cards, JSON-RPC task/message envelopes,
 * and streaming updates — much as MCP standardized tools.
 *
 * This module is the dependency-free substrate the runtime calls. It owns:
 *
 *   - `buildAgentCard(...)`   — assemble the JSON agent card advertised to peers.
 *   - `buildMessageSendParams(...)` — build the JSON-RPC `message/send` params
 *     used to hand a task to a remote agent.
 *   - `parseTaskResult(...)`  — normalize a remote agent's task/message reply
 *     into `{ state, text, artifacts }`.
 *   - `toDelegateDescriptors(...)` — turn registered remote agents into callable
 *     delegate descriptors the tool layer can expose.
 *   - card-URL and task-state helpers.
 *
 * Wiring this into the server (mount the card + JSON-RPC handler under
 * `serverPath` in `server/index.ts`, register delegates as tools in
 * `server/tools/tool-factory.ts`, fetch remote cards on startup) is the
 * remaining integration step; the API below is the stable surface that wiring
 * targets. It deliberately performs no network I/O so it stays unit-testable.
 */

/** Conventional well-known path for an A2A agent card. */
export const WELL_KNOWN_CARD_PATH = '/.well-known/agent-card.json';

/**
 * Task lifecycle states from the A2A protocol. `input-required` and
 * `auth-required` are non-terminal pauses; the rest of the non-terminal states
 * are `submitted` / `working`.
 */
export type A2ATaskState =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'auth-required'
  | 'completed'
  | 'canceled'
  | 'failed'
  | 'rejected';

const TERMINAL_STATES: ReadonlySet<A2ATaskState> = new Set<A2ATaskState>([
  'completed',
  'canceled',
  'failed',
  'rejected',
]);

/** Whether a task state is terminal (no further updates will arrive). */
export function isTerminalState(state: string): boolean {
  return TERMINAL_STATES.has(state as A2ATaskState);
}

// --- Agent card ---

export interface AgentCardCapabilities {
  streaming: boolean;
  pushNotifications: boolean;
  stateTransitionHistory: boolean;
}

export interface AgentCardSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

export interface AgentCard {
  name: string;
  description: string;
  /** Absolute base URL the A2A endpoint is served from, when a base URL is known. */
  url?: string;
  version: string;
  protocolVersion: string;
  capabilities: AgentCardCapabilities;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: AgentCardSkill[];
  securitySchemes: Record<string, { type: string; scheme?: string; name?: string; in?: string }>;
}

/** The A2A protocol revision this engine targets. */
export const A2A_PROTOCOL_VERSION = '0.2.0';

/** Join a base URL and a mount path without doubling or dropping the slash. */
export function joinUrl(baseUrl: string, path: string): string {
  if (!baseUrl) return path;
  const trimmedBase = baseUrl.replace(/\/+$/, '');
  const trimmedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimmedBase}${trimmedPath}`;
}

/**
 * Map a resolved auth scheme to the agent card `securitySchemes` entry. `none`
 * yields an empty object (the endpoint is unauthenticated).
 */
export function securitySchemesFor(
  scheme: A2AAuthScheme,
): AgentCard['securitySchemes'] {
  switch (scheme) {
    case 'bearer':
      return { bearer: { type: 'http', scheme: 'bearer' } };
    case 'apiKey':
      return { apiKey: { type: 'apiKey', name: 'X-API-Key', in: 'header' } };
    case 'oauth2':
      return { oauth2: { type: 'oauth2' } };
    case 'none':
    default:
      return {};
  }
}

/**
 * Assemble the JSON agent card advertised to A2A peers from the resolved config.
 * When `baseUrl` is provided, the card's `url` points at `baseUrl + serverPath`.
 */
export function buildAgentCard(
  config: ResolvedA2AConfig,
  baseUrl?: string,
): AgentCard {
  const card: AgentCard = {
    name: config.agentName,
    description: config.agentDescription,
    version: config.version,
    protocolVersion: A2A_PROTOCOL_VERSION,
    capabilities: {
      streaming: config.advertiseStreaming,
      pushNotifications: config.advertisePushNotifications,
      stateTransitionHistory: false,
    },
    defaultInputModes: config.inputModes.length ? config.inputModes : ['text/plain'],
    defaultOutputModes: config.outputModes.length ? config.outputModes : ['text/plain'],
    skills: config.skills.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      tags: s.tags,
    })),
    securitySchemes: securitySchemesFor(config.authScheme),
  };
  if (baseUrl) {
    card.url = joinUrl(baseUrl, config.serverPath);
  }
  return card;
}

// --- Message / task envelopes ---

export interface A2ATextPart {
  kind: 'text';
  text: string;
}

export interface A2AMessage {
  role: 'user' | 'agent';
  parts: A2ATextPart[];
  messageId: string;
  kind: 'message';
  contextId?: string;
  taskId?: string;
}

export interface MessageSendParams {
  message: A2AMessage;
  configuration?: { blocking?: boolean; acceptedOutputModes?: string[] };
}

/**
 * Build the JSON-RPC `message/send` params handed to a remote agent. `messageId`
 * is supplied by the caller (the runtime) so this stays free of nondeterministic
 * id generation and remains unit-testable.
 */
export function buildMessageSendParams(
  text: string,
  opts: {
    messageId: string;
    contextId?: string;
    taskId?: string;
    blocking?: boolean;
    acceptedOutputModes?: string[];
  },
): MessageSendParams {
  const message: A2AMessage = {
    role: 'user',
    parts: [{ kind: 'text', text }],
    messageId: opts.messageId,
    kind: 'message',
  };
  if (opts.contextId) message.contextId = opts.contextId;
  if (opts.taskId) message.taskId = opts.taskId;

  const params: MessageSendParams = { message };
  if (opts.blocking !== undefined || opts.acceptedOutputModes) {
    params.configuration = {};
    if (opts.blocking !== undefined) params.configuration.blocking = opts.blocking;
    if (opts.acceptedOutputModes) {
      params.configuration.acceptedOutputModes = opts.acceptedOutputModes;
    }
  }
  return params;
}

/** Wrap params in a JSON-RPC 2.0 request envelope. */
export function buildJsonRpcRequest(
  method: string,
  params: unknown,
  id: string | number,
): { jsonrpc: '2.0'; id: string | number; method: string; params: unknown } {
  return { jsonrpc: '2.0', id, method, params };
}

export interface ParsedTaskResult {
  /** Normalized task state, or `null` when the reply is a bare message (no task). */
  state: A2ATaskState | null;
  /** Concatenated text of the agent's reply / final artifacts. */
  text: string;
  /** Raw artifacts array when present. */
  artifacts: unknown[];
  /** JSON-RPC error message when the remote returned an error. */
  error: string | null;
}

/** Concatenate the text parts of a message-like object. */
function collectText(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .map((p) =>
      p && typeof p === 'object' && (p as { kind?: string }).kind === 'text'
        ? String((p as { text?: unknown }).text ?? '')
        : '',
    )
    .filter(Boolean)
    .join('');
}

/**
 * Normalize a remote agent's JSON-RPC reply into `{ state, text, artifacts,
 * error }`. Handles both shapes the A2A `message/send` result can take: a bare
 * `Message` (kind === 'message') and a `Task` (kind === 'task', carrying a
 * `status.state`, `artifacts`, and `history`). Unknown shapes collapse to an
 * empty result rather than throwing so a malformed peer cannot crash the run.
 */
export function parseTaskResult(response: unknown): ParsedTaskResult {
  const empty: ParsedTaskResult = { state: null, text: '', artifacts: [], error: null };
  if (!response || typeof response !== 'object') return empty;

  const rpc = response as Record<string, unknown>;
  if (rpc.error && typeof rpc.error === 'object') {
    const message = (rpc.error as { message?: unknown }).message;
    return { ...empty, error: typeof message === 'string' ? message : 'unknown A2A error' };
  }

  const result = (rpc.result ?? rpc) as Record<string, unknown>;

  // Bare message reply.
  if (result.kind === 'message') {
    return { state: null, text: collectText(result.parts), artifacts: [], error: null };
  }

  // Task reply.
  const status = (result.status ?? {}) as { state?: unknown };
  const state = typeof status.state === 'string' ? (status.state as A2ATaskState) : null;
  const artifacts = Array.isArray(result.artifacts) ? (result.artifacts as unknown[]) : [];
  const artifactText = artifacts.map((a) => collectText((a as { parts?: unknown }).parts)).join('\n');

  // Prefer artifact text; fall back to the last agent message in history.
  let text = artifactText;
  if (!text && Array.isArray(result.history)) {
    const history = result.history as Array<Record<string, unknown>>;
    const lastAgent = [...history].reverse().find((m) => m.role === 'agent');
    if (lastAgent) text = collectText(lastAgent.parts);
  }

  return { state, text, artifacts, error: null };
}

// --- Remote delegates ---

export interface DelegateDescriptor {
  /** Stable tool-safe id derived from the remote agent id. */
  id: string;
  /** Tool name the delegate is exposed under, e.g. `a2a_delegate_research`. */
  toolName: string;
  name: string;
  cardUrl: string;
  authScheme: A2AAuthScheme;
}

/** Slugify an id into a tool-safe token (`[a-z0-9_]`). */
export function toToolToken(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'agent';
}

/**
 * Turn a config's registered remote agents into callable delegate descriptors.
 * Returns an empty list when the node is disabled or acts as a pure server, so
 * the tool layer registers nothing in those cases. Delegates with a blank
 * `cardUrl` are dropped — they cannot be reached.
 */
export function toDelegateDescriptors(config: ResolvedA2AConfig): DelegateDescriptor[] {
  if (!config.enabled) return [];
  if (config.role === 'server') return [];
  return config.remoteAgents
    .filter((r) => r.cardUrl.trim().length > 0)
    .map((r) => ({
      id: r.id,
      toolName: `a2a_delegate_${toToolToken(r.name || r.id)}`,
      name: r.name,
      cardUrl: r.cardUrl,
      authScheme: r.authScheme,
    }));
}

/**
 * Resolve a possibly-partial agent card URL to the well-known card path. A URL
 * already ending in a `.json` file is returned untouched; a bare origin (or one
 * ending in a slash) is extended with `/.well-known/agent-card.json`.
 */
export function normalizeCardUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (/\.json($|\?)/.test(trimmed)) return trimmed;
  return joinUrl(trimmed, WELL_KNOWN_CARD_PATH);
}

/** Whether this config should serve an agent card (server / both roles, enabled). */
export function servesCard(config: ResolvedA2AConfig): boolean {
  return config.enabled && (config.role === 'server' || config.role === 'both');
}
