import type {
  ResolvedA2AConfig,
  ResolvedRemoteA2AAgent,
} from '../../shared/agent-config';

/**
 * Agent-to-Agent (A2A) interop engine.
 *
 * Where `agentComm` is an in-process bus and `subAgent` is in-tree, A2A lets
 * this agent interoperate with agents built on *other* frameworks. This module
 * is the dependency-free substrate the server calls; it owns agent-card
 * assembly, the task lifecycle state machine, delegate resolution, and the
 * message/result envelope shapes, while the server owns the actual HTTP surface
 * (mounting the card + `message/send` endpoint) and outbound calls to remote
 * agents.
 *
 * The orchestration a future `server/a2a/` slice performs:
 *
 *   1. On startup, for an A2A node whose role is `server`/`both`, serve
 *      `buildAgentCard(...)` at `<serverPath>/.well-known/agent.json` and accept
 *      inbound `message/send` requests, driving each task through the lifecycle
 *      validated by `canTransition(...)`.
 *   2. When the agent delegates to a remote agent, `selectDelegate(...)` resolves
 *      the handle, `buildTaskMessage(...)` builds the outbound envelope, and
 *      `extractTaskText(...)` pulls the reply text out of the returned task.
 *   3. `validateRemoteAgent(...)` guards the delegate registry at resolve/config
 *      time so a malformed remote entry fails loudly rather than at first call.
 *
 * Wiring the HTTP surface and outbound client into `server/a2a/` is the
 * remaining integration step; the API below is the stable surface that wiring
 * targets. Shapes follow the A2A protocol (agent cards, task/message envelopes).
 */

/** A2A task lifecycle states (protocol `TaskState`). */
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

/** States from which no further transition is allowed. */
export const TERMINAL_A2A_STATES: readonly A2ATaskState[] = [
  'completed',
  'canceled',
  'failed',
  'rejected',
];

export function isTerminalState(state: A2ATaskState): boolean {
  return TERMINAL_A2A_STATES.includes(state);
}

/**
 * Allowed task lifecycle transitions. A task starts `submitted`, moves through
 * `working` (and possibly back and forth with `input-required`), and ends in a
 * terminal state. Any transition out of a terminal state is rejected.
 */
const ALLOWED_TRANSITIONS: Record<A2ATaskState, readonly A2ATaskState[]> = {
  submitted: ['working', 'input-required', 'completed', 'canceled', 'failed', 'rejected'],
  working: ['working', 'input-required', 'completed', 'canceled', 'failed'],
  'input-required': ['working', 'canceled', 'failed'],
  completed: [],
  canceled: [],
  failed: [],
  rejected: [],
};

/**
 * Whether a task may move from `from` to `to`. Terminal states are absorbing.
 * Used by the server to reject illegal lifecycle updates rather than silently
 * corrupting task state.
 */
export function canTransition(from: A2ATaskState, to: A2ATaskState): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

/** A skill advertised on the agent card. */
export interface A2ASkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

/** Agent card metadata (protocol `AgentCard`). */
export interface AgentCard {
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
  authentication: { schemes: string[] };
  skills: A2ASkill[];
}

export interface AgentCardOptions {
  /** Base URL the server is reachable at (the card's `url`, sans path). */
  baseUrl: string;
  /** Agent version string for the card. */
  version: string;
  /** Agent name used when the node leaves `agentName` empty. */
  fallbackName: string;
  /**
   * Resolved skills to advertise, supplied by the caller (the runtime knows the
   * agent's tools/skills; the engine stays dependency-free). Only used when
   * `publishSkills` is set on the config.
   */
  skills?: A2ASkill[];
}

/**
 * Map a config's auth scheme to the card's advertised authentication schemes.
 * `none` advertises no schemes; `bearer`/`apiKey` map to their protocol names.
 */
export function authSchemesFor(config: ResolvedA2AConfig): string[] {
  switch (config.authScheme) {
    case 'bearer':
      return ['bearer'];
    case 'apiKey':
      return ['apiKey'];
    case 'none':
    default:
      return [];
  }
}

/**
 * Build the A2A agent card published for this agent. Joins `baseUrl` and the
 * node's `serverPath`, falls back to `fallbackName` when the node leaves the
 * card name empty, and only advertises skills when `publishSkills` is set.
 */
