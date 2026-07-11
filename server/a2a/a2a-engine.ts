import type {
  ResolvedA2AConfig,
  ResolvedA2ARemote,
  ResolvedA2ASkill,
} from '../../shared/agent-config';

/**
 * Agent-to-Agent (A2A) interop engine.
 *
 * A2A is the emerging cross-framework protocol for agent interop: an agent
 * publishes an **Agent Card** describing its identity, capabilities, and skills;
 * callers discover it (conventionally at `…/.well-known/agent-card.json`) and
 * exchange task and message envelopes over HTTP, with streaming status
 * updates as a task moves through its lifecycle. It standardizes agent↔agent
 * calls much as MCP standardized tools.
 *
 * This module is the dependency-free substrate the runtime calls. It owns:
 *
 *   - assembling the Agent Card this agent publishes (server side),
 *   - validating a card fetched from a remote before trusting it (client side),
 *   - constructing and validating the task/message envelopes exchanged,
 *   - normalizing task lifecycle states and deciding when a task is terminal,
 *   - selecting which registered remote should handle a given capability.
 *
 * The HTTP surface — serving the card, an `POST /` JSON-RPC / REST endpoint,
 * SSE streaming, and the fetch client that dispatches to remotes — is the
 * remaining integration step (`server/a2a/a2a-server.ts` + wiring into
 * `server/agents/run-coordinator.ts`). Everything here is pure so it stays unit
 * testable and framework-agnostic; ids and timestamps are passed in by the
 * caller rather than generated, so the same call is deterministic under test.
 */

// --- Agent Card ---

/** A skill advertised on an Agent Card. Mirrors the A2A `AgentSkill` object. */
export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

/** The capabilities block of an Agent Card. */
export interface AgentCapabilities {
  streaming: boolean;
  pushNotifications: boolean;
}

/** A published Agent Card. A subset of the A2A `AgentCard` schema. */
export interface AgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  /** Version of the A2A protocol this card speaks. */
  protocolVersion: string;
  capabilities: AgentCapabilities;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: AgentSkill[];
  /** Named security schemes; empty when the agent advertises no auth. */
  securitySchemes: Record<string, { type: string; scheme?: string; in?: string; name?: string }>;
  /** Which of `securitySchemes` a caller must satisfy. */
  security: Array<Record<string, string[]>>;
}

/** The A2A protocol version this engine targets. */
export const A2A_PROTOCOL_VERSION = '0.2.0';

/** Conventional path a published Agent Card is served from. */
export const AGENT_CARD_PATH = '/.well-known/agent-card.json';

/**
 * Translate a resolved node's auth scheme into the card's `securitySchemes` /
 * `security` blocks. `none` yields empty blocks (open agent).
 */
function buildSecurity(config: ResolvedA2AConfig): Pick<AgentCard, 'securitySchemes' | 'security'> {
  switch (config.authScheme) {
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
    case 'none':
    default:
      return { securitySchemes: {}, security: [] };
  }
}

/**
 * Assemble the Agent Card this agent publishes from its resolved A2A config.
 * The card is what remote frameworks fetch to discover and task this agent.
 */
