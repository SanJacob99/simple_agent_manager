import type { ResolvedA2AConfig, ResolvedA2ARemoteAgent } from '../../shared/agent-config';

/**
 * Agent-to-Agent (A2A) interop engine.
 *
 * An A2A node exposes this agent to — and lets it call — agents built on *other*
 * frameworks over the emerging Agent-to-Agent protocol (agent cards,
 * task/message envelopes, streaming updates), much as MCP standardized tools.
 * `agentComm` is an in-process bus and `subAgent` is in-tree; A2A is the
 * cross-framework surface neither covers.
 *
 * This module is the dependency-free substrate the server calls; it owns:
 *
 *   1. `buildAgentCard(...)` — assemble the Agent Card JSON served at
 *      `<base>/.well-known/agent-card.json` from the resolved config, the
 *      agent's own metadata, and (optionally) its resolved skills.
 *   2. `normalizeBasePath` / `wellKnownCardPath` / `resolveCardUrl` — the URL
 *      conventions the spec defines for locating a card.
 *   3. `validateRemote(...)` — validate a registered delegate before the server
 *      tries to reach it.
 *   4. `buildMessageSendParams(...)` / `parseTaskResult(...)` — construct a
 *      JSON-RPC `message/send` request to a remote and parse the Task / Message
 *      it returns.
 *
 * Wiring an actual HTTP surface (serve the card + a `message/send` handler under
 * `basePath`, dispatch delegated tasks to `remotes`, honour `taskTimeoutMs` /
 * `maxConcurrentTasks`) into `server/agents/run-coordinator.ts` and the Express
 * app is the remaining integration step; the API below is the stable surface
 * that wiring targets.
 */

/** A2A protocol revision this scaffold targets. */
export const A2A_PROTOCOL_VERSION = '0.3.0';

/** Terminal + non-terminal task states defined by the A2A protocol. */
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

const TERMINAL_STATES: ReadonlySet<A2ATaskState> = new Set([
  'completed',
  'canceled',
  'failed',
  'rejected',
]);

/** Whether a task state is terminal (no further updates will arrive). */
export function isTerminalState(state: A2ATaskState): boolean {
  return TERMINAL_STATES.has(state);
}

// --- Base-path / URL conventions ---

/**
 * Normalize an A2A mount path: ensure a single leading slash, drop any trailing
 * slash, and fall back to `/a2a` when empty. This is the server-side source of
 * truth; `graph-to-agent.ts` keeps a copy of the same logic because browser code
 * cannot import server modules.
 */
export function normalizeBasePath(raw: string): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return '/a2a';
  const withLead = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const noTrail = withLead.replace(/\/+$/, '');
  return noTrail || '/a2a';
}

/** The well-known Agent Card path for a given mount base. */
export function wellKnownCardPath(basePath: string): string {
  return `${normalizeBasePath(basePath)}/.well-known/agent-card.json`;
}

/**
 * Resolve a remote's configured URL to the URL of its Agent Card. A bare origin
 * or base path (no `.json`) is extended with the well-known suffix; a URL that
 * already points at a card is returned untouched (trailing slash trimmed).
 */
export function resolveCardUrl(rawUrl: string): string {
  const url = (rawUrl ?? '').trim().replace(/\/+$/, '');
  if (!url) return '';
  if (/\.json($|\?)/.test(url) || url.includes('/.well-known/')) return url;
  return `${url}/.well-known/agent-card.json`;
}

// --- Role helpers ---

export function isServer(config: ResolvedA2AConfig): boolean {
  return config.enabled && (config.role === 'server' || config.role === 'both');
}

export function isClient(config: ResolvedA2AConfig): boolean {
  return config.enabled && (config.role === 'client' || config.role === 'both');
}

// --- Agent Card ---

export interface AgentCardCapabilities {
  streaming: boolean;
  pushNotifications: boolean;
}

