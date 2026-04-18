/**
 * Multi-stage assistant visible text sanitizer.
 *
 * Strips model-internal scaffolding that leaks into user-facing text:
 * - Harmony-style delimiter tokens (`<|...|>`, `<｜...｜>`)
 * - Reasoning/thinking XML tags (`<think>`, `<thinking>`, `<thought>`, etc.)
 * - Provider-specific thought-channel preambles (Gemini preview `쓸᯼>thought`)
 *
 * Each stage is code-region-aware and won't mangle legitimate code samples.
 *
 * Ported from openclaw's `src/shared/text/assistant-visible-text.ts` and
 * adapted for SAM's runtime.
 */
import { stripModelSpecialTokens } from './model-special-tokens';
import { stripReasoningTagsFromText } from './reasoning-tags';

// ---------------------------------------------------------------------------
// SAM-specific: Gemini preview thought-channel preamble
// ---------------------------------------------------------------------------

/**
 * Some Gemini preview models (e.g. `google/gemini-3.1-pro-preview-customtools`)
 * emit a mis-decoded channel delimiter followed by the model's chain-of-thought
 * before the actual user-facing answer, all in one text blob.
 *
 * The pattern is: `<garbled-unicode>thought\n<thinking content>...<visible answer>`
 *
 * We detect the `>thought\n` sentinel at the start of the text (possibly
 * preceded by 1-6 non-ASCII characters that are the mis-decoded token bytes)
 * and strip everything up to the last paragraph break before the visible answer.
 *
 * This is a provider bug. Remove when upstream stops leaking these tokens.
 */
const THOUGHT_CHANNEL_PREAMBLE_RE =
  /^[\s\S]{0,10}>thought\n/;

export function stripThoughtChannelPreamble(text: string): string {
  if (!text) return text;

  const match = THOUGHT_CHANNEL_PREAMBLE_RE.exec(text);
  if (!match) return text;

  // The thought section runs from the match to somewhere before the visible
  // answer. The model typically transitions from thinking to answering with
  // a sentence that doesn't start with whitespace after a thinking line.
  // Strategy: find the last occurrence of a double-newline or the boundary
  // where the model switches from internal monologue to user-facing prose.
  // Since the thought section often ends mid-paragraph (no clean separator),
  // we look for common transition patterns.

  const afterPreamble = text.slice(match[0].length);

  // Look for a transition: thinking text often ends right before the
  // user-facing reply which starts with a greeting or substantive sentence.
  // The most reliable heuristic from observed transcripts: the thought
  // section and the visible answer are concatenated with no separator.
  // We strip the `>thought\n` prefix and everything that looks like the
  // model's internal instruction recap (CRITICAL INSTRUCTION lines).
  const instructionBlockEnd = findEndOfInstructionBlock(afterPreamble);
  if (instructionBlockEnd > 0) {
    return afterPreamble.slice(instructionBlockEnd).trim();
  }

  // Fallback: strip just the preamble marker itself
  return afterPreamble.trim();
}

/**
 * Find where the model's instruction-recap / chain-of-thought block ends.
 * Returns the index after the last thinking line, or 0 if no block detected.
 *
 * The thought block typically contains lines starting with "CRITICAL INSTRUCTION",
 * "Wait,", "Let me", "I will", "I'll", etc. followed by the actual answer.
 * We look for the last line that clearly belongs to internal monologue.
 */
