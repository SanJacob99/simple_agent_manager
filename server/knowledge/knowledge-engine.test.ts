import { describe, expect, it } from 'vitest';
import type {
  ResolvedKnowledgeConfig,
  ResolvedKnowledgeSource,
} from '../../shared/agent-config';
import { estimateTokens } from '../../shared/token-estimator';
import {
  buildIngestionPlan,
  chunkText,
  dedupeSources,
  isRefreshDue,
  normalizeSource,
  parseRefreshInterval,
  splitIntoUnits,
} from './knowledge-engine';

function makeSource(
  overrides: Partial<ResolvedKnowledgeSource> = {},
): ResolvedKnowledgeSource {
  return {
    id: 's1',
    type: 'file',
    location: '/docs/readme.md',
    include: '',
    exclude: '',
    ...overrides,
  };
}

function makeConfig(
  overrides: Partial<ResolvedKnowledgeConfig> = {},
): ResolvedKnowledgeConfig {
  return {
    knowledgeNodeId: 'k1',
    label: 'Knowledge',
    enabled: true,
    collectionName: 'default',
    sources: [makeSource()],
    chunkStrategy: 'paragraph',
    chunkSize: 512,
    chunkOverlap: 64,
    embedding: { provider: 'openrouter', model: 'openai/text-embedding-3-small' },
    refreshSchedule: 'manual',
    maxDocuments: 0,
    ...overrides,
  };
}

describe('normalizeSource', () => {
  it('trims location and globs', () => {
    const n = normalizeSource(
      makeSource({ location: '  /docs  ', include: ' **/*.md ', exclude: '  ' }),
    );
    expect(n).toEqual({
      id: 's1',
      type: 'file',
      location: '/docs',
      include: '**/*.md',
      exclude: '',
    });
  });

  it('returns null for an empty location', () => {
    expect(normalizeSource(makeSource({ location: '   ' }))).toBeNull();
  });
});

describe('dedupeSources', () => {
  it('drops later duplicates by type + location, keeping the first', () => {
    const a = makeSource({ id: 'a', location: '/docs', include: '**/*.md' });
    const b = makeSource({ id: 'b', location: '/docs', include: 'other' });
    const c = makeSource({ id: 'c', type: 'url', location: 'https://x.dev' });
    const out = dedupeSources([a, b, c]);
    expect(out.map((s) => s.id)).toEqual(['a', 'c']);
    expect(out[0].include).toBe('**/*.md');
  });

  it('never merges inline text sources with the same location', () => {
    const a = makeSource({ id: 'a', type: 'text', location: 'hello' });
    const b = makeSource({ id: 'b', type: 'text', location: 'hello' });
    expect(dedupeSources([a, b]).map((s) => s.id)).toEqual(['a', 'b']);
  });
});

describe('splitIntoUnits', () => {
  it('returns the whole document for the fixed strategy', () => {
    expect(splitIntoUnits('a\n\nb\n\nc', 'fixed')).toEqual(['a\n\nb\n\nc']);
  });

  it('splits paragraphs on blank lines', () => {
    expect(splitIntoUnits('one\n\ntwo\n\n\nthree', 'paragraph')).toEqual([
      'one',
      'two',
      'three',
    ]);
  });

  it('splits sentences and keeps terminators', () => {
    expect(splitIntoUnits('Hi there. How are you? Fine!', 'sentence')).toEqual([
      'Hi there.',
      'How are you?',
      'Fine!',
    ]);
  });

  it('splits markdown on headings, keeping the preamble', () => {
    const md = 'intro text\n# Title\nbody\n## Sub\nmore';
    expect(splitIntoUnits(md, 'markdown')).toEqual([
      'intro text',
      '# Title\nbody',
      '## Sub\nmore',
    ]);
  });

  it('returns an empty list for blank input', () => {
    expect(splitIntoUnits('   \n  ', 'paragraph')).toEqual([]);
  });
});

