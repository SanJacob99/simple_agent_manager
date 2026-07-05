import type {
  ResolvedA2AConfig,
  ResolvedA2ARemoteAgent,
  A2AAuthScheme,
} from '../../shared/agent-config';

/**
 * Agent-to-Agent (A2A) interop engine.
 *
 * A2A is the emerging cross-framework protocol for agents to discover and
 * delegate to one another — an *agent card* advertises what an agent can do
 * (the discovery layer), and *task/message envelopes* carry work between them
 * (the transport layer). It is becoming to agents what MCP is to tools. This
 * module is the dependency-free substrate the runtime calls; it owns agent-card
 * assembly, remote-agent validation, delegate naming, auth-header construction,
 * the JSON-RPC `message/send` envelope, task-result extraction, and the
 * per-run delegation guard. The runtime owns the actual HTTP transport and the
 * `/.well-known/agent-card.json` route.
 *
 * The orchestration the run-coordinator / A2A server performs:
 *
 *   Server role: serve `buildAgentCard(config, opts)` at `WELL_KNOWN_CARD_PATH`,
 *   accept inbound `message/send` requests, and run them through the same
 *   headless-run path the cron scheduler uses.
 *
 *   Client role: for each remote agent, register a delegate tool named by
 *   `delegateToolName(remote)`. When invoked, POST `buildMessageSendEnvelope(...)`
 *   (with `buildAuthHeaders(...)`) to the remote's URL, poll until
 *   `isTerminalTaskState(...)`, and return `extractTextFromResult(...)`.
 *   `shouldDelegate(config, count)` caps delegations per run for loop/cost safety.
 *
 * Wiring this into `server/agents/run-coordinator.ts` (register delegate tools,
 * mount the A2A server route, emit `a2a:delegated` / `a2a:task_failed` events)
 * is the remaining integration step; the API below is the stable surface that
 * wiring targets.
 */

/** Canonical path an A2A agent card is served from (spec: agent-card discovery). */
export const WELL_KNOWN_CARD_PATH = '/.well-known/agent-card.json';

/** A2A protocol version advertised on the card. */
export const A2A_PROTOCOL_VERSION = '0.3.0';

/** Task lifecycle states an agent may report (A2A task state machine). */
export type A2ATaskState =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'auth-required'
  | 'completed'
  | 'canceled'
  | 'failed'
  | 'rejected';

/** States after which no further updates arrive — polling should stop. */
export const TERMINAL_TASK_STATES: ReadonlySet<A2ATaskState> = new Set<A2ATaskState>([
  'completed',
  'canceled',
  'failed',
  'rejected',
]);

/** Whether a task state is terminal (the delegate poll loop should stop). */
export function isTerminalTaskState(state: unknown): boolean {
  return typeof state === 'string' && TERMINAL_TASK_STATES.has(state as A2ATaskState);
}

/** Whether a terminal state represents success (vs. a failure/cancel/reject). */
export function isSuccessTaskState(state: unknown): boolean {
  return state === 'completed';
}

/**
 * Normalize a display name into a tool-name-safe slug: lowercase, alnum +
 * underscores, collapsed, trimmed. Empty input yields `agent`.
 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
  return slug || 'agent';
}

/**
 * Deterministic delegate tool name for a remote agent. Prefer the name; fall
 * back to the id so two unnamed remotes never collide.
 */
export function delegateToolName(remote: ResolvedA2ARemoteAgent): string {
  const base = remote.name.trim() ? slugify(remote.name) : slugify(remote.id);
  return `a2a_${base}`;
}

/** One skill entry as advertised in an agent card. */
export interface A2ACardSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

/** A minimal but spec-shaped A2A agent card. */
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
  securitySchemes: Record<string, { type: string; scheme?: string; description?: string }>;
}

/** Runtime-supplied fallbacks used when the node leaves a field blank. */
export interface AgentCardContext {
  /** Falls back the card name when `agentName` is empty. */
  fallbackName: string;
  /** Falls back the card URL when `publicUrl` is empty (e.g. the server host). */
  fallbackUrl: string;
}

/**
 * Translate the node's `inboundAuthScheme` into the card's `securitySchemes`
 * map. `none` advertises no scheme.
 */
export function buildSecuritySchemes(
  scheme: A2AAuthScheme,
): A2AAgentCard['securitySchemes'] {
  switch (scheme) {
    case 'bearer':
      return { bearer: { type: 'http', scheme: 'bearer', description: 'Bearer token' } };
    case 'apiKey':
      return { apiKey: { type: 'apiKey', description: 'API key header' } };
    case 'oauth2':
      return { oauth2: { type: 'oauth2', description: 'OAuth 2.0 flow' } };
    case 'none':
    default:
      return {};
  }
}

/**
 * Assemble the agent card advertised at `WELL_KNOWN_CARD_PATH`. Blank
 * `agentName` / `publicUrl` fall back to the runtime-supplied context so the
 * card is always well-formed.
 */
