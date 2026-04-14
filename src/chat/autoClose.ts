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
