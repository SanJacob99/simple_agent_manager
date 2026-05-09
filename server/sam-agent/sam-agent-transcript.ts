import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SamAgentToolResult, SamAgentMessage } from '../../shared/sam-agent/protocol-types';

// Re-export so external code that imported from this module continues to work.
export type { SamAgentToolResult, SamAgentMessage } from '../../shared/sam-agent/protocol-types';

export class SamAgentTranscriptStore {
  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
  }

  async read(): Promise<SamAgentMessage[]> {
    if (!existsSync(this.path)) return [];
    const raw = readFileSync(this.path, 'utf-8');
    if (raw.length === 0) return [];

    // ⚡ Bolt Optimization: Use single-pass extraction to parse JSONL data.
    // Avoids chained array methods (.split.filter.map) and intermediate array allocations
    // which cause significant memory churn for large transcript files.
    const results: SamAgentMessage[] = [];
    let start = 0;
    let end = raw.indexOf('\n');

    while (end !== -1) {
      if (end > start) {
        results.push(JSON.parse(raw.substring(start, end)) as SamAgentMessage);
      }
      start = end + 1;
      end = raw.indexOf('\n', start);
    }

    // Process any remaining data after the last newline
    if (start < raw.length) {
      results.push(JSON.parse(raw.substring(start)) as SamAgentMessage);
    }

    return results;
  }

  async append(message: SamAgentMessage): Promise<void> {
    appendFileSync(this.path, JSON.stringify(message) + '\n', 'utf-8');
  }

  async clear(): Promise<void> {
    writeFileSync(this.path, '', 'utf-8');
  }

  async updatePatchState(
    messageId: string,
    toolCallId: string,
    state: NonNullable<SamAgentToolResult['patchState']>,
  ): Promise<boolean> {
    const all = await this.read();
    let changed = false;
    for (const m of all) {
      if (m.id !== messageId || !m.toolResults) continue;
      for (const tr of m.toolResults) {
        if (tr.toolCallId === toolCallId) {
          tr.patchState = state;
          changed = true;
        }
      }
    }
    if (!changed) return false;
    writeFileSync(this.path, all.map((m) => JSON.stringify(m)).join('\n') + '\n', 'utf-8');
    return true;
  }
}
