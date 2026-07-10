import type {
  ResolvedA2AConfig,
  ResolvedA2ARemoteAgent,
  A2AAuthScheme,
} from '../../shared/agent-config';

/**
 * Agent-to-Agent (A2A) interop engine.
 *
 * The A2A protocol standardizes cross-framework agent interop the way MCP
 * standardized tools: an agent publishes an **agent card** (a JSON document at
 * `/.well-known/agent-card.json`) describing who it is and what it can do, and
 * peers exchange **tasks** carrying **messages** through a small JSON-RPC-style
 * surface (`message/send`, `message/stream`, `tasks/get`, `tasks/cancel`). Each
 * task walks a fixed lifecycle of states.
 *
 * This module is the dependency-free substrate the runtime calls. It owns:
 *   - building the agent card this agent advertises (server side),
 *   - the task-state lifecycle and its legal transitions,
 *   - validating and normalizing inbound task envelopes,
 *   - selecting a resolved remote delegate to call (client side).
 *
 * The runtime owns the actual HTTP/SSE endpoints and the outbound fetches; this
 * module never touches the network, so it stays pure and unit-testable.
 *
 * Wiring the card route + task endpoints into the server (`server/a2a/`) and
 * registering remote delegates as callable tools in
 * `server/agents/run-coordinator.ts` is the remaining integration step; the API
 * below is the stable surface that wiring targets.
 */

/** A2A protocol revision this engine targets. */
export const A2A_PROTOCOL_VERSION = '0.2.0';

/** A skill entry advertised on the agent card. */
export interface A2ASkillDescriptor {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  examples?: string[];
}

/** Capability flags advertised on the agent card. */
export interface A2ACardCapabilities {
  streaming: boolean;
  pushNotifications: boolean;
  stateTransitionHistory: boolean;
}

/** The published agent card (subset of the A2A AgentCard schema). */
export interface A2AAgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  url: string;
  version: string;
  preferredTransport: string;
  capabilities: A2ACardCapabilities;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: A2ASkillDescriptor[];
  securitySchemes: Record<string, { type: string; scheme?: string; description?: string }>;
  security: Array<Record<string, string[]>>;
}

/**
 * A2A task lifecycle states. Mirrors the protocol's `TaskState` enum: a task is
 * `submitted`, transitions through `working` (and optionally `input-required`
 * for a clarification turn), and settles in one terminal state.
 */
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

/** Legal forward transitions between task states. Terminal states have none. */
const TRANSITIONS: Record<A2ATaskState, ReadonlySet<A2ATaskState>> = {
  submitted: new Set(['working', 'rejected', 'canceled']),
  working: new Set(['input-required', 'completed', 'failed', 'canceled']),
  'input-required': new Set(['working', 'completed', 'failed', 'canceled']),
  completed: new Set(),
  canceled: new Set(),
  failed: new Set(),
  rejected: new Set(),
};

/** Whether `state` is a settled/terminal task state. */
export function isTerminalState(state: A2ATaskState): boolean {
  return TERMINAL_STATES.has(state);
}

/** Whether a task may move from `from` to `to` under the A2A lifecycle. */
export function canTransition(from: A2ATaskState, to: A2ATaskState): boolean {
  return TRANSITIONS[from]?.has(to) ?? false;
}

/**
 * Map the card's auth scheme to an OpenAPI-style `securitySchemes` entry plus
 * the `security` requirement list the card advertises. `none` yields empty
 * objects (no auth advertised).
 */
export function buildSecuritySchemes(scheme: A2AAuthScheme): {
  securitySchemes: A2AAgentCard['securitySchemes'];
  security: A2AAgentCard['security'];
} {
  switch (scheme) {
    case 'apiKey':
      return {
        securitySchemes: { apiKey: { type: 'apiKey', description: 'API key in the X-API-Key header.' } },
        security: [{ apiKey: [] }],
      };
    case 'bearer':
      return {
        securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'Bearer token.' } },
        security: [{ bearer: [] }],
      };
    case 'oauth2':
      return {
        securitySchemes: { oauth2: { type: 'oauth2', description: 'OAuth 2.0 client-credentials flow.' } },
        security: [{ oauth2: [] }],
      };
    case 'none':
    default:
      return { securitySchemes: {}, security: [] };
  }
}

/**
 * Build the agent card this agent publishes. `fallbackName` supplies the card
 * `name` when the node leaves `agentName` empty (falls back to the agent's own
 * name). `skills` are the agent's resolved skills projected into card skills.
 */
