# Streaming Markdown Blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render markdown progressively during assistant streaming by decomposing the message into block elements whose structural frames appear immediately and whose content fills char-by-char inside.

**Architecture:** A non-React line-level scanner ingests deltas and emits an ordered list of `Block` records (type + frameSource + contentSource + status). A React `StreamingMarkdownRenderer` mirrors that list and renders each `StreamingBlock`, which runs its own RAF char cursor and passes `frameSource + autoClose(contentSource.slice(0, displayCount))` through the existing `ReactMarkdown` + `remarkGfm` setup. The final end-of-stream swap to full-document `ReactMarkdown` is untouched.

**Tech Stack:** TypeScript, React 19, Vitest, `react-markdown`, `remark-gfm`, Zustand (for settings). No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-04-14-streaming-markdown-blocks-design.md`](../specs/2026-04-14-streaming-markdown-blocks-design.md)

---

## File Structure

**New files**

- `src/chat/autoClose.ts` — pure helper that closes open inline markdown tokens (and the code fence) in a partial string so ReactMarkdown sees well-formed input.
- `src/chat/autoClose.test.ts` — vitest unit tests.
- `src/chat/streaming-markdown-scanner.ts` — pure line-level state machine that converts growing raw content into an ordered `Block[]`.
- `src/chat/streaming-markdown-scanner.test.ts` — vitest unit tests including a chunk-randomization property test.
- `src/chat/StreamingBlock.tsx` — renders one block (frame + char-gated content through ReactMarkdown, entrance animation).
- `src/chat/StreamingMarkdownRenderer.tsx` — owns the scanner, mirrors blocks into state, renders the block list.

**Modified files**

- `src/app.css` — add `@keyframes stream-block-in` and `.stream-block-in` class.
- `src/settings/types.ts` — add `textRevealStructure: 'blocks' | 'flat'` to `ChatUIDefaults` and `DEFAULT_CHAT_UI_DEFAULTS`.
- `src/settings/sections/AppearanceSection.tsx` — add structure-mode radio group.
- `src/chat/MessageBubble.tsx` — replace `<StreamingText>` usage in the streaming branch with `<StreamingMarkdownRenderer>` gated on `textRevealStructure`.

---

## Task 1: CSS entrance keyframe

**Files:**
- Modify: `src/app.css` (append after the existing `.stream-char-fade` block, line ~51)

- [ ] **Step 1: Add the keyframe and class**

Append to `src/app.css`:

```css
@keyframes streamBlockIn {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.stream-block-in {
  animation: streamBlockIn 200ms ease-out both;
}
```

- [ ] **Step 2: Verify the dev build still compiles**

Run: `npm run typecheck`
Expected: no errors (CSS is not type-checked but the script should still pass cleanly).

- [ ] **Step 3: Commit**

```bash
git add src/app.css
git commit -m "chore(chat): add streamBlockIn keyframe for streaming markdown blocks"
```

---

## Task 2: `autoClose` helper

**Files:**
- Create: `src/chat/autoClose.ts`
- Test: `src/chat/autoClose.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/chat/autoClose.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { autoClose } from './autoClose';

describe('autoClose', () => {
  it('returns already-closed input unchanged', () => {
    expect(autoClose('hello world', 'paragraph')).toBe('hello world');
    expect(autoClose('**done**', 'paragraph')).toBe('**done**');
  });

  it('closes an unclosed bold token', () => {
    expect(autoClose('a **bol', 'paragraph')).toBe('a **bol**');
  });

  it('closes an unclosed italic token', () => {
    expect(autoClose('an *it', 'paragraph')).toBe('an *it*');
  });

  it('closes unclosed underscore italic and bold', () => {
    expect(autoClose('_it', 'paragraph')).toBe('_it_');
    expect(autoClose('__bo', 'paragraph')).toBe('__bo__');
  });

  it('closes an unclosed inline code span', () => {
    expect(autoClose('use `foo', 'paragraph')).toBe('use `foo`');
  });

  it('closes an unclosed strikethrough', () => {
    expect(autoClose('~~gon', 'paragraph')).toBe('~~gon~~');
  });

  it('closes an unclosed link text bracket', () => {
    expect(autoClose('see [click', 'paragraph')).toBe('see [click]()');
  });

  it('does not double-close already closed tokens inside partial text', () => {
    expect(autoClose('**done** and *par', 'paragraph')).toBe('**done** and *par*');
  });

  it('closes nested tokens in LIFO order', () => {
    expect(autoClose('**bold and *italic', 'paragraph')).toBe('**bold and *italic***');
  });

  it('appends a closing fence when code_fence source is not terminated', () => {
    expect(autoClose('```ts\nconst x = 1', 'code_fence')).toBe('```ts\nconst x = 1\n```');
  });

  it('does not add a second closing fence when already present', () => {
    const src = '```ts\nconst x = 1\n```';
    expect(autoClose(src, 'code_fence')).toBe(src);
  });

  it('does not treat tokens inside inline code as open', () => {
    expect(autoClose('code `**not-bold', 'paragraph')).toBe('code `**not-bold`');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/chat/autoClose.test.ts`
Expected: FAIL — `Cannot find module './autoClose'`.

- [ ] **Step 3: Implement `autoClose`**

Create `src/chat/autoClose.ts`:

```ts
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

  if (blockType === 'code_fence') {
    const trimmed = out.trimEnd();
    const hasClosingFence = /(^|\n)```\s*$/.test(trimmed);
    if (!hasClosingFence) {
      out = (out.endsWith('\n') ? out : out + '\n') + '```';
    }
  }

  return out;
}

function toggle(stack: InlineToken[], token: InlineToken) {
  const top = stack[stack.length - 1];
  if (top === token) stack.pop();
  else stack.push(token);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/chat/autoClose.test.ts`
Expected: PASS (all 12 tests green).

- [ ] **Step 5: Commit**

```bash
git add src/chat/autoClose.ts src/chat/autoClose.test.ts
git commit -m "feat(chat): add autoClose helper for partial markdown input"
```

---

## Task 3: Scanner — types, append, paragraph, heading, blank-line close

**Files:**
- Create: `src/chat/streaming-markdown-scanner.ts`
- Test: `src/chat/streaming-markdown-scanner.test.ts`

- [ ] **Step 1: Write failing tests for the MVP block types**

Create `src/chat/streaming-markdown-scanner.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createScanner, type Block } from './streaming-markdown-scanner';

function feed(input: string) {
  const s = createScanner();
  s.append(input);
  return s.getBlocks();
}

function committed(blocks: readonly Block[]) {
  return blocks.filter((b) => b.status !== 'tentative');
}

describe('streaming-markdown-scanner — paragraphs and headings', () => {
  it('returns empty block list for empty input', () => {
    expect(createScanner().getBlocks()).toEqual([]);
  });

  it('opens a paragraph block on the first non-blank char', () => {
    const blocks = committed(feed('hello world\n'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[0].contentSource).toBe('hello world');
    expect(blocks[0].frameSource).toBe('');
  });

  it('closes a paragraph on a blank line', () => {
    const blocks = committed(feed('line one\n\n'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].status).toBe('closed');
  });

  it('opens a new paragraph after a blank line', () => {
    const blocks = committed(feed('first\n\nsecond\n'));
    expect(blocks).toHaveLength(2);
    expect(blocks[0].contentSource).toBe('first');
    expect(blocks[1].contentSource).toBe('second');
  });

  it('recognises an h1 heading', () => {
    const blocks = committed(feed('# Title\n'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('heading');
    expect(blocks[0].frameSource).toBe('# ');
    expect(blocks[0].contentSource).toBe('Title');
    expect(blocks[0].status).toBe('closed');
  });

  it('recognises h2 through h6 headings', () => {
    for (let n = 2; n <= 6; n++) {
      const hashes = '#'.repeat(n);
      const blocks = committed(feed(`${hashes} H${n}\n`));
      expect(blocks[0].type).toBe('heading');
      expect(blocks[0].frameSource).toBe(`${hashes} `);
      expect(blocks[0].contentSource).toBe(`H${n}`);
    }
  });

  it('treats `#abc` (no space) as a paragraph', () => {
    const blocks = committed(feed('#abc\n'));
    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[0].contentSource).toBe('#abc');
  });

  it('appends to an open paragraph across multiple lines', () => {
    const blocks = committed(feed('line a\nline b\n'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].contentSource).toBe('line a\nline b');
  });

  it('treats partial (not-yet-newline) input as still-being-built', () => {
    const s = createScanner();
    s.append('hello');
    const blocks = committed(s.getBlocks());
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[0].contentSource).toBe('hello');
    expect(blocks[0].status).toBe('open');
  });

  it('notifies subscribers on append', () => {
    const s = createScanner();
    let count = 0;
    s.onChange(() => count++);
    s.append('hi\n');
    expect(count).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/chat/streaming-markdown-scanner.test.ts`
Expected: FAIL — `Cannot find module './streaming-markdown-scanner'`.

- [ ] **Step 3: Implement the scanner core**

Create `src/chat/streaming-markdown-scanner.ts`:

```ts
export type BlockType =
  | 'paragraph'
  | 'heading'
  | 'code_fence'
  | 'blockquote'
  | 'list'
  | 'list_item'
  | 'table'
  | 'table_row'
  | 'hr'
  | 'image'
  | 'setext_heading';

export type BlockStatus = 'tentative' | 'open' | 'closed';

export interface Block {
  id: string;
  type: BlockType;
  status: BlockStatus;
  frameSource: string;
  contentSource: string;
  children?: Block[];
}

export interface Scanner {
  append(chars: string): void;
  getBlocks(): readonly Block[];
  onChange(cb: () => void): () => void;
  finalize(): void;
}

/**
 * Creates a stateful scanner. Feed it raw assistant deltas via `append()`.
 * The scanner builds an ordered list of `Block` records that reflect the
 * structural decomposition of the stream so far.
 *
 * Internal state only mutates on complete (newline-terminated) lines. The
 * `lineBuffer` holds the current partial line and is projected onto the open
 * block (or a speculative paragraph) at read time — this keeps classification
 * stable while still letting the renderer show text as it arrives.
 */
export function createScanner(): Scanner {
  let nextId = 0;
  const mkId = () => `blk_${nextId++}`;

  const internalBlocks: Block[] = [];
  let openBlock: Block | null = null;
  let lineBuffer = '';

  const subs = new Set<() => void>();
  const notify = () => {
    subs.forEach((cb) => cb());
  };

  function closeOpen() {
    if (openBlock) {
      openBlock.status = 'closed';
      openBlock = null;
    }
  }

  function startBlock(type: BlockType, frameSource: string, contentSource: string): Block {
    closeOpen();
    const b: Block = {
      id: mkId(),
      type,
      status: 'open',
      frameSource,
      contentSource,
    };
    internalBlocks.push(b);
    openBlock = b;
    return b;
  }

  function classifyLine(line: string) {
    // Blank line closes an open block.
    if (line.trim() === '') {
      closeOpen();
      return;
    }

    // ATX heading: 1-6 hashes + space + text
    const headingMatch = /^(#{1,6}) (.*)$/.exec(line);
    if (headingMatch) {
      const block = startBlock('heading', `${headingMatch[1]} `, headingMatch[2]);
      block.status = 'closed';
      openBlock = null;
      return;
    }

    // Default: paragraph. Append to open paragraph if one exists, else start.
    if (openBlock && openBlock.type === 'paragraph') {
      openBlock.contentSource += '\n' + line;
      return;
    }
    startBlock('paragraph', '', line);
  }

  function processCompletedLines() {
    while (true) {
      const nlIndex = lineBuffer.indexOf('\n');
      if (nlIndex === -1) return;
      const line = lineBuffer.slice(0, nlIndex);
      lineBuffer = lineBuffer.slice(nlIndex + 1);
      classifyLine(line);
    }
  }

  function startsWithSpecialSyntax(s: string): boolean {
    return /^(#{1,6} |```|~~~|- |\* |\+ |\d+\. |> |!\[|---|\*\*\*|___|\|)/.test(s);
  }

  /**
   * Returns blocks with the partial `lineBuffer` projected onto the open
   * block (or as a speculative paragraph when nothing is open and the
   * buffer doesn't look like a block marker). Pure — does not mutate state.
   */
  function projectedBlocks(): Block[] {
    if (lineBuffer.length === 0) return internalBlocks;

    if (openBlock && openBlock.type === 'paragraph') {
      const view = internalBlocks.slice();
      const idx = view.indexOf(openBlock);
      view[idx] = {
        ...openBlock,
        contentSource: openBlock.contentSource + '\n' + lineBuffer,
      };
      return view;
    }

    if (!openBlock && !startsWithSpecialSyntax(lineBuffer)) {
      return [
        ...internalBlocks,
        {
          id: '__partial__',
          type: 'paragraph',
          status: 'open',
          frameSource: '',
          contentSource: lineBuffer,
        },
      ];
    }

    return internalBlocks;
  }

  return {
    append(chars: string) {
      lineBuffer += chars;
      processCompletedLines();
      notify();
    },
    getBlocks() {
      return projectedBlocks();
    },
    onChange(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    finalize() {
      if (lineBuffer.length > 0) {
        classifyLine(lineBuffer);
        lineBuffer = '';
      }
      closeOpen();
      notify();
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/chat/streaming-markdown-scanner.test.ts`
Expected: PASS (all 10 tests green).

- [ ] **Step 5: Commit**

```bash
git add src/chat/streaming-markdown-scanner.ts src/chat/streaming-markdown-scanner.test.ts
git commit -m "feat(chat): add streaming markdown scanner core (paragraph + heading)"
```

---

## Task 4: Scanner — code fence with detection suspension

**Files:**
- Modify: `src/chat/streaming-markdown-scanner.ts`
- Test: `src/chat/streaming-markdown-scanner.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `src/chat/streaming-markdown-scanner.test.ts`:

```ts
describe('streaming-markdown-scanner — code fences', () => {
  it('opens a code_fence block on triple-backtick', () => {
    const s = createScanner();
    s.append('```js\nconst x = 1\n');
    const blocks = s.getBlocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('code_fence');
    expect(blocks[0].frameSource).toBe('```js\n');
    expect(blocks[0].contentSource).toBe('const x = 1');
    expect(blocks[0].status).toBe('open');
  });

  it('closes the code_fence on the matching closing fence', () => {
    const s = createScanner();
    s.append('```js\nconst x = 1\n```\n');
    const blocks = s.getBlocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0].status).toBe('closed');
    expect(blocks[0].contentSource).toBe('const x = 1');
  });

  it('does not classify markdown inside a code fence', () => {
    const s = createScanner();
    s.append('```\n# not a heading\n> not a quote\n```\n');
    const blocks = s.getBlocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('code_fence');
    expect(blocks[0].contentSource).toBe('# not a heading\n> not a quote');
  });

  it('supports tildes as fence', () => {
    const s = createScanner();
    s.append('~~~python\nprint(1)\n~~~\n');
    const blocks = s.getBlocks();
    expect(blocks[0].type).toBe('code_fence');
    expect(blocks[0].frameSource).toBe('~~~python\n');
    expect(blocks[0].contentSource).toBe('print(1)');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/chat/streaming-markdown-scanner.test.ts`
Expected: FAIL — code fence tests fail because lines are classified as headings/paragraphs.

- [ ] **Step 3: Update the scanner to handle code fences**

Modify `src/chat/streaming-markdown-scanner.ts`. Replace `classifyLine` with:

```ts
  function classifyLine(line: string) {
    // Inside an open code fence, lines are appended verbatim until the
    // matching closing fence.
    if (openBlock && openBlock.type === 'code_fence') {
      const fenceChar = openBlock.frameSource.startsWith('~~~') ? '~~~' : '```';
      if (line.trim() === fenceChar) {
        openBlock.status = 'closed';
        openBlock = null;
        return;
      }
      openBlock.contentSource += (openBlock.contentSource ? '\n' : '') + line;
      return;
    }

    // Blank line closes an open block.
    if (line.trim() === '') {
      closeOpen();
      return;
    }

    // Opening code fence: ``` or ~~~ optionally followed by a language tag.
    const fenceMatch = /^(```|~~~)([^\s`~]*)\s*$/.exec(line);
    if (fenceMatch) {
      startBlock('code_fence', `${fenceMatch[1]}${fenceMatch[2]}\n`, '');
      return;
    }

    // ATX heading: 1-6 hashes + space + text
    const headingMatch = /^(#{1,6}) (.*)$/.exec(line);
    if (headingMatch) {
      const block = startBlock('heading', `${headingMatch[1]} `, headingMatch[2]);
      block.status = 'closed';
      openBlock = null;
      return;
    }

    // Default: paragraph. Append to open paragraph if one exists, else start.
    if (openBlock && openBlock.type === 'paragraph') {
      openBlock.contentSource += '\n' + line;
      return;
    }
    startBlock('paragraph', '', line);
  }
```

Also extend `projectedBlocks` so a partial line inside an open code fence is projected too. Update the function by inserting this branch immediately after the `if (lineBuffer.length === 0) return internalBlocks;` line:

```ts
    if (openBlock && openBlock.type === 'code_fence') {
      const view = internalBlocks.slice();
      const idx = view.indexOf(openBlock);
      view[idx] = {
        ...openBlock,
        contentSource:
          openBlock.contentSource + (openBlock.contentSource ? '\n' : '') + lineBuffer,
      };
      return view;
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/chat/streaming-markdown-scanner.test.ts`
Expected: PASS (all existing tests + 4 new code-fence tests).

- [ ] **Step 5: Commit**

```bash
git add src/chat/streaming-markdown-scanner.ts src/chat/streaming-markdown-scanner.test.ts
git commit -m "feat(chat): scanner handles code fences with detection suspension"
```

---

## Task 5: Scanner — blockquote, hr, image, lists

**Files:**
- Modify: `src/chat/streaming-markdown-scanner.ts`
- Test: `src/chat/streaming-markdown-scanner.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `src/chat/streaming-markdown-scanner.test.ts`:

```ts
describe('streaming-markdown-scanner — blockquote, hr, image', () => {
  it('recognises a blockquote line', () => {
    const s = createScanner();
    s.append('> quoted text\n');
    const blocks = s.getBlocks();
    expect(blocks[0].type).toBe('blockquote');
    expect(blocks[0].frameSource).toBe('> ');
    expect(blocks[0].contentSource).toBe('quoted text');
  });

  it('continues a blockquote across consecutive `>` lines', () => {
    const s = createScanner();
    s.append('> line 1\n> line 2\n');
    const blocks = s.getBlocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0].contentSource).toBe('line 1\nline 2');
  });

  it('recognises a horizontal rule', () => {
    const s = createScanner();
    s.append('---\n');
    const blocks = s.getBlocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('hr');
    expect(blocks[0].status).toBe('closed');
  });

  it('recognises a standalone image', () => {
    const s = createScanner();
    s.append('![alt](http://example.com/a.png)\n');
    const blocks = s.getBlocks();
    expect(blocks[0].type).toBe('image');
    expect(blocks[0].frameSource).toBe('![alt](http://example.com/a.png)');
    expect(blocks[0].status).toBe('closed');
  });
});

describe('streaming-markdown-scanner — lists', () => {
  it('opens a list block with a single item', () => {
    const s = createScanner();
    s.append('- alpha\n');
    const blocks = s.getBlocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('list');
    expect(blocks[0].children).toBeDefined();
    expect(blocks[0].children!).toHaveLength(1);
    const item = blocks[0].children![0];
    expect(item.type).toBe('list_item');
    expect(item.frameSource).toBe('- ');
    expect(item.contentSource).toBe('alpha');
  });

  it('adds subsequent items to the same list', () => {
    const s = createScanner();
    s.append('- alpha\n- beta\n- gamma\n');
    const blocks = s.getBlocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0].children).toHaveLength(3);
    expect(blocks[0].children!.map((c) => c.contentSource)).toEqual([
      'alpha',
      'beta',
      'gamma',
    ]);
  });

  it('recognises ordered list items', () => {
    const s = createScanner();
    s.append('1. first\n2. second\n');
    const blocks = s.getBlocks();
    expect(blocks[0].type).toBe('list');
    expect(blocks[0].children![0].frameSource).toBe('1. ');
    expect(blocks[0].children![1].frameSource).toBe('2. ');
  });

  it('closes a list on a blank line and starts a new paragraph after', () => {
    const s = createScanner();
    s.append('- alpha\n\nafter\n');
    const blocks = s.getBlocks();
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('list');
    expect(blocks[0].status).toBe('closed');
    expect(blocks[1].type).toBe('paragraph');
    expect(blocks[1].contentSource).toBe('after');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/chat/streaming-markdown-scanner.test.ts`
Expected: FAIL for the new tests (current scanner returns paragraphs).

- [ ] **Step 3: Extend the scanner**

Modify `src/chat/streaming-markdown-scanner.ts`. Replace `classifyLine` with the expanded version below:

```ts
  function openList(): Block {
    closeOpen();
    const list: Block = {
      id: mkId(),
      type: 'list',
      status: 'open',
      frameSource: '',
      contentSource: '',
      children: [],
    };
    blocks.push(list);
    openBlock = list;
    return list;
  }

  function appendListItem(list: Block, frame: string, content: string) {
    const item: Block = {
      id: mkId(),
      type: 'list_item',
      status: 'closed',
      frameSource: frame,
      contentSource: content,
    };
    list.children!.push(item);
  }

  function classifyLine(line: string) {
    // Inside an open code fence, lines are appended verbatim until the
    // matching closing fence.
    if (openBlock && openBlock.type === 'code_fence') {
      const fenceChar = openBlock.frameSource.startsWith('~~~') ? '~~~' : '```';
      if (line.trim() === fenceChar) {
        openBlock.status = 'closed';
        openBlock = null;
        return;
      }
      openBlock.contentSource += (openBlock.contentSource ? '\n' : '') + line;
      return;
    }

    // Blank line closes an open block.
    if (line.trim() === '') {
      closeOpen();
      return;
    }

    // Opening code fence.
    const fenceMatch = /^(```|~~~)([^\s`~]*)\s*$/.exec(line);
    if (fenceMatch) {
      startBlock('code_fence', `${fenceMatch[1]}${fenceMatch[2]}\n`, '');
      return;
    }

    // Horizontal rule — 3+ of -, *, or _ alone on a line.
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      const block = startBlock('hr', `${line}\n`, '');
      block.status = 'closed';
      openBlock = null;
      return;
    }

    // Standalone image.
    if (/^!\[[^\]]*\]\([^)]+\)\s*$/.test(line)) {
      const block = startBlock('image', line.trim(), '');
      block.status = 'closed';
      openBlock = null;
      return;
    }

    // ATX heading.
    const headingMatch = /^(#{1,6}) (.*)$/.exec(line);
    if (headingMatch) {
      const block = startBlock('heading', `${headingMatch[1]} `, headingMatch[2]);
      block.status = 'closed';
      openBlock = null;
      return;
    }

    // Blockquote.
    const quoteMatch = /^> (.*)$/.exec(line);
    if (quoteMatch) {
      if (openBlock && openBlock.type === 'blockquote') {
        openBlock.contentSource += '\n' + quoteMatch[1];
      } else {
        startBlock('blockquote', '> ', quoteMatch[1]);
      }
      return;
    }

    // Unordered list item.
    const ulMatch = /^([-*+]) (.*)$/.exec(line);
    if (ulMatch) {
      const list =
        openBlock && openBlock.type === 'list' ? openBlock : openList();
      appendListItem(list, `${ulMatch[1]} `, ulMatch[2]);
      return;
    }

    // Ordered list item.
    const olMatch = /^(\d+\.) (.*)$/.exec(line);
    if (olMatch) {
      const list =
        openBlock && openBlock.type === 'list' ? openBlock : openList();
      appendListItem(list, `${olMatch[1]} `, olMatch[2]);
      return;
    }

    // Default: paragraph.
    if (openBlock && openBlock.type === 'paragraph') {
      openBlock.contentSource += '\n' + line;
      return;
    }
    startBlock('paragraph', '', line);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/chat/streaming-markdown-scanner.test.ts`
Expected: PASS — all existing + 9 new tests.

- [ ] **Step 5: Commit**

```bash
git add src/chat/streaming-markdown-scanner.ts src/chat/streaming-markdown-scanner.test.ts
git commit -m "feat(chat): scanner recognises blockquote, hr, image, and lists"
```

---

## Task 6: Scanner — table and setext heading disambiguation + idle timeout + finalize

**Files:**
- Modify: `src/chat/streaming-markdown-scanner.ts`
- Test: `src/chat/streaming-markdown-scanner.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `src/chat/streaming-markdown-scanner.test.ts`:

```ts
import { vi } from 'vitest';

describe('streaming-markdown-scanner — disambiguation', () => {
  it('promotes a tentative `|`-line to a table when separator arrives', () => {
    const s = createScanner();
    s.append('| a | b |\n');
    // Before the separator arrives, the line is tentative (not visible).
    expect(s.getBlocks().filter((b) => b.status !== 'tentative')).toHaveLength(0);
    s.append('| --- | --- |\n| 1 | 2 |\n');
    const committed = s.getBlocks().filter((b) => b.status !== 'tentative');
    expect(committed).toHaveLength(1);
    expect(committed[0].type).toBe('table');
    expect(committed[0].frameSource).toBe('| a | b |\n| --- | --- |\n');
    expect(committed[0].children).toBeDefined();
    expect(committed[0].children![0].type).toBe('table_row');
    expect(committed[0].children![0].contentSource).toBe('| 1 | 2 |');
  });

  it('falls back a tentative `|` line to a paragraph when next line is not a separator', () => {
    const s = createScanner();
    s.append('| not a table\nplain text after\n');
    const committed = s.getBlocks().filter((b) => b.status !== 'tentative');
    expect(committed).toHaveLength(1);
    expect(committed[0].type).toBe('paragraph');
    expect(committed[0].contentSource).toBe('| not a table\nplain text after');
  });

  it('promotes a paragraph line to a setext heading when followed by `===`', () => {
    const s = createScanner();
    s.append('Title\n===\n');
    const committed = s.getBlocks().filter((b) => b.status !== 'tentative');
    expect(committed).toHaveLength(1);
    expect(committed[0].type).toBe('setext_heading');
    expect(committed[0].frameSource).toBe('Title\n===\n');
  });

  it('commits a tentative block to its fallback after the idle timeout', () => {
    vi.useFakeTimers();
    try {
      const s = createScanner();
      s.append('| maybe a table\n');
      // Still tentative.
      expect(s.getBlocks().filter((b) => b.status !== 'tentative')).toHaveLength(0);
      vi.advanceTimersByTime(200);
      const committed = s.getBlocks().filter((b) => b.status !== 'tentative');
      expect(committed).toHaveLength(1);
      expect(committed[0].type).toBe('paragraph');
    } finally {
      vi.useRealTimers();
    }
  });

  it('finalize() force-commits tentative blocks and closes open ones', () => {
    const s = createScanner();
    s.append('| pending\n');
    s.finalize();
    const blocks = s.getBlocks();
    expect(blocks.every((b) => b.status === 'closed')).toBe(true);
    expect(blocks[0].type).toBe('paragraph');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/chat/streaming-markdown-scanner.test.ts`
Expected: FAIL — disambiguation tests fail.

- [ ] **Step 3: Add tentative-block machinery to the scanner**

Modify `src/chat/streaming-markdown-scanner.ts`. Add state and helpers before `classifyLine`:

```ts
  // Tentative block held for one-line lookahead (table detection, setext).
  // `tentativeKind` tells us which fallback to commit to on timeout.
  let tentativeLine: string | null = null;
  let tentativeKind: 'table' | 'setext' | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const IDLE_COMMIT_MS = 150;

  function clearIdle() {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function scheduleIdle() {
    clearIdle();
    idleTimer = setTimeout(() => {
      idleTimer = null;
      commitTentativeFallback();
      notify();
    }, IDLE_COMMIT_MS);
  }

  function commitTentativeFallback() {
    if (tentativeLine === null) return;
    const line = tentativeLine;
    const kind = tentativeKind;
    tentativeLine = null;
    tentativeKind = null;
    if (kind === 'table') {
      // fallback: treat as a plain paragraph line
      if (openBlock && openBlock.type === 'paragraph') {
        openBlock.contentSource += '\n' + line;
      } else {
        startBlock('paragraph', '', line);
      }
    } else if (kind === 'setext') {
      // fallback: commit the original paragraph line as-is
      if (openBlock && openBlock.type === 'paragraph') {
        openBlock.contentSource += '\n' + line;
      } else {
        startBlock('paragraph', '', line);
      }
    }
  }

  function promoteTableFromTentative(separatorLine: string) {
    if (tentativeLine === null || tentativeKind !== 'table') return;
    const header = tentativeLine;
    tentativeLine = null;
    tentativeKind = null;
    const table: Block = {
      id: mkId(),
      type: 'table',
      status: 'open',
      frameSource: `${header}\n${separatorLine}\n`,
      contentSource: '',
      children: [],
    };
    closeOpen();
    blocks.push(table);
    openBlock = table;
  }

  function promoteSetextFromTentative(underline: string) {
    if (tentativeLine === null || tentativeKind !== 'setext') return;
    const title = tentativeLine;
    tentativeLine = null;
    tentativeKind = null;
    const block = startBlock('setext_heading', `${title}\n${underline}\n`, '');
    block.status = 'closed';
    openBlock = null;
  }
```

Update `classifyLine` — add tentative handling at the top (right after code-fence suspension) and add table / setext branches. Full replacement:

```ts
  function classifyLine(line: string) {
    // Inside an open code fence, lines are appended verbatim until the fence closes.
    if (openBlock && openBlock.type === 'code_fence') {
      const fenceChar = openBlock.frameSource.startsWith('~~~') ? '~~~' : '```';
      if (line.trim() === fenceChar) {
        openBlock.status = 'closed';
        openBlock = null;
        return;
      }
      openBlock.contentSource += (openBlock.contentSource ? '\n' : '') + line;
      return;
    }

    // Tentative lookahead resolution.
    if (tentativeLine !== null) {
      if (tentativeKind === 'table' && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)) {
        promoteTableFromTentative(line);
        return;
      }
      if (tentativeKind === 'setext' && /^(={3,}|-{3,})\s*$/.test(line)) {
        promoteSetextFromTentative(line);
        return;
      }
      commitTentativeFallback();
      // fall through — re-classify the current line normally
    }

    // Blank line closes an open block.
    if (line.trim() === '') {
      closeOpen();
      return;
    }

    // Opening code fence.
    const fenceMatch = /^(```|~~~)([^\s`~]*)\s*$/.exec(line);
    if (fenceMatch) {
      startBlock('code_fence', `${fenceMatch[1]}${fenceMatch[2]}\n`, '');
      return;
    }

    // Horizontal rule.
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      const block = startBlock('hr', `${line}\n`, '');
      block.status = 'closed';
      openBlock = null;
      return;
    }

    // Standalone image.
    if (/^!\[[^\]]*\]\([^)]+\)\s*$/.test(line)) {
      const block = startBlock('image', line.trim(), '');
      block.status = 'closed';
      openBlock = null;
      return;
    }

    // ATX heading.
    const headingMatch = /^(#{1,6}) (.*)$/.exec(line);
    if (headingMatch) {
      const block = startBlock('heading', `${headingMatch[1]} `, headingMatch[2]);
      block.status = 'closed';
      openBlock = null;
      return;
    }

    // Blockquote.
    const quoteMatch = /^> (.*)$/.exec(line);
    if (quoteMatch) {
      if (openBlock && openBlock.type === 'blockquote') {
        openBlock.contentSource += '\n' + quoteMatch[1];
      } else {
        startBlock('blockquote', '> ', quoteMatch[1]);
      }
      return;
    }

    // Unordered / ordered list items (open list if needed).
    const ulMatch = /^([-*+]) (.*)$/.exec(line);
    if (ulMatch) {
      const list = openBlock && openBlock.type === 'list' ? openBlock : openList();
      appendListItem(list, `${ulMatch[1]} `, ulMatch[2]);
      return;
    }
    const olMatch = /^(\d+\.) (.*)$/.exec(line);
    if (olMatch) {
      const list = openBlock && openBlock.type === 'list' ? openBlock : openList();
      appendListItem(list, `${olMatch[1]} `, olMatch[2]);
      return;
    }

    // Table row appended to an open table.
    if (openBlock && openBlock.type === 'table' && /^\|.*\|\s*$/.test(line)) {
      const row: Block = {
        id: mkId(),
        type: 'table_row',
        status: 'closed',
        frameSource: '',
        contentSource: line,
      };
      openBlock.children!.push(row);
      return;
    }

    // Tentative-line candidates.
    if (/^\|.*\|\s*$/.test(line)) {
      tentativeLine = line;
      tentativeKind = 'table';
      scheduleIdle();
      return;
    }

    // Setext candidate: any non-blank line can become a heading if the next
    // line is === or ---. Only apply when there's no open block above.
    if (!openBlock) {
      tentativeLine = line;
      tentativeKind = 'setext';
      scheduleIdle();
      return;
    }

    // Default: paragraph.
    if (openBlock && openBlock.type === 'paragraph') {
      openBlock.contentSource += '\n' + line;
      return;
    }
    startBlock('paragraph', '', line);
  }
```

Update `getBlocks()` to expose tentatives so the test filter works — it already does (it returns the full `blocks` array; tentatives live alongside committed blocks with `status: 'tentative'`... but we're using separate `tentativeLine` state instead). The tests call `.filter((b) => b.status !== 'tentative')` expecting the tentative to *not* surface. That's fine — with this implementation, tentatives never enter `blocks`, so the filter is a no-op. Keep the filter in tests for forward-compat.

Update `finalize`:

```ts
    finalize() {
      clearIdle();
      if (lineBuffer.length > 0) {
        classifyLine(lineBuffer);
        lineBuffer = '';
      }
      commitTentativeFallback();
      closeOpen();
      notify();
    },
```

Update `append` so scheduling happens *after* flushing (so idle timer tracks when chars stop arriving):

```ts
    append(chars: string) {
      clearIdle();
      lineBuffer += chars;
      processCompletedLines();
      if (tentativeLine !== null) scheduleIdle();
      notify();
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/chat/streaming-markdown-scanner.test.ts`
Expected: PASS — all prior tests + 5 disambiguation tests.

- [ ] **Step 5: Commit**

```bash
git add src/chat/streaming-markdown-scanner.ts src/chat/streaming-markdown-scanner.test.ts
git commit -m "feat(chat): scanner handles table/setext disambiguation with idle commit"
```

---

## Task 7: Scanner — chunk-randomization property test

**Files:**
- Modify: `src/chat/streaming-markdown-scanner.test.ts`

- [ ] **Step 1: Add the property test**

Append to `src/chat/streaming-markdown-scanner.test.ts`:

```ts
describe('streaming-markdown-scanner — chunk invariance', () => {
  const FIXTURES = [
    '# Heading\n\nA paragraph with **bold** and *italics*.\n\n- one\n- two\n- three\n\n```js\nconst x = 1;\n```\n\n> a quote\n\n---\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n',
    'Title\n===\n\nbody line one\nbody line two\n\n![img](http://x/y.png)\n',
  ];

  function serialize(blocks: readonly Block[]): string {
    return JSON.stringify(
      blocks.map((b) => ({
        type: b.type,
        status: b.status,
        frame: b.frameSource,
        content: b.contentSource,
        children: b.children?.map((c) => ({
          type: c.type,
          frame: c.frameSource,
          content: c.contentSource,
        })),
      })),
    );
  }

  function runWithChunks(input: string, chunkSize: number): string {
    const s = createScanner();
    for (let i = 0; i < input.length; i += chunkSize) {
      s.append(input.slice(i, i + chunkSize));
    }
    s.finalize();
    return serialize(s.getBlocks());
  }

  it('produces identical block lists regardless of delta chunk size', () => {
    for (const fixture of FIXTURES) {
      const baseline = runWithChunks(fixture, fixture.length);
      for (const size of [1, 3, 7, 50]) {
        expect(runWithChunks(fixture, size)).toBe(baseline);
      }
    }
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/chat/streaming-markdown-scanner.test.ts`
Expected: PASS. If it fails, the bug is in `flushLineBuffer`'s partial-line handling — check that the committed portion of an open paragraph isn't being duplicated when partial content arrives.

- [ ] **Step 3: Commit**

```bash
git add src/chat/streaming-markdown-scanner.test.ts
git commit -m "test(chat): scanner is invariant to delta chunk size"
```

---

## Task 8: `StreamingBlock` component

**Files:**
- Create: `src/chat/StreamingBlock.tsx`

- [ ] **Step 1: Create the component**

Create `src/chat/StreamingBlock.tsx`:

```tsx
import { memo, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSettingsStore } from '../settings/settings-store';
import { markdownComponents } from './markdown-components';
import { autoClose } from './autoClose';
import type { Block } from './streaming-markdown-scanner';

interface StreamingBlockProps {
  block: Block;
}

/**
 * Renders a single scanner block. The `frameSource` is rendered immediately;
 * the `contentSource` fills char-by-char at the configured reveal rate. A
 * one-shot entrance animation runs on mount.
 */
function StreamingBlockImpl({ block }: StreamingBlockProps) {
  const chatUIDefaults = useSettingsStore((s) => s.chatUIDefaults);
  const { textRevealEnabled, textRevealCharsPerSec } = chatUIDefaults;

  const [displayCount, setDisplayCount] = useState(() =>
    textRevealEnabled ? 0 : block.contentSource.length,
  );

  const contentRef = useRef(block.contentSource);
  const statusRef = useRef(block.status);
  const enabledRef = useRef(textRevealEnabled);
  const rateRef = useRef(textRevealCharsPerSec);
  contentRef.current = block.contentSource;
  statusRef.current = block.status;
  enabledRef.current = textRevealEnabled;
  rateRef.current = textRevealCharsPerSec;

  useEffect(() => {
    let raf: number | null = null;
    let lastTick: number | null = null;
    let revealed = enabledRef.current ? 0 : contentRef.current.length;

    const tick = (now: number) => {
      if (lastTick === null) lastTick = now;
      const dt = now - lastTick;
      lastTick = now;

      const content = contentRef.current;
      if (!enabledRef.current) {
        revealed = content.length;
        setDisplayCount(content.length);
      } else {
        const advance = (dt / 1000) * rateRef.current;
        const prev = Math.floor(revealed);
        revealed = Math.min(content.length, revealed + advance);
        const next = Math.floor(revealed);
        if (next !== prev) setDisplayCount(next);
      }

      if (statusRef.current === 'closed' && revealed >= contentRef.current.length) {
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, []);

  // For list and table parents, render their children recursively.
  if (block.children && (block.type === 'list' || block.type === 'table')) {
    const slice = block.frameSource;
    return (
      <div className="stream-block-in">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {slice}
        </ReactMarkdown>
        {block.children.map((child) => (
          <StreamingBlock key={child.id} block={child} />
        ))}
      </div>
    );
  }

  const visibleContent = block.contentSource.slice(0, displayCount);
  const merged = block.frameSource + visibleContent;
  const closedInput = autoClose(merged, block.type);

  return (
    <div className="stream-block-in">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {closedInput}
      </ReactMarkdown>
    </div>
  );
}

const StreamingBlock = memo(StreamingBlockImpl, (prev, next) => {
  return (
    prev.block.id === next.block.id &&
    prev.block.status === next.block.status &&
    prev.block.contentSource.length === next.block.contentSource.length &&
    (prev.block.children?.length ?? 0) === (next.block.children?.length ?? 0)
  );
});

export default StreamingBlock;
```

- [ ] **Step 2: Extract `markdownComponents` into its own module**

`MessageBubble.tsx` currently declares `markdownComponents` inline. Move it to a new file so `StreamingBlock` can import it without creating a circular dependency.

Create `src/chat/markdown-components.tsx`:

```tsx
import type { Components } from 'react-markdown';

export const markdownComponents: Components = {
  p: (props: any) => {
    const { node, ...rest } = props;
    return <p className="mb-2 last:mb-0 leading-relaxed" {...rest} />;
  },
  a: (props: any) => {
    const { node, ...rest } = props;
    return (
      <a
        className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
        target="_blank"
        rel="noopener noreferrer"
        {...rest}
      />
    );
  },
  ul: (props: any) => {
    const { node, ...rest } = props;
    return <ul className="list-disc pl-4 mb-2 space-y-1" {...rest} />;
  },
  ol: (props: any) => {
    const { node, ...rest } = props;
    return <ol className="list-decimal pl-4 mb-2 space-y-1" {...rest} />;
  },
  li: (props: any) => {
    const { node, ...rest } = props;
    return <li className="marker:text-slate-500" {...rest} />;
  },
  h1: (props: any) => {
    const { node, ...rest } = props;
    return <h1 className="text-lg font-bold mt-4 mb-2 text-slate-100" {...rest} />;
  },
  h2: (props: any) => {
    const { node, ...rest } = props;
    return (
      <h2
        className="text-base font-bold mt-4 mb-2 text-slate-100 border-b border-slate-700/50 pb-1"
        {...rest}
      />
    );
  },
  h3: (props: any) => {
    const { node, ...rest } = props;
    return <h3 className="text-sm font-bold mt-3 mb-1 text-slate-200" {...rest} />;
  },
  table: (props: any) => {
    const { node, ...rest } = props;
    return (
      <div className="overflow-x-auto my-3">
        <table className="w-full text-left border-collapse" {...rest} />
      </div>
    );
  },
  th: (props: any) => {
    const { node, ...rest } = props;
    return (
      <th
        className="border border-slate-700 bg-slate-900/50 px-3 py-2 font-semibold text-slate-100"
        {...rest}
      />
    );
  },
  td: (props: any) => {
    const { node, ...rest } = props;
    return <td className="border border-slate-700 px-3 py-2 text-slate-300" {...rest} />;
  },
  blockquote: (props: any) => {
    const { node, ...rest } = props;
    return (
      <blockquote
        className="border-l-4 border-blue-500/50 bg-slate-900/30 pl-3 py-1 pr-2 my-2 italic text-slate-400 rounded-r"
        {...rest}
      />
    );
  },
  code(props: any) {
    const { children, className, node, ...rest } = props;
    const match = /language-(\w+)/.exec(className || '');
    return match ? (
      <div className="rounded-md bg-[#0d1117] border border-slate-700/60 my-3 overflow-hidden shadow-sm">
        <div className="bg-slate-800/80 px-3 py-1.5 text-[10px] text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-700/60">
          {match[1]}
        </div>
        <pre className="p-3 overflow-x-auto text-[11px] font-mono text-slate-300 leading-normal">
          <code className={className} {...rest}>
            {children}
          </code>
        </pre>
      </div>
    ) : (
      <code
        className="bg-slate-900/60 px-1.5 py-0.5 rounded border border-slate-700/50 text-slate-300 font-mono text-[11px]"
        {...rest}
      >
        {children}
      </code>
    );
  },
};
```

Then edit `src/chat/MessageBubble.tsx`: remove the local `markdownComponents` definition (lines ~50-81) and replace the import block at the top with:

```tsx
import { memo, useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Brain, ChevronDown, Wrench } from 'lucide-react';
import type { Message } from '../store/session-store';
import StreamingText from './StreamingText';
import { markdownComponents } from './markdown-components';
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/chat/StreamingBlock.tsx src/chat/markdown-components.tsx src/chat/MessageBubble.tsx
git commit -m "feat(chat): add StreamingBlock component and extract markdown component map"
```

---

## Task 9: `StreamingMarkdownRenderer` component

**Files:**
- Create: `src/chat/StreamingMarkdownRenderer.tsx`

- [ ] **Step 1: Create the component**

Create `src/chat/StreamingMarkdownRenderer.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import StreamingBlock from './StreamingBlock';
import { createScanner, type Block, type Scanner } from './streaming-markdown-scanner';
import { useSettingsStore } from '../settings/settings-store';

interface StreamingMarkdownRendererProps {
  /** Current full content of the streaming message. */
  text: string;
  /** True while the source stream is still producing deltas. */
  isStreaming: boolean;
  /** Called once every block's reveal cursor has caught up after the stream ends. */
  onRevealComplete?: () => void;
}

export default function StreamingMarkdownRenderer({
  text,
  isStreaming,
  onRevealComplete,
}: StreamingMarkdownRendererProps) {
  const scannerRef = useRef<Scanner | null>(null);
  const consumedRef = useRef(0);
  const [blocks, setBlocks] = useState<readonly Block[]>([]);
  const completedRef = useRef(false);

  const chatUIDefaults = useSettingsStore((s) => s.chatUIDefaults);
  const { textRevealCharsPerSec, textRevealEnabled } = chatUIDefaults;

  // Lazy scanner instantiation + subscription.
  if (scannerRef.current === null) {
    scannerRef.current = createScanner();
    scannerRef.current.onChange(() => {
      setBlocks(scannerRef.current!.getBlocks().slice());
    });
  }

  // Feed new chars to the scanner as `text` grows.
  useEffect(() => {
    const scanner = scannerRef.current!;
    if (text.length > consumedRef.current) {
      const chunk = text.slice(consumedRef.current);
      consumedRef.current = text.length;
      scanner.append(chunk);
    }
  }, [text]);

  // On stream end: finalize the scanner, let cursors drain, then fire reveal-complete.
  useEffect(() => {
    if (isStreaming) return;
    const scanner = scannerRef.current!;
    scanner.finalize();

    // Drain delay: how long the slowest block needs to reach the end.
    const unseenChars = blocks.reduce((sum, b) => {
      const contentLen = b.contentSource.length;
      return sum + contentLen + (b.children?.reduce((a, c) => a + c.contentSource.length, 0) ?? 0);
    }, 0);

    const drainMs = textRevealEnabled
      ? Math.max(200, (unseenChars / Math.max(1, textRevealCharsPerSec)) * 1000)
      : 200;

    const timer = setTimeout(() => {
      if (!completedRef.current) {
        completedRef.current = true;
        onRevealComplete?.();
      }
    }, drainMs);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming]);

  return (
    <div className="stream-markdown-root">
      {blocks.map((block) => (
        <StreamingBlock key={block.id} block={block} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/chat/StreamingMarkdownRenderer.tsx
git commit -m "feat(chat): add StreamingMarkdownRenderer hosting scanner and blocks"
```

---

## Task 10: Settings field and UI

**Files:**
- Modify: `src/settings/types.ts`
- Modify: `src/settings/sections/AppearanceSection.tsx`

- [ ] **Step 1: Add the setting to the type and default**

Edit `src/settings/types.ts`. Replace the `ChatUIDefaults` interface and its default:

```ts
export interface ChatUIDefaults {
  /** Characters per second revealed while an assistant message is streaming. */
  textRevealCharsPerSec: number;
  /** Duration in ms of the per-character opacity fade (used in 'flat' mode). */
  textRevealFadeMs: number;
  /** Whether to animate the character reveal at all. */
  textRevealEnabled: boolean;
  /** Rendering strategy while streaming: per-block structural reveal, or flat char reveal. */
  textRevealStructure: 'blocks' | 'flat';
}
```

```ts
export const DEFAULT_CHAT_UI_DEFAULTS: ChatUIDefaults = {
  textRevealCharsPerSec: 90,
  textRevealFadeMs: 320,
  textRevealEnabled: true,
  textRevealStructure: 'blocks',
};
```

- [ ] **Step 2: Add the UI control**

Edit `src/settings/sections/AppearanceSection.tsx`. Update the destructure on line ~18 to include `textRevealStructure`:

```tsx
  const { textRevealCharsPerSec, textRevealFadeMs, textRevealEnabled, textRevealStructure } =
    chatUIDefaults;
```

Insert a new field block before the "Enable reveal animation" checkbox (between the `<div className="space-y-6">` opening and the existing label). Add:

```tsx
          <div>
            <div className="mb-2 text-sm font-medium text-slate-200">Streaming layout</div>
            <div className="space-y-2">
              <label className="flex items-start gap-3">
                <input
                  type="radio"
                  name="text-reveal-structure"
                  value="blocks"
                  checked={textRevealStructure === 'blocks'}
                  onChange={() => setChatUIDefaults({ textRevealStructure: 'blocks' })}
                  className="mt-0.5 h-4 w-4"
                />
                <span className="flex-1">
                  <span className="block text-sm text-slate-200">Structural (blocks)</span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    Headers, paragraphs, code, tables, and lists appear as framed
                    blocks; text fills each block char-by-char.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-3">
                <input
                  type="radio"
                  name="text-reveal-structure"
                  value="flat"
                  checked={textRevealStructure === 'flat'}
                  onChange={() => setChatUIDefaults({ textRevealStructure: 'flat' })}
                  className="mt-0.5 h-4 w-4"
                />
                <span className="flex-1">
                  <span className="block text-sm text-slate-200">Flat (characters only)</span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    Legacy behavior: plain text fades in character by character; markdown renders once after the stream ends.
                  </span>
                </span>
              </label>
            </div>
          </div>
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Run the existing settings tests**

Run: `npx vitest run src/settings`
Expected: PASS. If any test snapshots the `ChatUIDefaults` shape, update the snapshot to include the new field.

- [ ] **Step 5: Commit**

```bash
git add src/settings/types.ts src/settings/sections/AppearanceSection.tsx
git commit -m "feat(settings): add textRevealStructure toggle for streaming layout"
```

---

## Task 11: Integrate into `MessageBubble` and verify end-to-end

**Files:**
- Modify: `src/chat/MessageBubble.tsx`

- [ ] **Step 1: Wire the new renderer into the streaming branch**

Edit `src/chat/MessageBubble.tsx`. At the top of the file, add the import:

```tsx
import StreamingMarkdownRenderer from './StreamingMarkdownRenderer';
import { useSettingsStore } from '../settings/settings-store';
```

Inside the `MessageBubble` function body (after the existing hooks), add:

```tsx
  const textRevealStructure = useSettingsStore((s) => s.chatUIDefaults.textRevealStructure);
```

Replace the streaming-branch JSX (the `useStreamingRenderer ? ( ... ) : ...` block, lines ~163-168) with:

```tsx
              {useStreamingRenderer ? (
                textRevealStructure === 'blocks' ? (
                  <StreamingMarkdownRenderer
                    text={msg.content}
                    isStreaming={isStreamingThis}
                    onRevealComplete={handleRevealComplete}
                  />
                ) : (
                  <StreamingText
                    text={msg.content}
                    isStreaming={isStreamingThis}
                    onRevealComplete={handleRevealComplete}
                  />
                )
              ) : preferPlainText ? (
                <span className="whitespace-pre-wrap">{msg.content}</span>
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {msg.content}
                </ReactMarkdown>
              )}
```

- [ ] **Step 2: Typecheck and run the full test suite**

Run in parallel:
- `npm run typecheck`
- `npx vitest run`

Expected: typecheck clean, all tests green. If `MessageBubble` or `ChatMessages` tests fail, inspect the snapshot and update to reflect the new wrapper `<div class="stream-markdown-root">` around streaming content when `textRevealStructure === 'blocks'`.

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev`

Check each of the following in the chat drawer with a real agent connection:

1. **Long paragraph** — paragraph frame appears on first delta, chars fill at configured rate. No final pop when stream ends.
2. **Multiple headings** — each heading drops in with the 200 ms fade + translate-Y animation.
3. **Fenced code block** — code card and language label appear immediately; code lines fill inside.
4. **Markdown table** — nothing renders until the separator row arrives; then table header appears, followed by body rows dropping in one-by-one.
5. **List** — `<ul>` container appears on first `- ` line; each item drops in as it arrives.
6. **Blockquote** — quote frame appears on first `> ` line.
7. **Mixed content** — an assistant message containing heading + paragraph + code + list + table all render in order without flicker.
8. **Toggle `textRevealStructure` to `flat`** — legacy char-fade behavior comes back.
9. **Toggle `textRevealEnabled` off (in blocks mode)** — blocks still drop in with entrance animation, but text inside appears instantly.
10. **Scrolled up mid-stream** — new blocks don't yank scroll position (existing `ChatMessages` pin-to-bottom logic still owns scroll).

Document any rendering issues as follow-up tasks. Do not mark this step complete if the smoke test reveals a regression — fix inline.

- [ ] **Step 4: Commit**

```bash
git add src/chat/MessageBubble.tsx
git commit -m "feat(chat): wire StreamingMarkdownRenderer into assistant streaming path"
```

---

## Self-Review Checklist (for plan author — not a task)

- Spec coverage: every section in the spec has a corresponding task (scanner, frame/content split, autoClose, entrance animation, per-block cursor, settings field, MessageBubble integration, scanner edge cases).
- Placeholder scan: no TBDs or "add appropriate handling" steps; every code step shows actual code.
- Type consistency: `Block`, `BlockType`, `Scanner`, `autoClose(text, blockType)`, `StreamingBlock`, `StreamingMarkdownRenderer`, `textRevealStructure` are all used consistently across tasks.
- Scope check: 11 tasks, single focused feature, single plan.
