import type { ResolvedA2AConfig, ResolvedA2ARemoteAgent } from '../../shared/agent-config';

/**
 * Agent-to-Agent (A2A) interop engine.
 *
 * A2A is the emerging cross-framework protocol for agents to discover and call
 * one another: an **agent card** advertises capabilities, a JSON-RPC 2.0
 * task/message envelope carries work, and streamed status updates report
 * progress through a small task state machine. This module is the
 * dependency-free substrate the server calls; it owns agent-card construction,
 * the task state machine, inbound-request validation, and turning remote agents
 * into callable delegate tool descriptors, while the server owns the HTTP/SSE
 * transport and the actual model calls.
 *
 * The orchestration the A2A server performs:
 *
 *   1. Serve `buildAgentCard(config, baseUrl)` at
 *      `<serverPath>/.well-known/agent-card.json` so callers can discover this
 *      agent (server mode).
 *   2. On an inbound `message/send`, validate the params with
 *      `validateMessageSend(...)`, create a task in state `submitted`, and drive
 *      it through `nextTaskState(...)` as the run progresses.
 *   3. In client mode, expose each remote agent flagged `exposeAsTool` to the
 *      local agent via `resolveDelegateTools(config)`; a call routes an outbound
 *      `message/send` to the remote's card URL.
 *
 * Wiring this into an Express router under `server/a2a/` (mount the card + task
 * endpoints, bridge `runtime.prompt()` to task state, register delegate tools
 * through the tool factory) is the remaining integration step; the API below is
 * the stable surface that wiring targets.
 */

// --- Agent card ---

export interface A2AAgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

export interface A2AAgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  /** Absolute URL of this agent's A2A endpoint. */
  url: string;
  version: string;
  preferredTransport: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransitionHistory: boolean;
  };
  /** Named security schemes, keyed by scheme name; empty when auth is `none`. */
  securitySchemes: Record<string, { type: string; scheme?: string; in?: string; name?: string }>;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: A2AAgentSkill[];
}

/** A2A protocol revision this engine targets. */
export const A2A_PROTOCOL_VERSION = '0.3.0';

/** Transport label advertised in the card, per the resolved node transport. */
const PREFERRED_TRANSPORT = 'JSONRPC';

function securitySchemesFor(
  scheme: ResolvedA2AConfig['authScheme'],
): A2AAgentCard['securitySchemes'] {
  switch (scheme) {
    case 'bearer':
      return { bearer: { type: 'http', scheme: 'bearer' } };
    case 'apiKey':
      return { apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' } };
    case 'none':
    default:
      return {};
  }
}

/**
 * Build the A2A agent card served for discovery. `baseUrl` is the externally
 * reachable origin (e.g. `https://host:3000`); the card `url` is that origin
 * joined with the node's `serverPath`, with any duplicate slash collapsed.
 */
export function buildAgentCard(config: ResolvedA2AConfig, baseUrl: string): A2AAgentCard {
  const origin = baseUrl.replace(/\/+$/, '');
  const path = config.serverPath.startsWith('/')
    ? config.serverPath
    : `/${config.serverPath}`;
  return {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name: config.cardName,
    description: config.cardDescription,
    url: `${origin}${path}`,
    version: '1.0.0',
    preferredTransport: PREFERRED_TRANSPORT,
    capabilities: {
      streaming: config.streaming,
      pushNotifications: config.pushNotifications,
      stateTransitionHistory: config.stateTransitionHistory,
    },
    securitySchemes: securitySchemesFor(config.authScheme),
    defaultInputModes: config.defaultInputModes.length
      ? [...config.defaultInputModes]
      : ['text/plain'],
    defaultOutputModes: config.defaultOutputModes.length
      ? [...config.defaultOutputModes]
      : ['text/plain'],
    skills: config.skills.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      tags: [...s.tags],
    })),
  };
}

// --- Task state machine ---

export type A2ATaskState =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'canceled'
  | 'failed';

export const A2A_TASK_STATES: readonly A2ATaskState[] = [
  'submitted',
  'working',
  'input-required',
  'completed',
  'canceled',
  'failed',
];

const TERMINAL_TASK_STATES: ReadonlySet<A2ATaskState> = new Set<A2ATaskState>([
  'completed',
  'canceled',
  'failed',
]);

/** Whether a task state is terminal (no further transitions are allowed). */
export function isTerminalTaskState(state: A2ATaskState): boolean {
  return TERMINAL_TASK_STATES.has(state);
}

/**
 * Events that advance a task. `cancel` is valid from any non-terminal state;
 * the rest follow the normal submitted → working → completed lifecycle with an
 * `input-required` detour for clarification.
 */
export type A2ATaskEvent =
  | 'start'
  | 'need_input'
  | 'resume'
  | 'complete'
  | 'fail'
  | 'cancel';

const TRANSITIONS: Record<A2ATaskState, Partial<Record<A2ATaskEvent, A2ATaskState>>> = {
  submitted: { start: 'working', cancel: 'canceled', fail: 'failed' },
  working: {
    need_input: 'input-required',
    complete: 'completed',
    fail: 'failed',
    cancel: 'canceled',
  },
  'input-required': { resume: 'working', cancel: 'canceled', fail: 'failed' },
  completed: {},
  canceled: {},
  failed: {},
};

/**
 * Advance a task by one event. Returns the next state, or `null` when the event
 * is not legal from `current` (including any event from a terminal state), which
 * the server should surface as a protocol error rather than silently applying.
 */
export function nextTaskState(
  current: A2ATaskState,
  event: A2ATaskEvent,
): A2ATaskState | null {
  return TRANSITIONS[current][event] ?? null;
}

// --- Message parts ---

