import type { ResolvedMemoryConfig } from '../../shared/agent-config';
import type { StorageEngine } from '../storage/storage-engine';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { Type, type TSchema } from '@sinclair/typebox';
import { Mutex } from '../util/mutex';

function textResult(text: string): AgentToolResult<undefined> {
  return { content: [{ type: 'text', text }], details: undefined };
}

function isoDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return isoDate(d);
}

export type MemoryScope = 'long_term' | 'short_term';

export interface MemorySearchHit {
  file: string;
  scope: MemoryScope;
  line: number;
  excerpt: string;
}

/**
 * Two-tier memory inspired by OpenClaw:
 *
 *   - Long-term: a single `MEMORY.md` of durable facts. Never auto-compacted.
 *   - Short-term: `memory/YYYY-MM-DD.md` daily logs. Today + N recent days are
 *     auto-loaded; older days can be compacted into a `summary.md` rollup.
 *
 * Persistence is delegated to the connected StorageEngine. When no storage
 * is available (e.g. the agent has no Storage node) every operation
 * becomes a no-op and tools report that memory is offline.
 */
export class MemoryEngine {
  /**
   * Serializes long-term (MEMORY.md) read-modify-write so two concurrent
   * appends — e.g. parallel memory_save tool calls in a single turn — can't
   * both read the same file content and have the later write drop the
   * earlier append.
   */
  private readonly longTermLock = new Mutex();

  constructor(
    private readonly config: ResolvedMemoryConfig,
    private readonly storage: StorageEngine | null,
  ) {}

  private requireStorage(): StorageEngine | null {
    return this.storage;
  }

  // --- Long-term (MEMORY.md) ---

  async readLongTerm(): Promise<string> {
    const storage = this.requireStorage();
    if (!storage) return '';
    const content = await storage.readLongTermMemory();
    return content ?? '';
  }

  async appendLongTerm(content: string): Promise<void> {
    const storage = this.requireStorage();
    if (!storage) return;
    await this.longTermLock.run(async () => {
      const existing = (await storage.readLongTermMemory()) ?? '';
      const stamp = new Date().toISOString();
      const block = existing.endsWith('\n') || existing.length === 0 ? '' : '\n';
      const entry = `${block}\n- (${stamp}) ${content.trim()}\n`;
      await storage.writeLongTermMemory(existing + entry);
    });
  }

  async writeLongTerm(content: string): Promise<void> {
    const storage = this.requireStorage();
    if (!storage) return;
    await this.longTermLock.run(async () => {
      await storage.writeLongTermMemory(content);
    });
  }

  // --- Short-term (daily logs) ---

  async appendShortTerm(content: string, date?: string): Promise<string> {
    const storage = this.requireStorage();
    if (!storage) return '';
    const target = date ?? isoDate();
    const stamp = new Date().toISOString();
    const entry = `\n- (${stamp}) ${content.trim()}\n`;
    await storage.appendDailyMemory(entry, target);
    return target;
  }

  async readShortTerm(date?: string): Promise<string> {
    const storage = this.requireStorage();
    if (!storage) return '';
    const target = date ?? isoDate();
    const content = await storage.readDailyMemory(target);
    return content ?? '';
  }

  // --- Session bootstrap injection ---

