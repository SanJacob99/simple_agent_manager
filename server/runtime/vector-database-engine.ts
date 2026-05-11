import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import type { ResolvedVectorDatabaseConfig } from '../../shared/agent-config';
import type { EmbeddingClient } from './embeddings/embedding-client';

export interface VectorDocument {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface VectorSearchOptions {
  topK?: number;
}

export interface VectorSearchResult {
  id: string;
  score: number;
  text: string;
  metadata: Record<string, unknown>;
}

export class UnsupportedProviderError extends Error {
  constructor(provider: string) {
    super(
      `Vector store provider "${provider}" is not yet implemented at runtime. Use "sqlite-vec".`,
    );
    this.name = 'UnsupportedProviderError';
  }
}

export class VectorEngineUnavailableError extends Error {
  constructor(detail: string) {
    super(`sqlite-vec extension could not be loaded: ${detail}`);
    this.name = 'VectorEngineUnavailableError';
  }
}

export class DimensionMismatchError extends Error {
  constructor(expected: number, actual: number) {
    super(
      `Embedding dimension mismatch: collection expects ${expected}-dim vectors, embedder produced ${actual}-dim. Use the same embedding model that populated the collection.`,
    );
    this.name = 'DimensionMismatchError';
  }
}

/**
 * One open vector collection backed by sqlite-vec. The engine owns its
 * EmbeddingClient so insert-time and query-time vectors come from the
 * same model and the engine can validate dimensions on first insert.
 */
export class VectorDatabaseEngine {
  private readonly cfg: ResolvedVectorDatabaseConfig;
  private readonly embeddings: EmbeddingClient;
  private db: Database.Database | null = null;
  private dimension: number | null = null;
  private initPromise: Promise<void> | null = null;
  private readonly tableName: string;

  constructor(cfg: ResolvedVectorDatabaseConfig, embeddings: EmbeddingClient) {
    this.cfg = cfg;
    this.embeddings = embeddings;
    this.tableName = sanitizeIdentifier(cfg.collectionName || 'default');
  }

  init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.doInit();
    }
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    if (this.cfg.provider !== 'sqlite-vec') {
      throw new UnsupportedProviderError(this.cfg.provider);
    }

    const dbPath = resolveDbPath(this.cfg);
    const dir = path.dirname(dbPath);
    if (dir && dir !== '.') {
      await fs.promises.mkdir(dir, { recursive: true });
    }

    let db: Database.Database;
    try {
      db = new Database(dbPath);
      sqliteVec.load(db);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new VectorEngineUnavailableError(msg);
    }