export function buildAgentCard(config: ResolvedA2AConfig): AgentCard {
  const { securitySchemes, security } = buildSecurity(config);
  return {
    name: config.agentName.trim() || config.label,
    description: config.agentDescription.trim(),
    url: config.agentUrl.replace(/\/+$/, ''),
    version: config.version.trim() || '0.1.0',
    protocolVersion: A2A_PROTOCOL_VERSION,
    capabilities: {
      streaming: config.streaming,
      pushNotifications: config.pushNotifications,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: config.skills.map(
      (s: ResolvedA2ASkill): AgentSkill => ({
        id: s.id,
        name: s.name,
        description: s.description,
        tags: s.tags.filter((t) => t.trim().length > 0),
      }),
    ),
    securitySchemes,
    security,
  };
}

/**
 * Validate a card fetched from a remote before registering it as a delegate.
 * Returns a list of human-readable problems; an empty list means the card is
 * structurally usable. Tolerant of unknown extra fields (forward-compatible).
 */
export function validateAgentCard(card: unknown): string[] {
  const errors: string[] = [];
  if (!card || typeof card !== 'object') {
    return ['card is not an object'];
  }
  const c = card as Record<string, unknown>;
  if (typeof c.name !== 'string' || c.name.trim() === '') errors.push('missing name');
  if (typeof c.url !== 'string' || c.url.trim() === '') errors.push('missing url');
  if (typeof c.version !== 'string' || c.version.trim() === '') errors.push('missing version');
  if (c.skills !== undefined && !Array.isArray(c.skills)) errors.push('skills must be an array');
  if (c.capabilities !== undefined && (typeof c.capabilities !== 'object' || c.capabilities === null)) {
    errors.push('capabilities must be an object');
  }
  return errors;
}

// --- Task / Message envelopes ---

/**
 * A2A task lifecycle states. `working` and `input-required` are non-terminal;
 * the rest are terminal. See the A2A `TaskState` enum.
 */
export const A2A_TASK_STATES = [
  'submitted',
  'working',
  'input-required',
  'completed',
  'canceled',
  'failed',
  'rejected',
] as const;

export type A2ATaskState = (typeof A2A_TASK_STATES)[number];

const TERMINAL_STATES = new Set<A2ATaskState>([
  'completed',
  'canceled',
  'failed',
  'rejected',
]);

/** Whether a task in this state will not transition further. */
export function isTerminalState(state: A2ATaskState): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * Coerce an arbitrary remote-reported state string into a known `A2ATaskState`.
 * Unknown/blank states are treated as `working` (non-terminal) so a caller keeps
 * polling rather than prematurely finalizing on a state it does not understand.
 */
export function normalizeTaskState(raw: unknown): A2ATaskState {
  if (typeof raw !== 'string') return 'working';
  const s = raw.trim().toLowerCase().replace(/_/g, '-');
  return (A2A_TASK_STATES as readonly string[]).includes(s) ? (s as A2ATaskState) : 'working';
}

/** A single part of a message. This engine handles text parts. */
export interface TextPart {
  kind: 'text';
  text: string;
}

/** An A2A message. Mirrors the protocol `Message` object (text parts only). */
export interface A2AMessage {
  kind: 'message';
  role: 'user' | 'agent';
  parts: TextPart[];
  messageId: string;
  taskId?: string;
  contextId?: string;
}

/**
 * Build an A2A message envelope. `messageId` (and any `taskId`/`contextId`) are
 * supplied by the caller so construction is deterministic and side-effect free.
 */
export function buildMessage(params: {
  role: 'user' | 'agent';
  text: string;
  messageId: string;
  taskId?: string;
  contextId?: string;
}): A2AMessage {
  const msg: A2AMessage = {
    kind: 'message',
    role: params.role,
    parts: [{ kind: 'text', text: params.text }],
    messageId: params.messageId,
  };
  if (params.taskId) msg.taskId = params.taskId;
  if (params.contextId) msg.contextId = params.contextId;
  return msg;
}

/** Parameters for a `message/send` request against a remote agent. */
export interface SendMessageParams {
  message: A2AMessage;
}

/**
 * Build the JSON-RPC request body for dispatching a message to a remote agent
 * (`message/send`, or `message/stream` when streaming is requested). `id` is the
 * caller-supplied JSON-RPC correlation id.
 */
export function buildSendMessageRequest(
  message: A2AMessage,
  id: string | number,
  opts: { stream?: boolean } = {},
): { jsonrpc: '2.0'; id: string | number; method: string; params: SendMessageParams } {
  return {
    jsonrpc: '2.0',
    id,
    method: opts.stream ? 'message/stream' : 'message/send',
    params: { message },
  };
}

/** A task as returned by a remote, reduced to the fields the runtime consumes. */
export interface A2ATaskResult {
  id: string;
  contextId: string;
  state: A2ATaskState;
  /** Concatenated text of the agent's reply, when the task produced one. */
  text: string;
  terminal: boolean;
}

/**
 * Extract an `A2ATaskResult` from a remote's JSON-RPC response. Understands both
 * a `Task` result (with `status.state` and `artifacts`/`history`) and a bare
 * `Message` result (a synchronous reply with no task). Returns `null` when the
 * payload carries a JSON-RPC `error` or is unparseable, which the runtime maps
 * to its configured `onRemoteError` policy.
 */
export function parseTaskResult(response: unknown): A2ATaskResult | null {
  if (!response || typeof response !== 'object') return null;
  const r = response as Record<string, unknown>;
  if (r.error) return null;
  const result = (r.result ?? r) as Record<string, unknown>;

  // Bare Message result — a synchronous reply, no task lifecycle.
  if (result.kind === 'message') {
    return {
      id: typeof result.messageId === 'string' ? result.messageId : '',
      contextId: typeof result.contextId === 'string' ? result.contextId : '',
      state: 'completed',
      text: extractText(result.parts),
      terminal: true,
    };
  }

  const status = (result.status ?? {}) as Record<string, unknown>;
  const state = normalizeTaskState(status.state);
  return {
    id: typeof result.id === 'string' ? result.id : '',
    contextId: typeof result.contextId === 'string' ? result.contextId : '',
    state,
    text: extractTaskText(result),
    terminal: isTerminalState(state),
  };
}

/** Concatenate the text of an array of message parts. */
function extractText(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter(
      (p): p is TextPart =>
        !!p && typeof p === 'object' && (p as TextPart).kind === 'text' && typeof (p as TextPart).text === 'string',
    )
    .map((p) => p.text)
    .join('');
}

/**
 * Pull the agent's reply text out of a Task: prefer artifact parts, then the
 * final agent message in `history`.
 */
function extractTaskText(task: Record<string, unknown>): string {
  const artifacts = task.artifacts;
  if (Array.isArray(artifacts) && artifacts.length > 0) {
    const joined = artifacts
      .map((a) => extractText((a as Record<string, unknown>)?.parts))
      .filter((t) => t.length > 0)
      .join('\n');
    if (joined) return joined;
  }
  const history = task.history;
  if (Array.isArray(history)) {
    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i] as Record<string, unknown>;
      if (msg?.role === 'agent') {
        const text = extractText(msg.parts);
        if (text) return text;
      }
    }
  }
  const status = task.status as Record<string, unknown> | undefined;
  if (status?.message) return extractText((status.message as Record<string, unknown>).parts);
  return '';
}

// --- Delegate selection ---

/**
 * Choose which registered remote should handle a request, by matching a
 * capability hint against remote ids/names. `hint` is typically a skill id or a
 * keyword drawn from the delegating turn. Returns the first case-insensitive
 * match on id or name, else the first remote as a fallback, else `null` when no
 * remotes are registered.
 */
export function selectDelegate(
  config: ResolvedA2AConfig,
  hint: string,
): ResolvedA2ARemote | null {
  const remotes = config.remotes;
  if (remotes.length === 0) return null;
  const needle = hint.trim().toLowerCase();
  if (needle) {
    const match = remotes.find(
      (r) => r.id.toLowerCase() === needle || r.name.toLowerCase().includes(needle),
    );
    if (match) return match;
  }
  return remotes[0];
}

/** Whether this agent should serve a card (server or both mode, and enabled). */
export function servesCard(config: ResolvedA2AConfig): boolean {
  return config.enabled && (config.mode === 'server' || config.mode === 'both');
}

/** Whether this agent may delegate to remotes (client or both mode, and enabled). */
export function delegatesToRemotes(config: ResolvedA2AConfig): boolean {
  return config.enabled && (config.mode === 'client' || config.mode === 'both');
}
