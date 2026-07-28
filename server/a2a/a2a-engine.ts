import type {
  ResolvedA2AConfig,
  ResolvedA2ARemoteAgent,
  A2ATransport,
} from '../../shared/agent-config';

/**
 * Agent-to-Agent (A2A) interop engine.
 *
 * An a2a node exposes this agent as an A2A server (publishes an agent card,
 * accepts remote tasks) and/or registers remote A2A agents as callable
 * delegates. This module is the dependency-free substrate the runtime and the
 * A2A HTTP surface call: it builds the agent card from resolved config, derives
 * the well-known card path, validates a config before it is served, selects the
 * transport for a remote call, and shapes each remote agent into a delegate tool
 * descriptor the model can invoke.
 *
 * The network layer (an Express router that serves the card and terminates the
 * A2A task/message endpoint, plus a client that performs the JSON-RPC / gRPC /
 * HTTP+JSON call to a remote agent) is the remaining integration step; the API
 * below is the stable, side-effect-free surface that wiring targets. Nothing
 * here opens a socket or reads a secret — `authRef` stays a reference and the
 * runtime resolves the actual credential out of band.
 */

/** The conventional path an A2A agent card is served from. */
export const A2A_WELL_KNOWN_PATH = '/.well-known/agent-card.json';

/** A2A protocol version this scaffold targets. */
export const A2A_PROTOCOL_VERSION = '0.2';

/** Card capabilities block. */
export interface A2ACardCapabilities {
  streaming: boolean;
  pushNotifications: boolean;
}

/** One advertised skill on the card. */
export interface A2ACardSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

/**
 * A serializable A2A agent card, shaped after the protocol's agent-card object.
 * This is what the server role publishes at {@link A2A_WELL_KNOWN_PATH}.
 */
export interface A2AAgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: A2ACardCapabilities;
  /** Transports the endpoint accepts, preferred first. */
  transports: A2ATransport[];
  /** Auth schemes the endpoint accepts (`none` means public). */
  securitySchemes: string[];
  skills: A2ACardSkill[];
}

/**
 * Join a base URL and a path without doubling or dropping the separating slash.
 * Kept local so the engine stays dependency-free (no URL/path imports).
 */
export function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, '');
  const p = path.replace(/^\/+/, '');
  return `${b}/${p}`;
}

/**
 * The absolute URL this agent's card is served from, or `null` when the config
 * has no `serverUrl` to anchor it (an incomplete server config).
 */
export function cardUrlFor(config: ResolvedA2AConfig): string | null {
  if (!config.serverUrl.trim()) return null;
  return joinUrl(config.serverUrl.trim(), A2A_WELL_KNOWN_PATH);
}

/** Whether this config turns on the server role (publishes a card). */
export function servesCard(config: ResolvedA2AConfig): boolean {
  return config.enabled && (config.role === 'server' || config.role === 'both');
}

/** Whether this config turns on the client role (delegates to remote agents). */
export function delegatesRemotely(config: ResolvedA2AConfig): boolean {
  return config.enabled && (config.role === 'client' || config.role === 'both');
}

/**
 * Build the agent card for the server role from resolved config. `agentName`
 * falls back to `fallbackName` (the agent's own name) when the node leaves it
 * blank, mirroring how the runtime fills an empty label at serve time.
 */
export function buildAgentCard(
  config: ResolvedA2AConfig,
  fallbackName: string,
): A2AAgentCard {
  const transports: A2ATransport[] = [config.defaultTransport];
  const securitySchemes =
    config.serverAuthScheme === 'none' ? ['none'] : [config.serverAuthScheme];
  return {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name: config.agentName.trim() || fallbackName,
    description: config.agentDescription.trim(),
    url: cardUrlFor(config) ?? '',
    version: config.cardVersion.trim() || '1.0.0',
    capabilities: {
      streaming: config.streaming,
      pushNotifications: config.pushNotifications,
    },
    transports,
    securitySchemes,
    skills: config.advertisedSkills.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      tags: [...s.tags],
    })),
  };
}

