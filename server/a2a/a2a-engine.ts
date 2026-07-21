import type { ResolvedA2AConfig } from '../../shared/agent-config';

/**
 * Agent-to-Agent (A2A) interop engine.
 *
 * The A2A protocol (agent cards, task/message envelopes, streaming task-state
 * updates) is the emerging lingua franca for cross-framework agent interop,
 * much as MCP standardized tools. An A2A node turns this agent into an A2A
 * *server* (it publishes an agent card and accepts inbound tasks) and/or an
 * A2A *client* (it registers remote A2A agents as callable delegates).
 *
 * This module is the dependency-free substrate the server calls. It owns:
 *
 *   - Agent-card composition (`buildAgentCard`) from the resolved config plus
 *     the agent's own name / description / version / skills.
 *   - The task-state machine (`isTerminalTaskState`, `canTransition`) that a
 *     server route drives as it processes an inbound task.
 *   - Inbound validation and auth (`validateInboundMessage`, `createInboundTask`,
 *     `authorizeInbound`) so a route can reject malformed or unauthenticated
 *     requests before touching the runtime.
 *   - Delegate-tool synthesis (`buildDelegateTools`) so the tool factory can
 *     register one callable tool per enabled remote agent, and remote-card
 *     parsing (`parseRemoteCard`) for the client side.
 *
 * Wiring these into an Express router under `server/a2a/` (serve the card at
 * `config.cardPath`, accept `message/send` + `message/stream`, register the
 * delegate tools through `server/tools/tool-factory.ts`, and drive the state
 * machine around `runtime.prompt()`) is the remaining integration step; the API
 * below is the stable surface that wiring targets.
 */

/**
 * A2A protocol version this scaffold targets. Tracks the public A2A spec; the
 * card advertises it as `protocolVersion` so remote clients can negotiate.
 */
export const A2A_PROTOCOL_VERSION = '0.3.0';

/**
 * Task lifecycle states, per the A2A task model. `submitted` and `working` are
 * in-flight, `input-required` / `auth-required` pause for the caller, and the
 * remaining four are terminal.
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

const TERMINAL_STATES: ReadonlySet<A2ATaskState> = new Set<A2ATaskState>([
  'completed',
  'canceled',
  'failed',
  'rejected',
]);

/** Whether a task state is terminal (no further transitions are allowed). */
export function isTerminalTaskState(state: A2ATaskState): boolean {
  return TERMINAL_STATES.has(state);
}

const LEGAL_TRANSITIONS: Record<A2ATaskState, ReadonlySet<A2ATaskState>> = {
  submitted: new Set(['working', 'canceled', 'rejected', 'auth-required']),
  working: new Set([
    'input-required',
    'auth-required',
    'completed',
    'canceled',
    'failed',
  ]),
  'input-required': new Set(['working', 'canceled', 'failed']),
  'auth-required': new Set(['submitted', 'working', 'canceled', 'rejected']),
  completed: new Set(),
  canceled: new Set(),
  failed: new Set(),
  rejected: new Set(),
};

/**
 * Whether a task may move `from` -> `to`. Terminal states have no outgoing
 * transitions. A no-op self-transition is not legal (the caller should skip
 * emitting an update when the state is unchanged).
 */
export function canTransition(from: A2ATaskState, to: A2ATaskState): boolean {
  return LEGAL_TRANSITIONS[from]?.has(to) ?? false;
}

/**
 * Normalize a list of MIME modes: trim, drop blanks, dedupe (order-preserving).
 * Falls back to `fallback` when nothing survives so a card never advertises an
 * empty input/output mode list.
 */
export function normalizeModes(modes: string[], fallback: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of modes) {
    const m = raw.trim();
    if (m && !seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
  }
  return out.length > 0 ? out : [...fallback];
}

/** A skill entry as advertised on the agent card. */
export interface A2ACardSkill {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  examples?: string[];
}

/** Agent identity supplied by the runtime when composing a card. */
export interface A2AAgentMeta {
  /** Agent name; used when the node leaves `serverName` blank. */
  name: string;
  /** Agent description; used when the node leaves `serverDescription` blank. */
  description: string;
  /** Serialized agent version (e.g. the `AgentConfig.version`). */
  version: string;
  /** Absolute base URL this agent is reachable at. */
  url: string;
  /** Skills to advertise; typically derived from the agent's skills/tools. */
  skills?: A2ACardSkill[];
}

/** A2A agent card (the JSON served at `config.cardPath`). */
export interface A2AAgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransitionHistory: boolean;
  };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: A2ACardSkill[];
  securitySchemes?: Record<string, { type: string; scheme: string }>;
  security?: Array<Record<string, string[]>>;
}

