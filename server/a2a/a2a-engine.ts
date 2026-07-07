import type { ResolvedA2AConfig, ResolvedA2ARemoteAgent } from '../../shared/agent-config';

/**
 * Agent-to-Agent (A2A) interop engine.
 *
 * An A2A node exposes this agent over the emerging Agent-to-Agent protocol and/or
 * registers remote A2A agents as callable delegates. Where `agentComm` is an
 * in-process bus and `subAgent` is in-tree, A2A is the cross-framework *wire*
 * protocol — agent cards for discovery, task/message envelopes for work, and
 * streaming/webhook updates for progress. This module is the dependency-free
 * substrate the server layer calls: it builds agent cards, validates inbound
 * task envelopes, parses remote cards, derives delegate tool names, authorizes
 * inbound requests, and bounds task concurrency. The transport (HTTP routes,
 * SSE, fetch to remotes) lives in the server layer that consumes this API.
 *
 * The orchestration `server/a2a/` performs on top of this substrate:
 *
 *   1. On agent start, when `role` includes `server`, mount `serverPath` and
 *      serve `buildAgentCard(...)` at `<serverPath>/.well-known/agent-card.json`.
 *   2. On an inbound POST, `authorizeInbound(...)` gates the request, then
 *      `parseTaskRequest(...)` validates the JSON-RPC `message/send` envelope and
 *      `TaskConcurrencyGuard` bounds in-flight work before dispatching to a
 *      headless run.
 *   3. When `role` includes `client`, `enabledRemotes(...)` are fetched via
 *      `parseAgentCard(...)`; each becomes a delegate tool named
 *      `delegateToolName(...)` that posts an outbound task to the remote.
 *
 * Wiring this into the server (routes, fetch, headless-run dispatch, event
 * emission) is the remaining integration step; the API below is the stable
 * surface that wiring targets. Functions are pure so they unit-test without a
 * network or a live agent.
 */

/** A2A task lifecycle states, per the A2A protocol task state machine. */
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

/** Whether a task state is terminal (no further updates follow). */
export function isTerminalTaskState(state: A2ATaskState): boolean {
  return TERMINAL_STATES.has(state);
}

/** A single skill entry advertised in an agent card. */
export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

/**
 * The published A2A agent card. Shape follows the A2A protocol's agent-card
 * schema (protocol version, discovery URL, capabilities, and skills). Served at
 * `<serverPath>/.well-known/agent-card.json` for remote clients to discover.
 */
export interface AgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  /** Absolute URL remote clients POST tasks to. */
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

/** The A2A protocol version this builder targets. */
export const A2A_PROTOCOL_VERSION = '0.3.0';

/** Conventional path segment where an agent card is published. */
export const AGENT_CARD_PATH = '/.well-known/agent-card.json';

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

/** Slugify a display name into a stable, tool-safe token. */
function slug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Build the agent card published for this agent. `fallbackName` is used when the
 * node leaves `agentName` empty (the runtime supplies the agent's own name);
 * `baseUrl` is the externally reachable origin the server is mounted under. The
 * advertised skills become card skill entries keyed by their slug.
 */
export function buildAgentCard(
  config: ResolvedA2AConfig,
  opts: { baseUrl: string; fallbackName: string },
): AgentCard {
  const name = config.agentName.trim() || opts.fallbackName;
  const skills: AgentSkill[] = config.advertisedSkills
    .map((s) => s.trim())
    .filter(Boolean)
    .map((tag) => ({
      id: slug(tag) || tag,
      name: tag,
      description: `Handles ${tag} tasks.`,
      tags: [tag],
    }));

  return {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name,
    description: config.agentDescription,
    url: joinUrl(opts.baseUrl, config.serverPath),
    version: config.agentVersion || '1.0.0',
    capabilities: {
      streaming: config.streaming,
      pushNotifications: config.pushNotifications,
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills,
  };
}

/** A part of an A2A message. Only the text part is modelled here. */
export interface A2ATextPart {
  kind: 'text';
  text: string;
}

/** A normalized inbound task request extracted from a JSON-RPC envelope. */
export interface A2ATaskRequest {
  /** JSON-RPC request id, echoed back on the response. */
  requestId: string | number;
  /** Caller-supplied message id, if present. */
  messageId: string;
  /** The user-role text extracted from the message parts, concatenated. */
  text: string;
}

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/**
 * Validate and normalize an inbound A2A request body. A2A transports tasks over
 * JSON-RPC 2.0 with method `message/send` (or `message/stream`) and a `params`
 * object carrying a `message` with a `role` and text `parts`. Returns the
 * normalized request or a human-readable error the caller can surface as a
 * JSON-RPC error response.
 */
export function parseTaskRequest(payload: unknown): ParseResult<A2ATaskRequest> {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'request body is not an object' };
  }
  const rpc = payload as Record<string, unknown>;
  if (rpc.jsonrpc !== '2.0') {
    return { ok: false, error: 'missing or invalid jsonrpc version (expected "2.0")' };
  }
  const method = rpc.method;
  if (method !== 'message/send' && method !== 'message/stream') {
    return { ok: false, error: `unsupported method: ${String(method)}` };
  }
  const requestId =
    typeof rpc.id === 'string' || typeof rpc.id === 'number' ? rpc.id : '';
  if (requestId === '') {
    return { ok: false, error: 'missing JSON-RPC id' };
  }

  const params = rpc.params;
  if (!params || typeof params !== 'object') {
    return { ok: false, error: 'missing params object' };
  }
  const message = (params as Record<string, unknown>).message;
  if (!message || typeof message !== 'object') {
    return { ok: false, error: 'missing params.message' };
  }
  const msg = message as Record<string, unknown>;
  if (msg.role !== 'user') {
    return { ok: false, error: `unexpected message role: ${String(msg.role)}` };
  }
  const parts = msg.parts;
  if (!Array.isArray(parts)) {
    return { ok: false, error: 'message.parts must be an array' };
  }
  const text = parts
    .filter(
      (p): p is A2ATextPart =>
        !!p && typeof p === 'object' && (p as Record<string, unknown>).kind === 'text',
    )
    .map((p) => (typeof p.text === 'string' ? p.text : ''))
    .join('')
    .trim();
  if (!text) {
    return { ok: false, error: 'message has no text parts' };
  }

  return {
    ok: true,
    value: {
      requestId,
      messageId: typeof msg.messageId === 'string' ? msg.messageId : '',
      text,
    },
  };
}

