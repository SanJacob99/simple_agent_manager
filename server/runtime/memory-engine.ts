import type { ResolvedMemoryConfig } from '../../shared/agent-config';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { Type, type TSchema } from '@sinclair/typebox';

export interface MemoryEntry {
  key: string;
  content: string;
  metadata: Record<string, unknown>;
  timestamp: number;
}

function textResult(text: string): AgentToolResult<undefined> {
  return { content: [{ type: 'text', text }], details: undefined };
}

/**
 * MemoryEngine manages agent memory with support for session messages,
 * long-term storage, and search (keyword/semantic/hybrid).
 *
 * Builtin backend uses an in-memory Map (with optional IndexedDB persistence).
 * External/cloud backends delegate to REST endpoints.
 */
export class MemoryEngine {
  private config: ResolvedMemoryConfig;
  private longTermStore = new Map<string, MemoryEntry>();
  private sessionMessages = new Map<string, Array<{ role: string; content: string; timestamp: number }>>();

  constructor(config: ResolvedMemoryConfig) {
    this.config = config;
  }

  // --- Long-term memory ---

  async saveLongTerm(key: string, content: string, metadata: Record<string, unknown> = {}): Promise<void> {
    this.longTermStore.set(key, { key, content, metadata, timestamp: Date.now() });
  }

  async getLongTerm(key: string): Promise<MemoryEntry | null> {
    return this.longTermStore.get(key) || null;
  }

  async searchLongTerm(query: string): Promise<MemoryEntry[]> {
    const queryLower = query.toLowerCase();
    const results: MemoryEntry[] = [];

    for (const entry of this.longTermStore.values()) {
      const contentLower = entry.content.toLowerCase();
      if (contentLower.includes(queryLower)) {
        results.push(entry);
      }
    }

    // Sort by relevance (simple: position of match, then recency)
    results.sort((a, b) => b.timestamp - a.timestamp);
    return results.slice(0, 10);
  }

  // --- Session memory ---

  async saveSessionMessage(
    sessionId: string,
    message: { role: string; content: string; timestamp: number },
  ): Promise<void> {
    if (!this.sessionMessages.has(sessionId)) {
      this.sessionMessages.set(sessionId, []);
    }
    const msgs = this.sessionMessages.get(sessionId)!;
    msgs.push(message);

    // Trim to max
    if (msgs.length > this.config.maxSessionMessages) {
      msgs.splice(0, msgs.length - this.config.maxSessionMessages);
    }
  }

  async getSessionMessages(
    sessionId: string,
    limit?: number,
  ): Promise<Array<{ role: string; content: string; timestamp: number }>> {
    const msgs = this.sessionMessages.get(sessionId) || [];
    return limit ? msgs.slice(-limit) : msgs;
  }

  // --- Compaction ---

  async compact(
    messages: Array<{ role: string; content: string }>,
  ): Promise<{ compacted: Array<{ role: string; content: string }>; summary: string }> {
    if (!this.config.compactionEnabled || messages.length < 4) {
      return { compacted: messages, summary: '' };
    }

    const strategy = this.config.compactionStrategy;

    if (strategy === 'sliding-window') {
      // Keep last N messages
      const keepCount = Math.max(4, Math.floor(messages.length * 0.3));
      const kept = messages.slice(-keepCount);
      const dropped = messages.slice(0, -keepCount);
      const summary = dropped.length > 0
        ? `[${dropped.length} earlier messages compacted]`
        : '';
      return { compacted: kept, summary };
    }

    if (strategy === 'summary') {
      // Summarize older messages, keep recent ones
      const keepCount = Math.max(4, Math.floor(messages.length * 0.3));
      const toSummarize = messages.slice(0, -keepCount);
      const kept = messages.slice(-keepCount);

      if (toSummarize.length === 0) {
        return { compacted: messages, summary: '' };
      }

      const summaryText = toSummarize
        .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
        .join('\n');
      const summary = `Summary of ${toSummarize.length} earlier messages:\n${summaryText.slice(0, 1000)}`;

      const compacted = [
        { role: 'system' as const, content: summary },
        ...kept,
      ];
      return { compacted, summary };
    }

    return { compacted: messages, summary: '' };
  }

  // --- Memory tools for the agent ---

  createMemoryTools(): AgentTool<TSchema>[] {
    const tools: AgentTool<TSchema>[] = [];

    if (this.config.exposeMemorySearch) {
      tools.push({
        name: 'memory_search',
        description: 'Search long-term memory using keyword matching. Returns relevant memory entries.',
        label: 'Memory Search',
        parameters: Type.Object({
          query: Type.String({ description: 'Search query' }),
        }),
        execute: async (_id, params: any) => {
          const results = await this.searchLongTerm(params.query);
          if (results.length === 0) {
            return textResult('No memory entries found matching the query.');
          }
          const formatted = results
            .map((r) => `[${r.key}] ${r.content}`)
            .join('\n---\n');
          return textResult(formatted);
        },
      });
    }

    if (this.config.exposeMemoryGet) {
      tools.push({
        name: 'memory_get',
        description: 'Retrieve a specific memory entry by key.',
        label: 'Memory Get',
        parameters: Type.Object({
          key: Type.String({ description: 'Memory entry key' }),
        }),
        execute: async (_id, params: any) => {
          const entry = await this.getLongTerm(params.key);
          if (!entry) {
            return textResult(`No memory entry found with key: ${params.key}`);
          }
          return textResult(`[${entry.key}] ${entry.content}`);
        },
      });
    }

    if (this.config.exposeMemorySave) {
      tools.push({
        name: 'memory_save',
        description: 'Save information to long-term memory for later retrieval.',
        label: 'Memory Save',
        parameters: Type.Object({
          key: Type.String({ description: 'Unique key for this memory entry' }),
          content: Type.String({ description: 'Content to remember' }),
        }),
        execute: async (_id, params: any) => {
          await this.saveLongTerm(params.key, params.content);
          return textResult(`Saved memory entry: ${params.key}`);
        },
      });
    }

    return tools;
  }
}