export function buildAgentCard(
  config: ResolvedA2AConfig,
  fallbackName: string,
  skills: A2ASkillDescriptor[] = [],
): A2AAgentCard {
  const { securitySchemes, security } = buildSecuritySchemes(config.authScheme);
  return {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name: config.agentName.trim() || fallbackName,
    description: config.agentDescription.trim(),
    url: config.serverUrl.trim(),
    version: config.version.trim() || '0.0.0',
    preferredTransport: config.transport,
    capabilities: {
      streaming: config.streaming,
      pushNotifications: config.pushNotifications,
      stateTransitionHistory: true,
    },
    defaultInputModes: dedupeStrings(config.defaultInputModes, ['text/plain']),
    defaultOutputModes: dedupeStrings(config.defaultOutputModes, ['text/plain']),
    skills,
    securitySchemes,
    security,
  };
}

function dedupeStrings(values: string[], fallback: string[]): string[] {
  const cleaned = values.map((v) => v.trim()).filter(Boolean);
  const unique = Array.from(new Set(cleaned));
  return unique.length > 0 ? unique : fallback;
}

/** One text/data part of an A2A message. */
export interface A2APart {
  kind: 'text' | 'data' | 'file';
  text?: string;
  data?: unknown;
}

/** An A2A message (a turn in a task's conversation). */
export interface A2AMessage {
  role: 'user' | 'agent';
  parts: A2APart[];
  messageId: string;
  taskId?: string;
}

/** Result of validating an inbound `message/send` params object. */
export interface TaskEnvelopeValidation {
  valid: boolean;
  errors: string[];
  message: A2AMessage | null;
}

/**
 * Validate and normalize an inbound A2A `message/send` params object into an
 * `A2AMessage`. Tolerates messages whose parts are bare strings (normalized to
 * text parts). Returns the recovered message and a list of validation errors;
 * `valid` is true only when there are no errors.
 */
export function validateTaskEnvelope(raw: unknown): TaskEnvelopeValidation {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { valid: false, errors: ['envelope must be an object'], message: null };
  }
  const obj = raw as Record<string, unknown>;
  const msg = (obj.message ?? obj) as Record<string, unknown>;

  const role = msg.role === 'agent' ? 'agent' : 'user';
  if (msg.role !== undefined && msg.role !== 'user' && msg.role !== 'agent') {
    errors.push(`invalid role "${String(msg.role)}"`);
  }

  const rawParts = Array.isArray(msg.parts) ? msg.parts : [];
  if (rawParts.length === 0) {
    errors.push('message must carry at least one part');
  }
  const parts: A2APart[] = rawParts.map((p): A2APart => {
    if (typeof p === 'string') return { kind: 'text', text: p };
    if (p && typeof p === 'object') {
      const po = p as Record<string, unknown>;
      if (typeof po.text === 'string') return { kind: 'text', text: po.text };
      if ('data' in po) return { kind: 'data', data: po.data };
    }
    errors.push('unsupported part shape');
    return { kind: 'text', text: '' };
  });

  const messageId =
    typeof msg.messageId === 'string' && msg.messageId.trim()
      ? msg.messageId
      : '';
  if (!messageId) errors.push('messageId is required');

  const taskId = typeof msg.taskId === 'string' ? msg.taskId : undefined;

  return {
    valid: errors.length === 0,
    errors,
    message: { role, parts, messageId, taskId },
  };
}

/**
 * Select an enabled remote delegate by id. Returns `null` when the id is unknown
 * or the delegate is disabled, which the runtime treats as "not callable".
 */
export function selectRemoteAgent(
  config: ResolvedA2AConfig,
  id: string,
): ResolvedA2ARemoteAgent | null {
  const match = config.remoteAgents.find((r) => r.id === id);
  return match && match.enabled ? match : null;
}

/**
 * Whether the resolved config exposes a usable A2A server: enabled, exposing a
 * server, and advertising a non-empty endpoint URL.
 */
export function isServerExposed(config: ResolvedA2AConfig): boolean {
  return config.enabled && config.exposeAsServer && config.serverUrl.trim().length > 0;
}

/** The enabled remote delegates the agent can actually call. */
export function callableDelegates(config: ResolvedA2AConfig): ResolvedA2ARemoteAgent[] {
  if (!config.enabled) return [];
  return config.remoteAgents.filter((r) => r.enabled && r.cardUrl.trim().length > 0);
}
