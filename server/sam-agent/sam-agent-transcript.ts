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

    // ⚡ Bolt Optimization: Use single-pass while loop with indexOf('\n')
    // Bypasses parsing the entire payload and prevents massive intermediate array allocations
    // caused by chained .split().map().filter() in hot paths.
    const messages: SamAgentMessage[] = [];
    let start = 0;
    while (start < raw.length) {
      const end = raw.indexOf('\n', start);
      if (end === -1) {
        // Last line without a newline
        const line = raw.substring(start).trim();
        if (line.length > 0) {
          messages.push(JSON.parse(line) as SamAgentMessage);
        }
        break;
      }

      const line = raw.substring(start, end).trim();
      if (line.length > 0) {
        messages.push(JSON.parse(line) as SamAgentMessage);
      }
      start = end + 1;
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