export interface AgentCardSecurityScheme {
  type: 'apiKey' | 'http' | 'oauth2';
  /** For `http` schemes, the scheme name (e.g. `bearer`). */
  scheme?: string;
  /** For `apiKey` schemes, where the key travels. */
  in?: 'header' | 'query' | 'cookie';
  name?: string;
}

export interface AgentCardSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
}

export interface AgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  url: string;
  preferredTransport: 'JSONRPC' | 'GRPC' | 'HTTP+JSON';
  version: string;
  capabilities: AgentCardCapabilities;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: AgentCardSkill[];
  securitySchemes?: Record<string, AgentCardSecurityScheme>;
  security?: Array<Record<string, string[]>>;
}

/** Minimal shape of a resolved skill, kept local so the engine has no `src/` dep. */
export interface CardSkillInput {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
}

export interface AgentCardMeta {
  /** Fully-qualified base URL the agent is reachable at, e.g. `https://host/a2a`. */
  baseUrl: string;
  /** Agent's own name — used when the node leaves `agentName` empty. */
  fallbackName: string;
  /** Agent's own description — used when the node leaves `agentDescription` empty. */
  fallbackDescription: string;
  /** Agent's semantic version string for the card `version` field. */
  agentVersion: string;
  /** Resolved skills to advertise when `config.publishSkills` is set. */
  skills?: CardSkillInput[];
}

const TRANSPORT_LABEL: Record<ResolvedA2AConfig['transport'], AgentCard['preferredTransport']> = {
  jsonrpc: 'JSONRPC',
  grpc: 'GRPC',
  rest: 'HTTP+JSON',
};

/**
 * Translate a resolved auth scheme into an Agent Card `securitySchemes` entry.
 * `none` yields no scheme (the card omits `securitySchemes`/`security`).
 */
function securitySchemeFor(
  scheme: ResolvedA2AConfig['serverAuth'],
): AgentCardSecurityScheme | null {
  switch (scheme) {
    case 'apiKey':
      return { type: 'apiKey', in: 'header', name: 'X-API-Key' };
    case 'bearer':
      return { type: 'http', scheme: 'bearer' };
    case 'oauth2':
      return { type: 'oauth2' };
    case 'none':
    default:
      return null;
  }
}

/**
 * Assemble the Agent Card served for this agent. `agentName` / `agentDescription`
 * on the node win; empty falls back to the agent's own metadata. Skills are only
 * listed when `publishSkills` is set. When `serverAuth` is not `none`, a single
 * security scheme (`default`) is declared and required.
 */
export function buildAgentCard(config: ResolvedA2AConfig, meta: AgentCardMeta): AgentCard {
  const name = config.agentName.trim() || meta.fallbackName;
  const description = config.agentDescription.trim() || meta.fallbackDescription;

  const skills: AgentCardSkill[] =
    config.publishSkills && meta.skills
      ? meta.skills.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description ?? '',
          tags: s.tags ?? [],
        }))
      : [];

  const card: AgentCard = {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name,
    description,
    url: meta.baseUrl,
    preferredTransport: TRANSPORT_LABEL[config.transport],
    version: meta.agentVersion,
    capabilities: {
      streaming: config.streaming,
      pushNotifications: config.pushNotifications,
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills,
  };

  const scheme = securitySchemeFor(config.serverAuth);
  if (scheme) {
    card.securitySchemes = { default: scheme };
    card.security = [{ default: [] }];
  }

  return card;
}

// --- Remote delegate validation ---

export interface RemoteValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Validate a registered remote before the server tries to reach it. Checks the
 * card URL is a well-formed http(s) URL and that a credential source is present
 * whenever the remote requires auth.
 */
export function validateRemote(remote: ResolvedA2ARemoteAgent): RemoteValidationResult {
  const errors: string[] = [];

  const url = resolveCardUrl(remote.cardUrl);
  if (!url) {
    errors.push('cardUrl is required');
  } else if (!/^https?:\/\//i.test(url)) {
    errors.push('cardUrl must be an http(s) URL');
  }

  if (remote.authScheme !== 'none' && !remote.credentialEnvVar.trim()) {
    errors.push(`authScheme "${remote.authScheme}" requires a credentialEnvVar`);
  }

  return { ok: errors.length === 0, errors };
}