    db.exec(
      `CREATE TABLE IF NOT EXISTS ${quoteIdent(this.metaTable())} (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
    );
    db.exec(
      `CREATE TABLE IF NOT EXISTS ${quoteIdent(this.docsTable())} (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}'
      )`,
    );

    const storedDim = this.readMeta(db, 'dimension');
    if (storedDim) {
      const parsed = Number(storedDim);
      if (Number.isFinite(parsed) && parsed > 0) {
        this.dimension = parsed;
        this.ensureVecTable(db, parsed);
      }
    }

    this.db = db;
  }

  async upsert(docs: VectorDocument[]): Promise<{ inserted: number }> {
    if (docs.length === 0) return { inserted: 0 };
    await this.init();
    const db = this.db!;

    const vectors = await this.embeddings.embed(docs.map((d) => d.text));
    if (vectors.length !== docs.length) {
      throw new Error(
        `Embedding count mismatch: ${docs.length} documents in, ${vectors.length} vectors out`,
      );
    }

    const dim = vectors[0]?.length ?? 0;
    if (dim === 0) throw new Error('Embedder returned an empty vector');
    this.lockDimension(db, dim);

    for (const vec of vectors) {
      if (vec.length !== this.dimension) {
        throw new DimensionMismatchError(this.dimension!, vec.length);
      }
    }

    const insertDoc = db.prepare(
      `INSERT INTO ${quoteIdent(this.docsTable())} (id, text, metadata)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET text = excluded.text, metadata = excluded.metadata`,
    );
    const deleteVec = db.prepare(
      `DELETE FROM ${quoteIdent(this.vecTable())} WHERE id = ?`,
    );
    const insertVec = db.prepare(
      `INSERT INTO ${quoteIdent(this.vecTable())} (id, embedding) VALUES (?, ?)`,
    );

    const txn = db.transaction((rows: Array<{ doc: VectorDocument; vec: number[] }>) => {
      for (const { doc, vec } of rows) {
        const metadata = JSON.stringify(doc.metadata ?? {});
        insertDoc.run(doc.id, doc.text, metadata);
        deleteVec.run(doc.id);
        insertVec.run(doc.id, new Float32Array(vec));
      }
    });

    txn(docs.map((doc, i) => ({ doc, vec: vectors[i] })));
    return { inserted: docs.length };
  }

  async search(query: string, opts: VectorSearchOptions = {}): Promise<VectorSearchResult[]> {
    await this.init();
    const db = this.db!;
    if (this.dimension === null) return [];

    const topK = Math.max(1, Math.min(opts.topK ?? 5, 100));
    const [vec] = await this.embeddings.embed([query]);
    if (!vec) return [];
    if (vec.length !== this.dimension) {
      throw new DimensionMismatchError(this.dimension, vec.length);
    }

    // sqlite-vec requires `LIMIT` or `k = ?` directly on the virtual
    // table; it does not accept LIMIT through an outer join. Do the kNN
    // pass first, then hydrate text + metadata via a separate lookup.
    const hits = db
      .prepare(
        `SELECT id, distance FROM ${quoteIdent(this.vecTable())}
         WHERE embedding MATCH ?
         ORDER BY distance
         LIMIT ?`,
      )
      .all(new Float32Array(vec), topK) as Array<{ id: string; distance: number }>;

    if (hits.length === 0) return [];

    const docStmt = db.prepare(
      `SELECT id, text, metadata FROM ${quoteIdent(this.docsTable())} WHERE id = ?`,
    );

    return hits.map((hit) => {
      const doc = docStmt.get(hit.id) as
        | { id: string; text: string; metadata: string }
        | undefined;
      return {
        id: hit.id,
        score: hit.distance,
        text: doc?.text ?? '',
        metadata: parseMetadata(doc?.metadata ?? null),
      };
    });
  }

  async delete(ids: string[]): Promise<{ deleted: number }> {
    if (ids.length === 0) return { deleted: 0 };
    await this.init();
    const db = this.db!;

    const deleteDoc = db.prepare(
      `DELETE FROM ${quoteIdent(this.docsTable())} WHERE id = ?`,
    );
    let deleteVec: Database.Statement | null = null;
    if (this.dimension !== null) {
      deleteVec = db.prepare(
        `DELETE FROM ${quoteIdent(this.vecTable())} WHERE id = ?`,
      );
    }

    let deleted = 0;
    const txn = db.transaction((targetIds: string[]) => {
      for (const id of targetIds) {
        const res = deleteDoc.run(id);
        if (res.changes > 0) deleted += 1;
        deleteVec?.run(id);
      }
    });
    txn(ids);
    return { deleted };
  }

  async get(id: string): Promise<VectorDocument | null> {
    await this.init();
    const db = this.db!;
    const row = db
      .prepare(
        `SELECT id, text, metadata FROM ${quoteIdent(this.docsTable())} WHERE id = ?`,
      )
      .get(id) as { id: string; text: string; metadata: string } | undefined;
    if (!row) return null;
    return { id: row.id, text: row.text, metadata: parseMetadata(row.metadata) };
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.initPromise = null;
  }

  // ---- internals ---------------------------------------------------------

  private metaTable(): string {
    return `${this.tableName}_meta`;
  }
  private docsTable(): string {
    return `${this.tableName}_docs`;
  }
  private vecTable(): string {
    return `vec_${this.tableName}`;
  }

  private readMeta(db: Database.Database, key: string): string | null {
    const row = db
      .prepare(`SELECT value FROM ${quoteIdent(this.metaTable())} WHERE key = ?`)
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  private writeMeta(db: Database.Database, key: string, value: string): void {
    db.prepare(
      `INSERT INTO ${quoteIdent(this.metaTable())} (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(key, value);
  }

  private ensureVecTable(db: Database.Database, dim: number): void {
    db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS ${quoteIdent(this.vecTable())}
       USING vec0(id TEXT PRIMARY KEY, embedding float[${dim}])`,
    );
  }

  private lockDimension(db: Database.Database, dim: number): void {
    if (this.dimension === null) {
      this.ensureVecTable(db, dim);
      this.writeMeta(db, 'dimension', String(dim));
      this.writeMeta(db, 'embeddingProvider', this.embeddings.provider);
      this.writeMeta(db, 'embeddingModel', this.embeddings.model);
      this.dimension = dim;
      return;
    }
    if (dim !== this.dimension) {
      throw new DimensionMismatchError(this.dimension, dim);
    }
  }
}

function sanitizeIdentifier(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_]/g, '_');
  if (!cleaned) return 'collection';
  if (/^\d/.test(cleaned)) return `c_${cleaned}`;
  return cleaned;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function resolveDbPath(cfg: ResolvedVectorDatabaseConfig): string {
  if (cfg.connectionString && cfg.connectionString.trim().length > 0) {
    return cfg.connectionString.trim();
  }
  const dir = cfg.storagePath?.trim() || '.sam/vector';
  const file = sanitizeIdentifier(cfg.collectionName || 'default') + '.db';
  return path.isAbsolute(dir) ? path.join(dir, file) : path.resolve(process.cwd(), dir, file);
}

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
