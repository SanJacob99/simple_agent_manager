import type {
  ResolvedKnowledgeConfig,
  ResolvedKnowledgeSource,
  ChunkStrategy,
} from '../../shared/agent-config';
import { estimateTokens } from '../../shared/token-estimator';

/**
 * Knowledge / ingestion engine.
 *
 * A knowledge node owns the *sources* — files, directories, URLs, git repos, or
 * inline text — that get chunked, embedded, and written into the Vector DB the
 * Context Engine's RAG path reads from. This module is the dependency-free
 * substrate the ingestion runner calls: it owns source normalization/dedup, the
 * text-chunking strategies, the refresh-due decision, and the ingestion-plan
 * summary, while the runner owns the actual fetch, embed, and upsert I/O.
 *
 * The orchestration the ingestion runner performs:
 *
 *   1. `buildIngestionPlan(config)` collapses the node's sources into a clean,
 *      deduped work list plus the target collection and embedding model.
 *   2. For each source, `isRefreshDue(source.refreshSchedule, lastRunAt, now)`
 *      decides whether it is stale enough to re-fetch.
 *   3. The runner fetches each due source's raw text (its own I/O), then calls
 *      `chunkText(text, config)` to split it into overlapping windows.
 *   4. Each chunk is embedded and upserted into `collectionName`; the vectors
 *      are what the Context Engine later retrieves.
 *
 * Wiring this into an ingestion runner (fetch sources, embed chunks, upsert into
 * the Vector DB, honor the refresh schedule) is the remaining integration step;
 * the API below is the stable surface that wiring targets.
 */

/** A single ingestion unit: a chunk of source text plus its provenance. */
export interface Chunk {
  /** Zero-based index of this chunk within its source document. */
  index: number;
  /** The chunk text. */
  text: string;
  /** Approximate token count (shared estimator). */
  tokens: number;
}

/**
 * Normalize a resolved source: trim the location, default the globs, and drop a
 * source whose location is empty (nothing to fetch). Returns `null` for an empty
 * source so callers can `.filter(Boolean)` it out.
 */
export function normalizeSource(
  source: ResolvedKnowledgeSource,
): ResolvedKnowledgeSource | null {
  const location = source.location.trim();
  if (!location) return null;
  return {
    id: source.id,
    type: source.type,
    location,
    include: source.include.trim(),
    exclude: source.exclude.trim(),
  };
}

/**
 * Dedupe sources by `type` + `location`. The first occurrence wins so that an
 * earlier source's globs are preserved. Inline `text` sources are never merged
 * (identical pasted text is legitimately distinct), so they are keyed by `id`.
 */
