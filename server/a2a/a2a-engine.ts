import type {
  ResolvedA2AConfig,
  A2ARemoteAgent,
  A2ASkillAdvertisement,
} from '../../shared/agent-config';

/**
 * Agent-to-Agent (A2A) interop engine.
 *
 * An A2A node lets this agent speak the emerging A2A protocol: publish an agent
 * card and accept remote tasks (server side), and/or register remote A2A agents
 * as callable delegates (client side). This module is the dependency-free
 * substrate the `server/a2a/` route layer builds on — it owns agent-card
 * construction, the task-state machine, incoming JSON-RPC message parsing,
 * delegate selection, and envelope helpers, while the route layer owns the HTTP
 * transport, the actual model runs, and streaming.
 *
 * Wiring this into the backend (mount an A2A router at `server.path`, drive a
 * headless run per accepted task, register remotes as delegate tools, and emit
 * task events) is the remaining integration step; the API below is the stable
 * surface that wiring targets.
 *
 * Shapes follow the A2A specification (agent cards, message/send, tasks/get,
 * tasks/cancel, JSON-RPC 2.0 framing). Kept intentionally free of any transport
 * or SDK dependency so it can be unit-tested in isolation.
 */

/** Protocol version advertised in the agent card. */
export const A2A_PROTOCOL_VERSION = '0.3.0';

/** Well-known path an A2A agent card is served from, relative to the mount path. */
export const AGENT_CARD_WELL_KNOWN = '/.well-known/agent-card.json';

/**
 * A2A task lifecycle states. `submitted → working` then either a terminal state
 * (`completed`, `canceled`, `failed`, `rejected`) or `input-required` when the
 * agent needs more from the caller before it can continue.
 */
export type A2ATaskState =
  | 'submitted'
  | 'working'
  | 'input-required'
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

/**
 * Allowed A2A task-state transitions. A terminal state has no outgoing edges.
 * `input-required` can resume back to `working` when the caller supplies more.
 */
const TRANSITIONS: Readonly<Record<A2ATaskState, ReadonlyArray<A2ATaskState>>> = {
  submitted: ['working', 'input-required', 'completed', 'canceled', 'failed', 'rejected'],
  working: ['input-required', 'completed', 'canceled', 'failed'],
  'input-required': ['working', 'canceled', 'failed'],
  completed: [],
  canceled: [],
  failed: [],
  rejected: [],
};

/** Whether a task state is terminal (no further work happens). */
export function isTerminalState(state: A2ATaskState): boolean {
  return TERMINAL_STATES.has(state);
}

/** Whether the state machine permits a `from → to` task transition. */
export function canTransition(from: A2ATaskState, to: A2ATaskState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

// --- Agent card ---

export interface A2AAgentCardSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

export interface A2AAgentCardCapabilities {
  streaming: boolean;
  pushNotifications: boolean;
  stateTransitionHistory: boolean;
}

export interface A2AAgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  version: string;
  url: string;
  capabilities: A2AAgentCardCapabilities;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  /** Present only when the server requires a bearer token. */
  securitySchemes?: Record<string, { type: string; scheme: string }>;
  skills: A2AAgentCardSkill[];
}

/**
 * Build the A2A agent card the server side publishes at
 * `${baseUrl}${AGENT_CARD_WELL_KNOWN}`. `baseUrl` is the externally reachable
 * origin the backend is served from; the card's `url` is that origin joined with
 * the configured mount path.
 */
export function buildAgentCard(config: ResolvedA2AConfig, baseUrl: string): A2AAgentCard {
  const server = config.server;
  const card: A2AAgentCard = {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name: server.agentName,
    description: server.agentDescription,
    version: server.agentVersion,
    url: joinUrl(baseUrl, server.path),
    capabilities: {
      streaming: server.streaming,
      pushNotifications: server.pushNotifications,
      stateTransitionHistory: false,
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: server.skills.map(toCardSkill),
  };
  if (server.requireAuth) {
    card.securitySchemes = { bearer: { type: 'http', scheme: 'bearer' } };
  }
  return card;
}

function toCardSkill(s: A2ASkillAdvertisement): A2AAgentCardSkill {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    tags: s.tags,
  };
}

