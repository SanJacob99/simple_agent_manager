import type { ResolvedA2AConfig, ResolvedA2ARemoteAgent, A2AAuthScheme } from '../../shared/agent-config';
import { extractJson } from '../runtime/structured-output-engine';

/**
 * Agent-to-Agent (A2A) interop engine.
 *
 * The A2A protocol lets agents built on different frameworks discover and
 * delegate to one another: a server publishes an *agent card* (JSON metadata at
 * a well-known path describing its skills and capabilities), and clients send it
 * work as JSON-RPC `message/send` requests carrying message/part envelopes.
 * `agentComm` is an in-process bus and `subAgent` is in-tree; A2A is the
 * cross-framework wire format, much as MCP standardized tools.
 *
 * This module is the dependency-free substrate the runtime calls. It owns:
 *   - building the agent card served for the *server* role
 *     (`buildAgentCard`), and validating a card fetched from a *remote* agent
 *     (`validateAgentCard`);
 *   - deriving the well-known discovery URL from a base origin
 *     (`wellKnownCardUrl`);
 *   - constructing a JSON-RPC `message/send` request for a delegate call
 *     (`buildSendMessageRequest`) and extracting the reply text from the result
 *     (`extractTextFromResult`);
 *   - the auth header for a scheme (`authHeader`) and the delegate tool name a
 *     remote agent is exposed as (`remoteToolName`).
 *
 * The runtime owns the actual HTTP: serving the card route, and fetching remote
 * cards / posting task requests. Wiring an A2A server route into
 * `server/index.ts` and registering remote-delegate tools through the tool
 * factory (one `a2a_send_*` tool per remote agent when `exposeAsTools` is set)
 * is the remaining integration step; the API below is the stable surface that
 * wiring targets.
 */

/** JSON-RPC 2.0 protocol version echoed on every A2A request. */
export const JSON_RPC_VERSION = '2.0';

/** A skill advertised on an agent card. */
export interface A2ASkillCard {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
}

/** The A2A agent card served for the server role / fetched for a remote agent. */
export interface A2AAgentCard {
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
  skills: A2ASkillCard[];
  /** Security schemes advertised to callers. Omitted when the server needs no auth. */
  securitySchemes?: Record<string, { type: string }>;
}

/** Metadata the runtime supplies about the resolved agent when building a card. */
export interface AgentCardMeta {
  /** Falls back onto the card `name` when the node's `serverName` is empty. */
  agentName: string;
  /** Public base URL the agent is reachable at; becomes the card `url`. */
  baseUrl: string;
  /** Skills to advertise, typically derived from the agent's resolved skills. */
  skills?: Array<{ id: string; name: string; description?: string; tags?: string[] }>;
}

/**
 * Map an A2A auth scheme to the JSON-RPC `securitySchemes` value advertised on
 * the card. `none` produces no entry (the card omits `securitySchemes`).
 */
function securitySchemeFor(scheme: A2AAuthScheme): { type: string } | null {
  switch (scheme) {
    case 'bearer':
      return { type: 'http' };
    case 'apiKey':
      return { type: 'apiKey' };
    case 'oauth2':
      return { type: 'oauth2' };
    case 'none':
    default:
      return null;
  }
}

/**
 * Assemble the A2A agent card this agent serves. Node config wins where set;
 * otherwise falls back to the resolved agent metadata (name, skills).
 */
