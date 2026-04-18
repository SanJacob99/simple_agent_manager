/**
 * Strip model control tokens leaked into assistant text output.
 *
 * Models like GLM-5, DeepSeek, and some Gemini previews emit internal
 * delimiter tokens (e.g. `<|assistant|>`, `<|tool_call_result_begin|>`,
 * `<｜begin▁of▁sentence｜>`) in their responses. These use the universal
 * `<|...|>` convention (ASCII or full-width pipe variants) and should
 * never reach end users.
 *
 * Matches inside fenced code blocks or inline code spans are preserved so
 * that documentation / examples that reference these tokens are not corrupted.
 */
import { findCodeRegions, isInsideCode } from './code-regions';

// Match both ASCII pipe <|...|> and full-width pipe <｜...｜> (U+FF5C) variants.
const MODEL_SPECIAL_TOKEN_RE = /<[|｜][^|｜]*[|｜]>/g;

function shouldInsertSeparator(before: string | undefined, after: string | undefined): boolean {
  return Boolean(before && after && !/\s/.test(before) && !/\s/.test(after));
}

export function stripModelSpecialTokens(text: string): string {
  if (!text) return text;

  MODEL_SPECIAL_TOKEN_RE.lastIndex = 0;
  if (!MODEL_SPECIAL_TOKEN_RE.test(text)) return text;
  MODEL_SPECIAL_TOKEN_RE.lastIndex = 0;

  const codeRegions = findCodeRegions(text);
  let out = '';
  let cursor = 0;

  for (const match of text.matchAll(MODEL_SPECIAL_TOKEN_RE)) {
    const matched = match[0];
    const start = match.index ?? 0;
    const end = start + matched.length;
    out += text.slice(cursor, start);
    if (isInsideCode(start, codeRegions)) {
      out += matched;
    } else if (shouldInsertSeparator(text[start - 1], text[end])) {
      out += ' ';
    }
    cursor = end;
  }
  out += text.slice(cursor);
  return out;
}
