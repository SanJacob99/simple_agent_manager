import type { AgentConfig, ResolvedVectorDatabaseConfig } from '../../shared/agent-config';
import type { RuntimeHints } from '../tools/tool-module';
import { VectorDatabaseEngine } from './vector-database-engine';
import { createEmbeddingClient } from './embeddings/embedding-client';

/**
 * Per-`AgentConfig` cache of constructed `VectorDatabaseEngine` instances,
 * keyed by node label. The cache is held in a `WeakMap` so old configs
 * become garbage-collectable once the runtime that owned them is gone.
 */
const enginesByConfig = new WeakMap<
  AgentConfig,
  Map<string, VectorDatabaseEngine>
>();

function getCache(config: AgentConfig): Map<string, VectorDatabaseEngine> {
  let cache = enginesByConfig.get(config);
  if (!cache) {
    cache = new Map();
    enginesByConfig.set(config, cache);
  }
  return cache;
}

function findCollection(
  config: AgentConfig,
  label: string | undefined,
): ResolvedVectorDatabaseConfig | null {
  const all = config.vectorDatabases ?? [];
  if (all.length === 0) return null;
  if (!label) {
    return all.length === 1 ? all[0] : null;
  }
  return all.find((c) => c.label === label) ?? null;
}

/**
 * Resolve the named collection (or the only one configured) and return
 * its engine, constructing+initializing it on first use. Returns `null`
 * when no `vectorDatabase` is configured or when an explicit label does
 * not match any attached node.
 */
export async function getOrCreateVectorEngine(
  config: AgentConfig,
  label: string | undefined,
  runtime: RuntimeHints,
): Promise<VectorDatabaseEngine | null> {
  const cfg = findCollection(config, label);
  if (!cfg) return null;

  const cache = getCache(config);
  const cacheKey = cfg.label;
  let engine = cache.get(cacheKey);
  if (!engine) {
    const embeddings = createEmbeddingClient(cfg.embedding, runtime);
    engine = new VectorDatabaseEngine(cfg, embeddings);
    cache.set(cacheKey, engine);
  }
  await engine.init();
  return engine;
}

/** Close every cached engine for the given config (called on runtime teardown). */
export async function closeVectorEngines(config: AgentConfig): Promise<void> {
  const cache = enginesByConfig.get(config);
  if (!cache) return;
  await Promise.all([...cache.values()].map((e) => e.close().catch(() => undefined)));
  cache.clear();
  enginesByConfig.delete(config);
}
