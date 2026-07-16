import type {
  ResolvedA2AConfig,
  A2AAuthScheme,
  A2ARemoteAgent,
  A2ATransport,
} from '../../shared/agent-config';

/**
 * Agent-to-Agent (A2A) interop engine.
 *
 * An A2A node gives an agent a cross-framework interop surface: it can publish
 * an Agent Card so remote clients can discover and task it (server role), and it
 * can register remote A2A agents as callable delegates (client role). This
 * module is the dependency-free substrate the runtime calls; it owns Agent Card
 * construction/validation, the task-state machine, JSON-RPC request/response
 * shaping, and turning a registered remote agent into a delegate tool spec,
 * while the runtime owns the actual HTTP/gRPC transport and model calls.
 *
 * The orchestration the A2A server (`server/a2a/`) performs:
 *
 *   1. On startup, if `role` includes server and `exposeAgentCard` is set, serve
 *      `buildAgentCard(config)` at `config.wellKnownPath`.
 *   2. On an inbound `message/send` (or `message/stream`), create a task, run it
 *      through the same headless run path the cron scheduler uses, and report
 *      state transitions validated by `canTransition(...)`.
 *   3. For client role, `remoteAgentToolSpec(...)` exposes each registered remote
 *      agent as a tool; a call builds a `buildMessageSendRequest(...)`, POSTs it,
 *      and interprets the reply with `parseTaskResult(...)`.
 *
 * Wiring the transport, task store, and streaming into `server/a2a/` and the
 * run-coordinator is the remaining integration step; the API below is the stable
 * surface that wiring targets.
 */

// --- Agent Card ---

/** A skill advertised on an Agent Card (A2A `AgentSkill`). */
export interface A2AAgentCardSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

/** Advertised transport binding on an Agent Card interface entry. */
export interface A2AAgentInterface {
  transport: string;
  url: string;
}

/**
 * A2A Agent Card — the public metadata document a server agent publishes at its
 * well-known path so remote clients can discover and task it. Shape follows the
 * A2A `AgentCard` object.
 */
export interface A2AAgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  /** Primary endpoint URL for the preferred transport. */
  url: string;
  /** Preferred transport for `url`. */
  preferredTransport: string;
  /** Additional transport bindings, if advertised. */
  additionalInterfaces: A2AAgentInterface[];
  version: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
  };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: A2AAgentCardSkill[];
  /** Named security schemes, keyed by scheme name. Absent when auth is `none`. */
  securitySchemes?: Record<string, Record<string, unknown>>;
}

/** Map a config transport to its A2A transport identifier. */
export function transportLabel(transport: A2ATransport): string {
  switch (transport) {
    case 'jsonrpc':
      return 'JSONRPC';
    case 'grpc':
      return 'GRPC';
    case 'rest':
      return 'HTTP+JSON';
  }
}

/**
 * Build the security-schemes map advertised on the card for a given scheme.
 * Returns `undefined` for `none` so the field is omitted entirely.
 */
export function buildSecuritySchemes(
  scheme: A2AAuthScheme,
): Record<string, Record<string, unknown>> | undefined {
  switch (scheme) {
    case 'none':
      return undefined;
    case 'apiKey':
      return { apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' } };
    case 'bearer':
      return { bearer: { type: 'http', scheme: 'bearer' } };
    case 'oauth2':
      return { oauth2: { type: 'oauth2', flows: {} } };
  }
}

/**
 * Build the Agent Card this agent publishes, from its resolved A2A config.
 * `agentName` / `agentVersion` are the agent's own identity, used as fallbacks
 * when the card fields are left blank.
 */
export function buildAgentCard(
  config: ResolvedA2AConfig,
  agentName = 'Agent',
  agentVersion = '0.1.0',
): A2AAgentCard {
  const base = config.serverUrl.replace(/\/+$/, '');
  const schemes = buildSecuritySchemes(config.authScheme);
  const card: A2AAgentCard = {
    protocolVersion: config.protocolVersion,
    name: config.cardName.trim() || agentName,
    description: config.cardDescription.trim(),
    url: base,
    preferredTransport: transportLabel(config.transport),
    additionalInterfaces: [],
    version: agentVersion,
    capabilities: {
      streaming: config.streaming,
      pushNotifications: config.pushNotifications,
    },
    defaultInputModes: config.inputModes.length ? [...config.inputModes] : ['text/plain'],
    defaultOutputModes: config.outputModes.length ? [...config.outputModes] : ['text/plain'],
    skills: config.advertisedSkills.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      tags: [...s.tags],
    })),
  };
  if (schemes) card.securitySchemes = schemes;
  return card;
}

