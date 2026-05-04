import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SamAgentCoordinator } from './sam-agent-coordinator';
import type { GraphSnapshot } from '../../shared/sam-agent/workflow-patch';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'samagent-int-'));
  mkdirSync(join(dir, 'docs/concepts'), { recursive: true });
  writeFileSync(
    join(dir, 'docs/concepts/_manifest.json'),
    JSON.stringify({ concepts: { agent: { doc: 'agent-node.md' } } }),
  );
  writeFileSync(join(dir, 'docs/concepts/agent-node.md'), '# Agent Node');
  writeFileSync(join(dir, 'README.md'), '# Project');
  writeFileSync(join(dir, 'AGENTS.md'), '# Agents');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Build a stub runtime that fires a canned event sequence when prompt() is called.
 * The event names match the actual AgentRuntime API:
 *   message_start / message_update / message_end / tool_execution_start /
 *   tool_execution_end / agent_end
 *
 * For `propose_workflow_patch` tool calls the stub INVOKES the real tool's execute()
 * so the actual validator runs. The tool execution result is passed as `.result` on the
 * `tool_execution_end` event — this matches how the coordinator's onRuntimeEvent reads it:
 *   `JSON.stringify((e as any).result ?? {})`
 *
 * The coordinator's message_update handler reads `ame.delta` (not `ame.textDelta`),
 * so text deltas use the `delta` field.
 */
function makeStubRuntime(scenarios: Array<{
  text?: string;
  patchToolCall?: { toolCallId: string; args: Record<string, unknown> };
}>) {
  let i = 0;
  const listeners = new Set<(e: any) => void>();
  let injectedTools: any[] = [];
  return {
    addTools: vi.fn((tools: any[]) => { injectedTools = tools; }),
    setSessionContext: vi.fn(),
    setBroadcast: vi.fn(),
    subscribe(handler: (e: any) => void) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
    prompt: vi.fn(async function (_text: string) {
      const scenario = scenarios[i++];
      if (!scenario) {
        for (const l of listeners) l({ type: 'agent_end' });
        return;
      }
      const messageId = `msg-${i}`;
      for (const l of listeners) l({ type: 'message_start', message: { role: 'assistant', content: [] } });
      if (scenario.text) {
        for (const l of listeners) l({
          type: 'message_update',
          message: { role: 'assistant', content: [] },
          assistantMessageEvent: { type: 'text_delta', delta: scenario.text, contentIndex: 0 },
        });
      }
      if (scenario.patchToolCall) {
        const { toolCallId, args } = scenario.patchToolCall;
        const tool = injectedTools.find((t) => t.name === 'propose_workflow_patch');
        if (!tool) throw new Error('propose_workflow_patch tool not injected');
        for (const l of listeners) l({
          type: 'tool_execution_start',
          toolCallId,
          toolName: 'propose_workflow_patch',
          args,
        });
        // Execute the real tool so the validator runs.
        // The tool returns AgentToolResult: { content: [{ type: 'text', text: JSON.stringify(patchResult) }], details: null }
        // The coordinator reads (e as any).result and JSON.stringifies it, so we pass the
        // parsed inner result as `result` so that JSON.stringify(result) == the patch result JSON.
        const toolResult = await tool.execute(toolCallId, args, new AbortController().signal);
        const result = JSON.parse((toolResult as any).content[0].text);
        for (const l of listeners) l({
          type: 'tool_execution_end',
          toolCallId,
          toolName: 'propose_workflow_patch',
          result,
        });
      }
      for (const l of listeners) l({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: scenario.text ?? '' }],
        },
      });
      for (const l of listeners) l({ type: 'agent_end' });
    }),
  } as any;
}

const baseModelSelection = {
  provider: {
    pluginId: 'openrouter',
    authMethodId: 'api-key',
    envVar: 'OPENROUTER_API_KEY',
    baseUrl: '',
  },
  modelId: 'm',
};

