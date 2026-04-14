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
 *
 * Tentative lines (table header candidates) are stored in `internalBlocks`
 * with `status: 'tentative'` and held until the next line resolves their type.
 * Setext heading detection works by retroactively promoting an open paragraph
 * when `===` or `---` underlines arrive. A 150ms idle timer commits tentative
 * blocks to their paragraph fallback when the stream pauses.
 */
export function createScanner(): Scanner {
  let nextId = 0;
  const mkId = () => `blk_${nextId++}`;

  const internalBlocks: Block[] = [];
  let openBlock: Block | null = null;
  let lineBuffer = '';

  // Tentative-line state for table disambiguation.
  // The tentative block lives in internalBlocks with status 'tentative'.
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const IDLE_COMMIT_MS = 150;

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
    internalBlocks.push(list);
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

  function clearIdle() {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function hasTentativeBlock(): boolean {
    return openBlock !== null && openBlock.status === 'tentative';
  }

  function commitTentativeFallback() {
    if (!hasTentativeBlock()) return;
    // Promote tentative block to a committed paragraph.
    openBlock!.type = 'paragraph';
    openBlock!.status = 'open';
  }

  function scheduleIdle() {
    clearIdle();
    idleTimer = setTimeout(() => {
      idleTimer = null;
      commitTentativeFallback();
      notify();
    }, IDLE_COMMIT_MS);
  }

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

    // Tentative table-header lookahead resolution.
    if (hasTentativeBlock()) {
      const tentativeContent = openBlock!.contentSource;
      if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)) {
        // Promote tentative block to a table.
        openBlock!.type = 'table';
        openBlock!.status = 'open';
        openBlock!.frameSource = `${tentativeContent}\n${line}\n`;
        openBlock!.contentSource = '';
        openBlock!.children = [];
        return;
      }
      // Not a separator — commit tentative as a paragraph and fall through.
      commitTentativeFallback();
      // fall through to classify this line normally
    }

    // Setext underline: promote an open paragraph to setext_heading.
    if (openBlock && openBlock.type === 'paragraph' && /^(={3,}|-{3,})\s*$/.test(line)) {
      // Only treat as setext if the paragraph is a single-line (no \n in contentSource).
      if (!openBlock.contentSource.includes('\n')) {
        const title = openBlock.contentSource;
        openBlock.type = 'setext_heading';
        openBlock.frameSource = `${title}\n${line}\n`;
        openBlock.contentSource = '';
        openBlock.status = 'closed';
        openBlock = null;
        return;
      }
    }

    if (line.trim() === '') {
      closeOpen();
      return;
    }

    const fenceMatch = /^(```|~~~)([^\s`~]*)\s*$/.exec(line);
    if (fenceMatch) {
      startBlock('code_fence', `${fenceMatch[1]}${fenceMatch[2]}\n`, '');
      return;
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      const block = startBlock('hr', `${line}\n`, '');
      block.status = 'closed';
      openBlock = null;
      return;
    }

    if (/^!\[[^\]]*\]\([^)]+\)\s*$/.test(line)) {
      const block = startBlock('image', line.trim(), '');
      block.status = 'closed';
      openBlock = null;
      return;
    }

    const headingMatch = /^(#{1,6}) (.*)$/.exec(line);
    if (headingMatch) {
      const block = startBlock('heading', `${headingMatch[1]} `, headingMatch[2]);
      block.status = 'closed';
      openBlock = null;
      return;
    }

    const quoteMatch = /^> (.*)$/.exec(line);
    if (quoteMatch) {
      if (openBlock && openBlock.type === 'blockquote') {
        openBlock.contentSource += '\n' + quoteMatch[1];
      } else {
        startBlock('blockquote', '> ', quoteMatch[1]);
      }
      return;
    }

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

    // Tentative table-header candidate: a `|`-starting line with no open block or table.
    if (line.startsWith('|') && !openBlock) {
      const tentative: Block = {
        id: mkId(),
        type: 'table',
        status: 'tentative',
        frameSource: '',
        contentSource: line,
        children: [],
      };
      internalBlocks.push(tentative);
      openBlock = tentative;
      scheduleIdle();
      return;
    }

    // Default: paragraph (also handles continuation of open paragraph).
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
      clearIdle();
      lineBuffer += chars;
      processCompletedLines();
      if (hasTentativeBlock()) scheduleIdle();
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
      clearIdle();
      if (lineBuffer.length > 0) {
        classifyLine(lineBuffer);
        lineBuffer = '';
      }
      commitTentativeFallback();
      closeOpen();
      notify();
    },
  };
}
