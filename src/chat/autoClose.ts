import type { BlockType } from './streaming-markdown-scanner';

type InlineToken = '**' | '__' | '*' | '_' | '`' | '~~' | '[';

const TOKEN_CLOSERS: Record<InlineToken, string> = {
  '**': '**',
  '__': '__',
  '*': '*',
  '_': '_',
  '`': '`',
  '~~': '~~',
  '[': ']()',
};

/**
 * Closes any open inline markdown tokens in `text` so that ReactMarkdown sees
 * well-formed input while the stream is still producing. For `code_fence`
 * blocks, also appends a closing fence if one isn't present.
 *
 * Pure. Does not mutate input.
 */
export function autoClose(text: string, blockType: BlockType): string {
  // For code_fence blocks, the content is raw code — skip inline token parsing.
  if (blockType === 'code_fence') {
    const trimmed = text.trimEnd();
    const hasClosingFence = /(^|\n)```\s*$/.test(trimmed);
    if (!hasClosingFence) {
      return (text.endsWith('\n') ? text : text + '\n') + '```';
    }
    return text;
  }

  const stack: InlineToken[] = [];
  let i = 0;
  let inCode = false;

  while (i < text.length) {
    const c = text[i];
    const c2 = text.slice(i, i + 2);

    // Inline code span toggles — while inside, other tokens are inert.
    if (c === '`') {
      if (inCode) {
        inCode = false;
        stack.pop();
      } else {
        inCode = true;
        stack.push('`');
      }
      i += 1;
      continue;
    }

    if (inCode) {
      i += 1;
      continue;
    }

    if (c2 === '**') {
      toggle(stack, '**');
      i += 2;
      continue;
    }
    if (c2 === '__') {
      toggle(stack, '__');
      i += 2;
      continue;
    }
    if (c2 === '~~') {
      toggle(stack, '~~');
      i += 2;
      continue;
    }
    if (c === '*') {
      toggle(stack, '*');
      i += 1;
      continue;
    }
    if (c === '_') {
      toggle(stack, '_');
      i += 1;
      continue;
    }
    if (c === '[') {
      stack.push('[');
      i += 1;
      continue;
    }
    if (c === ']') {
      // Matching ] for an open [ — the paren group may or may not follow.
      const top = stack[stack.length - 1];
      if (top === '[') stack.pop();
      i += 1;
      continue;
    }
    i += 1;
  }

  let out = text;
  for (let k = stack.length - 1; k >= 0; k--) {
    out += TOKEN_CLOSERS[stack[k]];
  }

  return out;
}

function toggle(stack: InlineToken[], token: InlineToken) {
  const top = stack[stack.length - 1];
  if (top === token) stack.pop();
  else stack.push(token);
}

/**
 * Returns the largest k ≤ cursor such that `text.slice(0, k)` has no open
 * inline markdown token. Used by the streaming reveal cursor to hold the
 * displayed slice at a safe boundary — so `*hel` inside `*hello*` never
 * renders as literal punctuation; the whole `*hello*` appears at once when
 * the closer enters the revealed range.
 *
 * For `code_fence` blocks, inline parsing is inert — returns `cursor` as-is.
 */
export function findSafeRevealCount(
  text: string,
  cursor: number,
  blockType: BlockType,
): number {
  if (blockType === 'code_fence') return cursor;

  const limit = Math.min(cursor, text.length);
  const stack: Array<{ token: InlineToken; pos: number }> = [];
  let inCode = false;
  // Math delimiter tracking: position of the opening `$` / `$$`, or null.
  // While inside math, we skip inline-markdown token scanning — math has its
  // own syntax. Heuristics for single-`$` follow remark-math: an opening `$`
  // cannot be followed by whitespace, and literal "$5" style money isn't
  // treated as math because the next char is a digit. `$$` is unconditional.
  let mathOpenPos: number | null = null;
  let mathIsDisplay = false;
  let i = 0;

  const toggleAt = (token: InlineToken, pos: number) => {
    const top = stack[stack.length - 1];
    if (top && top.token === token) stack.pop();
    else stack.push({ token, pos });
  };

  while (i < limit) {
    const c = text[i];
    const c2 = text.slice(i, i + 2);

    if (c === '`') {
      if (inCode) {
        inCode = false;
        stack.pop();
      } else {
        inCode = true;
        stack.push({ token: '`', pos: i });
      }
      i += 1;
      continue;
    }
    if (inCode) {
      i += 1;
      continue;
    }

    // Math: `$$` display delimiter.
    if (c2 === '$$') {
      if (mathOpenPos === null) {
        mathOpenPos = i;
        mathIsDisplay = true;
        i += 2;
        continue;
      }
      if (mathIsDisplay) {
        mathOpenPos = null;
        mathIsDisplay = false;
        i += 2;
        continue;
      }
      // Inside inline math: the first `$` closes, second opens anew.
      mathOpenPos = i + 1;
      i += 2;
      continue;
    }
    // Math: single `$` inline delimiter.
    if (c === '$') {
      if (mathOpenPos !== null && !mathIsDisplay) {
        mathOpenPos = null;
        i += 1;
        continue;
      }
      if (mathOpenPos !== null && mathIsDisplay) {
        i += 1;
        continue;
      }
      const next = text[i + 1];
      const isOpener = next !== undefined && next !== ' ' && next !== '\t' && next !== '\n';
      if (isOpener) {
        mathOpenPos = i;
        mathIsDisplay = false;
      }
      i += 1;
      continue;
    }
    // Inside math, suspend markdown inline scanning until the closer arrives.
    if (mathOpenPos !== null) {
      i += 1;
      continue;
    }

    if (c2 === '**') {
      toggleAt('**', i);
      i += 2;
      continue;
    }
    if (c2 === '__') {
      toggleAt('__', i);
      i += 2;
      continue;
    }
    if (c2 === '~~') {
      toggleAt('~~', i);
      i += 2;
      continue;
    }
    if (c === '*') {
      toggleAt('*', i);
      i += 1;
      continue;
    }
    if (c === '_') {
      toggleAt('_', i);
      i += 1;
      continue;
    }
    if (c === '[') {
      stack.push({ token: '[', pos: i });
      i += 1;
      continue;
    }
    if (c === ']') {
      const top = stack[stack.length - 1];
      if (top && top.token === '[') stack.pop();
      i += 1;
      continue;
    }
    i += 1;
  }

  const firstUnclosed =
    stack.length === 0 ? limit : stack[0].pos;
  if (mathOpenPos !== null) return Math.min(firstUnclosed, mathOpenPos);
  return firstUnclosed;
}
