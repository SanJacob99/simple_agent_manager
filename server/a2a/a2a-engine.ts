import type { A2AAuthScheme, ResolvedA2AConfig } from '../../shared/agent-config';

/**
 * Agent-to-Agent (A2A) interop engine.
 *
 * The A2A protocol lets agents built on *different* frameworks discover and call
 * one another the way MCP standardized tool access. Its moving parts are an
 * **Agent Card** (a JSON capability document served at a well-known path), a
 * JSON-RPC 2.0 transport (`message/send`, `message/stream`), and a **Task**
 * lifecycle (`submitted → working → …→ completed | failed | canceled`).
 *
 * This module is the dependency-free substrate the server calls. It owns the
 * pure pieces — building this agent's card, validating a remote card, deriving
 * delegate tool descriptors, framing JSON-RPC message requests, and parsing task
 * responses — while the server owns the actual HTTP router and outbound fetches.
 *
 * The orchestration the server layer performs, once wired:
 *
 *   Server role: mount a router at `normalizeExposePath(config.exposePath)` that
 *     serves `buildAgentCard(...)` at `WELL_KNOWN_CARD_PATH` and answers
 *     `message/send` / `message/stream` JSON-RPC calls by driving a headless run.
 *   Client role: for each `config.remoteAgents`, register the descriptor from
 *     `resolveDelegateTools(...)` as a tool; when the agent calls it, fetch and
 *     `validateAgentCard(...)` the remote card, POST `buildMessageSendRequest(...)`
 *     with `buildAuthHeaders(...)`, then `parseTaskResult(...)` the reply and poll
 *     while `!isTerminalTaskState(state)` up to `config.taskTimeoutMs`.
 *
 * Wiring this into `server/index.ts` (the router), `server/tools/tool-factory.ts`
 * (the delegate tools), and `server/agents/run-coordinator.ts` (emit `a2a:task`
 * events) is the remaining integration step; the API below is the stable surface
 * that wiring targets.
 */

export const A2A_JSONRPC_VERSION = '2.0';
export const A2A_PROTOCOL_VERSION = '0.2.5';
export const A2A_MESSAGE_SEND_METHOD = 'message/send';
export const A2A_MESSAGE_STREAM_METHOD = 'message/stream';
/** Well-known relative path an A2A agent card is served at, appended to `exposePath`. */
export const WELL_KNOWN_CARD_PATH = '/.well-known/agent-card.json';

/** A2A task lifecycle states. */
export type A2ATaskState =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'canceled'
  | 'failed'
  | 'rejected'
  | 'unknown';

/** States after which no further updates arrive — the client stops polling. */
export const TERMINAL_TASK_STATES: ReadonlySet<A2ATaskState> = new Set<A2ATaskState>([
  'completed',
  'canceled',
  'failed',
  'rejected',
]);

/** Whether a task state is terminal (the client-side poll loop should stop). */
export function isTerminalTaskState(state: A2ATaskState): boolean {
  return TERMINAL_TASK_STATES.has(state);
}

/**
 * Normalize an A2A mount path: ensure a single leading slash, drop any trailing
 * slash, and collapse an empty/blank value to the conventional `/a2a`.
 */
export function normalizeExposePath(path: string): string {
  const trimmed = (path ?? '').trim();
  if (!trimmed || trimmed === '/') return '/a2a';
  const withLead = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLead.replace(/\/+$/, '');
}

/** Identity fields the card borrows from the owning agent when the node leaves them blank. */
export interface A2AAgentIdentity {
  name: string;
  description: string;
  version: string;
  /** Public base URL the remote client should POST JSON-RPC requests to. */
  url: string;
}

/** A minimal A2A Agent Card, conforming to the protocol's card schema. */
export interface A2AAgentCard {
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
  skills: { id: string; name: string; description: string; tags: string[] }[];
  securitySchemes?: Record<string, unknown>;
  security?: Record<string, unknown[]>[];
}

/**
 * Build the security scheme + requirement blocks for a published card. `none`
 * yields no blocks (an open server); the others follow the OpenAPI-style shapes
 * the A2A card schema borrows.
 */
export function buildSecuritySchemes(
  scheme: A2AAuthScheme,
): Pick<A2AAgentCard, 'securitySchemes' | 'security'> {
  switch (scheme) {
    case 'bearer':
      return {
        securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
        security: [{ bearer: [] }],
      };
    case 'apiKey':
      return {
        securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' } },
        security: [{ apiKey: [] }],
      };
    case 'oauth2':
      return {
        securitySchemes: { oauth2: { type: 'oauth2', flows: {} } },
        security: [{ oauth2: [] }],
      };
    case 'none':
    default:
      return {};
  }
}

/**
 * Build this agent's published A2A Agent Card. Falls back to the owning agent's
 * identity for any card field the node leaves blank.
 */