/**
 * Compose the A2A agent card from the resolved node config and the agent's own
 * identity. `serverName` / `serverDescription` override the agent's name /
 * description when set; blank falls back to the agent. When `requireAuth` is on,
 * a bearer security scheme is advertised so clients know to authenticate.
 */
export function buildAgentCard(
  config: ResolvedA2AConfig,
  meta: A2AAgentMeta,
): A2AAgentCard {
  const card: A2AAgentCard = {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name: config.serverName.trim() || meta.name,
    description: config.serverDescription.trim() || meta.description,
    url: meta.url,
    version: meta.version,
    capabilities: {
      streaming: config.streaming,
      pushNotifications: config.pushNotifications,
      stateTransitionHistory: config.stateTransitionHistory,
    },
    defaultInputModes: normalizeModes(config.defaultInputModes, ['text/plain']),
    defaultOutputModes: normalizeModes(config.defaultOutputModes, ['text/plain']),
    skills: meta.skills ?? [],
  };

  if (config.requireAuth) {
    card.securitySchemes = {
      bearer: { type: 'http', scheme: 'bearer' },
    };
    card.security = [{ bearer: [] }];
  }

  return card;
}

/** A message part in an inbound A2A message. */
export type A2APartKind = 'text' | 'file' | 'data';

export interface A2AMessagePart {
  kind: A2APartKind;
  /** Present for `kind: 'text'`. */
  text?: string;
  /** Present for `kind: 'file'` / `'data'` — opaque to this scaffold. */
  data?: unknown;
}

export interface A2AMessage {
  role: 'user' | 'agent';
  parts: A2AMessagePart[];
}

/** Result of validating an inbound envelope: either the value, or an error. */
export type A2AValidation<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Validate and normalize an inbound A2A message (the `message` field of a
 * `message/send` request). Requires a `user`/`agent` role and a non-empty
 * `parts` array; unknown part kinds are rejected. Returns a normalized message
 * or a human-readable error the route can surface as an invalid-params fault.
 */
export function validateInboundMessage(raw: unknown): A2AValidation<A2AMessage> {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'message must be an object' };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.role !== 'user' && obj.role !== 'agent') {
    return { ok: false, error: "message.role must be 'user' or 'agent'" };
  }
  if (!Array.isArray(obj.parts) || obj.parts.length === 0) {
    return { ok: false, error: 'message.parts must be a non-empty array' };
  }

  const parts: A2AMessagePart[] = [];
  for (let i = 0; i < obj.parts.length; i++) {
    const p = obj.parts[i];
    if (!p || typeof p !== 'object') {
      return { ok: false, error: `message.parts[${i}] must be an object` };
    }
    const kind = (p as Record<string, unknown>).kind;
    if (kind !== 'text' && kind !== 'file' && kind !== 'data') {
      return { ok: false, error: `message.parts[${i}].kind must be text|file|data` };
    }
    if (kind === 'text') {
      const text = (p as Record<string, unknown>).text;
      if (typeof text !== 'string') {
        return { ok: false, error: `message.parts[${i}].text must be a string` };
      }
      parts.push({ kind: 'text', text });
    } else {
      parts.push({ kind, data: (p as Record<string, unknown>).data });
    }
  }

  return { ok: true, value: { role: obj.role, parts } };
}

/** An inbound task, freshly created in the `submitted` state. */
export interface A2ATask {
  id: string;
  state: A2ATaskState;
  message: A2AMessage;
}

/**
 * Wrap a validated message in a fresh task. The task id is supplied by the
 * caller (the route generates it) so this stays pure and testable. New tasks
 * always start in `submitted`.
 */
export function createInboundTask(taskId: string, message: A2AMessage): A2ATask {
  return { id: taskId, state: 'submitted', message };
}

/**
 * Concatenate the text parts of a message into a single prompt string, the form
 * the runtime consumes. Non-text parts are skipped (this scaffold is text-first).
 */
export function messageToPromptText(message: A2AMessage): string {
  return message.parts
    .filter((p): p is A2AMessagePart & { text: string } => p.kind === 'text' && typeof p.text === 'string')
    .map((p) => p.text)
    .join('\n')
    .trim();
}

export interface A2AAuthResult {
  ok: boolean;
  /** Present when `ok` is false — why the request was rejected. */
  reason?: string;
}

/**
 * Authorize an inbound request against the node's auth policy. When the node
 * does not require auth, every request passes. Otherwise the `Authorization`
 * header must be `Bearer <token>` and match `expectedToken` (which the runtime
 * resolves from `authTokenEnvVar` — the secret never lives in the config). A
 * blank `expectedToken` under `requireAuth` is a misconfiguration and fails
 * closed rather than accepting all callers.
 */