/** Join an origin and a path with exactly one slash between them. */
export function joinUrl(baseUrl: string, path: string): string {
  const left = baseUrl.replace(/\/+$/, '');
  const right = path.replace(/^\/+/, '');
  return right ? `${left}/${right}` : left;
}

// --- JSON-RPC message envelopes ---

export interface A2AMessagePart {
  kind: 'text';
  text: string;
}

export interface A2AMessage {
  role: 'user' | 'agent';
  parts: A2AMessagePart[];
  messageId: string;
  taskId?: string;
  contextId?: string;
}

/** JSON-RPC error codes: the standard set plus A2A's task-specific extensions. */
export const A2A_ERROR = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  taskNotFound: -32001,
  taskNotCancelable: -32002,
  unsupportedOperation: -32004,
} as const;

export interface A2AJsonRpcError {
  jsonrpc: '2.0';
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

export interface A2AJsonRpcResult {
  jsonrpc: '2.0';
  id: string | number | null;
  result: unknown;
}

export function buildJsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): A2AJsonRpcError {
  const error: A2AJsonRpcError['error'] = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id, error };
}

export function buildJsonRpcResult(id: string | number | null, result: unknown): A2AJsonRpcResult {
  return { jsonrpc: '2.0', id, result };
}

/** A2A JSON-RPC methods this agent understands on the server side. */
export const A2A_METHODS = ['message/send', 'message/stream', 'tasks/get', 'tasks/cancel'] as const;
export type A2AMethod = (typeof A2A_METHODS)[number];

export function isKnownMethod(method: string): method is A2AMethod {
  return (A2A_METHODS as readonly string[]).includes(method);
}

export type ParsedRequest =
  | { ok: true; id: string | number | null; method: A2AMethod; params: Record<string, unknown> }
  | { ok: false; id: string | number | null; code: number; message: string };

/**
 * Validate a raw JSON-RPC request body against the A2A envelope: `jsonrpc:
 * "2.0"`, a known method, and an object `params`. Streaming is refused when the
 * server does not advertise it. Returns a discriminated result so the route
 * layer can turn a failure straight into `buildJsonRpcError`.
 */
export function parseRpcRequest(raw: unknown, config: ResolvedA2AConfig): ParsedRequest {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, id: null, code: A2A_ERROR.invalidRequest, message: 'Request body must be a JSON object' };
  }
  const body = raw as Record<string, unknown>;
  const id = (typeof body.id === 'string' || typeof body.id === 'number' ? body.id : null) as
    | string
    | number
    | null;

  if (body.jsonrpc !== '2.0') {
    return { ok: false, id, code: A2A_ERROR.invalidRequest, message: 'jsonrpc must be "2.0"' };
  }
  if (typeof body.method !== 'string' || !isKnownMethod(body.method)) {
    return { ok: false, id, code: A2A_ERROR.methodNotFound, message: `Unknown method: ${String(body.method)}` };
  }
  if (body.method === 'message/stream' && !config.server.streaming) {
    return {
      ok: false,
      id,
      code: A2A_ERROR.unsupportedOperation,
      message: 'This agent does not advertise streaming',
    };
  }
  const params =
    body.params && typeof body.params === 'object' ? (body.params as Record<string, unknown>) : {};
  return { ok: true, id, method: body.method, params };
}

/**
 * Extract and normalize an A2A `message` object from `message/send` params.
 * Requires a `user` role and at least one non-empty text part. Returns `null`
 * when the message is missing or malformed (the caller replies invalidParams).
 */
export function parseIncomingMessage(params: Record<string, unknown>): A2AMessage | null {
  const message = params.message;
  if (!message || typeof message !== 'object') return null;
  const m = message as Record<string, unknown>;
  if (m.role !== 'user') return null;
  if (!Array.isArray(m.parts)) return null;

  const parts: A2AMessagePart[] = [];
  for (const part of m.parts) {
    if (part && typeof part === 'object') {
      const p = part as Record<string, unknown>;
      if (p.kind === 'text' && typeof p.text === 'string') {
        parts.push({ kind: 'text', text: p.text });
      }
    }
  }
  if (parts.length === 0) return null;

  const out: A2AMessage = {
    role: 'user',
    parts,
    messageId: typeof m.messageId === 'string' && m.messageId ? m.messageId : '',
  };
  if (typeof m.taskId === 'string') out.taskId = m.taskId;
  if (typeof m.contextId === 'string') out.contextId = m.contextId;
  return out;
}

