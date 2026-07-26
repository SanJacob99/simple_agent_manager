import type { ResolvedA2AConfig, A2AAuthScheme } from '../../shared/agent-config';

/**
 * Agent-to-Agent (A2A) interop engine.
 *
 * `agentComm` is an in-process bus and `subAgent` is in-tree; neither lets this
 * agent talk to agents built on *other* frameworks. The A2A protocol is the
 * emerging lingua franca for cross-framework agent interop, much as MCP
 * standardized tools: a remote agent publishes an **agent card** at
 * `/.well-known/agent-card.json`, and callers hand it work with a JSON-RPC 2.0
 * `message/send` (or streaming `message/stream`) envelope, receiving a Task or
 * Message back.
 *
 * This module is the dependency-free substrate the runtime calls. It owns:
 *
 *   - assembling and validating the agent card this agent publishes as a server,
 *   - parsing/normalizing a remote agent's card,
 *   - selecting which registered remote agent should receive a delegated task,
 *   - constructing the JSON-RPC `message/send` request envelope, and
 *   - parsing the Task/Message result back into text + artifacts.
 *
 * It performs **no network I/O** and generates no ids of its own (callers pass
 * `messageId` / `requestId` so the surface stays pure and unit-testable). Wiring
 * it into `server/a2a/` (serve the card over HTTP, POST delegated tasks, expose
 * an `a2a_delegate` tool, stream `tasks/get` updates) is the remaining
 * integration step; the API below is the stable surface that wiring targets.
 */

/** A2A protocol version this scaffold targets (spec https://a2a-protocol.org/v0.3.0). */
export const A2A_PROTOCOL_VERSION = '0.3.0';
/** RFC 8615 well-known path an A2A agent card is served from. */
export const A2A_WELL_KNOWN_PATH = '/.well-known/agent-card.json';
/** Preferred content type for an agent card; `application/json` is also accepted. */
export const A2A_CONTENT_TYPE = 'application/a2a+json';

// --- Agent card shapes (serializable A2A wire types) ---

export interface A2ASkillCard {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

export interface A2ASecurityScheme {
  type: 'apiKey' | 'http' | 'oauth2';
  /** apiKey */
  in?: 'header' | 'query';
  name?: string;
  /** http */
  scheme?: string;
  /** oauth2 */
  flows?: Record<string, unknown>;
}

export interface A2AAgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  /** Base URL remote agents use to reach this agent's A2A endpoint. */
  url: string;
  version: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransitionHistory: boolean;
  };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: A2ASkillCard[];
  securitySchemes?: Record<string, A2ASecurityScheme>;
  security?: Array<Record<string, string[]>>;
}

/** Fallbacks pulled from the resolved agent when the node leaves fields blank. */
export interface A2ACardFallback {
  name: string;
  description: string;
  /** Skill names/ids derived from the agent's tools + skills. */
  skills: string[];
  version: string;
}

/**
 * Slugify a skill name into a stable A2A skill id: lowercase, non-alphanumerics
 * collapsed to single dashes, trimmed. Empty input yields `'skill'` so a card
 * never carries an empty id.
 */
export function slugifySkillId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'skill';
}

/**
 * Translate the node's coarse auth scheme into an A2A `securitySchemes` +
 * `security` pair. `none` yields neither (anonymous card).
 */
export function buildSecurity(scheme: A2AAuthScheme): {
  securitySchemes?: Record<string, A2ASecurityScheme>;
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
        securitySchemes: { oauth2: { type: 'oauth2', flows: {} } },
        security: [{ oauth2: [] }],
      };
    case 'none':
    default:
      return {};
  }
}

/**
 * Assemble the agent card this agent publishes as an A2A server. Blank node
 * fields fall back to the resolved agent's own name/description/skills so a
 * minimally configured node still produces a valid card.
 */
export function buildAgentCard(
  config: ResolvedA2AConfig,
  fallback: A2ACardFallback,
): A2AAgentCard {
  const advertised =
    config.advertisedSkills.length > 0 ? config.advertisedSkills : fallback.skills;
  const seen = new Set<string>();
  const skills: A2ASkillCard[] = [];
  for (const name of advertised) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const id = slugifySkillId(trimmed);
    if (seen.has(id)) continue;
    seen.add(id);
    skills.push({ id, name: trimmed, description: '', tags: [] });
  }

  return {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name: config.serverName.trim() || fallback.name,
    description: config.serverDescription.trim() || fallback.description,
    url: config.serverUrl.trim(),
    version: fallback.version,
    capabilities: {
      streaming: config.supportsStreaming,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills,
    ...buildSecurity(config.serverAuth),
  };
}

export interface CardValidation {
  ok: boolean;
  errors: string[];
}

/**
 * Validate that a card carries the fields the A2A spec marks required
 * (`name`, `description`, `url`, `version`, `capabilities`, input/output modes,
 * `skills`). Used both to check the card we publish and to sanity-check a
 * remote card before trusting it.
 */
