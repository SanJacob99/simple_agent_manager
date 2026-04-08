import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { SessionTranscriptStore } from './session-transcript-store';

function makeUsage() {
  return {
    input: 10,
    output: 5,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 15,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

describe('SessionTranscriptStore', () => {
  let tempDir: string;
  let store: SessionTranscriptStore;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `sam-transcripts-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempDir, { recursive: true });
    store = new SessionTranscriptStore(tempDir, process.cwd());
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('provisions a transcript file immediately for a fresh session', async () => {
    const created = await store.createSession();

    const raw = await fs.readFile(created.sessionFile, 'utf-8');
    const [header] = raw.trim().split('\n').map((line) => JSON.parse(line) as { type: string; id: string });

    expect(created.sessionId).toBeTruthy();
    expect(header.type).toBe('session');
    expect(header.id).toBe(created.sessionId);
  });

  it('snapshots user-only entries and reopens without duplicating the session header', async () => {
    const created = await store.createSession();
    created.manager.appendMessage({
      role: 'user',
      content: 'hello',
      timestamp: Date.now(),
    });

    let reopened = await store.snapshot(created.manager);
    reopened.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'hi there' }],
      api: 'openai-completions',
      provider: 'openai',
      model: 'gpt-4o',
      usage: makeUsage(),
      stopReason: 'stop',
      timestamp: Date.now(),
    });
    reopened = await store.snapshot(reopened);

    const lines = (await fs.readFile(created.sessionFile, 'utf-8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string });

    expect(lines.filter((entry) => entry.type === 'session')).toHaveLength(1);
    expect(lines.filter((entry) => entry.type === 'message')).toHaveLength(2);
    expect(reopened.getEntries()).toHaveLength(2);
  });

  it('creates a forked transcript with a parent session path when requested', async () => {
    const parent = await store.createSession();
    const child = await store.createSession(parent.sessionFile);

    const raw = await fs.readFile(child.sessionFile, 'utf-8');
    const [header] = raw.trim().split('\n').map((line) => JSON.parse(line) as { parentSession?: string });

    expect(header.parentSession).toBe(parent.sessionFile);
  });
});