export function buildAgentCard(config: ResolvedA2AConfig, meta: AgentCardMeta): A2AAgentCard {
  const skills: A2ASkillCard[] = (meta.skills ?? []).map((s) => ({
    id: s.id,
    name: s.name || s.id,
    description: s.description ?? '',
    tags: s.tags ?? [],
  }));

  const card: A2AAgentCard = {
    name: config.serverName.trim() || meta.agentName || 'agent',
    description: config.serverDescription.trim(),
    url: meta.baseUrl,
    version: config.version.trim() || '0.1.0',
    capabilities: {
      streaming: config.streaming,
      pushNotifications: config.pushNotifications,
    },
    defaultInputModes:
      config.defaultInputModes.length > 0 ? [...config.defaultInputModes] : ['text/plain'],
    defaultOutputModes:
      config.defaultOutputModes.length > 0 ? [...config.defaultOutputModes] : ['text/plain'],
    skills,
  };

  const security = securitySchemeFor(config.serverAuthScheme);
  if (security) {
    card.securitySchemes = { [config.serverAuthScheme]: security };
  }

  return card;
}

/** The outcome of validating a card fetched from a remote agent. */
export interface CardValidation {
  valid: boolean;
  errors: string[];
  /** The parsed card when `valid`; otherwise `null`. */
  card: A2AAgentCard | null;
}

/**
 * Validate a value fetched from a remote agent's discovery URL as an A2A card.
 * Tolerates a raw object or a JSON string / JSON embedded in prose (via
 * `extractJson`). A card is valid when it carries a `name`, a `url`, and a
 * `capabilities` object; missing `skills`/`version` default rather than fail so
 * minimal cards from lean servers still resolve.
 */
export function validateAgentCard(input: unknown): CardValidation {
  let value: unknown = input;
  if (typeof input === 'string') {
    const extracted = extractJson(input);
    if ('value' in extracted) value = extracted.value;
    else return { valid: false, errors: [extracted.error], card: null };
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, errors: ['card is not an object'], card: null };
  }

  const obj = value as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof obj.name !== 'string' || !obj.name.trim()) errors.push('missing "name"');
  if (typeof obj.url !== 'string' || !obj.url.trim()) errors.push('missing "url"');
  if (!obj.capabilities || typeof obj.capabilities !== 'object') {
    errors.push('missing "capabilities" object');
  }
  if (errors.length > 0) return { valid: false, errors, card: null };

  const caps = obj.capabilities as Record<string, unknown>;
  const rawSkills = Array.isArray(obj.skills) ? obj.skills : [];
  const skills: A2ASkillCard[] = rawSkills
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s) => ({
      id: typeof s.id === 'string' ? s.id : '',
      name: typeof s.name === 'string' ? s.name : '',
      description: typeof s.description === 'string' ? s.description : '',
      tags: Array.isArray(s.tags) ? s.tags.filter((t): t is string => typeof t === 'string') : [],
    }));

  const card: A2AAgentCard = {
    name: (obj.name as string).trim(),
    description: typeof obj.description === 'string' ? obj.description : '',
    url: (obj.url as string).trim(),
    version: typeof obj.version === 'string' ? obj.version : '0.1.0',
    capabilities: {
      streaming: caps.streaming === true,
      pushNotifications: caps.pushNotifications === true,
    },
    defaultInputModes: Array.isArray(obj.defaultInputModes)
      ? obj.defaultInputModes.filter((m): m is string => typeof m === 'string')
      : ['text/plain'],
    defaultOutputModes: Array.isArray(obj.defaultOutputModes)
      ? obj.defaultOutputModes.filter((m): m is string => typeof m === 'string')
      : ['text/plain'],
    skills,
  };
  return { valid: true, errors: [], card };
}

/**
 * The canonical A2A discovery path. Servers publish their card here so clients
 * can find it from a bare origin.
 */
export const WELL_KNOWN_A2A_PATH = '/.well-known/agent.json';

/**
 * Derive the agent-card discovery URL from a base. If `base` already points at a
 * concrete card file (ends in `.json`), it is returned untouched; otherwise the
 * well-known path is appended to the origin, collapsing any duplicate slash.
 */
