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

  return stack.length === 0 ? limit : stack[0].pos;
}