export function validateAgentCard(card: Partial<A2AAgentCard>): CardValidation {
  const errors: string[] = [];
  if (!card.name || !card.name.trim()) errors.push('name is required');
  if (!card.description || !card.description.trim()) errors.push('description is required');
  if (!card.url || !card.url.trim()) errors.push('url is required');
  if (!card.version || !card.version.trim()) errors.push('version is required');
  if (!card.capabilities || typeof card.capabilities !== 'object') {
    errors.push('capabilities is required');
  }
  if (!Array.isArray(card.defaultInputModes) || card.defaultInputModes.length === 0) {
    errors.push('defaultInputModes must be a non-empty array');
  }
  if (!Array.isArray(card.defaultOutputModes) || card.defaultOutputModes.length === 0) {
    errors.push('defaultOutputModes must be a non-empty array');
  }
  if (!Array.isArray(card.skills)) errors.push('skills must be an array');
  return { ok: errors.length === 0, errors };
}

/**
 * The URL a remote agent's card is fetched from: an explicit `cardUrl` when the
 * remote does not use the well-known path, otherwise `${url}` + the well-known
 * path (with duplicate slashes collapsed).
 */
export function cardUrlFor(remote: { url: string; cardUrl?: string }): string {
  if (remote.cardUrl && remote.cardUrl.trim()) return remote.cardUrl.trim();
  const base = remote.url.trim().replace(/\/+$/, '');
  return base + A2A_WELL_KNOWN_PATH;
}

export type ParseResult<T> = { value: T } | { error: string };

/**
 * Parse a fetched remote agent card (raw JSON string or already-parsed object)
 * into a normalized `A2AAgentCard`. Returns `{ error }` when the payload is not
 * an object or fails required-field validation, which the runtime treats as
 * "remote is not a usable A2A agent".
 */
export function parseRemoteAgentCard(input: string | unknown): ParseResult<A2AAgentCard> {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch {
      return { error: 'agent card is not valid JSON' };
    }
  }
  if (!raw || typeof raw !== 'object') return { error: 'agent card must be an object' };
  const card = raw as Partial<A2AAgentCard>;
  const validation = validateAgentCard(card);
  if (!validation.ok) return { error: validation.errors.join('; ') };
  return { value: card as A2AAgentCard };
}

// --- Message / task envelopes (JSON-RPC 2.0) ---

export type A2APart =
  | { kind: 'text'; text: string }
  | { kind: 'data'; data: Record<string, unknown> }
  | { kind: 'file'; file: { name?: string; mimeType?: string; uri?: string; bytes?: string } };

export interface A2AMessage {
  role: 'user' | 'agent';
  parts: A2APart[];
  messageId: string;
  kind: 'message';
  contextId?: string;
  taskId?: string;
}

export interface A2ARpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: 'message/send' | 'message/stream';
  params: { message: A2AMessage; configuration?: Record<string, unknown> };
}

/**
 * Normalize loose input into A2A message parts. A bare string becomes a single
 * text part; an array is passed through with unknown entries coerced to text so
 * a caller can hand us a mix without pre-shaping it.
 */
export function normalizeMessageParts(input: string | A2APart[]): A2APart[] {
  if (typeof input === 'string') return [{ kind: 'text', text: input }];
  return input.map((p) =>
    p && typeof p === 'object' && 'kind' in p ? p : { kind: 'text', text: String(p) },
  );
}

export interface BuildTaskOptions {
  /** JSON-RPC request id (caller-supplied so this stays pure). */
  requestId: string | number;
  /** A2A message id (caller-supplied). */
  messageId: string;
  /** Continue an existing task/context when delegating a follow-up. */
  contextId?: string;
  taskId?: string;
  /** Use the streaming method (`message/stream`) instead of `message/send`. */
  stream?: boolean;
  /** Extra `configuration` block (e.g. accepted output modes, blocking mode). */
  configuration?: Record<string, unknown>;
}

/**
 * Construct the JSON-RPC `message/send` (or `message/stream`) request that
 * delegates a task to a remote A2A agent. Content is normalized through
 * `normalizeMessageParts`; ids come from `opts` so the envelope is deterministic.
 */
export function buildMessageSendRequest(
  content: string | A2APart[],
  opts: BuildTaskOptions,
): A2ARpcRequest {
  const message: A2AMessage = {
    role: 'user',
    parts: normalizeMessageParts(content),
    messageId: opts.messageId,
    kind: 'message',
    ...(opts.contextId ? { contextId: opts.contextId } : {}),
    ...(opts.taskId ? { taskId: opts.taskId } : {}),
  };
  return {
    jsonrpc: '2.0',
    id: opts.requestId,
    method: opts.stream ? 'message/stream' : 'message/send',
    params: {
      message,
      ...(opts.configuration ? { configuration: opts.configuration } : {}),
    },
  };
}

export interface A2ATaskResult {
  /** Concatenated text extracted from the reply's/artifact's text parts. */
  text: string;
  /** Task lifecycle state when the reply was a Task (`completed`, `failed`, …). */
  state: string;
  /** Non-text artifact parts (data/file) surfaced for the caller to handle. */
  artifacts: A2APart[];
  /** Task id when the reply was a Task, for follow-up `tasks/get` polling. */
  taskId?: string;
}

