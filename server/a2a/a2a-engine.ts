import type {
  ResolvedA2AConfig,
  ResolvedA2ARemoteAgent,
  SkillDefinition,
} from '../../shared/agent-config';

/**
 * Agent-to-Agent (A2A) interop engine.
 *
 * An A2A node exposes this agent over the A2A protocol and/or registers remote
 * A2A agents as delegates. A2A is the emerging cross-framework standard for
 * agents to discover and task one another: a server publishes an **Agent Card**
 * (its identity, endpoint, capabilities, and skills) and peers exchange
 * **message/task envelopes** over JSON-RPC, optionally streaming updates over
 * SSE. Where MCP standardized tools, A2A standardizes agent-to-agent calls.
 *
 * This module is the dependency-free substrate the server calls; it owns:
 *   - Agent Card construction from the resolved config (`buildAgentCard`),
 *   - the `/.well-known` card URL (`agentCardUrl`),
 *   - inbound message-envelope validation (`validateIncomingMessage`) and text
 *     extraction (`extractMessageText`),
 *   - the task-state machine (`canTransition` / `isTerminalState`), and
 *   - remote-delegate lookup (`selectRemoteAgent`).
 *
 * Wiring the HTTP surface (an Express route that serves the card, accepts
 * `message/send` + `message/stream`, and drives a headless run per task) into
 * `server/agents/run-coordinator.ts` is the remaining integration step; the API
 * below is the stable surface that wiring targets.
 */

/** A2A protocol version this engine targets. */
export const A2A_PROTOCOL_VERSION = '0.2.0';

/**
 * Canonical A2A task lifecycle states. A task starts `submitted`, moves through
 * `working`, and ends in one of the terminal states (or pauses in
 * `input-required` / `auth-required` awaiting the caller).
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

/** Allowed forward transitions in the task-state machine. */
const TRANSITIONS: Record<A2ATaskState, readonly A2ATaskState[]> = {
  submitted: ['working', 'canceled', 'rejected', 'failed'],
  working: ['input-required', 'auth-required', 'completed', 'canceled', 'failed'],
  'input-required': ['working', 'canceled', 'failed'],
  'auth-required': ['working', 'canceled', 'failed', 'rejected'],
  completed: [],
  canceled: [],
  failed: [],
  rejected: [],
};

/** Whether `state` is a terminal task state (no further transitions allowed). */
export function isTerminalState(state: A2ATaskState): boolean {
  return TERMINAL_STATES.has(state);
}