function findEndOfInstructionBlock(text: string): number {
  // Split into lines and find where thinking stops
  const lines = text.split('\n');
  let lastThinkingLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (
      line.startsWith('CRITICAL INSTRUCTION') ||
      line.startsWith('ALWAYS START') ||
      line.startsWith('Available tools:') ||
      line.startsWith('Tool to use:') ||
      line.startsWith('We need to ') ||
      line.startsWith('We will use ') ||
      line.startsWith('Wait,') ||
      line.startsWith('Ah,') ||
      line.startsWith('Let me ') ||
      line.startsWith('I will ') ||
      line.startsWith("I'll ") ||
      line.startsWith('I should ') ||
      line.startsWith('I am now ') ||
      line.startsWith('I\'m now ') ||
      line.startsWith('The ') && line.includes(' tool') && line.includes('not') ||
      line.startsWith('Since ') && line.includes('tool') ||
      /^(?:Wait|Hmm|Ok|Looking|Actually),?\s/i.test(line) ||
      /^In particular,/.test(line)
    ) {
      lastThinkingLine = i;
    }
  }

  if (lastThinkingLine < 0) return 0;

  // Return the byte offset after the last thinking line
  let offset = 0;
  for (let i = 0; i <= lastThinkingLine; i++) {
    offset += lines[i].length + 1; // +1 for the \n
  }

  // Skip any trailing blank lines between thought and answer
  while (offset < text.length && (text[offset] === '\n' || text[offset] === '\r')) {
    offset++;
  }

  return offset;
}

// ---------------------------------------------------------------------------
// Stage 4: Undelimited thought blocks (Gemini customtools)
// ---------------------------------------------------------------------------

/**
 * Some Gemini models emit chain-of-thought as a plain text block with no
 * delimiter tokens or XML tags. The fingerprint is a training-time instruction
 * recap like "ALWAYS START your thought with recalling critical instructions".
 *
 * Also catches internal monologue concatenated with the visible answer, e.g.:
 * "The file has been written. I can now inform the user.Here is your answer."
 */
const INSTRUCTION_RECAP_RE =
  /^ALWAYS\s+START\s+your\s+thought/i;

const INTERNAL_MONOLOGUE_BRIDGE_RE =
  /I (?:can now|will now|should now|need to) (?:inform|tell|respond|reply|let|update) the user[.:]\s*/i;

export function stripUndelimitedThought(text: string): string {
  if (!text) return text;

  // Case 1: entire text block starts with the instruction recap
  if (INSTRUCTION_RECAP_RE.test(text)) {
    const end = findEndOfInstructionBlock(text);
    if (end > 0 && end < text.length) {
      return text.slice(end).trim();
    }
    // Entire block is thought — return empty (the content block will be dropped)
    return '';
  }

  // Case 2: internal monologue bridge — "I can now inform the user.Actual answer"
  const bridgeMatch = INTERNAL_MONOLOGUE_BRIDGE_RE.exec(text);
  if (bridgeMatch) {
    const afterBridge = text.slice(bridgeMatch.index + bridgeMatch[0].length);
    if (afterBridge.trim()) {
      return afterBridge.trim();
    }
  }

  return text;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/**
 * Sanitize assistant text content for user-facing display and persistence.
 * Applies all stripping stages in order.
 */
export function sanitizeAssistantVisibleText(text: string): string {
  if (!text) return text;

  let cleaned = text;

  // Stage 1: Strip harmony-style <|...|> delimiter tokens
  cleaned = stripModelSpecialTokens(cleaned);

  // Stage 2: Strip thinking/reasoning XML tags and their content
  cleaned = stripReasoningTagsFromText(cleaned);

  // Stage 3: Strip Gemini preview thought-channel preamble (SAM-specific)
  cleaned = stripThoughtChannelPreamble(cleaned);

  // Stage 4: Strip undelimited thought blocks and internal monologue bridges
  cleaned = stripUndelimitedThought(cleaned);

  return cleaned.trim();
}

/**
 * Sanitize an array of content blocks (the shape used in assistant messages).
 * Only text blocks are sanitized; tool calls and other block types pass through.
 * Generic preserves the caller's concrete content type.
 */
export function sanitizeAssistantContentBlocks<T>(content: T[]): T[] {
  return content.map((block) => {
    const record = block as Record<string, unknown>;
    if (record.type !== 'text' || typeof record.text !== 'string') {
      return block;
    }
    const sanitized = sanitizeAssistantVisibleText(record.text);
    if (sanitized === record.text) return block;
    return { ...record, text: sanitized } as T;
  });
}