/** Resolve the absolute URL an Agent Card is served from. */
export function agentCardUrl(config: ResolvedA2AConfig): string {
  const base = config.serverUrl.replace(/\/+$/, '');
  const path = config.wellKnownPath.startsWith('/')
    ? config.wellKnownPath
    : `/${config.wellKnownPath}`;
  return `${base}${path}`;
}

/**
 * Validate an arbitrary value parsed from a remote agent's well-known endpoint
 * as an Agent Card. Returns the narrowed card on success, or the list of missing
 * / malformed fields so the caller can surface a useful discovery error.
 */
export function validateAgentCard(
  value: unknown,
): { ok: true; card: A2AAgentCard } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!value || typeof value !== 'object') {
    return { ok: false, errors: ['card is not an object'] };
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.name !== 'string' || !obj.name.trim()) errors.push('missing name');
  if (typeof obj.url !== 'string' || !obj.url.trim()) errors.push('missing url');
  if (typeof obj.version !== 'string' || !obj.version.trim()) errors.push('missing version');
  if (!Array.isArray(obj.skills)) errors.push('missing skills array');
  if (errors.length) return { ok: false, errors };

  const skills = (obj.skills as unknown[]).flatMap((s) => {
    if (!s || typeof s !== 'object') return [];
    const so = s as Record<string, unknown>;
    return [
      {
        id: typeof so.id === 'string' ? so.id : '',
        name: typeof so.name === 'string' ? so.name : '',
        description: typeof so.description === 'string' ? so.description : '',
        tags: Array.isArray(so.tags) ? so.tags.filter((t): t is string => typeof t === 'string') : [],
      },
    ];
  });

  const caps = (obj.capabilities ?? {}) as Record<string, unknown>;
  const card: A2AAgentCard = {
    protocolVersion: typeof obj.protocolVersion === 'string' ? obj.protocolVersion : '0.3.0',
    name: obj.name as string,
    description: typeof obj.description === 'string' ? obj.description : '',
    url: obj.url as string,
    preferredTransport:
      typeof obj.preferredTransport === 'string' ? obj.preferredTransport : 'JSONRPC',
    additionalInterfaces: [],
    version: obj.version as string,
    capabilities: {
      streaming: caps.streaming === true,
      pushNotifications: caps.pushNotifications === true,
    },
    defaultInputModes: Array.isArray(obj.defaultInputModes)
      ? (obj.defaultInputModes as unknown[]).filter((m): m is string => typeof m === 'string')
      : ['text/plain'],
    defaultOutputModes: Array.isArray(obj.defaultOutputModes)
      ? (obj.defaultOutputModes as unknown[]).filter((m): m is string => typeof m === 'string')
      : ['text/plain'],
    skills,
  };
  return { ok: true, card };
}

// --- Task lifecycle ---

/**
 * A2A task states. Terminal states end the task; non-terminal states may
 * transition further. `input-required` is non-terminal — the agent is waiting on
 * the client for more input.
 */
export const A2A_TASK_STATES = [
  'submitted',
  'working',
  'input-required',
  'auth-required',
  'completed',
  'canceled',
  'failed',
  'rejected',
] as const;

export type A2ATaskState = (typeof A2A_TASK_STATES)[number];

const TERMINAL_STATES: ReadonlySet<A2ATaskState> = new Set([
  'completed',
  'canceled',
  'failed',
  'rejected',
]);

/** Whether a task state is terminal (no further transitions allowed). */
export function isTerminalTaskState(state: A2ATaskState): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * Whether a task may transition from `from` to `to`. A terminal state can never
 * transition; otherwise any non-terminal → any state is allowed, matching the
 * A2A lifecycle where a working task can complete, fail, be canceled, or pause
 * for input/auth.
 */
export function canTransition(from: A2ATaskState, to: A2ATaskState): boolean {
  if (from === to) return false;
  if (isTerminalTaskState(from)) return false;
  return A2A_TASK_STATES.includes(to);
}

// --- JSON-RPC message shaping ---

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params: Record<string, unknown>;
}

/**
 * Build a JSON-RPC 2.0 `message/send` request that hands a text task to a remote
 * A2A agent. `requestId` is supplied by the caller so this stays pure/testable;
 * `messageId` identifies the message within the task.
 */
