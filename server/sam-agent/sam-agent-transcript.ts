import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type SamAgentToolResult = {
  toolName: string;
  toolCallId: string;
  resultJson: string;
  patchState?: 'pending' | 'applied' | 'discarded' | 'failed';
};

export type SamAgentMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'hitl';
  text: string;
  timestamp: number;
  toolResults?: SamAgentToolResult[];
};

export class SamAgentTranscriptStore {
  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
  }

  async read(): Promise<SamAgentMessage[]> {
    if (!existsSync(this.path)) return [];
    const raw = readFileSync(this.path, 'utf-8');
    if (raw.length === 0) return [];
    return raw
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as SamAgentMessage);
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
