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

    // ⚡ Bolt Optimization: Replace chained .split().filter().map() with a single-pass loop
    // using indexOf and substring. This avoids creating massive intermediate arrays
    // for large JSONL files, directly improving memory efficiency and reducing GC pauses.
    const messages: SamAgentMessage[] = [];
    let startIdx = 0;
    while (startIdx < raw.length) {
      let newlineIdx = raw.indexOf('\n', startIdx);
      if (newlineIdx === -1) newlineIdx = raw.length;

      const line = raw.substring(startIdx, newlineIdx);
      if (line.length > 0) {
        messages.push(JSON.parse(line) as SamAgentMessage);
      }

      startIdx = newlineIdx + 1;
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