export function buildMessageSendRequest(opts: {
  requestId: string;
  messageId: string;
  text: string;
  taskId?: string;
  contextId?: string;
}): JsonRpcRequest {
  const message: Record<string, unknown> = {
    role: 'user',
    parts: [{ kind: 'text', text: opts.text }],
    messageId: opts.messageId,
    kind: 'message',
  };
  if (opts.taskId) message.taskId = opts.taskId;
  if (opts.contextId) message.contextId = opts.contextId;
  return {
    jsonrpc: '2.0',
    id: opts.requestId,
    method: 'message/send',
    params: { message },
  };
}

export interface A2ATaskResult {
  /** Task state, if the reply carried a task. `null` when it could not be read. */
  state: A2ATaskState | null;
  /** Concatenated text parts from the final message / task artifacts. */
  text: string;
  /** JSON-RPC error message, if the reply was an error. */
  error?: string;
}

/**
 * Interpret a JSON-RPC reply to `message/send`. Handles both a bare `Message`
 * result and a `Task` result (reading `status.state` and gathering text from the
 * status message and any artifacts). A JSON-RPC `error` object is surfaced in
 * `error` with a null state.
 */
export function parseTaskResult(response: unknown): A2ATaskResult {
  if (!response || typeof response !== 'object') {
    return { state: null, text: '', error: 'empty response' };
  }
  const obj = response as Record<string, unknown>;
  if (obj.error && typeof obj.error === 'object') {
    const err = obj.error as Record<string, unknown>;
    const msg = typeof err.message === 'string' ? err.message : 'unknown error';
    return { state: null, text: '', error: msg };
  }
  const result = obj.result;
  if (!result || typeof result !== 'object') {
    return { state: null, text: '', error: 'missing result' };
  }
  const r = result as Record<string, unknown>;

  // A bare Message result.
  if (r.kind === 'message') {
    return { state: 'completed', text: gatherText(r.parts) };
  }

  // A Task result.
  const status = (r.status ?? {}) as Record<string, unknown>;
  const rawState = typeof status.state === 'string' ? status.state : null;
  const state = rawState && (A2A_TASK_STATES as readonly string[]).includes(rawState)
    ? (rawState as A2ATaskState)
    : null;

  let text = '';
  const statusMessage = status.message as Record<string, unknown> | undefined;
  if (statusMessage) text += gatherText(statusMessage.parts);
  if (Array.isArray(r.artifacts)) {
    for (const artifact of r.artifacts as unknown[]) {
      if (artifact && typeof artifact === 'object') {
        text += gatherText((artifact as Record<string, unknown>).parts);
      }
    }
  }
  return { state, text: text.trim() };
}

/** Concatenate the text of any `text` parts in a message/artifact parts array. */
function gatherText(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .flatMap((p) => {
      if (!p || typeof p !== 'object') return [];
      const po = p as Record<string, unknown>;
      if (po.kind === 'text' && typeof po.text === 'string') return [po.text];
      return [];
    })
    .join('');
}

// --- Remote agent delegation ---

export interface A2ADelegateToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Sanitize a name into a tool-safe identifier (`a2a__<slug>`). */
export function delegateToolName(remote: A2ARemoteAgent): string {
  const base = (remote.name || remote.id || 'agent')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return `a2a__${base || 'agent'}`;
}

/**
 * Turn a registered remote A2A agent into a callable delegate tool spec the
 * local agent can invoke. The runtime binds the returned spec to a handler that
 * fetches the remote card, sends the task via `buildMessageSendRequest`, and
 * returns `parseTaskResult(...).text`.
 */
export function remoteAgentToolSpec(remote: A2ARemoteAgent): A2ADelegateToolSpec {
  const name = remote.name || remote.id;
  return {
    name: delegateToolName(remote),
    description:
      `Delegate a sub-task to the remote A2A agent "${name}" ` +
      `(${remote.cardUrl}, via ${remote.transport}). ` +
      'Pass a self-contained task description; returns the remote agent\'s reply.',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'The self-contained task to delegate to the remote agent.',
        },
      },
      required: ['task'],
      additionalProperties: false,
    },
  };
}

/** The remote agents that should be exposed as delegate tools (client role). */
export function activeRemoteDelegates(config: ResolvedA2AConfig): A2ARemoteAgent[] {
  if (!config.enabled) return [];
  if (config.role === 'server') return [];
  return config.remoteAgents.filter((r) => r.enabledAsTool && r.cardUrl.trim());
}

/** Whether this config should publish an Agent Card (server role). */
export function shouldPublishCard(config: ResolvedA2AConfig): boolean {
  return config.enabled && config.role !== 'client' && config.exposeAgentCard;
}