/** A configuration problem that would make an A2A surface fail at serve time. */
export interface A2AConfigIssue {
  field: string;
  message: string;
}

/**
 * Validate a resolved config before it is served or used to delegate. Returns
 * the list of blocking issues (empty when the config is serviceable). Disabled
 * configs are always valid — they do nothing. The rules mirror what the network
 * layer needs to actually stand the surface up.
 */
export function validateA2AConfig(config: ResolvedA2AConfig): A2AConfigIssue[] {
  const issues: A2AConfigIssue[] = [];
  if (!config.enabled) return issues;

  if (servesCard(config)) {
    if (!config.serverUrl.trim()) {
      issues.push({
        field: 'serverUrl',
        message: 'Server role needs a base URL to serve the agent card from.',
      });
    }
    const skillIds = new Set<string>();
    config.advertisedSkills.forEach((s, i) => {
      if (!s.id.trim()) {
        issues.push({ field: `advertisedSkills[${i}].id`, message: 'Skill id is required.' });
      } else if (skillIds.has(s.id)) {
        issues.push({
          field: `advertisedSkills[${i}].id`,
          message: `Duplicate skill id "${s.id}".`,
        });
      } else {
        skillIds.add(s.id);
      }
    });
  }

  if (delegatesRemotely(config)) {
    const remoteIds = new Set<string>();
    config.remoteAgents.forEach((r, i) => {
      if (!r.cardUrl.trim()) {
        issues.push({
          field: `remoteAgents[${i}].cardUrl`,
          message: 'Remote agent needs a card URL to resolve its capabilities.',
        });
      }
      if (!r.id.trim()) {
        issues.push({ field: `remoteAgents[${i}].id`, message: 'Remote agent id is required.' });
      } else if (remoteIds.has(r.id)) {
        issues.push({
          field: `remoteAgents[${i}].id`,
          message: `Duplicate remote agent id "${r.id}".`,
        });
      } else {
        remoteIds.add(r.id);
      }
      if (r.authScheme !== 'none' && !r.authRef.trim()) {
        issues.push({
          field: `remoteAgents[${i}].authRef`,
          message: `Auth scheme "${r.authScheme}" needs a credential reference.`,
        });
      }
    });
  }

  return issues;
}

/** The transport used to call a remote agent — its own pin, else the node default. */
export function transportFor(
  config: ResolvedA2AConfig,
  remote: ResolvedA2ARemoteAgent,
): A2ATransport {
  return remote.transport ?? config.defaultTransport;
}

/**
 * A tool descriptor exposing a remote A2A agent as a callable delegate. The
 * runtime registers one per remote agent whose `exposeAsTool` is set, so the
 * model can hand a subtask to another framework's agent by name. Shaped like the
 * other built-in tool descriptors so the tool factory can adopt it directly.
 */
export interface A2ADelegateTool {
  name: string;
  description: string;
  remoteAgentId: string;
  cardUrl: string;
  transport: A2ATransport;
}

/** Sanitize a remote agent id into a stable, tool-name-safe suffix. */
function toolSuffix(id: string): string {
  return id.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'agent';
}

/**
 * Build the delegate tool descriptors for a config's client role. Only remote
 * agents with `exposeAsTool` set are included; the rest are still callable
 * internally but not surfaced to the model. Names are `a2a_delegate_<id>`.
 */
export function buildDelegateTools(config: ResolvedA2AConfig): A2ADelegateTool[] {
  if (!delegatesRemotely(config)) return [];
  return config.remoteAgents
    .filter((r) => r.exposeAsTool)
    .map((r) => ({
      name: `a2a_delegate_${toolSuffix(r.id)}`,
      description:
        `Delegate a subtask to the remote A2A agent "${r.name || r.id}". ` +
        `The remote agent runs independently and returns its result.`,
      remoteAgentId: r.id,
      cardUrl: r.cardUrl,
      transport: transportFor(config, r),
    }));
}