export function dedupeSources(
  sources: ResolvedKnowledgeSource[],
): ResolvedKnowledgeSource[] {
  const seen = new Set<string>();
  const out: ResolvedKnowledgeSource[] = [];
  for (const s of sources) {
    const key = s.type === 'text' ? `text::${s.id}` : `${s.type}::${s.location}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * Split raw text into the atomic units a chunk strategy packs from. `fixed`
 * treats the whole document as one unit (packed by token window); the others
 * break on sentence, paragraph, or Markdown-heading boundaries. Empty units are
 * dropped. This never loses characters other than the boundary whitespace.
 */
export function splitIntoUnits(text: string, strategy: ChunkStrategy): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  switch (strategy) {
    case 'fixed':
      return [trimmed];
    case 'sentence':
      // Split after ., !, or ? followed by whitespace. Keeps the terminator.
      return trimmed
        .split(/(?<=[.!?])\s+/)
        .map((u) => u.trim())
        .filter(Boolean);
    case 'paragraph':
      return trimmed
        .split(/\n\s*\n+/)
        .map((u) => u.trim())
        .filter(Boolean);
    case 'markdown': {
      // Break before each ATX heading (# .. ######) so a heading stays with the
      // prose beneath it. The first segment (pre-heading preamble) is kept.
      const parts = trimmed.split(/\n(?=#{1,6}\s)/);
      return parts.map((u) => u.trim()).filter(Boolean);
    }
    default:
      return [trimmed];
  }
}

/** Hard-split a single oversized unit into `maxTokens`-sized word runs. */
function splitOversizedUnit(unit: string, maxTokens: number): string[] {
  const words = unit.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let current: string[] = [];
  for (const word of words) {
    current.push(word);
    if (estimateTokens(current.join(' ')) >= maxTokens) {
      out.push(current.join(' '));
      current = [];
    }
  }
  if (current.length) out.push(current.join(' '));
  return out;
}

/**
 * Chunk `text` into overlapping token windows per the config's strategy.
 *
 * Units (sentences/paragraphs/headings/whole-doc) are packed greedily until the
 * next unit would push the window past `chunkSize` tokens, then the window is
 * flushed. `chunkOverlap` tokens' worth of trailing units are carried into the
 * next window so retrieval keeps cross-boundary context. A single unit larger
 * than `chunkSize` is hard-split on word boundaries so no chunk exceeds the size
 * by more than one word.
 *
 * `chunkSize` is clamped to at least 1 and `chunkOverlap` to `[0, chunkSize-1]`
 * so a misconfigured node can never produce an empty or non-terminating loop.
 */
export function chunkText(text: string, config: {
  chunkStrategy: ChunkStrategy;
  chunkSize: number;
  chunkOverlap: number;
}): Chunk[] {
  const size = Math.max(1, Math.floor(config.chunkSize) || 1);
  const overlap = Math.min(Math.max(0, Math.floor(config.chunkOverlap) || 0), size - 1);

  const rawUnits = splitIntoUnits(text, config.chunkStrategy);
  // Pre-split any unit that alone exceeds the window so packing stays bounded.
  const units: string[] = [];
  for (const u of rawUnits) {
    if (estimateTokens(u) > size) units.push(...splitOversizedUnit(u, size));
    else units.push(u);
  }

  const chunks: Chunk[] = [];
  let window: string[] = [];
  let index = 0;

  const flush = () => {
    if (!window.length) return;
    const text = window.join(' ');
    chunks.push({ index: index++, text, tokens: estimateTokens(text) });
  };

  /** Trailing units of `window` whose combined tokens stay within `overlap`. */
  const carryOver = (): string[] => {
    if (overlap === 0) return [];
    const carried: string[] = [];
    for (let i = window.length - 1; i >= 0; i--) {
      const next = [window[i], ...carried];
      if (estimateTokens(next.join(' ')) > overlap) break;
      carried.unshift(window[i]);
    }
    return carried;
  };

  for (const unit of units) {
    const candidate = [...window, unit];
    if (window.length && estimateTokens(candidate.join(' ')) > size) {
      flush();
      window = [...carryOver(), unit];
    } else {
      window = candidate;
    }
  }
  flush();

  return chunks;
}

/**
 * Parse a refresh cadence into milliseconds. `manual` (or empty / unrecognized)
 * returns `null` — never auto-refresh. Accepts a bare duration like `30m`,
 * `6h`, `7d`, `45s`, or `250ms`.
 */
export function parseRefreshInterval(schedule: string): number | null {
  const s = schedule.trim().toLowerCase();
  if (!s || s === 'manual') return null;
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/.exec(s);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = match[2];
  const scale: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return value * scale[unit];
}

/**
 * Whether a source is due for re-ingestion. `manual` schedules are never due.
 * A source that has never run (`lastRunAtMs == null`) is always due once it has
 * an interval. Otherwise it is due when `now - lastRun >= interval`.
 */
export function isRefreshDue(
  schedule: string,
  lastRunAtMs: number | null,
  nowMs: number,
): boolean {
  const interval = parseRefreshInterval(schedule);
  if (interval === null) return false;
  if (lastRunAtMs === null) return true;
  return nowMs - lastRunAtMs >= interval;
}

/** A cleaned, deduped ingestion plan derived from a resolved knowledge config. */
export interface IngestionPlan {
  knowledgeNodeId: string;
  collectionName: string;
  enabled: boolean;
  embeddingModel: string;
  chunkStrategy: ChunkStrategy;
  chunkSize: number;
  chunkOverlap: number;
  /** Normalized, deduped, non-empty sources to ingest. */
  sources: ResolvedKnowledgeSource[];
  /** Sources dropped for an empty location, for surfacing back to the user. */
  droppedSourceIds: string[];
}

/**
 * Collapse a resolved knowledge config into a clean ingestion plan: normalize
 * each source, drop empty ones (recording their ids), and dedupe. A disabled
 * node yields a plan with `enabled: false` and no sources so the runner can skip
 * it without special-casing.
 */
export function buildIngestionPlan(config: ResolvedKnowledgeConfig): IngestionPlan {
  const droppedSourceIds: string[] = [];
  const normalized: ResolvedKnowledgeSource[] = [];
  for (const s of config.sources) {
    const n = normalizeSource(s);
    if (n) normalized.push(n);
    else droppedSourceIds.push(s.id);
  }
  const sources = config.enabled ? dedupeSources(normalized) : [];
  return {
    knowledgeNodeId: config.knowledgeNodeId,
    collectionName: config.collectionName,
    enabled: config.enabled,
    embeddingModel: config.embedding.model,
    chunkStrategy: config.chunkStrategy,
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
    sources,
    droppedSourceIds,
  };
}