describe('chunkText', () => {
  it('packs small paragraphs into a single chunk under the size', () => {
    const chunks = chunkText('one\n\ntwo\n\nthree', {
      chunkStrategy: 'paragraph',
      chunkSize: 512,
      chunkOverlap: 0,
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe('one two three');
    expect(chunks[0].index).toBe(0);
  });

  it('flushes a new chunk when the next unit would exceed the size', () => {
    // ~4 chars/token; each 40-char word block is ~10 tokens.
    const para = (n: number) => Array.from({ length: n }, () => 'word').join(' ');
    const text = `${para(4)}\n\n${para(4)}\n\n${para(4)}`;
    const chunks = chunkText(text, {
      chunkStrategy: 'paragraph',
      chunkSize: 6,
      chunkOverlap: 0,
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.tokens).toBeLessThanOrEqual(6);
    expect(chunks.map((c, i) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  it('carries overlap units into the following chunk', () => {
    const text = 'alpha.\n\nbeta.\n\ngamma.\n\ndelta.';
    const noOverlap = chunkText(text, {
      chunkStrategy: 'paragraph',
      chunkSize: 3,
      chunkOverlap: 0,
    });
    const withOverlap = chunkText(text, {
      chunkStrategy: 'paragraph',
      chunkSize: 3,
      chunkOverlap: 2,
    });
    // Overlap re-emits trailing units, so total emitted text is longer.
    const totalLen = (cs: { text: string }[]) =>
      cs.reduce((a, c) => a + c.text.length, 0);
    expect(totalLen(withOverlap)).toBeGreaterThan(totalLen(noOverlap));
  });

  it('hard-splits a single oversized unit on word boundaries', () => {
    const bigParagraph = Array.from({ length: 50 }, (_, i) => `word${i}`).join(' ');
    const chunks = chunkText(bigParagraph, {
      chunkStrategy: 'paragraph',
      chunkSize: 8,
      chunkOverlap: 0,
    });
    expect(chunks.length).toBeGreaterThan(1);
    // No chunk exceeds the size by more than roughly one trailing word.
    for (const c of chunks) expect(c.tokens).toBeLessThanOrEqual(9);
    // Reassembled words cover the original (order preserved).
    expect(chunks.map((c) => c.text).join(' ').split(/\s+/)).toHaveLength(50);
  });

  it('returns no chunks for blank input', () => {
    expect(chunkText('   ', { chunkStrategy: 'fixed', chunkSize: 10, chunkOverlap: 0 })).toEqual([]);
  });

  it('clamps a degenerate size/overlap config instead of looping forever', () => {
    const chunks = chunkText('one\n\ntwo\n\nthree', {
      chunkStrategy: 'paragraph',
      chunkSize: 0,
      chunkOverlap: 100,
    });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.text.length > 0)).toBe(true);
  });

  it('reports token counts via the shared estimator', () => {
    const [chunk] = chunkText('hello world', {
      chunkStrategy: 'fixed',
      chunkSize: 100,
      chunkOverlap: 0,
    });
    expect(chunk.tokens).toBe(estimateTokens('hello world'));
  });
});

describe('parseRefreshInterval', () => {
  it('returns null for manual / empty / unrecognized schedules', () => {
    expect(parseRefreshInterval('manual')).toBeNull();
    expect(parseRefreshInterval('')).toBeNull();
    expect(parseRefreshInterval('nightly')).toBeNull();
    expect(parseRefreshInterval('0h')).toBeNull();
  });

  it('parses duration units', () => {
    expect(parseRefreshInterval('250ms')).toBe(250);
    expect(parseRefreshInterval('45s')).toBe(45_000);
    expect(parseRefreshInterval('30m')).toBe(1_800_000);
    expect(parseRefreshInterval('6h')).toBe(21_600_000);
    expect(parseRefreshInterval('7d')).toBe(604_800_000);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(parseRefreshInterval('  2H ')).toBe(7_200_000);
  });
});

describe('isRefreshDue', () => {
  it('is never due for a manual schedule', () => {
    expect(isRefreshDue('manual', null, 1_000)).toBe(false);
    expect(isRefreshDue('manual', 0, 1_000_000_000)).toBe(false);
  });

  it('is always due when it has never run and has an interval', () => {
    expect(isRefreshDue('1h', null, 5_000)).toBe(true);
  });

  it('is due once the interval has elapsed', () => {
    const hour = 3_600_000;
    expect(isRefreshDue('1h', 0, hour - 1)).toBe(false);
    expect(isRefreshDue('1h', 0, hour)).toBe(true);
    expect(isRefreshDue('1h', 0, hour + 1)).toBe(true);
  });
});

describe('buildIngestionPlan', () => {
  it('normalizes, drops empty, and dedupes sources', () => {
    const config = makeConfig({
      sources: [
        makeSource({ id: 'a', location: '  /docs  ' }),
        makeSource({ id: 'b', location: '/docs' }),
        makeSource({ id: 'c', location: '   ' }),
        makeSource({ id: 'd', type: 'url', location: 'https://x.dev' }),
      ],
    });
    const plan = buildIngestionPlan(config);
    expect(plan.sources.map((s) => s.id)).toEqual(['a', 'd']);
    expect(plan.droppedSourceIds).toEqual(['c']);
    expect(plan.collectionName).toBe('default');
    expect(plan.embeddingModel).toBe('openai/text-embedding-3-small');
  });

  it('yields no sources for a disabled node but still records drops', () => {
    const plan = buildIngestionPlan(
      makeConfig({
        enabled: false,
        sources: [makeSource({ id: 'a' }), makeSource({ id: 'b', location: '' })],
      }),
    );
    expect(plan.enabled).toBe(false);
    expect(plan.sources).toEqual([]);
    expect(plan.droppedSourceIds).toEqual(['b']);
  });
});
