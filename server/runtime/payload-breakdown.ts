import { estimateTokens } from '../../shared/token-estimator';
import type { ContextUsageEntry } from '../../shared/context-usage';

/** Safe JSON-stringify that returns '' on circular or unserializable input. */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Extract the system-prompt text from a provider payload. Providers
 * put it in different places:
 *
 * - OpenAI-compatible: the first entry of `messages` with role
 *   `"system"` or `"developer"`.
 * - Anthropic: a top-level `system` field (string or array of text
 *   blocks).
 * - Pi-core in-state shape: a top-level `systemPrompt` string.
 *
 * Returns the extracted text plus the remaining (non-system) messages
 * so the caller can tokenize them as the "messages" section without
 * double-counting.
 */
export function extractSystemAndMessages(payload: unknown): {
  systemText: string;
  remainingMessages: unknown[];
} {
  const p = payload as {
    system?: unknown;
    systemPrompt?: unknown;
    messages?: unknown;
  };

  // Anthropic-style top-level `system`
  if (typeof p.system === 'string') {
    return { systemText: p.system, remainingMessages: asArray(p.messages) };
  }
  if (Array.isArray(p.system)) {
    const text = p.system
      .map((block: unknown) => {
        if (typeof block === 'string') return block;
        if (block && typeof block === 'object' && 'text' in block) {
          return String((block as { text: unknown }).text ?? '');
        }
        return '';
      })
      .join('');
    return { systemText: text, remainingMessages: asArray(p.messages) };
  }

  // Pi-core state shape (some providers pass this through)
  if (typeof p.systemPrompt === 'string') {
    return { systemText: p.systemPrompt, remainingMessages: asArray(p.messages) };
  }

  // OpenAI-style: pluck role=system / role=developer entries out of messages
  const messages = asArray(p.messages);
  const systemParts: string[] = [];
  const remaining: unknown[] = [];
  for (const msg of messages) {
    const m = msg as { role?: unknown; content?: unknown };
    if (m?.role === 'system' || m?.role === 'developer') {
      if (typeof m.content === 'string') {
        systemParts.push(m.content);
      } else if (Array.isArray(m.content)) {
        for (const part of m.content) {
          if (typeof part === 'string') systemParts.push(part);
          else if (part && typeof part === 'object' && 'text' in part) {
            systemParts.push(String((part as { text: unknown }).text ?? ''));
          }
        }
      }
    } else {
      remaining.push(msg);
    }
  }
  return { systemText: systemParts.join('\n'), remainingMessages: remaining };
}

export interface PayloadBreakdown {
  total: number;
  systemPrompt: number;
  skills: number;
  tools: number;
  messages: number;
  skillsEntries: ContextUsageEntry[];
  toolsEntries: ContextUsageEntry[];
}

/** A skill blob the caller wants to count. Just name + content. */
export interface SkillInput {
  name: string;
  content: string;
}

/**
 * Extract a tool's display name from whichever provider shape it's
 * wrapped in. OpenAI uses `{ type: 'function', function: { name } }`;
 * Anthropic and pi-core both use a top-level `name`.
 */
function toolNameOf(tool: unknown): string {
  if (!tool || typeof tool !== 'object') return '(unknown)';
  const t = tool as {
    name?: unknown;
    function?: { name?: unknown };
  };
  if (typeof t.name === 'string' && t.name.length > 0) return t.name;
  if (typeof t.function?.name === 'string' && t.function.name.length > 0) {
    return t.function.name;
  }
  return '(unknown)';
}

/**
 * Tokenize an outbound payload into mutually-exclusive sections.
 * Numbers approximately sum to the total tokens the provider will see,
 * modulo estimator noise. Model-agnostic.
 *
 * `skills` is carved out of the system prompt -- skills are folded
 * into `systemPrompt` during prompt assembly, so we subtract the
 * skill-content tokens from the systemPrompt count to keep the four
 * buckets disjoint.
 */
export function estimatePayloadBreakdown(
  payload: unknown,
  skillInputs: readonly SkillInput[],
): PayloadBreakdown {
  const { systemText, remainingMessages } = extractSystemAndMessages(payload);
  const systemPromptTotal = estimateTokens(systemText);

  // Per-skill entries, sorted descending by tokens.
  const skillsEntries: ContextUsageEntry[] = skillInputs
    .map((s) => ({
      name: s.name || '(unnamed)',
      tokens: estimateTokens(typeof s.content === 'string' ? s.content : ''),
    }))
    .sort((a, b) => b.tokens - a.tokens);
  const skills = skillsEntries.reduce((sum, e) => sum + e.tokens, 0);

  const systemPrompt = Math.max(0, systemPromptTotal - skills);

  // Per-tool entries: tokenize each tool independently so the numbers
  // sum to the aggregate `tools` bucket. JSON-stringify includes
  // schema, description, and all provider-specific wrapping.
  const rawTools = asArray((payload as { tools?: unknown })?.tools);
  const toolsEntries: ContextUsageEntry[] = rawTools
    .map((t) => ({
      name: toolNameOf(t),
      tokens: estimateTokens(safeStringify(t)),
    }))
    .sort((a, b) => b.tokens - a.tokens);
  const tools = toolsEntries.reduce((sum, e) => sum + e.tokens, 0);

  const messages = estimateTokens(safeStringify(remainingMessages));

  return {
    total: systemPrompt + skills + tools + messages,
    systemPrompt,
    skills,
    tools,
    messages,
    skillsEntries,
    toolsEntries,
  };
}