export interface A2ATextPart {
  kind: 'text';
  text: string;
}
export interface A2AFilePart {
  kind: 'file';
  file: { name?: string; mimeType?: string; uri?: string; bytes?: string };
}
export interface A2ADataPart {
  kind: 'data';
  data: Record<string, unknown>;
}
export type A2APart = A2ATextPart | A2AFilePart | A2ADataPart;

export interface A2AMessage {
  role: 'user' | 'agent';
  parts: A2APart[];
  messageId?: string;
}

/** Wrap plain text as a single-part A2A message from the given role. */
export function textToParts(text: string): A2APart[] {
  return [{ kind: 'text', text }];
}

/** Concatenate the text of every text part, ignoring file/data parts. */
export function partsToText(parts: A2APart[]): string {
  return parts
    .filter((p): p is A2ATextPart => p.kind === 'text')
    .map((p) => p.text)
    .join('');
}

// --- Inbound request validation ---

export type MessageSendValidation =
  | { ok: true; message: A2AMessage }
  | { ok: false; errors: string[] };

function validatePart(part: unknown, index: number, errors: string[]): void {
  if (!part || typeof part !== 'object') {
    errors.push(`parts[${index}] must be an object`);
    return;
  }
  const kind = (part as { kind?: unknown }).kind;
  if (kind === 'text') {
    if (typeof (part as { text?: unknown }).text !== 'string') {
      errors.push(`parts[${index}] of kind "text" requires a string "text"`);
    }
  } else if (kind === 'file') {
    if (!(part as { file?: unknown }).file || typeof (part as { file?: unknown }).file !== 'object') {
      errors.push(`parts[${index}] of kind "file" requires a "file" object`);
    }
  } else if (kind === 'data') {
    const data = (part as { data?: unknown }).data;
    if (!data || typeof data !== 'object') {
      errors.push(`parts[${index}] of kind "data" requires a "data" object`);
    }
  } else {
    errors.push(`parts[${index}] has unknown kind ${JSON.stringify(kind)}`);
  }
}

/**
 * Validate the `params` of an inbound `message/send` (or `message/stream`)
 * request. Enforces a well-formed `message` with a valid `role` and a non-empty
 * `parts` array of recognized parts. Returns the narrowed message on success or
 * a list of human-readable errors the server can return as JSON-RPC error data.
 */
export function validateMessageSend(raw: unknown): MessageSendValidation {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['params must be an object'] };
  }
  const message = (raw as { message?: unknown }).message;
  if (!message || typeof message !== 'object') {
    return { ok: false, errors: ['params.message is required'] };
  }
  const role = (message as { role?: unknown }).role;
  if (role !== 'user' && role !== 'agent') {
    errors.push('message.role must be "user" or "agent"');
  }
  const parts = (message as { parts?: unknown }).parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    errors.push('message.parts must be a non-empty array');
  } else {
    parts.forEach((p, i) => validatePart(p, i, errors));
  }
  const messageId = (message as { messageId?: unknown }).messageId;
  if (messageId !== undefined && typeof messageId !== 'string') {
    errors.push('message.messageId, when present, must be a string');
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    message: {
      role: role as 'user' | 'agent',
      parts: parts as A2APart[],
      ...(typeof messageId === 'string' ? { messageId } : {}),
    },
  };
}

// --- Delegate tools (client mode) ---

export interface DelegateToolSpec {
  name: string;
  description: string;
  /** Id of the remote agent this delegate routes to. */
  remoteAgentId: string;
  cardUrl: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

/**
 * Derive a stable, valid tool name from a remote agent. Non-alphanumeric runs
 * collapse to a single underscore and the whole thing is lower-cased, prefixed
 * `a2a_` so delegates are recognizable in the tool catalog. Falls back to the
 * agent id when the name has no usable characters.
 */
export function delegateToolName(remote: ResolvedA2ARemoteAgent): string {
  const base = remote.name.trim() || remote.id;
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `a2a_${slug || remote.id.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
}

/** Build the callable tool descriptor for one remote A2A agent. */
export function buildDelegateToolSpec(remote: ResolvedA2ARemoteAgent): DelegateToolSpec {
  return {
    name: delegateToolName(remote),
    description: `Delegate a task to the remote A2A agent "${remote.name}" via ${remote.transport} (${remote.cardUrl}). Provide a self-contained task description; returns the remote agent's reply.`,
    remoteAgentId: remote.id,
    cardUrl: remote.cardUrl,
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'A self-contained description of the task for the remote agent.',
        },
      },
      required: ['task'],
    },
  };
}

/**
 * Resolve the delegate tools this agent should expose. Empty when the node is
 * disabled, in `server`-only mode, or no remote agent is flagged `exposeAsTool`.
 * Tool names are de-duplicated: on a collision the later remote gets a numeric
 * suffix so every delegate keeps a unique catalog name.
 */
export function resolveDelegateTools(config: ResolvedA2AConfig): DelegateToolSpec[] {
  if (!config.enabled || config.mode === 'server') return [];
  const seen = new Map<string, number>();
  const specs: DelegateToolSpec[] = [];
  for (const remote of config.remoteAgents) {
    if (!remote.exposeAsTool) continue;
    const spec = buildDelegateToolSpec(remote);
    const count = seen.get(spec.name) ?? 0;
    seen.set(spec.name, count + 1);
    if (count > 0) spec.name = `${spec.name}_${count + 1}`;
    specs.push(spec);
  }
  return specs;
}

/** Whether the node serves an inbound A2A endpoint (agent card + tasks). */
export function servesInbound(config: ResolvedA2AConfig): boolean {
  return config.enabled && (config.mode === 'server' || config.mode === 'both');
}
