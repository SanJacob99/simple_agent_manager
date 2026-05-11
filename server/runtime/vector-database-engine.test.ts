import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  DimensionMismatchError,
  UnsupportedProviderError,
  VectorDatabaseEngine,
} from './vector-database-engine';
import type { ResolvedVectorDatabaseConfig } from '../../shared/agent-config';
import type { EmbeddingClient } from './embeddings/embedding-client';

class StubEmbedder implements EmbeddingClient {
  readonly provider = 'stub';
  constructor(
    public model: string,
    private readonly map: (text: string) => number[],
  ) {}
  dimensions(): number | null {
    return null;
  }
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(this.map);
  }
}

function makeConfig(overrides: Partial<ResolvedVectorDatabaseConfig> = {}): ResolvedVectorDatabaseConfig {
  return {
    label: 'test',
    provider: 'sqlite-vec',
    collectionName: 'unit_test',
    connectionString: '',
    storagePath: '',
    embedding: { provider: 'openrouter', model: 'stub-model' },
    ...overrides,
  };
}

describe('VectorDatabaseEngine', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vec-engine-'));
    dbPath = path.join(tmpDir, 'unit.db');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('upserts documents and finds the closest neighbour via cosine search', async () => {
    const embedder = new StubEmbedder('stub-3', (text) => {
      if (text.includes('hello')) return [1, 0, 0];
      if (text.includes('world')) return [0, 1, 0];
      return [0, 0, 1];
    });
    const engine = new VectorDatabaseEngine(
      makeConfig({ connectionString: dbPath }),
      embedder,
    );

    await engine.init();
    const upserted = await engine.upsert([
      { id: 'a', text: 'hello there' },
      { id: 'b', text: 'world wide' },
    ]);
    expect(upserted.inserted).toBe(2);

    const results = await engine.search('hello friend', { topK: 1 });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('a');
    expect(results[0].text).toBe('hello there');

    await engine.close();
  });

  it('returns the stored document with vector_get and removes it via delete', async () => {
    const embedder = new StubEmbedder('stub-3', () => [0.1, 0.2, 0.3]);
    const engine = new VectorDatabaseEngine(
      makeConfig({ connectionString: dbPath }),
      embedder,
    );
    await engine.init();
    await engine.upsert([
      { id: 'doc1', text: 'first document', metadata: { tag: 'demo' } },
    ]);

    const got = await engine.get('doc1');
    expect(got).not.toBeNull();
    expect(got?.text).toBe('first document');
    expect(got?.metadata).toEqual({ tag: 'demo' });

    const del = await engine.delete(['doc1']);
    expect(del.deleted).toBe(1);
    expect(await engine.get('doc1')).toBeNull();

    await engine.close();
  });

  it('throws DimensionMismatchError when a second embedder produces a different vector size', async () => {
    const embedder3 = new StubEmbedder('stub-3', () => [1, 2, 3]);
    const engine = new VectorDatabaseEngine(
      makeConfig({ connectionString: dbPath }),
      embedder3,
    );
    await engine.init();
    await engine.upsert([{ id: 'a', text: 'first' }]);
    await engine.close();

    const embedder4 = new StubEmbedder('stub-4', () => [1, 2, 3, 4]);
    const engine2 = new VectorDatabaseEngine(
      makeConfig({ connectionString: dbPath }),
      embedder4,
    );
    await engine2.init();
    await expect(engine2.upsert([{ id: 'b', text: 'second' }])).rejects.toBeInstanceOf(
      DimensionMismatchError,
    );
    await engine2.close();
  });

  it('throws UnsupportedProviderError for non-sqlite-vec providers', async () => {
    const embedder = new StubEmbedder('stub', () => [0, 0, 0]);
    const engine = new VectorDatabaseEngine(
      makeConfig({ provider: 'pinecone', connectionString: dbPath }),
      embedder,
    );
    await expect(engine.init()).rejects.toBeInstanceOf(UnsupportedProviderError);
  });

  it('returns an empty result list when searching an uninitialised collection', async () => {
    const embedder = new StubEmbedder('stub', () => [1, 0, 0]);
    const engine = new VectorDatabaseEngine(
      makeConfig({ connectionString: dbPath }),
      embedder,
    );
    await engine.init();
    const results = await engine.search('anything');
    expect(results).toEqual([]);
    await engine.close();
  });
});