export function buildAgentCard(
  config: ResolvedA2AConfig,
  identity: A2AAgentIdentity,
): A2AAgentCard {
  const card: A2AAgentCard = {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name: config.agentCardName.trim() || identity.name,
    description: config.agentCardDescription.trim() || identity.description,
    url: identity.url,
    version: identity.version,
    capabilities: {
      streaming: config.advertiseStreaming,
      pushNotifications: config.advertisePushNotifications,
    },
    defaultInputModes:
      config.defaultInputModes.length > 0 ? config.defaultInputModes : ['text/plain'],
    defaultOutputModes:
      config.defaultOutputModes.length > 0 ? config.defaultOutputModes : ['text/plain'],
    skills: config.publishedSkills.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      tags: s.tags,
    })),
  };
  const sec = buildSecuritySchemes(config.serverAuth);
  if (sec.securitySchemes) card.securitySchemes = sec.securitySchemes;
  if (sec.security) card.security = sec.security;
  return card;
}

/** Result of validating a remote agent card fetched over HTTP. */
export interface AgentCardValidation {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a remote agent card before trusting it as a delegate. Checks the
 * fields the client relies on: a non-empty `name`, an http(s) `url`, a `version`
 * string, a `capabilities` object, and a well-formed `skills` array. Unknown
 * extra fields are ignored (forward-compatible with newer card schemas).
 */
export function validateAgentCard(card: unknown): AgentCardValidation {
  const errors: string[] = [];
  if (!card || typeof card !== 'object') {
    return { valid: false, errors: ['card is not an object'] };
  }
  const c = card as Record<string, unknown>;

  if (typeof c.name !== 'string' || !c.name.trim()) errors.push('missing or empty "name"');

  if (typeof c.url !== 'string' || !/^https?:\/\//i.test(c.url)) {
    errors.push('"url" must be an http(s) URL');
  }

  if (typeof c.version !== 'string' || !c.version.trim()) {
    errors.push('missing or empty "version"');
  }

  if (!c.capabilities || typeof c.capabilities !== 'object') {
    errors.push('missing "capabilities" object');
  }

  if (c.skills !== undefined) {
    if (!Array.isArray(c.skills)) {
      errors.push('"skills" must be an array');
    } else {
      c.skills.forEach((s, i) => {
        if (!s || typeof s !== 'object' || typeof (s as Record<string, unknown>).id !== 'string') {
          errors.push(`skill[${i}] missing string "id"`);
        }
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

/** HTTP header map for authenticating an outbound call to a remote agent. */
export function buildAuthHeaders(
  scheme: A2AAuthScheme,
  credential: string,
): Record<string, string> {
  const cred = (credential ?? '').trim();
  if (!cred) return {};
  switch (scheme) {
    case 'bearer':
    case 'oauth2':
      return { Authorization: `Bearer ${cred}` };
    case 'apiKey':
      return { 'X-API-Key': cred };
    case 'none':
    default:
      return {};
  }
}

/** A delegate tool descriptor derived from a registered remote agent. */
export interface A2ADelegateTool {
  /** Tool name exposed to the agent (falls back to `a2a_call_<slug>`). */
  name: string;
  description: string;
  /** Id of the remote agent this tool delegates to. */
  remoteId: string;
  cardUrl: string;
  /** JSON-Schema for the tool's arguments. */
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

/** Lowercase a name into a safe tool-name slug (`My Agent!` → `my_agent`). */
export function slugifyToolName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Derive one delegate tool descriptor per registered remote agent. Returns an
 * empty list when the client role is off or `exposeDelegateTools` is false.
 * Remotes missing a `cardUrl` are skipped (they cannot be called).
 */
export function resolveDelegateTools(config: ResolvedA2AConfig): A2ADelegateTool[] {
  const clientEnabled = config.role === 'client' || config.role === 'both';
  if (!config.enabled || !clientEnabled || !config.exposeDelegateTools) return [];

  return config.remoteAgents
    .filter((r) => r.cardUrl.trim())
    .map((r) => {
      const slug = slugifyToolName(r.name) || slugifyToolName(r.id) || 'remote';
      const name = r.toolName.trim() || `a2a_call_${slug}`;
      return {
        name,
        description: `Delegate a task to the remote A2A agent "${r.name || r.id}" and return its reply.`,
        remoteId: r.id,
        cardUrl: r.cardUrl.trim(),
        inputSchema: {
          type: 'object' as const,
          properties: {
            message: {
              type: 'string',
              description: 'The task or message to send to the remote agent.',
            },
          },
          required: ['message'],
        },
      };
    });
}

/** A JSON-RPC 2.0 `message/send` request envelope. */
export interface A2AMessageSendRequest {
  jsonrpc: string;
  id: string;
  method: string;
  params: {
    message: {
      role: 'user';
      parts: { kind: 'text'; text: string }[];
      messageId: string;
      taskId?: string;
      contextId?: string;
    };
    configuration?: { blocking?: boolean };
  };
}

/**
 * Frame a JSON-RPC `message/send` request to a remote agent. `taskId` /
 * `contextId` continue an existing task/conversation; `blocking` asks the server
 * to hold the response open until the task reaches a terminal state.
 */
export function buildMessageSendRequest(opts: {
  requestId: string;
  messageId: string;
  text: string;
  taskId?: string;
  contextId?: string;
  blocking?: boolean;
}): A2AMessageSendRequest {
  const message: A2AMessageSendRequest['params']['message'] = {
    role: 'user',
    parts: [{ kind: 'text', text: opts.text }],
    messageId: opts.messageId,
  };
  if (opts.taskId) message.taskId = opts.taskId;
  if (opts.contextId) message.contextId = opts.contextId;

  const params: A2AMessageSendRequest['params'] = { message };
  if (opts.blocking !== undefined) params.configuration = { blocking: opts.blocking };

  return {
    jsonrpc: A2A_JSONRPC_VERSION,
    id: opts.requestId,
    method: A2A_MESSAGE_SEND_METHOD,
    params,
  };
}

/** Concatenate the text of every `text` part in an A2A message. */
export function extractTextFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .map((p) => {
      if (p && typeof p === 'object') {
        const part = p as Record<string, unknown>;
        // Current spec uses `kind: 'text'`; tolerate the older `type: 'text'`.
        const isText = part.kind === 'text' || part.type === 'text';
        if (isText && typeof part.text === 'string') return part.text;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

/** Normalized outcome of a remote task, recovered from a JSON-RPC response. */
export interface A2ATaskResult {
  ok: boolean;
  state: A2ATaskState;
  /** Best-effort reply text (from the task's status message, artifacts, or a bare message). */
  text: string;
  taskId?: string;
  contextId?: string;
  error?: { code: number; message: string };
}

/**
 * Parse a remote agent's JSON-RPC response into a normalized `A2ATaskResult`.
 * Handles a JSON-RPC `error`, a `result` that is a Task (with `status.state`),
 * and a `result` that is a bare Message. Unrecognized shapes collapse to an
 * `unknown` state so the client can decide whether to keep polling.
 */
export function parseTaskResult(response: unknown): A2ATaskResult {
  if (!response || typeof response !== 'object') {
    return { ok: false, state: 'unknown', text: '', error: { code: -1, message: 'empty response' } };
  }
  const r = response as Record<string, unknown>;

  if (r.error && typeof r.error === 'object') {
    const err = r.error as Record<string, unknown>;
    return {
      ok: false,
      state: 'failed',
      text: '',
      error: {
        code: typeof err.code === 'number' ? err.code : -1,
        message: typeof err.message === 'string' ? err.message : 'remote error',
      },
    };
  }

  const result = r.result;
  if (!result || typeof result !== 'object') {
    return { ok: false, state: 'unknown', text: '', error: { code: -1, message: 'no result' } };
  }
  const res = result as Record<string, unknown>;

  // A bare Message result (no task lifecycle).
  if (res.kind === 'message' || (Array.isArray(res.parts) && !res.status)) {
    return {
      ok: true,
      state: 'completed',
      text: extractTextFromParts(res.parts),
      contextId: typeof res.contextId === 'string' ? res.contextId : undefined,
    };
  }

  // A Task result with a lifecycle state.
  const status = (res.status && typeof res.status === 'object'
    ? (res.status as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const state = normalizeTaskState(status.state);

  // Prefer the status message; fall back to the last artifact's parts.
  let text = '';
  if (status.message && typeof status.message === 'object') {
    text = extractTextFromParts((status.message as Record<string, unknown>).parts);
  }
  if (!text && Array.isArray(res.artifacts) && res.artifacts.length > 0) {
    const last = res.artifacts[res.artifacts.length - 1] as Record<string, unknown>;
    text = extractTextFromParts(last?.parts);
  }

  return {
    ok: state === 'completed',
    state,
    text,
    taskId: typeof res.id === 'string' ? res.id : undefined,
    contextId: typeof res.contextId === 'string' ? res.contextId : undefined,
  };
}

/** Coerce an arbitrary value into a known `A2ATaskState`, defaulting to `unknown`. */
export function normalizeTaskState(raw: unknown): A2ATaskState {
  const known: A2ATaskState[] = [
    'submitted',
    'working',
    'input-required',
    'completed',
    'canceled',
    'failed',
    'rejected',
  ];
  return known.includes(raw as A2ATaskState) ? (raw as A2ATaskState) : 'unknown';
}
