import type {
  ResolvedA2AConfig,
  ResolvedA2ARemoteAgent,
} from '../../shared/agent-config';

/**
 * Agent-to-Agent (A2A) interop engine.
 *
 * An A2A node gives an agent two optional capabilities:
 *
 *   - **Server**: publish an A2A *agent card* (a JSON descriptor of the agent's
 *     identity, capabilities, and skills) at a well-known URL and accept remote
 *     *tasks* over a JSON-RPC / gRPC / REST endpoint. This makes the agent
 *     callable by agents built on *other* frameworks — the A2A protocol is to
 *     cross-framework agent interop what MCP is to tools.
 *   - **Client**: register remote A2A agents as callable *delegate tools*. Each
 *     enabled remote resolves to an `a2a_<name>` tool that forwards a task to
 *     the remote via `message/send` and returns its result.
 *
 * This module is the dependency-free substrate the server routes and the tool
 * factory call: it owns agent-card assembly, delegate-tool naming, JSON-RPC
 * envelope construction, result extraction, and config validation. The actual
 * HTTP serving (`server/a2a/` routes) and the network calls are the remaining
 * integration step; the pure functions below are the stable surface that wiring
 * targets.
 */

/** A2A capability flags advertised in the agent card. */
export interface A2ACapabilities {
  streaming: boolean;
  pushNotifications: boolean;
  stateTransitionHistory: boolean;
}

/** One advertised skill in the agent card's `skills[]`. */
export interface A2ACardSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

/**
 * The A2A agent card. Mirrors the fields consumers expect at
 * `<url><cardPath>`; kept as a plain serializable object so a route can return
 * it directly as JSON.
 */
export interface A2AAgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  url: string;
  version: string;
  preferredTransport: string;
  capabilities: A2ACapabilities;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  securitySchemes: Record<string, { type: string }>;
  skills: A2ACardSkill[];
}

/** The A2A protocol version this build targets. */
export const A2A_PROTOCOL_VERSION = '0.2.0';

/** Map the node's transport enum to the A2A `preferredTransport` token. */
export function transportToken(transport: ResolvedA2AConfig['transport']): string {
  switch (transport) {
    case 'jsonrpc':
      return 'JSONRPC';
    case 'grpc':
      return 'GRPC';
    case 'rest':
      return 'HTTP+JSON';
  }
}

/**
 * Translate an auth scheme into an A2A `securitySchemes` entry. `none` yields no
 * entry (open endpoint). The keys mirror the OpenAPI-style scheme names the A2A
 * spec reuses.
 */
export function securitySchemesFor(
  scheme: ResolvedA2AConfig['serverAuthScheme'],
): Record<string, { type: string }> {
  switch (scheme) {
    case 'none':
      return {};
    case 'apiKey':
      return { apiKey: { type: 'apiKey' } };
    case 'bearer':
      return { bearer: { type: 'http' } };
    case 'oauth2':
      return { oauth2: { type: 'oauth2' } };
  }
}

/**
 * Build the agent card from resolved config. `fallbackName` (the agent's own
 * name) fills in when the node leaves `agentName` blank so the card is never
 * anonymous.
 */
export function buildAgentCard(
  config: ResolvedA2AConfig,
  fallbackName: string,
): A2AAgentCard {
  const base = config.publicUrl.replace(/\/+$/, '');
  return {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name: config.agentName.trim() || fallbackName,
    description: config.agentDescription.trim(),
    url: base,
    version: config.agentVersion.trim() || '1.0.0',
    preferredTransport: transportToken(config.transport),
    capabilities: {
      streaming: config.streaming,
      pushNotifications: config.pushNotifications,
      stateTransitionHistory: false,
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    securitySchemes: securitySchemesFor(config.serverAuthScheme),
    skills: config.skills.map((s) => ({
      id: s.id,
      name: s.name.trim(),
      description: s.description.trim(),
      tags: [...s.tags],
    })),
  };
}

/** Whether the server side should actually be served. */
export function isServerActive(config: ResolvedA2AConfig): boolean {
  return (config.role === 'server' || config.role === 'both') && config.serverEnabled;
}

/** Whether the client side registers any delegate tools. */
export function isClientActive(config: ResolvedA2AConfig): boolean {
  return config.role === 'client' || config.role === 'both';
}

/** The enabled remote agents, i.e. those that become delegate tools. */
export function enabledRemotes(config: ResolvedA2AConfig): ResolvedA2ARemoteAgent[] {
  if (!isClientActive(config)) return [];
  return config.remoteAgents.filter((r) => r.enabled);
}

/**
 * Slugify a remote's name into the suffix of its delegate tool. Non-alphanumeric
 * runs collapse to `_`; leading/trailing separators are trimmed; empty names
 * fall back to `agent`.
 */
export function remoteSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'agent';
}

/** The delegate tool name exposed for a remote agent: `a2a_<slug>`. */
export function remoteToolName(remote: ResolvedA2ARemoteAgent): string {
  return `a2a_${remoteSlug(remote.name)}`;
}

/** A tool descriptor for one remote delegate; consumed by the tool factory. */
export interface A2ADelegateTool {
  name: string;
  remoteId: string;
  cardUrl: string;
  /** Empty until the card is fetched and its endpoint resolved. */
  endpoint: string;
  authScheme: ResolvedA2ARemoteAgent['authScheme'];
  credentialEnvVar: string;
  timeoutMs: number;
}