export function wellKnownCardUrl(base: string, path: string = WELL_KNOWN_A2A_PATH): string {
  const trimmed = base.trim();
  if (!trimmed) return path;
  if (/\.json($|\?)/i.test(trimmed)) return trimmed;
  const origin = trimmed.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${origin}${suffix}`;
}

/**
 * Build the HTTP auth headers for a scheme + credential value. `apiKey` uses the
 * conventional `X-API-Key` header; `bearer`/`oauth2` use `Authorization`. An
 * empty value or `none` yields no headers. The runtime is responsible for
 * resolving env-var names to secrets before calling this.
 */
export function authHeader(scheme: A2AAuthScheme, value: string): Record<string, string> {
  const v = value.trim();
  if (!v || scheme === 'none') return {};
  switch (scheme) {
    case 'apiKey':
      return { 'X-API-Key': v };
    case 'bearer':
    case 'oauth2':
      return { Authorization: v.toLowerCase().startsWith('bearer ') ? v : `Bearer ${v}` };
    default:
      return {};
  }
}

/** A minimal A2A message part. A2A supports `text`, `file`, and `data` parts. */
export interface A2ATextPart {
  kind: 'text';
  text: string;
}

/** A JSON-RPC 2.0 request for the A2A `message/send` method. */
export interface SendMessageRequest {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: string;
  method: 'message/send';
  params: {
    message: {
      role: 'user';
      parts: A2ATextPart[];
      messageId: string;
    };
  };
}

/**
 * Construct a JSON-RPC `message/send` request delegating `text` to a remote
 * agent. `requestId` and `messageId` are supplied by the caller (kept out of the
 * engine so it stays pure — the runtime mints ids).
 */
export function buildSendMessageRequest(
  text: string,
  ids: { requestId: string; messageId: string },
): SendMessageRequest {
  return {
    jsonrpc: JSON_RPC_VERSION,
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
 * Pull the reply text out of an A2A `message/send` result. The result may be a
 * Task (with `status.message.parts` and/or `artifacts[].parts`) or a bare
 * Message (`parts`). Text parts are concatenated in order. A JSON-RPC `error`
 * object surfaces its message. Returns `''` when nothing textual is present.
 */
export function extractTextFromResult(result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const obj = result as Record<string, unknown>;

  if (obj.error && typeof obj.error === 'object') {
    const err = obj.error as Record<string, unknown>;
    return typeof err.message === 'string' ? err.message : '';
  }

  // A JSON-RPC envelope wraps the payload under `result`.
  const payload = (obj.result ?? obj) as Record<string, unknown>;
  const chunks: string[] = [];

  const collectParts = (parts: unknown) => {
    if (!Array.isArray(parts)) return;
    for (const p of parts) {
      if (p && typeof p === 'object') {
        const part = p as Record<string, unknown>;
        if ((part.kind === 'text' || part.type === 'text') && typeof part.text === 'string') {
          chunks.push(part.text);
        }
      }
    }
  };

  // Bare Message: parts at the top level.
  collectParts(payload.parts);

  // Task: latest status message.
  const status = payload.status as Record<string, unknown> | undefined;
  if (status && typeof status === 'object') {
    const msg = status.message as Record<string, unknown> | undefined;
    if (msg) collectParts(msg.parts);
  }

  // Task: artifacts.
  if (Array.isArray(payload.artifacts)) {
    for (const a of payload.artifacts) {
      if (a && typeof a === 'object') collectParts((a as Record<string, unknown>).parts);
    }
  }

  return chunks.join('\n').trim();
}

/**
 * The delegate tool name a remote agent is exposed as when `exposeAsTools` is
 * set: `a2a_send_<slug>` where the slug is the agent's name lowercased with
 * non-alphanumerics collapsed to underscores. Falls back to the agent id when
 * the name has no usable characters, and to a bare `a2a_send` as a last resort.
 */
export function remoteToolName(remote: Pick<ResolvedA2ARemoteAgent, 'id' | 'name'>): string {
  const slugify = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  const slug = slugify(remote.name) || slugify(remote.id);
  return slug ? `a2a_send_${slug}` : 'a2a_send';
}