describe('SAMAgent integration', () => {
  it('build-an-agent: produces a tool result with patchState pending and ok:true', async () => {
    const events: any[] = [];
    const runtime = makeStubRuntime([{
      text: 'Building...',
      patchToolCall: {
        toolCallId: 'tc1',
        args: {
          add_nodes: [
            { tempId: 'a', type: 'agent', data: { type: 'agent', name: 'A' } },
            {
              tempId: 'p',
              type: 'provider',
              data: {
                type: 'provider',
                pluginId: 'openrouter',
                authMethodId: 'api-key',
                envVar: 'OPENROUTER_API_KEY',
                baseUrl: '',
              },
            },
            { tempId: 's', type: 'storage', data: { type: 'storage' } },
            { tempId: 'c', type: 'contextEngine', data: { type: 'contextEngine' } },
          ],
          update_nodes: [],
          remove_nodes: [],
          add_edges: [
            { source: 'p', target: 'a' },
            { source: 's', target: 'a' },
            { source: 'c', target: 'a' },
          ],
          remove_edges: [],
          rationale: 'build agent',
        },
      },
    }]);

    const coord = new SamAgentCoordinator({
      transcriptPath: join(dir, 'tx.jsonl'),
      repoRoot: dir,
      buildRuntime: () => runtime,
      emit: (e) => events.push(e),
    });

    await coord.dispatch({
      text: 'build an agent',
      currentGraph: { nodes: [], edges: [] },
      modelSelection: baseModelSelection,
    });

    const transcript = await coord.readTranscript();
    expect(transcript).toHaveLength(2);
    expect(transcript[0].role).toBe('user');
    expect(transcript[1].role).toBe('assistant');

    const tr = transcript[1].toolResults?.find((t) => t.toolName === 'propose_workflow_patch');
    expect(tr).toBeDefined();
    expect(tr!.patchState).toBe('pending');
    expect(JSON.parse(tr!.resultJson).ok).toBe(true);

    expect(events.find((e) => e.type === 'samAgent:event' && e.event.type === 'lifecycle:end')).toBeTruthy();
  });

  it('delete-unused-storage: removing a standalone storage node validates cleanly (ok:true)', async () => {
    const events: any[] = [];
    const runtime = makeStubRuntime([{
      patchToolCall: {
        toolCallId: 'tc2',
        args: {
          add_nodes: [],
          update_nodes: [],
          remove_nodes: ['s_unused'],
          add_edges: [],
          remove_edges: [],
          rationale: 'remove unused storage',
        },
      },
    }]);

    const coord = new SamAgentCoordinator({
      transcriptPath: join(dir, 'tx.jsonl'),
      repoRoot: dir,
      buildRuntime: () => runtime,
      emit: (e) => events.push(e),
    });

    const graphWithStorage: GraphSnapshot = {
      nodes: [{ id: 's_unused', type: 'storage', data: { type: 'storage' } }],
      edges: [],
    };

    await coord.dispatch({
      text: 'remove the unused storage',
      currentGraph: graphWithStorage,
      modelSelection: baseModelSelection,
    });

    const transcript = await coord.readTranscript();
    const tr = transcript[1].toolResults?.find((t) => t.toolName === 'propose_workflow_patch');
    expect(tr).toBeDefined();
    const parsed = JSON.parse(tr!.resultJson);
    // No edges, no agents — removing a standalone storage node should validate cleanly.
    expect(parsed.ok).toBe(true);
    expect(parsed.patch.rationale).toBe('remove unused storage');
  });

  it('multi-agent: orphan subAgent (no parent reference) is rejected', async () => {
    const events: any[] = [];
    const runtime = makeStubRuntime([{
      patchToolCall: {
        toolCallId: 'tc3',
        args: {
          add_nodes: [
            { tempId: 'sa', type: 'subAgent', data: { type: 'subAgent' } },
            { tempId: 't', type: 'tools', data: { type: 'tools' } },
          ],
          update_nodes: [],
          remove_nodes: [],
          add_edges: [{ source: 't', target: 'sa' }],
          remove_edges: [],
          rationale: 'orphan sub-agent',
        },
      },
    }]);

    const coord = new SamAgentCoordinator({
      transcriptPath: join(dir, 'tx.jsonl'),
      repoRoot: dir,
      buildRuntime: () => runtime,
      emit: (e) => events.push(e),
    });

    await coord.dispatch({
      text: 'add a sub-agent',
      currentGraph: { nodes: [], edges: [] },
      modelSelection: baseModelSelection,
    });

    const transcript = await coord.readTranscript();
    const tr = transcript[1].toolResults?.find((t) => t.toolName === 'propose_workflow_patch');
    expect(tr).toBeDefined();
    const parsed = JSON.parse(tr!.resultJson);
    expect(parsed.ok).toBe(false);
    expect(parsed.errors.some((e: any) => e.code === 'subagent_not_referenced')).toBe(true);
  });
});