/**
 * Produce delegate-tool descriptors for every enabled remote, de-duplicating
 * tool names (two remotes named "Search" would both slug to `a2a_search`) by
 * suffixing collisions with `_2`, `_3`, …
 */
export function buildRemoteDelegateTools(config: ResolvedA2AConfig): A2ADelegateTool[] {
  const seen = new Map<string, number>();
  return enabledRemotes(config).map((r) => {
    const base = remoteToolName(r);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const name = count === 0 ? base : `${base}_${count + 1}`;
    return {
      name,
      remoteId: r.id,
      cardUrl: r.cardUrl,
      endpoint: r.endpoint,
      authScheme: r.authScheme,
      credentialEnvVar: r.credentialEnvVar,
      timeoutMs: config.taskTimeoutMs,
    };
  });
}

/** A minimal JSON-RPC 2.0 request for the A2A `message/send` method. */
export interface A2ATaskEnvelope {
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
 * Build the JSON-RPC envelope that forwards `text` to a remote agent as a task.
 * `id` and `messageId` are supplied by the caller (the runtime owns id/clock
 * generation so this stays pure and deterministic for tests).
 */
export function buildTaskEnvelope(
  text: string,
  id: string,
  messageId: string,
): A2ATaskEnvelope {
  return {
    jsonrpc: '2.0',
    id,
    method: 'message/send',
    params: {
      message: {
        role: 'user',
        parts: [{ kind: 'text', text }],
        messageId,
      },
    },
  };
}

/**
 * Extract the reply text from an A2A task/message result. Tolerates the three
 * shapes the spec allows: a `Message` result (`result.parts[]`), a `Task`
 * result whose status carries a message (`result.status.message.parts[]`), and
 * a completed `Task` carrying artifacts (`result.artifacts[].parts[]`). Returns
 * `''` when no text part can be recovered.
 */
export function parseTaskResult(response: unknown): string {
  if (!response || typeof response !== 'object') return '';
  const root = response as Record<string, unknown>;
  const result = (root.result ?? root) as Record<string, unknown>;

  const partsText = (parts: unknown): string => {
    if (!Array.isArray(parts)) return '';
    return parts
      .map((p) =>
        p && typeof p === 'object' && typeof (p as Record<string, unknown>).text === 'string'
          ? ((p as Record<string, unknown>).text as string)
          : '',
      )
      .filter(Boolean)
      .join('');
  };

  // Message result.
  const direct = partsText(result.parts);
  if (direct) return direct;

  // Task result with a status message.
  const status = result.status as Record<string, unknown> | undefined;
  if (status && typeof status === 'object') {
    const msg = status.message as Record<string, unknown> | undefined;
    const fromStatus = partsText(msg?.parts);
    if (fromStatus) return fromStatus;
  }

  // Task result carrying artifacts.
  if (Array.isArray(result.artifacts)) {
    const fromArtifacts = result.artifacts
      .map((a) => partsText((a as Record<string, unknown>)?.parts))
      .filter(Boolean)
      .join('\n');
    if (fromArtifacts) return fromArtifacts;
  }

  return '';
}

/** A single validation finding for an A2A node's config. */
export interface A2AValidationIssue {
  level: 'error' | 'warning';
  message: string;
}

/**
 * Validate a resolved A2A config, returning actionable issues the UI or the
 * run-coordinator can surface. Errors block serving/registration; warnings are
 * advisory (e.g. an auth scheme with no env var yet).
 */
export function validateA2AConfig(config: ResolvedA2AConfig): A2AValidationIssue[] {
  const issues: A2AValidationIssue[] = [];

  if (isServerActive(config)) {
    if (!config.publicUrl.trim()) {
      issues.push({ level: 'error', message: 'Server is enabled but Public URL is empty.' });
    }
    if (!config.cardPath.trim().startsWith('/')) {
      issues.push({ level: 'error', message: 'Card path must start with "/".' });
    }
    if (config.serverAuthScheme !== 'none' && !config.serverCredentialEnvVar.trim()) {
      issues.push({
        level: 'warning',
        message: `Server auth is "${config.serverAuthScheme}" but no credential env var is set.`,
      });
    }
    if (config.skills.length === 0) {
      issues.push({
        level: 'warning',
        message: 'Server advertises no skills; remote agents cannot discover capabilities.',
      });
    }
  }

  if (isClientActive(config)) {
    for (const r of enabledRemotes(config)) {
      if (!r.cardUrl.trim() && !r.endpoint.trim()) {
        issues.push({
          level: 'error',
          message: `Remote "${r.name || r.id}" has neither a card URL nor an endpoint.`,
        });
      }
      if (r.authScheme !== 'none' && !r.credentialEnvVar.trim()) {
        issues.push({
          level: 'warning',
          message: `Remote "${r.name || r.id}" uses "${r.authScheme}" auth but sets no credential env var.`,
        });
      }
    }
    // Delegate-tool name collisions are auto-suffixed, but flag them so the user
    // can rename for clarity.
    const names = enabledRemotes(config).map((r) => remoteToolName(r));
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    for (const d of new Set(dupes)) {
      issues.push({
        level: 'warning',
        message: `Multiple remotes resolve to tool "${d}"; collisions are numbered (${d}_2, …).`,
      });
    }
  }

  return issues;
}
