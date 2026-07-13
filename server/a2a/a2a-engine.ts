import type {
  ResolvedA2AConfig,
  ResolvedA2ARemoteAgent,
  A2AAuthScheme,
} from '../../shared/agent-config';

/**
 * Agent-to-Agent (A2A) interop engine.
 *
 * An A2A node gives this agent a cross-framework interop surface built on the
 * emerging Agent-to-Agent protocol: a published **agent card** describing what
 * the agent can do, **task/message envelopes** for exchanging work, and a
 * **task lifecycle** of status states. This module is the dependency-free
 * substrate the server and runtime call; it owns agent-card construction and
 * validation, message-envelope parsing, task/status construction, delegate
 * resolution, and outbound auth-header assembly. The transport (HTTP/SSE
 * mounting under `serverPath`, fetching a remote card, streaming updates) is the
 * runtime's job.
 *
 * The orchestration around this engine:
 *
 *   Server (expose this agent):
 *     1. `buildAgentCard(config, skills)` → serve at
 *        `<serverPath>/.well-known/agent-card.json`.
 *     2. On an inbound `message/send`, `parseIncomingMessage(raw)` extracts the
 *        text task; the runtime prompts the agent with it.
 *     3. `buildTask(...)` / `advanceTask(...)` track the task through
 *        `submitted → working → completed | failed`, returned to the caller.
 *
 *   Client (call a remote agent):
 *     1. `selectRemote(config, idOrName)` picks the delegate; the runtime fetches
 *        and `validateAgentCard(...)`s its card.
 *     2. `buildMessage('user', text)` + `authHeaders(...)` form the outbound
 *        `message/send`; the reply is parsed back with `parseIncomingMessage`.
 *
 * Wiring the HTTP surface and delegate tool into
 * `server/agents/run-coordinator.ts` is the remaining integration step; the API
 * below is the stable surface that wiring targets.
 */

/** A2A protocol revision this engine targets (agent-card `protocolVersion`). */
export const A2A_PROTOCOL_VERSION = '0.3.0';

/**
 * Task lifecycle states. `submitted` → `working` → a terminal state, with
 * `input-required` as an interruptible waiting state. Mirrors the A2A spec's
 * `TaskState`.
 */
export const TASK_STATES = [
  'submitted',
  'working',
  'input-required',
  'completed',
  'canceled',
  'failed',
  'rejected',
] as const;

export type TaskState = (typeof TASK_STATES)[number];

/** States after which no further work happens on a task. */
const TERMINAL_STATES: ReadonlySet<TaskState> = new Set([
  'completed',
  'canceled',
  'failed',
  'rejected',
]);

/** True once a task has reached a state the runtime will not advance from. */
export function isTerminalState(state: TaskState): boolean {
  return TERMINAL_STATES.has(state);
}

// --- Agent card ---

/** One advertised capability/skill on the agent card. */
export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

/** The published A2A agent card. Shape follows the A2A `AgentCard`. */
export interface AgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
  };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: AgentSkill[];
}

/**
 * Build the agent card advertised to remote agents. `baseUrl` is the externally
 * reachable origin the endpoint is served from (e.g. `https://host:port`); the
 * card's `url` is `baseUrl` joined with the node's `serverPath`. `skills` are
 * the agent's resolved skills/tools surfaced as A2A skills (may be empty).
 */
export function buildAgentCard(
  config: ResolvedA2AConfig,
  baseUrl: string,
  skills: AgentSkill[] = [],
): AgentCard {
  return {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name: config.agentName,
    description: config.agentDescription,
    url: joinUrl(baseUrl, config.serverPath),
    version: config.version,
    capabilities: {
      streaming: config.streaming,
      pushNotifications: false,
    },
    defaultInputModes: config.defaultInputModes.length
      ? [...config.defaultInputModes]
      : ['text'],
    defaultOutputModes: config.defaultOutputModes.length
      ? [...config.defaultOutputModes]
      : ['text'],
    skills: skills.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      tags: [...s.tags],
    })),
  };
}

/**
 * Validate a fetched remote agent card before trusting it as a delegate.
 * Returns the list of problems; an empty list means the card is usable.
 */
export function validateAgentCard(card: unknown): string[] {
  const errors: string[] = [];
  if (!card || typeof card !== 'object') {
    return ['agent card is not an object'];
  }
  const c = card as Record<string, unknown>;
  if (typeof c.name !== 'string' || c.name.trim() === '') {
    errors.push('missing name');
  }
  if (typeof c.url !== 'string' || !/^https?:\/\//i.test(c.url)) {
    errors.push('missing or non-http url');
  }
  if (typeof c.version !== 'string' || c.version.trim() === '') {
    errors.push('missing version');
  }
  if (c.capabilities !== undefined && typeof c.capabilities !== 'object') {
    errors.push('capabilities is not an object');
  }
  if (c.skills !== undefined && !Array.isArray(c.skills)) {
    errors.push('skills is not an array');
  }
  return errors;
}

// --- Messages & tasks ---

/** One part of a message. Only the `text` kind is handled today. */
export interface TextPart {
  kind: 'text';
  text: string;
}

