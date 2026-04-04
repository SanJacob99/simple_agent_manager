/**
 * Simple token estimation using char/4 heuristic.
 * Accurate enough for compaction threshold decisions.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessagesTokens(
  messages: Array<{ content?: string | unknown }>,
): number {
  let total = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      total += estimateTokens(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (typeof part === 'object' && part !== null && 'text' in part) {
          total += estimateTokens((part as { text: string }).text);
        }
      }
    }
  }
  return total;
}
