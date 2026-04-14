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
