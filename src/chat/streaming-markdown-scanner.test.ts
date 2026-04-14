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
