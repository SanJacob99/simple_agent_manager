import { nanoid } from 'nanoid';

/**
 * Build an LLM slug from provider + modelId.
 * Format: provider/modelId (preserves / in model IDs).
 * Example: "openrouter/anthropic/claude-opus-4"
 */
export function buildLlmSlug(provider: string, modelId: string): string {
  return `${provider}/${modelId}`;
}

/**
 * Build a composite session ID.
 * Format: agentName:llmSlug:default|hash
 */
export function buildSessionId(
  agentName: string,
  provider: string,
  modelId: string,
  isDefault: boolean = false,
): string {
  const slug = buildLlmSlug(provider, modelId);
  const suffix = isDefault ? 'default' : nanoid(8);
  return `${agentName}:${slug}:${suffix}`;
}

/**
 * Parse a session ID into its components.
 * Returns null if the format is invalid.
 */
export function parseSessionId(sessionId: string): {
  agentName: string;
  llmSlug: string;
  hash: string;
} | null {
  // The format is agentName:rest where rest ends with :hash
  // and the middle part is the llmSlug which can contain /
  // Split from the start to get agentName, and from the end to get hash
  const firstColon = sessionId.indexOf(':');
  const lastColon = sessionId.lastIndexOf(':');

  if (firstColon === -1 || lastColon === -1 || firstColon === lastColon) {
    return null;
  }

  const agentName = sessionId.slice(0, firstColon);
  const llmSlug = sessionId.slice(firstColon + 1, lastColon);
  const hash = sessionId.slice(lastColon + 1);

  if (!agentName || !llmSlug || !hash) return null;

  return { agentName, llmSlug, hash };
}

/**
 * Check if a session ID belongs to a given agent name.
 */
export function isSessionForAgent(sessionId: string, agentName: string): boolean {
  return sessionId.startsWith(`${agentName}:`);
}