/** Whether a task may move from `from` to `to` under the A2A state machine. */
export function canTransition(from: A2ATaskState, to: A2ATaskState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

// --- Agent Card ---

export interface A2AAgentSkillCard {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

export interface A2AAgentCapabilities {
  streaming: boolean;
  pushNotifications: boolean;
  stateTransitionHistory: boolean;
}

export interface A2AAgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  /** Absolute URL of the A2A endpoint this card describes. */
  url: string;
  version: string;
  capabilities: A2AAgentCapabilities;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  /** Named security schemes peers must satisfy, or `null` for open access. */
  securitySchemes: Record<string, { type: string; scheme?: string; in?: string }> | null;
  skills: A2AAgentSkillCard[];
}

/** Join a base URL and a mount path without doubling or dropping slashes. */
export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

/**
 * URL a peer fetches to discover this agent. A2A servers publish their Agent
 * Card at `<endpoint>/.well-known/agent-card.json`.
 */
export function agentCardUrl(config: ResolvedA2AConfig, baseUrl: string): string {
  return `${joinUrl(baseUrl, config.serverPath)}/.well-known/agent-card.json`;
}

/** Map the resolved auth scheme to an A2A `securitySchemes` object (or null). */
export function buildSecuritySchemes(
  config: ResolvedA2AConfig,
): A2AAgentCard['securitySchemes'] {
  switch (config.authScheme) {
    case 'bearer':
      return { bearer: { type: 'http', scheme: 'bearer' } };
    case 'apiKey':
      return { apiKey: { type: 'apiKey', in: 'header' } };
    case 'none':
    default:
      return null;
  }
}

/** Turn a connected skill into an A2A skill-card entry. */
function skillToCard(skill: SkillDefinition): A2AAgentSkillCard {
  const description =
    skill.content.trim().split('\n')[0]?.slice(0, 200) || skill.name;
  return { id: skill.id, name: skill.name, description, tags: ['skill'] };
}

/**
 * Build the Agent Card this agent publishes, or `null` when A2A is disabled or
 * the server surface is not exposed (client-only registration still returns
 * `null` here — the card describes the *inbound* surface).
 *
 * `skills` are the agent's connected skills; they are only published when
 * `config.publishSkills` is set.
 */
export function buildAgentCard(
  config: ResolvedA2AConfig,
  baseUrl: string,
  skills: SkillDefinition[] = [],
): A2AAgentCard | null {
  if (!config.enabled || !config.exposeAsServer) return null;

  return {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name: config.agentName,
    description: config.agentDescription,
    url: joinUrl(baseUrl, config.serverPath),
    version: config.version,
    capabilities: {
      streaming: config.streaming,
      pushNotifications: config.pushNotifications,
      stateTransitionHistory: config.stateTransitionHistory,
    },
    defaultInputModes: [...config.defaultInputModes],
    defaultOutputModes: [...config.defaultOutputModes],
    securitySchemes: buildSecuritySchemes(config),
    skills: config.publishSkills ? skills.map(skillToCard) : [],
  };
}

// --- Message envelopes ---

export interface A2AMessagePart {
  kind: 'text' | 'file' | 'data';
  text?: string;
  [k: string]: unknown;
}

export interface A2AMessage {
  role: 'user' | 'agent';
  parts: A2AMessagePart[];
  messageId?: string;
}

/**
 * Validate an inbound A2A message envelope. Returns the typed message on
 * success or a human-readable `error` the server maps to a JSON-RPC invalid
 * params response. Kept strict on shape but lenient on unknown fields so newer
 * A2A part kinds pass through untouched.
 */
export function validateIncomingMessage(
  raw: unknown,
): { message: A2AMessage } | { error: string } {
  if (!raw || typeof raw !== 'object') {
    return { error: 'message must be an object' };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.role !== 'user' && obj.role !== 'agent') {
    return { error: "message.role must be 'user' or 'agent'" };
  }
  if (!Array.isArray(obj.parts) || obj.parts.length === 0) {
    return { error: 'message.parts must be a non-empty array' };
  }
  const parts: A2AMessagePart[] = [];
  for (const p of obj.parts) {
    if (!p || typeof p !== 'object') {
      return { error: 'each part must be an object' };
    }
    const part = p as Record<string, unknown>;
    if (
      part.kind !== 'text' &&
      part.kind !== 'file' &&
      part.kind !== 'data'
    ) {
      return { error: "part.kind must be 'text', 'file', or 'data'" };
    }
    if (part.kind === 'text' && typeof part.text !== 'string') {
      return { error: 'text part must carry a string `text`' };
    }
    parts.push(part as A2AMessagePart);
  }
  const message: A2AMessage = {
    role: obj.role,
    parts,
    ...(typeof obj.messageId === 'string' ? { messageId: obj.messageId } : {}),
  };
  return { message };
}

/**
 * Concatenate the text of every text part in a message, in order. Non-text
 * parts (file/data) are skipped — the runtime handles those separately.
 */
export function extractMessageText(message: A2AMessage): string {
  return message.parts
    .filter((p) => p.kind === 'text' && typeof p.text === 'string')
    .map((p) => p.text as string)
    .join('\n')
    .trim();
}

// --- Remote delegates ---

/**
 * Look up a registered remote A2A peer by its local alias. Returns `null` when
 * no peer matches, which the caller surfaces as an unknown-delegate error.
 */
export function selectRemoteAgent(
  config: ResolvedA2AConfig,
  name: string,
): ResolvedA2ARemoteAgent | null {
  return config.remoteAgents.find((r) => r.name === name) ?? null;
}