// --- Task dispatch (JSON-RPC message/send) ---

export interface A2AMessagePart {
  kind: 'text';
  text: string;
}

export interface A2AMessage {
  role: 'user' | 'agent';
  parts: A2AMessagePart[];
  messageId: string;
  kind: 'message';
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string;
  method: 'message/send';
  params: {
    message: A2AMessage;
    configuration?: { blocking?: boolean; acceptedOutputModes?: string[] };
  };
}

export interface MessageSendOptions {
  /** Client-supplied message id (caller owns id generation for determinism). */
  messageId: string;
  /** JSON-RPC request id. */
  requestId: string;
  /** Whether to request a blocking send (wait for a terminal task). Default true. */
  blocking?: boolean;
}

/**
 * Build a JSON-RPC 2.0 `message/send` request for delegating a text task to a
 * remote A2A agent. The caller supplies `messageId` / `requestId` so this stays
 * a pure function (no clock / randomness), which keeps it unit-testable.
 */
export function buildMessageSendParams(text: string, opts: MessageSendOptions): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id: opts.requestId,
    method: 'message/send',
    params: {
      message: {
        role: 'user',
        parts: [{ kind: 'text', text }],
        messageId: opts.messageId,
        kind: 'message',
      },
      configuration: {
        blocking: opts.blocking ?? true,
        acceptedOutputModes: ['text/plain'],
      },
    },
  };
}

export interface ParsedTaskResult {
  /** Concatenated text extracted from the result's parts. */
  text: string;
  /** Task state, or `completed` when the result was a bare Message. */
  state: A2ATaskState;
  /** Task id when the result was a Task; empty for a bare Message. */
  taskId: string;
  /** A JSON-RPC error message when the response carried one. */
  error?: string;
}

function extractText(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .map((p) =>
      p && typeof p === 'object' && (p as Record<string, unknown>).kind === 'text'
        ? String((p as Record<string, unknown>).text ?? '')
        : '',
    )
    .filter(Boolean)
    .join('');
}

/**
 * Parse a JSON-RPC response from a remote `message/send`. Handles three shapes:
 * a JSON-RPC error, a `result` that is a Task (with `status.state` and history /
 * artifacts), and a `result` that is a bare Message. Unknown shapes collapse to
 * an `unknown` state with empty text rather than throwing, so the caller can
 * surface a soft failure.
 */
export function parseTaskResult(response: unknown): ParsedTaskResult {
  const empty: ParsedTaskResult = { text: '', state: 'unknown', taskId: '' };
  if (!response || typeof response !== 'object') return empty;
  const obj = response as Record<string, unknown>;

  if (obj.error && typeof obj.error === 'object') {
    const err = obj.error as Record<string, unknown>;
    return { ...empty, state: 'failed', error: String(err.message ?? 'A2A error') };
  }

  const result = obj.result;
  if (!result || typeof result !== 'object') return empty;
  const r = result as Record<string, unknown>;

  // Bare Message result.
  if (r.kind === 'message') {
    return { text: extractText(r.parts), state: 'completed', taskId: '' };
  }

  // Task result.
  const status = (r.status && typeof r.status === 'object' ? r.status : {}) as Record<
    string,
    unknown
  >;
  const state = (typeof status.state === 'string' ? status.state : 'unknown') as A2ATaskState;
  const taskId = typeof r.id === 'string' ? r.id : '';

  // Prefer the last agent artifact/message; fall back to the status message.
  let text = '';
  if (Array.isArray(r.artifacts) && r.artifacts.length > 0) {
    const last = r.artifacts[r.artifacts.length - 1] as Record<string, unknown>;
    text = extractText(last.parts);
  }
  if (!text && status.message && typeof status.message === 'object') {
    text = extractText((status.message as Record<string, unknown>).parts);
  }

  return { text, state, taskId };
}