/**
 * Parse and minimally validate a remote agent card fetched from a `cardUrl`.
 * Tolerant of missing optional fields, strict about the essentials (`name`,
 * `url`). Returns the card or a reason it could not be used as a delegate.
 */
export function parseAgentCard(text: string): ParseResult<AgentCard> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'agent card is not valid JSON' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'agent card is not an object' };
  }
  const c = parsed as Record<string, unknown>;
  if (typeof c.name !== 'string' || !c.name.trim()) {
    return { ok: false, error: 'agent card is missing a name' };
  }
  if (typeof c.url !== 'string' || !c.url.trim()) {
    return { ok: false, error: 'agent card is missing a url' };
  }
  const caps = (c.capabilities ?? {}) as Record<string, unknown>;
  const skills = Array.isArray(c.skills)
    ? (c.skills as Record<string, unknown>[])
        .filter((s) => s && typeof s === 'object')
        .map((s) => ({
          id: typeof s.id === 'string' ? s.id : '',
          name: typeof s.name === 'string' ? s.name : '',
          description: typeof s.description === 'string' ? s.description : '',
          tags: Array.isArray(s.tags) ? s.tags.filter((t): t is string => typeof t === 'string') : [],
        }))
    : [];

  return {
    ok: true,
    value: {
      protocolVersion: typeof c.protocolVersion === 'string' ? c.protocolVersion : '',
      name: c.name,
      description: typeof c.description === 'string' ? c.description : '',
      url: c.url,
      version: typeof c.version === 'string' ? c.version : '',
      capabilities: {
        streaming: caps.streaming === true,
        pushNotifications: caps.pushNotifications === true,
      },
      defaultInputModes: Array.isArray(c.defaultInputModes)
        ? c.defaultInputModes.filter((m): m is string => typeof m === 'string')
        : [],
      defaultOutputModes: Array.isArray(c.defaultOutputModes)
        ? c.defaultOutputModes.filter((m): m is string => typeof m === 'string')
        : [],
      skills,
    },
  };
}

/** The remotes that are actually registered as delegates (enabled + has a card URL). */
export function enabledRemotes(config: ResolvedA2AConfig): ResolvedA2ARemoteAgent[] {
  return config.remotes.filter((r) => r.enabled && r.cardUrl.trim() !== '');
}

/**
 * Tool name a remote delegate is exposed under. Namespaced with `a2a_` and
 * slugged from the remote's display name so it collides with nothing else in
 * the tool registry. Falls back to the remote id when the name is empty.
 */
export function delegateToolName(remote: Pick<ResolvedA2ARemoteAgent, 'id' | 'name'>): string {
  const base = slug(remote.name) || slug(remote.id) || 'remote';
  return `a2a_${base}`;
}

/**
 * Decide whether an inbound request is authorized. When `requireAuth` is off,
 * every request passes. When on, the presented bearer token must be non-empty
 * and equal to the configured `expectedToken` (which the server reads from the
 * `inboundTokenEnv` env var). An empty or misconfigured expected token denies
 * all requests rather than failing open.
 */
export function authorizeInbound(
  config: ResolvedA2AConfig,
  presentedToken: string | undefined,
  expectedToken: string | undefined,
): { authorized: boolean; reason?: string } {
  if (!config.requireAuth) return { authorized: true };
  if (!expectedToken) {
    return { authorized: false, reason: 'auth required but no inbound token configured' };
  }
  if (!presentedToken) {
    return { authorized: false, reason: 'missing bearer token' };
  }
  if (presentedToken !== expectedToken) {
    return { authorized: false, reason: 'invalid bearer token' };
  }
  return { authorized: true };
}

/**
 * Bounds the number of concurrently running A2A tasks (inbound + outbound) at
 * `config.maxConcurrentTasks`. A ceiling of 0 disables the limit. Mirrors the
 * ledger style of the budget engine: the server calls `tryAcquire()` before
 * dispatching a task and `release()` when it finalizes.
 */
export class TaskConcurrencyGuard {
  private inFlight = 0;

  constructor(private readonly limit: number) {}

  /** Reserve a slot. Returns false when the ceiling is reached (caller should reject with a "busy" error). */
  tryAcquire(): boolean {
    if (this.limit > 0 && this.inFlight >= this.limit) return false;
    this.inFlight += 1;
    return true;
  }

  /** Release a previously acquired slot. Never drops below zero. */
  release(): void {
    if (this.inFlight > 0) this.inFlight -= 1;
  }

  /** Current number of in-flight tasks. */
  get active(): number {
    return this.inFlight;
  }
}