export function buildAgentCard(
  config: ResolvedA2AConfig,
  opts: AgentCardOptions,
): AgentCard {
  const name = config.agentName.trim() || opts.fallbackName.trim() || 'agent';
  return {
    name,
    description: config.agentDescription.trim(),
    url: joinUrl(opts.baseUrl, config.serverPath),
    version: opts.version,
    capabilities: {
      streaming: config.streaming,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    authentication: { schemes: authSchemesFor(config) },
    skills: config.publishSkills ? (opts.skills ?? []) : [],
  };
}

/** Join a base URL and a path with exactly one slash between them. */
export function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, '');
  const p = path.replace(/^\/+/, '');
  return p ? `${b}/${p}` : b;
}

/**
 * Validate a remote delegate entry. Returns a list of human-readable problems;
 * an empty list means the entry is usable. Called at resolve/config time so a
 * malformed registry fails loudly rather than at first delegated call.
 */
export function validateRemoteAgent(agent: ResolvedRemoteA2AAgent): string[] {
  const errors: string[] = [];
  if (!agent.id.trim()) errors.push('remote agent is missing an id');
  if (!agent.url.trim()) {
    errors.push(`remote agent "${agent.id || '?'}" is missing a url`);
  } else if (!/^https?:\/\//i.test(agent.url.trim())) {
    errors.push(`remote agent "${agent.id || '?'}" url must be http(s)`);
  }
  return errors;
}

/**
 * Resolve a delegate by its local handle (`id`) or, failing that, a
 * case-insensitive name match. Returns `null` when no delegate matches or when
 * the config has no client role.
 */
export function selectDelegate(
  config: ResolvedA2AConfig,
  handle: string,
): ResolvedRemoteA2AAgent | null {
  if (config.role === 'server') return null;
  const needle = handle.trim().toLowerCase();
  if (!needle) return null;
  return (
    config.remoteAgents.find((r) => r.id.trim().toLowerCase() === needle) ??
    config.remoteAgents.find((r) => r.name.trim().toLowerCase() === needle) ??
    null
  );
}

/** A single content part of an A2A message (text only, for now). */
export interface A2ATextPart {
  kind: 'text';
  text: string;
}

/** An A2A message (protocol `Message`). */
export interface A2AMessage {
  role: 'user' | 'agent';
  parts: A2ATextPart[];
  messageId?: string;
}

/** Parameters for an A2A `message/send` request. */
export interface A2AMessageSendParams {
  message: A2AMessage;
  configuration?: { blocking?: boolean };
}

export interface BuildTaskMessageOptions {
  /** Optional stable message id (the server supplies one when omitted). */
  messageId?: string;
  /** Whether the caller wants a blocking (non-streaming) response. */
  blocking?: boolean;
}

/**
 * Build the outbound `message/send` params for delegating a task to a remote
 * agent. Wraps the text in a single user text part.
 */
export function buildTaskMessage(
  text: string,
  opts: BuildTaskMessageOptions = {},
): A2AMessageSendParams {
  const message: A2AMessage = {
    role: 'user',
    parts: [{ kind: 'text', text }],
  };
  if (opts.messageId) message.messageId = opts.messageId;
  return {
    message,
    configuration: { blocking: opts.blocking ?? true },
  };
}

/** Minimal shape of a returned A2A task with its terminal artifacts/messages. */
export interface A2ATaskResult {
  status?: { state?: string };
  artifacts?: Array<{ parts?: Array<{ kind?: string; text?: string }> }>;
  history?: A2AMessage[];
}

/**
 * Pull the reply text out of a returned task. Prefers artifact text parts (the
 * canonical output of a completed task); falls back to the last agent message in
 * the history. Returns an empty string when no text can be recovered.
 */
export function extractTaskText(result: A2ATaskResult): string {
  const fromArtifacts = (result.artifacts ?? [])
    .flatMap((a) => a.parts ?? [])
    .filter((p) => p.kind === 'text' && typeof p.text === 'string')
    .map((p) => p.text as string);
  if (fromArtifacts.length > 0) return fromArtifacts.join('\n').trim();

  const agentMessages = (result.history ?? []).filter((m) => m.role === 'agent');
  const last = agentMessages[agentMessages.length - 1];
  if (last) {
    return last.parts
      .filter((p) => p.kind === 'text')
      .map((p) => p.text)
      .join('\n')
      .trim();
  }
  return '';
}