export function buildAgentCard(
  config: ResolvedA2AConfig,
  ctx: AgentCardContext,
): A2AAgentCard {
  return {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name: config.agentName.trim() || ctx.fallbackName,
    description: config.agentDescription.trim(),
    url: config.publicUrl.trim() || ctx.fallbackUrl,
    version: config.agentVersion.trim() || '1.0.0',
    capabilities: {
      streaming: config.streaming,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: config.advertisedSkills
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => ({
        id: slugify(s),
        name: s,
        description: '',
        tags: [],
      })),
    securitySchemes: buildSecuritySchemes(config.inboundAuthScheme),
  };
}

/** Result of validating a remote-agent binding before use. */
export interface RemoteValidation {
  ok: boolean;
  errors: string[];
}

/**
 * Validate a remote-agent delegate binding. A missing/invalid URL or a
 * credential-less authenticated scheme is fatal; anything else passes. Kept
 * pure so the UI and the runtime can share one definition of "usable".
 */
export function validateRemoteAgent(remote: ResolvedA2ARemoteAgent): RemoteValidation {
  const errors: string[] = [];
  const url = remote.url.trim();
  if (!url) {
    errors.push('Remote agent URL is required.');
  } else {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        errors.push('Remote agent URL must be http(s).');
      }
    } catch {
      errors.push('Remote agent URL is not a valid URL.');
    }
  }
  if (remote.authScheme !== 'none' && !remote.authValue.trim()) {
    errors.push(`Auth scheme "${remote.authScheme}" requires a credential or env-var name.`);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Build the outbound HTTP headers used when calling a remote agent. `authValue`
 * is passed through verbatim — the runtime resolves env-var names to secrets
 * before calling this so the resolved-config surface never has to hold a raw
 * secret. `none` yields no auth header.
 */
export function buildAuthHeaders(
  scheme: A2AAuthScheme,
  value: string,
): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const token = value.trim();
  if (!token) return headers;
  switch (scheme) {
    case 'bearer':
    case 'oauth2':
      headers['authorization'] = `Bearer ${token}`;
      break;
    case 'apiKey':
      headers['x-api-key'] = token;
      break;
    case 'none':
    default:
      break;
  }
  return headers;
}

/** A JSON-RPC 2.0 `message/send` request envelope. */
export interface MessageSendEnvelope {
  jsonrpc: '2.0';
  id: string;
  method: 'message/send';
  params: {
    message: {
      role: 'user';
      parts: { kind: 'text'; text: string }[];
      messageId: string;
    };
  };
}

/**
 * Build the JSON-RPC `message/send` envelope that delegates a task to a remote
 * agent. `requestId` and `messageId` are supplied by the caller (the engine is
 * deterministic and does not read the clock or RNG).
 */
export function buildMessageSendEnvelope(
  text: string,
  ids: { requestId: string; messageId: string },
): MessageSendEnvelope {
  return {
    jsonrpc: '2.0',
    id: ids.requestId,
    method: 'message/send',
    params: {
      message: {
        role: 'user',
        parts: [{ kind: 'text', text }],
        messageId: ids.messageId,
      },
    },
  };
}

/**
 * Pull the human-readable text out of an A2A task/message result. Handles the
 * two shapes a remote may return: a Task (with `status.message` and/or
 * `artifacts[].parts[]`) or a bare Message (`parts[]`). Concatenates every text
 * part it finds. Returns `null` when no text can be recovered.
 */
export function extractTextFromResult(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const root = result as Record<string, unknown>;

  const texts: string[] = [];
  const collectParts = (parts: unknown) => {
    if (!Array.isArray(parts)) return;
    for (const part of parts) {
      if (part && typeof part === 'object') {
        const p = part as Record<string, unknown>;
        // A2A uses `kind: 'text'`; tolerate `type: 'text'` from older peers.
        const isText = p.kind === 'text' || p.type === 'text';
        if (isText && typeof p.text === 'string') texts.push(p.text);
      }
    }
  };

  // Bare Message shape.
  collectParts(root.parts);

  // Task shape: status.message.parts + artifacts[].parts.
  const status = root.status;
  if (status && typeof status === 'object') {
    const message = (status as Record<string, unknown>).message;
    if (message && typeof message === 'object') {
      collectParts((message as Record<string, unknown>).parts);
    }
  }
  const artifacts = root.artifacts;
  if (Array.isArray(artifacts)) {
    for (const artifact of artifacts) {
      if (artifact && typeof artifact === 'object') {
        collectParts((artifact as Record<string, unknown>).parts);
      }
    }
  }

  const joined = texts.join('\n').trim();
  return joined || null;
}

/**
 * Whether another task may be delegated this run. False once A2A is disabled,
 * the client side is off, or the per-run ceiling is reached. A ceiling of 0
 * disables the limit (unlimited).
 *
 * @param delegationsSoFar count of tasks already delegated in the current run.
 */
export function shouldDelegate(
  config: ResolvedA2AConfig,
  delegationsSoFar: number,
): boolean {
  if (!config.enabled) return false;
  if (config.role !== 'client' && config.role !== 'both') return false;
  if (config.maxDelegationsPerRun <= 0) return true;
  return delegationsSoFar < config.maxDelegationsPerRun;
}

/** Whether the config's role publishes an agent card. */
export function servesAgentCard(config: ResolvedA2AConfig): boolean {
  return config.enabled && (config.role === 'server' || config.role === 'both');
}
