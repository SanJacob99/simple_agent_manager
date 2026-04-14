import { describe, expect, it, vi } from 'vitest';
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

describe('streaming-markdown-scanner — disambiguation', () => {
  it('promotes a tentative `|`-line to a table when separator arrives', () => {
    const s = createScanner();
    s.append('| a | b |\n');
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

  it('finalize() cancels idle timer when lineBuffer had a partial tentative line', () => {
    vi.useFakeTimers();
    try {
      const s = createScanner();
      s.append('| pending');  // no trailing newline
      s.finalize();
      const blocks = s.getBlocks();
      expect(blocks.every((b) => b.status === 'closed')).toBe(true);
      expect(blocks[0].type).toBe('paragraph');

      // Verify no leaked timer fires after finalize.
      let notified = false;
      s.onChange(() => { notified = true; });
      vi.advanceTimersByTime(500);
      expect(notified).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('setext fallback: plain line followed by non-underline stays as paragraph', () => {
    const s = createScanner();
    s.append('Title\nnot an underline\n');
    const committed = s.getBlocks().filter((b) => b.status !== 'tentative');
    expect(committed).toHaveLength(1);
    expect(committed[0].type).toBe('paragraph');
    expect(committed[0].contentSource).toBe('Title\nnot an underline');
  });

  it('promotes a paragraph line to a setext heading when followed by `---`', () => {
    const s = createScanner();
    s.append('Title\n---\n');
    const committed = s.getBlocks().filter((b) => b.status !== 'tentative');
    expect(committed).toHaveLength(1);
    expect(committed[0].type).toBe('setext_heading');
    expect(committed[0].frameSource).toBe('Title\n---\n');
  });
});

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
