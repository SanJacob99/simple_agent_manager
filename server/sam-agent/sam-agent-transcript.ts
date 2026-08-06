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

    // ⚡ Bolt Optimization: Use single-pass extraction instead of chained
    // .split('\n').filter().map() to bypass creating large intermediate arrays
    // that cause memory churn and GC pauses when parsing large JSONL transcripts.
    const messages: SamAgentMessage[] = [];
    let currentIdx = 0;
    while (currentIdx < raw.length) {
      let nextIdx = raw.indexOf('\n', currentIdx);
      if (nextIdx === -1) {
        nextIdx = raw.length;
      }
      const line = raw.substring(currentIdx, nextIdx);
      if (line.length > 0) {
        messages.push(JSON.parse(line) as SamAgentMessage);
      }
      currentIdx = nextIdx + 1;
    }
    return messages;
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