/** Flatten a message's text parts into a single prompt string for a headless run. */
export function messageToPrompt(message: A2AMessage): string {
  return message.parts
    .filter((p) => p.kind === 'text')
    .map((p) => p.text)
    .join('\n')
    .trim();
}

// --- Task envelopes ---

export interface A2ATaskStatus {
  state: A2ATaskState;
  message?: A2AMessage;
}

export interface A2ATask {
  id: string;
  contextId: string;
  status: A2ATaskStatus;
  /** Result messages appended by the agent, newest last. */
  history: A2AMessage[];
}

/**
 * Build the initial task envelope for a freshly accepted request. The task
 * starts in `submitted`; the route layer advances it via `advanceTask` as the
 * headless run progresses.
 */
export function buildTask(taskId: string, contextId: string, incoming: A2AMessage): A2ATask {
  return {
    id: taskId,
    contextId,
    status: { state: 'submitted' },
    history: [incoming],
  };
}

/**
 * Advance a task to `state`, optionally attaching an agent message. Rejects
 * transitions the state machine forbids so a caller cannot, e.g., re-open a
 * completed task. Returns the same reference on success (mutated) or `null` when
 * the transition is illegal.
 */
export function advanceTask(
  task: A2ATask,
  state: A2ATaskState,
  agentMessage?: A2AMessage,
): A2ATask | null {
  if (!canTransition(task.status.state, state)) return null;
  task.status = agentMessage ? { state, message: agentMessage } : { state };
  if (agentMessage) task.history.push(agentMessage);
  return task;
}

/** Build an `agent`-role text message for a task result. */
export function buildAgentMessage(messageId: string, text: string, taskId: string, contextId: string): A2AMessage {
  return {
    role: 'agent',
    parts: [{ kind: 'text', text }],
    messageId,
    taskId,
    contextId,
  };
}

// --- Client-side delegate selection ---

export interface DelegateQuery {
  /** Match a specific remote by id. */
  agentId?: string;
  /** Case-insensitive substring matched against a remote's name. */
  name?: string;
  /** Case-insensitive substring matched against a remote's description. */
  capability?: string;
}

/**
 * Choose a registered remote A2A agent to delegate a task to. An explicit
 * `agentId` wins; otherwise the first remote whose name or description matches
 * the query is returned. Returns `null` when nothing matches or the client side
 * is disabled — the caller then applies the `onError` policy.
 */
export function selectDelegate(config: ResolvedA2AConfig, query: DelegateQuery): A2ARemoteAgent | null {
  if (!config.enabled) return null;
  if (config.mode !== 'client' && config.mode !== 'both') return null;
  const remotes = config.client.remotes;

  if (query.agentId) {
    return remotes.find((r) => r.id === query.agentId) ?? null;
  }
  const name = query.name?.toLowerCase();
  const capability = query.capability?.toLowerCase();
  if (!name && !capability) return remotes[0] ?? null;

  return (
    remotes.find((r) => {
      const nameHit = name ? r.name.toLowerCase().includes(name) : false;
      const capHit = capability ? r.description.toLowerCase().includes(capability) : false;
      return nameHit || capHit;
    }) ?? null
  );
}

/**
 * Build the `message/send` JSON-RPC request this agent sends to a remote A2A
 * delegate. `messageId` is supplied by the caller (which owns id generation).
 */
export function buildDelegateRequest(
  messageId: string,
  text: string,
  requestId: string | number,
): { jsonrpc: '2.0'; id: string | number; method: 'message/send'; params: { message: A2AMessage } } {
  return {
    jsonrpc: '2.0',
    id: requestId,
    method: 'message/send',
    params: {
      message: {
        role: 'user',
        parts: [{ kind: 'text', text }],
        messageId,
      },
    },
  };
}

/**
 * The effective timeout for a remote call: the remote may not override, so this
 * is simply the configured default, floored at a sane minimum so a
 * mis-configured `0` does not abort every call instantly.
 */
export function effectiveTimeoutMs(config: ResolvedA2AConfig): number {
  const t = config.client.defaultTimeoutMs;
  return Number.isFinite(t) && t > 0 ? t : 30000;
}
