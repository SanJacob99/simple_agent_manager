import { SUB_AGENT_NAME_REGEX } from '../../shared/sub-agent-types';

export interface ParsedSubSessionKey {
  parentSessionKey: string;
  subAgentName: string;
  shortUuid: string;
  isSubSession: true;
}

/**
 * Parse a sub-session key into its parts. Handles two forms:
 *   - raw:     sub:<parentSessionKey>:<subAgentName>:<shortUuid>
 *   - wrapped: agent:<agentId>:sub:<parentSessionKey>:<subAgentName>:<shortUuid>
 *
 * Returns null when the key isn't a sub-session key, when the name segment
 * fails the regex, or when the shortUuid segment is missing.
 */
export function parseSubSessionKey(sessionKey: string): ParsedSubSessionKey | null {
  let working = sessionKey;
  // Strip a single agent:<id>: wrapper if present and a sub: segment follows.
  const wrappedMatch = /^agent:[^:]+:(sub:.+)$/.exec(sessionKey);
  if (wrappedMatch) {
    working = wrappedMatch[1];
  }

  if (!working.startsWith('sub:')) {
    return null;
  }

  const rest = working.slice('sub:'.length);
  // Last segment = shortUuid, second-to-last = subAgentName, everything before = parentSessionKey.
  const segments = rest.split(':');
  if (segments.length < 5) {
    return null;
  }

  const shortUuid = segments[segments.length - 1];
  const subAgentName = segments[segments.length - 2];
  const parentSessionKey = segments.slice(0, segments.length - 2).join(':');

  if (!shortUuid) return null;
  if (!SUB_AGENT_NAME_REGEX.test(subAgentName)) return null;
  if (!parentSessionKey) return null;

  return {
    parentSessionKey,
    subAgentName,
    shortUuid,
    isSubSession: true,
  };
}

/** Build a raw sub-session key from parts. Always emits the `sub:` form. */
export function buildSubSessionKey(
  parentSessionKey: string,
  subAgentName: string,
  shortUuid: string,
): string {
  return `sub:${parentSessionKey}:${subAgentName}:${shortUuid}`;
}