  /**
   * Produce the markdown block that should be injected into the system prompt
   * at session start. Mirrors OpenClaw: long-term first, then the N most
   * recent daily logs. Returns an empty string if neither layer is auto-load.
   */
  async buildBootstrapContext(): Promise<string> {
    const storage = this.requireStorage();
    if (!storage) return '';

    const parts: string[] = [];

    if (this.config.autoLoadLongTerm) {
      let longTerm = await this.readLongTerm();
      if (longTerm) {
        const cap = this.config.longTermMaxBytes;
        if (cap > 0 && longTerm.length > cap) {
          longTerm = longTerm.slice(0, cap) + '\n\n... [truncated; full file in MEMORY.md]';
        }
        parts.push(`## Long-term memory (MEMORY.md)\n\n${longTerm}`);
      }
    }

    const days = Math.max(0, this.config.autoLoadShortTermDays);
    if (days > 0) {
      const blocks: string[] = [];
      for (let i = 0; i < days; i++) {
        const date = daysAgo(i);
        const content = await storage.readDailyMemory(date);
        if (content && content.trim().length > 0) {
          blocks.push(`### ${date}\n${content.trim()}`);
        }
      }
      if (blocks.length > 0) {
        parts.push(`## Short-term memory (recent daily logs)\n\n${blocks.join('\n\n')}`);
      }
    }

    return parts.join('\n\n');
  }

  // --- Search ---

  /**
   * Keyword search across MEMORY.md and every daily log. Case-insensitive.
   * Returns at most 20 hits, each carrying its source file, line number, and
   * a one-line excerpt so the agent can decide whether to memory_get more.
   *
   * `hybrid` mode is reserved for when a vector node is wired; for now it
   * falls through to keyword search so the schema can land first.
   */
  async search(query: string, limit = 20): Promise<MemorySearchHit[]> {
    const storage = this.requireStorage();
    if (!storage || !query.trim()) return [];

    const needle = query.toLowerCase();
    const hits: MemorySearchHit[] = [];

    const longTerm = await storage.readLongTermMemory();
    if (longTerm) {
      this.collectHits(longTerm, 'MEMORY.md', 'long_term', needle, hits, limit);
    }

    if (hits.length >= limit) return hits.slice(0, limit);

    const files = await storage.listMemoryFiles();
    const dailyFiles = files
      .filter((f) => !f.isEvergreen && f.date)
      .sort((a, b) => (b.date! < a.date! ? -1 : 1));

    for (const file of dailyFiles) {
      if (hits.length >= limit) break;
      const content = await storage.readDailyMemory(file.date!);
      if (!content) continue;
      this.collectHits(content, file.name, 'short_term', needle, hits, limit);
    }

    return hits.slice(0, limit);
  }

