/**
 * Model-agnostic token estimation.
 *
 * Uses a `chars / 4` heuristic that works across every LLM tokenizer we
 * support. Pure ASCII/Latin text averages ~1 token per 4 characters; CJK
 * (Chinese, Japanese, Korean) and other ideographic scripts average ~1
 * token per character. Without adjustment, the `chars/4` formula
 * underestimates CJK content by 2-4x.
 *
 * `estimateStringChars()` inflates the effective character count for
 * non-Latin text so that the downstream `chars / 4` yields an accurate
 * token estimate for any script.
 *
 * Ground truth for the *actual* context size still comes from the
 * provider's reported `usage.totalTokens`. This estimator is only used
 * for the tail of unsent content (e.g. a payload being assembled, or
 * messages appended since the last turn).
 */

/** Latin/ASCII text averages ~4 chars per token; CJK averages ~1. */
export const CHARS_PER_TOKEN_ESTIMATE = 4;

/**
 * Matches CJK Unified Ideographs (U+2E80-U+9FFF), CJK Extension A
 * (U+A000-U+A4FF), Hangul Syllables (U+AC00-U+D7AF), CJK Compatibility
 * Ideographs (U+F900-U+FAFF), and CJK Extension B+ (U+20000-U+2FA1F).
 */
const NON_LATIN_RE = /[⺀-鿿ꀀ-꓿가-힯豈-﫿\u{20000}-\u{2FA1F}]/gu;

/**
 * High-surrogate range for U+20000-U+2FA1F (CJK Extension B+). Only these
 * surrogates need adjustment because NON_LATIN_RE already counts their
 * code point once.
 */
const CJK_SURROGATE_HIGH_RE = /[\uD840-\uD87E][\uDC00-\uDFFF]/g;

function countCodePoints(text: string, nonLatinCount: number): number {
  if (nonLatinCount === 0) return text.length;
  const cjkSurrogates = (text.match(CJK_SURROGATE_HIGH_RE) ?? []).length;
  return text.length - cjkSurrogates;
}

/**
 * Return an adjusted character length that accounts for non-Latin (CJK,
 * Hangul, Kana) characters. Each non-Latin character is inflated to
 * {@link CHARS_PER_TOKEN_ESTIMATE} chars so that the downstream
 * `chars / CHARS_PER_TOKEN_ESTIMATE` token estimate remains accurate.
 *
 * For pure ASCII/Latin text this returns `text.length` unchanged.
 */
export function estimateStringChars(text: string): number {
  if (text.length === 0) return 0;
  const nonLatinCount = (text.match(NON_LATIN_RE) ?? []).length;
  const codePointLength = countCodePoints(text, nonLatinCount);
  return codePointLength + nonLatinCount * (CHARS_PER_TOKEN_ESTIMATE - 1);
}

/**
 * Estimate the number of tokens for a raw character count. Prefer
 * {@link estimateTokens} when the source string is available -- it
 * applies CJK adjustment before dividing.
 */
export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(Math.max(0, chars) / CHARS_PER_TOKEN_ESTIMATE);
}

/**
 * Estimate tokens for a string, with CJK-aware char inflation applied.
 */
export function estimateTokens(text: string): number {
  return estimateTokensFromChars(estimateStringChars(text));
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