/** An A2A message envelope. */
export interface A2AMessage {
  role: 'user' | 'agent';
  parts: TextPart[];
  messageId: string;
  taskId?: string;
  contextId?: string;
}

/** An A2A task record returned to callers. */
export interface A2ATask {
  id: string;
  contextId: string;
  status: {
    state: TaskState;
    /** Optional agent message attached to this status transition. */
    message?: A2AMessage;
  };
  history: A2AMessage[];
}

/** Build a text message envelope. `id`s are supplied by the caller (no clock). */
export function buildMessage(
  role: 'user' | 'agent',
  text: string,
  ids: { messageId: string; taskId?: string; contextId?: string },
): A2AMessage {
  const msg: A2AMessage = {
    role,
    parts: [{ kind: 'text', text }],
    messageId: ids.messageId,
  };
  if (ids.taskId) msg.taskId = ids.taskId;
  if (ids.contextId) msg.contextId = ids.contextId;
  return msg;
}

/**
 * Concatenate the text of every `text` part in a message. Non-text parts are
 * ignored. Returns an empty string when there is no text content.
 */
export function extractText(message: A2AMessage): string {
  return message.parts
    .filter((p): p is TextPart => p?.kind === 'text' && typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
    .trim();
}

/**
 * Parse an inbound `message/send` payload into a normalized `A2AMessage`.
 * Tolerates the wrapped `{ message: {...} }` form and a bare message object.
 * Returns `{ error }` when no usable text message can be recovered so the
 * server can reply with a protocol error instead of throwing.
 */
export function parseIncomingMessage(
  raw: unknown,
): { message: A2AMessage } | { error: string } {
  if (!raw || typeof raw !== 'object') {
    return { error: 'payload is not an object' };
  }
  const outer = raw as Record<string, unknown>;
  const candidate =
    outer.message && typeof outer.message === 'object'
      ? (outer.message as Record<string, unknown>)
      : outer;

  const role = candidate.role === 'agent' ? 'agent' : 'user';
  const partsRaw = Array.isArray(candidate.parts) ? candidate.parts : [];
  const parts: TextPart[] = partsRaw
    .filter(
      (p): p is Record<string, unknown> =>
        !!p && typeof p === 'object' && (p as Record<string, unknown>).kind === 'text',
    )
    .map((p) => ({ kind: 'text' as const, text: String(p.text ?? '') }));

  if (parts.length === 0) {
    return { error: 'message has no text parts' };
  }

  const messageId =
    typeof candidate.messageId === 'string' && candidate.messageId
      ? candidate.messageId
      : 'msg-unknown';

  const message: A2AMessage = { role, parts, messageId };
  if (typeof candidate.taskId === 'string') message.taskId = candidate.taskId;
  if (typeof candidate.contextId === 'string') message.contextId = candidate.contextId;
  return { message };
}

/**
 * Open a new task for an inbound request. Seeds the history with the caller's
 * message and starts in `submitted`. `ids` are supplied by the caller.
 */
export function buildTask(
  request: A2AMessage,
  ids: { taskId: string; contextId: string },
): A2ATask {
  return {
    id: ids.taskId,
    contextId: ids.contextId,
    status: { state: 'submitted' },
    history: [request],
  };
}

/**
 * Return a copy of `task` advanced to `state`, optionally attaching an agent
 * message (appended to history and to the status). Rejects an advance out of a
 * terminal state by returning the task unchanged.
 */
export function advanceTask(
  task: A2ATask,
  state: TaskState,
  agentMessage?: A2AMessage,
): A2ATask {
  if (isTerminalState(task.status.state)) return task;
  return {
    ...task,
    status: { state, ...(agentMessage ? { message: agentMessage } : {}) },
    history: agentMessage ? [...task.history, agentMessage] : task.history,
  };
}

// --- Delegates (client side) ---

/**
 * Resolve a remote delegate by id or (case-insensitive) name, considering only
 * enabled remotes. Returns `null` when nothing matches.
 */
export function selectRemote(
  config: ResolvedA2AConfig,
  idOrName: string,
): ResolvedA2ARemoteAgent | null {
  const needle = idOrName.trim().toLowerCase();
  const enabled = config.remotes.filter((r) => r.enabled);
  return (
    enabled.find((r) => r.id.toLowerCase() === needle) ??
    enabled.find((r) => r.name.toLowerCase() === needle) ??
    null
  );
}

/** The enabled remotes offered as delegates, in configuration order. */
export function listDelegates(config: ResolvedA2AConfig): ResolvedA2ARemoteAgent[] {
  return config.remotes.filter((r) => r.enabled);
}

/**
 * Build the outbound auth headers for a delegate call from the configured
 * scheme and a credential. An empty credential (or `none`) yields no headers.
 */
export function authHeaders(
  scheme: A2AAuthScheme,
  credential: string,
): Record<string, string> {
  const token = credential.trim();
  if (scheme === 'none' || token === '') return {};
  if (scheme === 'bearer') return { Authorization: `Bearer ${token}` };
  return { 'X-API-Key': token };
}

/** Join an origin and a path into a single URL without doubling the slash. */
function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}