function collectParts(parts: unknown): { text: string; artifacts: A2APart[] } {
  const texts: string[] = [];
  const artifacts: A2APart[] = [];
  if (!Array.isArray(parts)) return { text: '', artifacts };
  for (const part of parts) {
    if (part && typeof part === 'object' && (part as A2APart).kind === 'text') {
      texts.push(String((part as { text: unknown }).text ?? ''));
    } else if (part && typeof part === 'object') {
      artifacts.push(part as A2APart);
    }
  }
  return { text: texts.join('\n').trim(), artifacts };
}

/**
 * Parse a JSON-RPC response from a remote A2A agent into text + artifacts. The
 * `result` may be a Message (immediate reply) or a Task (with `status.message`
 * and `artifacts`); both shapes are handled. A JSON-RPC `error` member, or an
 * unrecognized shape, yields `{ error }`.
 */
export function parseTaskResult(response: unknown): ParseResult<A2ATaskResult> {
  if (!response || typeof response !== 'object') {
    return { error: 'response is not an object' };
  }
  const rpc = response as Record<string, unknown>;
  if (rpc.error && typeof rpc.error === 'object') {
    const err = rpc.error as { message?: unknown; code?: unknown };
    return { error: String(err.message ?? `rpc error ${err.code ?? ''}`).trim() };
  }
  const result = rpc.result;
  if (!result || typeof result !== 'object') return { error: 'response has no result' };
  const r = result as Record<string, unknown>;

  // Immediate Message reply.
  if (r.kind === 'message' || (Array.isArray(r.parts) && !r.status)) {
    const { text, artifacts } = collectParts(r.parts);
    return { value: { text, state: 'completed', artifacts } };
  }

  // Task reply.
  const status = (r.status as Record<string, unknown>) ?? {};
  const statusMsg = status.message as Record<string, unknown> | undefined;
  const fromStatus = collectParts(statusMsg?.parts);
  const artifactParts: A2APart[] = [];
  let artifactText = '';
  if (Array.isArray(r.artifacts)) {
    for (const artifact of r.artifacts) {
      const collected = collectParts((artifact as Record<string, unknown>)?.parts);
      if (collected.text) artifactText = artifactText ? `${artifactText}\n${collected.text}` : collected.text;
      artifactParts.push(...collected.artifacts);
    }
  }
  const text = [fromStatus.text, artifactText].filter(Boolean).join('\n').trim();
  return {
    value: {
      text,
      state: typeof status.state === 'string' ? status.state : 'unknown',
      artifacts: [...fromStatus.artifacts, ...artifactParts],
      ...(typeof r.id === 'string' ? { taskId: r.id } : {}),
    },
  };
}

// --- Delegate selection ---

export interface DelegateCandidate {
  id: string;
  name: string;
  skills: string[];
  enabled: boolean;
}

/**
 * Score how well a remote agent matches a delegation `need` (a skill id or a
 * free-text task hint). An exact skill-id match scores highest, a whole-word or
 * substring skill match next, and a match on the agent's name lowest. 0 means no
 * match. Disabled agents always score 0.
 */
export function scoreDelegateMatch(remote: DelegateCandidate, need: string): number {
  if (!remote.enabled) return 0;
  const target = need.trim().toLowerCase();
  if (!target) return 0;
  const needId = slugifySkillId(target);
  let best = 0;
  for (const skill of remote.skills) {
    const skillTrimmed = skill.trim().toLowerCase();
    if (!skillTrimmed) continue;
    const skillId = slugifySkillId(skillTrimmed);
    if (skillId === needId || skillTrimmed === target) best = Math.max(best, 1);
    else if (skillTrimmed.includes(target) || target.includes(skillTrimmed)) {
      best = Math.max(best, 0.6);
    }
  }
  if (best === 0 && remote.name.trim().toLowerCase().includes(target)) best = 0.3;
  return best;
}

/**
 * Pick the enabled remote agent that best matches `need`, or `null` when none
 * match. Ties break toward the earliest-registered remote so selection is
 * stable and order-driven.
 */
export function selectDelegate<T extends DelegateCandidate>(
  remotes: T[],
  need: string,
): T | null {
  let winner: T | null = null;
  let bestScore = 0;
  for (const remote of remotes) {
    const score = scoreDelegateMatch(remote, need);
    if (score > bestScore) {
      bestScore = score;
      winner = remote;
    }
  }
  return bestScore > 0 ? winner : null;
}

/**
 * Build the HTTP auth header used to call a remote A2A endpoint given its scheme
 * and a resolved credential value (already read from the configured env var by
 * the caller). Returns an empty object for `none` or a missing credential.
 */
export function resolveAuthHeader(
  scheme: A2AAuthScheme,
  credential: string | undefined,
): Record<string, string> {
  if (scheme === 'none' || !credential) return {};
  switch (scheme) {
    case 'apiKey':
      return { 'X-API-Key': credential };
    case 'bearer':
    case 'oauth2':
      return { Authorization: `Bearer ${credential}` };
    default:
      return {};
  }
}