export function authorizeInbound(
  config: Pick<ResolvedA2AConfig, 'requireAuth'>,
  expectedToken: string,
  authorizationHeader: string | undefined,
): A2AAuthResult {
  if (!config.requireAuth) return { ok: true };
  if (!expectedToken) {
    return { ok: false, reason: 'auth required but no token configured' };
  }
  if (!authorizationHeader) {
    return { ok: false, reason: 'missing Authorization header' };
  }
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  if (!match) {
    return { ok: false, reason: 'Authorization header must be a bearer token' };
  }
  if (match[1] !== expectedToken) {
    return { ok: false, reason: 'invalid bearer token' };
  }
  return { ok: true };
}

/**
 * Derive a safe tool-name suffix from a remote agent's display name: lowercase,
 * non-alphanumerics collapsed to single underscores, trimmed. Falls back to the
 * agent id when the name has no usable characters.
 */
export function slugifyToolName(name: string, fallbackId: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (slug) return slug;
  const idSlug = fallbackId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return idSlug || 'agent';
}

/** A callable tool synthesized for one remote A2A delegate. */
export interface A2ADelegateTool {
  /** Fully-qualified, collision-free tool name (`prefix` + slug). */
  name: string;
  /** Tool description surfaced to the model — the delegate's `description`. */
  description: string;
  /** The remote agent card URL the tool posts tasks to. */
  cardUrl: string;
  /** JSON-schema for the tool's input. */
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

/**
 * Synthesize one callable tool per enabled delegate. Delegates that are disabled
 * or missing a `cardUrl` are skipped. Tool names are `delegateToolPrefix` + a
 * slug of the delegate name; collisions are disambiguated with a numeric suffix
 * so a graph with two similarly-named delegates still produces distinct tools.
 */
export function buildDelegateTools(config: ResolvedA2AConfig): A2ADelegateTool[] {
  const prefix = config.delegateToolPrefix.trim();
  const used = new Set<string>();
  const tools: A2ADelegateTool[] = [];

  for (const d of config.delegates) {
    if (!d.enabled || !d.cardUrl.trim()) continue;
    let name = `${prefix}${slugifyToolName(d.name, d.id)}`;
    if (used.has(name)) {
      let n = 2;
      while (used.has(`${name}_${n}`)) n++;
      name = `${name}_${n}`;
    }
    used.add(name);
    tools.push({
      name,
      description:
        d.description.trim() ||
        `Delegate a task to the remote A2A agent "${d.name || d.id}".`,
      cardUrl: d.cardUrl.trim(),
      inputSchema: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'The task/message to send to the remote agent.',
          },
        },
        required: ['message'],
      },
    });
  }

  return tools;
}

/**
 * Validate and normalize a remote agent card fetched from a delegate `cardUrl`.
 * Requires at least a `name` and a `url`; missing capabilities default to off.
 * Returns a normalized card or a human-readable error for the client side to
 * surface when a delegate is unreachable or non-conformant.
 */
export function parseRemoteCard(raw: unknown): A2AValidation<A2AAgentCard> {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'agent card must be an object' };
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.name !== 'string' || !obj.name.trim()) {
    return { ok: false, error: 'agent card is missing a name' };
  }
  if (typeof obj.url !== 'string' || !obj.url.trim()) {
    return { ok: false, error: 'agent card is missing a url' };
  }
  const caps = (obj.capabilities ?? {}) as Record<string, unknown>;
  const card: A2AAgentCard = {
    protocolVersion:
      typeof obj.protocolVersion === 'string'
        ? obj.protocolVersion
        : A2A_PROTOCOL_VERSION,
    name: obj.name,
    description: typeof obj.description === 'string' ? obj.description : '',
    url: obj.url,
    version: typeof obj.version === 'string' ? obj.version : '',
    capabilities: {
      streaming: caps.streaming === true,
      pushNotifications: caps.pushNotifications === true,
      stateTransitionHistory: caps.stateTransitionHistory === true,
    },
    defaultInputModes: Array.isArray(obj.defaultInputModes)
      ? (obj.defaultInputModes.filter((m) => typeof m === 'string') as string[])
      : ['text/plain'],
    defaultOutputModes: Array.isArray(obj.defaultOutputModes)
      ? (obj.defaultOutputModes.filter((m) => typeof m === 'string') as string[])
      : ['text/plain'],
    skills: Array.isArray(obj.skills) ? (obj.skills as A2ACardSkill[]) : [],
  };
  return { ok: true, value: card };
}
