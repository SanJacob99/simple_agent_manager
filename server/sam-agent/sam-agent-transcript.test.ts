import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SamAgentTranscriptStore } from './sam-agent-transcript';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'samagent-tx-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('SamAgentTranscriptStore', () => {
  it('append + read round-trip', async () => {
    const store = new SamAgentTranscriptStore(join(dir, 'default.jsonl'));
    await store.append({ id: 'm1', role: 'user', text: 'hello', timestamp: 1 });
    await store.append({ id: 'm2', role: 'assistant', text: 'hi', timestamp: 2, toolResults: [] });
    const all = await store.read();
    expect(all).toHaveLength(2);
    expect(all[0].id).toBe('m1');
  });

  it('empty file returns empty array', async () => {
    const store = new SamAgentTranscriptStore(join(dir, 'absent.jsonl'));
    expect(await store.read()).toEqual([]);
  });

  it('clear empties the file', async () => {
    const store = new SamAgentTranscriptStore(join(dir, 'default.jsonl'));
    await store.append({ id: 'm1', role: 'user', text: 'a', timestamp: 1 });
    await store.clear();
    expect(await store.read()).toEqual([]);
  });

  it('updatePatchState rewrites the message in place', async () => {
    const store = new SamAgentTranscriptStore(join(dir, 'default.jsonl'));
    await store.append({
      id: 'm2', role: 'assistant', text: '', timestamp: 1,
      toolResults: [{ toolName: 'propose_workflow_patch', toolCallId: 'tc1', patchState: 'pending', resultJson: '{"ok":true}' }],
    });
    await store.updatePatchState('m2', 'tc1', 'applied');
    const all = await store.read();
    const tr = (all[0] as any).toolResults[0];
    expect(tr.patchState).toBe('applied');
  });
});