  private collectHits(
    content: string,
    file: string,
    scope: MemoryScope,
    needle: string,
    out: MemorySearchHit[],
    limit: number,
  ): void {
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (out.length >= limit) return;
      if (lines[i].toLowerCase().includes(needle)) {
        out.push({
          file,
          scope,
          line: i + 1,
          excerpt: lines[i].trim().slice(0, 240),
        });
      }
    }
  }

  // --- Compaction ---

  /**
   * Compact daily logs older than `compactionAfterDays`. Two strategies:
   *   - `sliding-window`: simply prune the file (data removed).
   *   - `summary`: collapse the file to a one-line summary header so the
   *      content can still be discovered by search but no longer carries
   *      its full bulk.
   *
   * Returns the list of dates that were touched. No-op when compaction is
   * disabled or storage is offline.
   */
  async compactOldDailyLogs(): Promise<string[]> {
    if (!this.config.compactionEnabled) return [];
    const storage = this.requireStorage();
    if (!storage) return [];

    const cutoff = daysAgo(Math.max(1, this.config.compactionAfterDays));
    const touched: string[] = [];

    const files = await storage.listMemoryFiles();
    for (const file of files) {
      if (file.isEvergreen || !file.date) continue;
      if (file.date >= cutoff) continue;

      const content = await storage.readDailyMemory(file.date);
      if (!content) continue;

      if (this.config.compactionStrategy === 'sliding-window') {
        // Replace the daily file with a single marker so search still finds
        // its absence without leaving stale bulk on disk. Must OVERWRITE, not
        // append — appending would leave the full original content in place
        // and grow the file instead of pruning it.
        await storage.writeDailyMemory(
          `<!-- compacted ${new Date().toISOString()} -->\n`,
          file.date,
        );
      } else {
        const summary = this.summarizeDailyLog(content);
        await storage.writeDailyMemory(
          `<!-- summarized ${new Date().toISOString()} -->\n${summary}\n`,
          file.date,
        );
      }
      touched.push(file.date);
    }

    return touched;
  }

  private summarizeDailyLog(content: string): string {
    // Local heuristic summary: keep the first line of each bullet so the
    // shape of the day is preserved without LLM cost. A future enhancement
    // can route through a summary model when one is configured.
    const lines = content.split(/\r?\n/);
    const bullets = lines.filter((l) => l.trim().startsWith('- '));
    const compact = bullets.map((l) => l.split('\n')[0].slice(0, 200));
    return `## Summary (${bullets.length} entries)\n${compact.join('\n')}`;
  }

  // --- Tools exposed to the agent ---

  createMemoryTools(): AgentTool<TSchema>[] {
    const tools: AgentTool<TSchema>[] = [];

    if (this.config.exposeMemorySave) {
      tools.push({
        name: 'memory_save',
        label: 'Memory Save',
        description:
          'Persist a fact the agent should remember. Use `long_term` for durable facts about the user or the job (preferences, decisions, standing instructions). Use `short_term` for today\'s observations and session context — these end up in the daily log and may be compacted later.',
        parameters: Type.Object({
          scope: Type.Union(
            [Type.Literal('long_term'), Type.Literal('short_term')],
            { description: 'Where to save the entry.' },
          ),
          content: Type.String({
            description: 'The fact or observation to remember. One self-contained sentence works best.',
          }),
        }),
        execute: async (_id, params: any) => {
          if (!this.storage) return textResult('Memory is offline — no Storage node connected.');
          if (params.scope === 'long_term') {
            await this.appendLongTerm(params.content);
            return textResult('Saved to MEMORY.md (long-term).');
          }
          const date = await this.appendShortTerm(params.content);
          return textResult(`Saved to memory/${date}.md (short-term).`);
        },
      });
    }

    if (this.config.exposeMemoryGet) {
      tools.push({
        name: 'memory_get',
        label: 'Memory Get',
        description:
          'Read a memory file in full. Pass scope=long_term to fetch MEMORY.md, or scope=short_term with a date (YYYY-MM-DD) to fetch a specific daily log. Omit the date to fetch today.',
        parameters: Type.Object({
          scope: Type.Union([
            Type.Literal('long_term'),
            Type.Literal('short_term'),
          ]),
          date: Type.Optional(
            Type.String({
              description: 'ISO date YYYY-MM-DD. Only used when scope=short_term. Defaults to today.',
            }),
          ),
        }),
        execute: async (_id, params: any) => {
          if (!this.storage) return textResult('Memory is offline — no Storage node connected.');
          if (params.scope === 'long_term') {
            const content = await this.readLongTerm();
            return textResult(content ? content : '(MEMORY.md is empty)');
          }
          const date = params.date ?? isoDate();
          const content = await this.readShortTerm(date);
          return textResult(content ? content : `(memory/${date}.md is empty)`);
        },
      });
    }

    if (this.config.exposeMemorySearch) {
      tools.push({
        name: 'memory_search',
        label: 'Memory Search',
        description:
          'Find memories matching a keyword across MEMORY.md and every daily log. Returns file, line, and excerpt for each hit so the agent can follow up with memory_get.',
        parameters: Type.Object({
          query: Type.String({ description: 'Search term (case-insensitive substring match).' }),
        }),
        execute: async (_id, params: any) => {
          if (!this.storage) return textResult('Memory is offline — no Storage node connected.');
          const hits = await this.search(params.query);
          if (hits.length === 0) return textResult(`No memory entries matched "${params.query}".`);
          const lines = hits.map((h) => `[${h.scope}] ${h.file}:${h.line} — ${h.excerpt}`);
          return textResult(lines.join('\n'));
        },
      });
    }

    return tools;
  }
}
