import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SamAgentCoordinator } from './sam-agent-coordinator';
import type { GraphSnapshot } from '../../shared/sam-agent/workflow-patch';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'samagent-coord-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/**
 * Stub runtime that mimics AgentRuntime's actual subscription API:
 *   subscribe(listener) → () => void
 * This matches the real AgentRuntime.subscribe() pattern in server/runtime/agent-runtime.ts.
 */
function makeStubRuntime() {
  const listeners = new Set<(e: any) => void>();
  return {
    eventsToFire: [] as any[],
    addTools: vi.fn(),
    setSessionContext: vi.fn(),
    setBroadcast: vi.fn(),
    /**
     * Real AgentRuntime API — subscribe(listener) returns an unsubscribe fn.
     * The coordinator calls this (not on/off).
     */
    subscribe(l: (e: any) => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    fireFromArray() {
      for (const e of (this as any).eventsToFire) {
        for (const l of listeners) l(e);
      }
    },
    prompt: vi.fn(async function (this: any, _text: string) { this.fireFromArray(); }),
  } as any;
}

describe('SamAgentCoordinator.dispatch', () => {
  it('streams shaped samAgent events for a simple text turn', async () => {
    const runtime = makeStubRuntime();
    // Use real AgentEvent discriminator names (underscores) as produced by pi-agent-core
    runtime.eventsToFire = [
      { type: 'message_start', message: { role: 'assistant', content: [] } },
      {
        type: 'message_update',
        message: { role: 'assistant', content: [] },
        assistantMessageEvent: { type: 'text_delta', delta: 'hello', contentIndex: 0, partial: {} },
      },
      { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] } },
      { type: 'agent_end', messages: [] },
    ];
    const events: any[] = [];
    const coord = new SamAgentCoordinator({
      transcriptPath: join(dir, 'default.jsonl'),
      repoRoot: dir,
      buildRuntime: () => runtime as any,
      emit: (e) => events.push(e),
    });
    await coord.dispatch({
      text: 'hi',
      currentGraph: { nodes: [], edges: [] },
      modelSelection: { provider: { pluginId: 'openrouter', authMethodId: 'api-key', envVar: 'OPENROUTER_API_KEY', baseUrl: '' }, modelId: 'm' },
    });
    expect(events.find((e) => e.type === 'samAgent:event' && e.event.type === 'message:start')).toBeTruthy();
    expect(events.find((e) => e.type === 'samAgent:event' && e.event.type === 'lifecycle:end')).toBeTruthy();
  });

  it('appends user + assistant turns to the transcript', async () => {
    const runtime = makeStubRuntime();
    runtime.eventsToFire = [
      { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] } },
      { type: 'agent_end', messages: [] },
    ];
    const coord = new SamAgentCoordinator({
      transcriptPath: join(dir, 'default.jsonl'),
      repoRoot: dir,
      buildRuntime: () => runtime as any,
      emit: () => {},
    });
    await coord.dispatch({
      text: 'hi',
      currentGraph: { nodes: [], edges: [] },
      modelSelection: { provider: { pluginId: 'openrouter', authMethodId: 'api-key', envVar: 'OPENROUTER_API_KEY', baseUrl: '' }, modelId: 'm' },
    });
    const transcript = await coord.readTranscript();
    expect(transcript).toHaveLength(2);
    expect(transcript[0].role).toBe('user');
    expect(transcript[1].role).toBe('assistant');
  });

  it('clear() empties the transcript', async () => {
    const runtime = makeStubRuntime();
    runtime.eventsToFire = [{ type: 'agent_end', messages: [] }];
    const coord = new SamAgentCoordinator({
      transcriptPath: join(dir, 'default.jsonl'),
      repoRoot: dir,
      buildRuntime: () => runtime as any,
      emit: () => {},
    });
    await coord.dispatch({ text: 'x', currentGraph: { nodes: [], edges: [] }, modelSelection: { provider: { pluginId: 'a', authMethodId: 'a', envVar: 'a', baseUrl: '' }, modelId: 'm' } });
    await coord.clear();
    expect(await coord.readTranscript()).toEqual([]);
  });
});
