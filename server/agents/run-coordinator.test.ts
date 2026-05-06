import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionManager } from '@mariozechner/pi-coding-agent';
import { RunCoordinator } from './run-coordinator';
import { StreamProcessor } from './stream-processor';
import { StorageEngine } from '../storage/storage-engine';
import { SessionTranscriptStore } from '../sessions/session-transcript-store';
import type { AgentRuntime } from '../runtime/agent-runtime';
import type { AgentConfig } from '../../shared/agent-config';
import type { SubAgentSessionMeta } from '../../shared/sub-agent-types';
import { HookRegistry } from '../hooks/hook-registry';
import { HOOK_NAMES, type BeforeAgentReplyContext } from '../hooks/hook-types';

vi.mock('../logger');

const RUN_DIAGNOSTIC_CUSTOM_TYPE = 'sam.run_diagnostic';

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

function mockRuntime(): AgentRuntime {
  const listeners = new Set<(event: any) => void>();
  const runtime: any = {
    prompt: vi.fn(() => Promise.resolve()),
    abort: vi.fn(),
    destroy: vi.fn(),
    subscribe: vi.fn((listener: (event: any) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    setModel: vi.fn(),
    setSystemPrompt: vi.fn(),
    getSystemPrompt: vi.fn(() => 'Test'),
    setActiveSession: vi.fn(),
    clearActiveSession: vi.fn(),
    setCurrentSessionKey: vi.fn(),
    getCurrentSessionKey: vi.fn(() => ''),
    setBroadcast: vi.fn(),
    cancelPendingHitl: vi.fn(),
    setSessionContext: vi.fn((messages: any[]) => {
      runtime.state.messages = [...messages];
    }),
    addTools: vi.fn(),
    state: {
      messages: [],
      model: { api: 'openai-completions' },
    },
    emitEvent: (event: any) => {
      for (const listener of listeners) {
        listener(event);
      }
    },
  };
  return runtime as AgentRuntime;
}

function makeConfig(storagePath: string, overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'agent-1',
    version: 3,
    name: 'Test Agent',
    description: '',
    tags: [],
    provider: 'openai',
    modelId: 'gpt-4',
    thinkingLevel: 'off',
    systemPrompt: {
      mode: 'manual',
      sections: [{ key: 'manual', label: 'Manual Prompt', content: 'Test', tokenEstimate: 1 }],
      assembled: 'Test',
      userInstructions: 'Test',
    },
    modelCapabilities: {},
    memory: null,
    tools: null,
    contextEngine: null,
    connectors: [],
    agentComm: [],
    storage: {
      label: 'Storage',
      backendType: 'filesystem',
      storagePath,
      sessionRetention: 50,
      memoryEnabled: false,
      dailyMemoryEnabled: false,
      dailyResetEnabled: true,
      dailyResetHour: 4,
      idleResetEnabled: false,
      idleResetMinutes: 60,
      parentForkMaxTokens: 100000,
      maintenanceMode: 'warn',
      pruneAfterDays: 30,
      maxEntries: 100,
      rotateBytes: 1048576,
      resetArchiveRetentionDays: 7,
      maxDiskBytes: 104857600,
      highWaterPercent: 80,
      maintenanceIntervalMinutes: 60,
    },
    vectorDatabases: [],
    crons: [],
    mcps: [],
    subAgents: [],
    exportedAt: Date.now(),
    sourceGraphId: 'agent-1',
    runTimeoutMs: 172800000,
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('RunCoordinator', () => {
  let runtime: AgentRuntime;
  let storagePath: string;
  let config: AgentConfig;
  let storage: StorageEngine;
  let coordinator: RunCoordinator;

  beforeEach(async () => {
    storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'sam-run-coordinator-'));
    config = makeConfig(storagePath);
    runtime = mockRuntime();
    storage = new StorageEngine(config.storage!, config.name);
    await storage.init();
    coordinator = new RunCoordinator('agent-1', runtime, config, storage);
  });

  afterEach(async () => {
    coordinator.destroy();
    await fs.rm(storagePath, { recursive: true, force: true });
  });

  async function getSession(subKey: string) {
    return storage.getSession(`agent:agent-1:${subKey}`);
  }

  async function readTranscript(subKey: string) {
    const session = await getSession(subKey);
    expect(session).toBeTruthy();
    const transcriptPath = storage.resolveTranscriptPath(session!);
    return SessionManager.open(transcriptPath, storage.getSessionsDir(), process.cwd()).getEntries();
  }

  function makeSubAgentMeta(overrides: Partial<SubAgentSessionMeta> = {}): SubAgentSessionMeta {
    return {
      subAgentId: 'sub-1',
      subAgentName: 'researcher',
      parentSessionKey: 'agent:agent-1:main',
      parentRunId: 'parent-run',
      status: 'running',
      sealed: false,
      appliedOverrides: {},
      modelId: 'gpt-4',
      providerPluginId: 'openai',
      startedAt: Date.now(),
      ...overrides,
    };
  }

  async function createStoredSubSession(
    sessionKey: string,
    meta: SubAgentSessionMeta = makeSubAgentMeta(),
  ) {
    const transcriptStore = new SessionTranscriptStore(storage.getSessionsDir(), process.cwd());
    const created = await transcriptStore.createSession();
    await storage.createSession({
      sessionKey,
      sessionId: created.sessionId,
      agentId: 'agent-1',
      sessionFile: path.relative(storage.getAgentDir(), created.sessionFile).replace(/\\/g, '/'),
      createdAt: new Date(meta.startedAt).toISOString(),
      updatedAt: new Date(meta.startedAt).toISOString(),
      chatType: 'direct',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      contextTokens: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalEstimatedCostUsd: 0,
      compactionCount: 0,
      subAgentMeta: meta,
    });
    return { transcriptStore, created };
  }

  function makeResolvedSubAgent() {
    return {
      name: 'researcher',
      description: 'Research helper',
      systemPrompt: 'You research one topic.',
      modelId: 'gpt-4',
      thinkingLevel: 'off',
      modelCapabilities: {},
      overridableFields: [],
      workingDirectory: '',
      recursiveSubAgentsEnabled: false,
      provider: { pluginId: 'openai', authMethodId: '', envVar: '', baseUrl: '' },
      tools: {
        profile: 'minimal',
        resolvedTools: ['exec'],
        enabledGroups: [],
        skills: [],
        plugins: [],
        subAgentSpawning: false,
        maxSubAgents: 0,
      },
      skills: [],
      mcps: [],
    } as AgentConfig['subAgents'][number];
  }

  describe('dispatch', () => {
    it('returns a runId, sessionId, and acceptedAt', async () => {
      const result = await coordinator.dispatch({ sessionKey: 'test-session', text: 'Hello' });

      expect(result.runId).toBeDefined();
      expect(typeof result.runId).toBe('string');
      expect(result.runId.length).toBeGreaterThan(0);
      expect(result.sessionId).toBeDefined();
      expect(typeof result.sessionId).toBe('string');
      expect(result.acceptedAt).toBeDefined();
      expect(typeof result.acceptedAt).toBe('number');
    });

    it('creates a new session when the subKey is first routed', async () => {
      const retentionSpy = vi.spyOn(storage, 'enforceRetention');

      await coordinator.dispatch({ sessionKey: 'new-session', text: 'Hello' });

      const session = await getSession('new-session');
      expect(session?.sessionKey).toBe('agent:agent-1:new-session');
      expect(retentionSpy).toHaveBeenCalledWith(50);
    });

    it('reuses an existing session when the same subKey is routed again', async () => {
      const first = await coordinator.dispatch({ sessionKey: 'reuse-session', text: 'First' });
      await coordinator.wait(first.runId, 5000);

      const second = await coordinator.dispatch({ sessionKey: 'reuse-session', text: 'Second' });
      await coordinator.wait(second.runId, 5000);

      expect(second.sessionId).toBe(first.sessionId);
    });

    it('reuses an existing session when the frontend passes the backend session id', async () => {
      const first = await coordinator.dispatch({ sessionKey: 'backend-managed', text: 'First' });
      await coordinator.wait(first.runId, 5000);

      const second = await coordinator.dispatch({ sessionKey: first.sessionId, text: 'Second' });
      await coordinator.wait(second.runId, 5000);

      expect(second.sessionId).toBe(first.sessionId);
    });

    it('persists the user message from the backend when a run starts', async () => {
      const result = await coordinator.dispatch({ sessionKey: 'persist-user', text: 'Hello backend' });
      await coordinator.wait(result.runId, 5000);

      const entries = await readTranscript('persist-user');
      expect(entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'message',
            message: expect.objectContaining({
              role: 'user',
              content: 'Hello backend',
            }),
          }),
        ]),
      );
    });

    it('does not inject session tools when no tools are resolved for the agent', async () => {
      const result = await coordinator.dispatch({ sessionKey: 'no-session-tools', text: 'Hello' });
      await coordinator.wait(result.runId, 5000);

      expect(runtime.addTools).not.toHaveBeenCalled();
    });

    it('injects only the resolved session tools for the agent', async () => {
      coordinator.destroy();
      config = makeConfig(storagePath, {
        tools: {
          profile: 'custom',
          resolvedTools: ['sessions_list'],
          enabledGroups: [],
          skills: [],
          plugins: [],
          subAgentSpawning: false,
          maxSubAgents: 3,
        },
      });
      runtime = mockRuntime();
      coordinator = new RunCoordinator('agent-1', runtime, config, storage);

      const result = await coordinator.dispatch({ sessionKey: 'selected-session-tools', text: 'Hello' });
      await coordinator.wait(result.runId, 5000);

      // 2 calls: injection + finally-block cleanup (addTools([]))
      expect(runtime.addTools).toHaveBeenCalledTimes(2);
      const [tools] = (runtime.addTools as any).mock.calls[0];
      expect(tools.map((tool: any) => tool.name)).toEqual(['sessions_list']);
      // Second call is the cleanup reset
      expect((runtime.addTools as any).mock.calls[1][0]).toEqual([]);
    });

    it('auto-injects sub-agent control tools when sub-agents are declared', async () => {
      coordinator.destroy();
      config = makeConfig(storagePath, {
        subAgents: [makeResolvedSubAgent()],
        tools: {
          profile: 'custom',
          resolvedTools: [],
          enabledGroups: [],
          skills: [],
          plugins: [],
          subAgentSpawning: false,
          maxSubAgents: 0,
        },
      });
      runtime = mockRuntime();
      coordinator = new RunCoordinator('agent-1', runtime, config, storage);

      const result = await coordinator.dispatch({ sessionKey: 'auto-sub-tools', text: 'Hello' });
      await coordinator.wait(result.runId, 5000);

      // 2 calls: injection + finally-block cleanup (addTools([]))
      expect(runtime.addTools).toHaveBeenCalledTimes(2);
      const [tools] = (runtime.addTools as any).mock.calls[0];
      expect(tools.map((tool: any) => tool.name).sort()).toEqual([
        'sessions_spawn',
        'sessions_yield',
        'subagents',
      ].sort());
      // Second call is the cleanup reset
      expect((runtime.addTools as any).mock.calls[1][0]).toEqual([]);
    });

    it('upserts a durable sub-session entry when sessions_spawn persists metadata', async () => {
      coordinator.destroy();
      config = makeConfig(storagePath, {
        provider: { pluginId: 'openai', authMethodId: '', envVar: '', baseUrl: '' } as any,
        subAgents: [makeResolvedSubAgent()],
        tools: {
          profile: 'custom',
          resolvedTools: [],
          enabledGroups: [],
          skills: [],
          plugins: [],
          subAgentSpawning: false,
          maxSubAgents: 0,
        },
      });
      runtime = mockRuntime();
      coordinator = new RunCoordinator('agent-1', runtime, config, storage);

      const result = await coordinator.dispatch({ sessionKey: 'spawn-parent', text: 'Hello' });
      await coordinator.wait(result.runId, 5000);
      const [tools] = (runtime.addTools as any).mock.calls[0];
      const spawnTool = tools.find((tool: any) => tool.name === 'sessions_spawn');

      const spawnResult = await spawnTool.execute('tool-1', {
        subAgent: 'researcher',
        message: 'Do the research',
        wait: false,
      });
      const parsed = JSON.parse(spawnResult.content[0].text);
      const subSession = await storage.getSession(parsed.sessionKey);

      expect(subSession).toEqual(expect.objectContaining({
        sessionKey: parsed.sessionKey,
        agentId: 'agent-1',
        chatType: 'direct',
      }));
      expect(subSession?.subAgentMeta).toEqual(expect.objectContaining({
        subAgentId: parsed.subAgentId,
        subAgentName: 'researcher',
        parentSessionKey: 'agent:agent-1:spawn-parent',
        status: 'running',
        sealed: false,
      }));
    });

    it('persists tool and assistant transcript entries and updates usage counters', async () => {
      (runtime.prompt as any).mockImplementationOnce(async () => {
        (runtime as any).emitEvent({
          type: 'tool_execution_end',
          toolCallId: 'tool-1',
          toolName: 'search',
          result: {
            content: [{ type: 'text', text: 'found 3 results' }],
          },
          isError: false,
        });
        (runtime as any).emitEvent({
          type: 'message_start',
          message: { role: 'assistant' },
        });
        (runtime as any).emitEvent({
          type: 'message_update',
          assistantMessageEvent: {
            type: 'text_delta',
            contentIndex: 0,
            delta: 'Final',
          },
        });
        (runtime as any).emitEvent({
          type: 'message_update',
          assistantMessageEvent: {
            type: 'text_end',
            contentIndex: 0,
            content: 'Final reply',
          },
        });
        (runtime as any).emitEvent({
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Final reply' }],
            api: 'openai-completions',
            provider: 'openai',
            model: 'gpt-4',
            usage: makeUsage(),
            stopReason: 'stop',
            timestamp: Date.now(),
          },
        });
      });

      const result = await coordinator.dispatch({ sessionKey: 'persist-stream', text: 'Hello' });
      await coordinator.wait(result.runId, 5000);

      const entries = await readTranscript('persist-stream');
      const roles = entries
        .filter((entry) => entry.type === 'message')
        .map((entry) => (entry as any).message.role);

      expect(roles).toEqual(['user', 'toolResult', 'assistant']);

      const status = await getSession('persist-stream');
      expect(status?.inputTokens).toBe(10);
      expect(status?.outputTokens).toBe(5);
      expect(status?.totalTokens).toBe(15);
    });

    it('persists an assistant message that contains only a tool call (no text, empty thinking)', async () => {
      // Regression: previously these messages were treated as "empty" and dropped
      // from the transcript, which left the following toolResult orphaned and
      // skipped usage accounting. Gemini-style responses with thinkingSignature
      // but empty thinking text hit this path.
      (runtime.prompt as any).mockImplementationOnce(async () => {
        (runtime as any).emitEvent({
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: '', thinkingSignature: 'reasoning' },
              {
                type: 'toolCall',
                id: 'tool_exec_1',
                name: 'exec',
                arguments: { command: 'echo hi' },
              },
            ],
            api: 'openai-completions',
            provider: 'openrouter',
            model: 'google/gemini-3.1-pro-preview',
            usage: makeUsage(),
            stopReason: 'toolUse',
            timestamp: Date.now(),
          },
        });
      });

      const result = await coordinator.dispatch({ sessionKey: 'tool-only', text: 'Do thing' });
      await coordinator.wait(result.runId, 5000);

      const entries = await readTranscript('tool-only');
      const messages = entries.filter((entry) => entry.type === 'message');
      const roles = messages.map((entry) => (entry as any).message.role);
      expect(roles).toEqual(['user', 'assistant']);

      const assistantContent = (messages[1] as any).message.content;
      expect(Array.isArray(assistantContent)).toBe(true);
      expect(assistantContent.some((b: any) => b.type === 'toolCall' && b.name === 'exec')).toBe(true);

      const status = await getSession('tool-only');
      expect(status?.inputTokens).toBe(10);
      expect(status?.outputTokens).toBe(5);
    });

    it('persists a durable diagnostic when the run fails before an assistant reply', async () => {
      (runtime.prompt as any).mockRejectedValueOnce(new Error('Model failed'));

      const result = await coordinator.dispatch({ sessionKey: 'user-only', text: 'Hello' });
      const wait = await coordinator.wait(result.runId, 5000);

      expect(wait.status).toBe('error');

      const entries = await readTranscript('user-only');
      expect(entries).toHaveLength(2);
      expect((entries[0] as any).message.role).toBe('user');
      expect(entries[1]).toEqual(
        expect.objectContaining({
          type: 'custom',
          customType: RUN_DIAGNOSTIC_CUSTOM_TYPE,
          data: expect.objectContaining({
            kind: 'run_error',
            runId: result.runId,
            sessionId: result.sessionId,
            code: 'internal',
            message: 'Model failed',
            phase: 'running',
            retriable: false,
          }),
        }),
      );
    });

    it('records the resolved system prompt on the transcript before the user message', async () => {
      (runtime as any).getResolvedSystemPrompt = vi.fn(() => ({
        mode: 'auto',
        sections: [{ key: 'identity', label: 'Identity', content: 'You are SAM.', tokenEstimate: 3 }],
        assembled: 'You are SAM.',
        userInstructions: '',
      }));

      const result = await coordinator.dispatch({ sessionKey: 'record-prompt', text: 'Hello' });
      await coordinator.wait(result.runId, 5000);

      const entries = await readTranscript('record-prompt');
      // The sam.system_prompt custom entry must come before the user message.
      const customIdx = entries.findIndex(
        (e: any) => e.type === 'custom' && e.customType === 'sam.system_prompt',
      );
      const userIdx = entries.findIndex(
        (e: any) => e.type === 'message' && e.message?.role === 'user',
      );
      expect(customIdx).toBeGreaterThanOrEqual(0);
      expect(customIdx).toBeLessThan(userIdx);
      expect((entries[customIdx] as any).data.assembled).toBe('You are SAM.');
    });

    it('dedups consecutive identical prompts across turns', async () => {
      (runtime as any).getResolvedSystemPrompt = vi.fn(() => ({
        mode: 'auto',
        sections: [{ key: 'identity', label: 'Identity', content: 'You are SAM.', tokenEstimate: 3 }],
        assembled: 'You are SAM.',
        userInstructions: '',
      }));

      const first = await coordinator.dispatch({ sessionKey: 'dedup-prompt', text: 'turn 1' });
      await coordinator.wait(first.runId, 5000);
      const second = await coordinator.dispatch({ sessionKey: 'dedup-prompt', text: 'turn 2' });
      await coordinator.wait(second.runId, 5000);

      const entries = await readTranscript('dedup-prompt');
      const customCount = entries.filter(
        (e: any) => e.type === 'custom' && e.customType === 'sam.system_prompt',
      ).length;
      expect(customCount).toBe(1);
    });

    it('records a new system prompt entry when the assembled text changes', async () => {
      let current = 'V1 prompt';
      (runtime as any).getResolvedSystemPrompt = vi.fn(() => ({
        mode: 'auto',
        sections: [{ key: 'identity', label: 'Identity', content: current, tokenEstimate: 3 }],
        assembled: current,
        userInstructions: '',
      }));

      const first = await coordinator.dispatch({ sessionKey: 'prompt-changes', text: 'turn 1' });
      await coordinator.wait(first.runId, 5000);

      current = 'V2 prompt'; // simulate a hook-driven change between turns
      const second = await coordinator.dispatch({ sessionKey: 'prompt-changes', text: 'turn 2' });
      await coordinator.wait(second.runId, 5000);

      const entries = await readTranscript('prompt-changes');
      const customs = entries.filter(
        (e: any) => e.type === 'custom' && e.customType === 'sam.system_prompt',
      );
      expect(customs).toHaveLength(2);
      expect((customs[0] as any).data.assembled).toBe('V1 prompt');
      expect((customs[1] as any).data.assembled).toBe('V2 prompt');
    });

    it('records a thinking_level_change when the configured level differs from the default baseline', async () => {
      coordinator.destroy();
      config = makeConfig(storagePath, { thinkingLevel: 'high' });
      runtime = mockRuntime();
      coordinator = new RunCoordinator('agent-1', runtime, config, storage);

      const result = await coordinator.dispatch({ sessionKey: 'thinking-change', text: 'Hello' });
      await coordinator.wait(result.runId, 5000);

      const entries = await readTranscript('thinking-change');
      const changes = entries.filter((e: any) => e.type === 'thinking_level_change');
      expect(changes).toHaveLength(1);
      expect((changes[0] as any).thinkingLevel).toBe('high');

      // Must come before the user message so the level is correctly
      // associated with the turn it influenced.
      const changeIdx = entries.findIndex((e: any) => e.type === 'thinking_level_change');
      const userIdx = entries.findIndex(
        (e: any) => e.type === 'message' && e.message?.role === 'user',
      );
      expect(changeIdx).toBeLessThan(userIdx);
    });

    it('does not re-record the thinking level when it matches the previous turn', async () => {
      coordinator.destroy();
      config = makeConfig(storagePath, { thinkingLevel: 'high' });
      runtime = mockRuntime();
      coordinator = new RunCoordinator('agent-1', runtime, config, storage);

      const first = await coordinator.dispatch({ sessionKey: 'thinking-stable', text: 'turn 1' });
      await coordinator.wait(first.runId, 5000);
      const second = await coordinator.dispatch({ sessionKey: 'thinking-stable', text: 'turn 2' });
      await coordinator.wait(second.runId, 5000);

      const entries = await readTranscript('thinking-stable');
      const changes = entries.filter((e: any) => e.type === 'thinking_level_change');
      expect(changes).toHaveLength(1);
    });

    it('records a model_change when the configured model drifts from the prior assistant message', async () => {
      coordinator.destroy();
      config = makeConfig(storagePath, {
        provider: {
          pluginId: 'openai',
          authMethodId: '',
          envVar: '',
          baseUrl: '',
        } as any,
        modelId: 'gpt-4',
      });
      runtime = mockRuntime();
      coordinator = new RunCoordinator('agent-1', runtime, config, storage);

      // First turn: streams an assistant message that will serve as the
      // implicit model baseline.
      (runtime.prompt as any).mockImplementationOnce(async () => {
        (runtime as any).emitEvent({
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'hi' }],
            api: 'openai-completions',
            provider: 'openai',
            model: 'gpt-4',
            usage: makeUsage(),
            stopReason: 'stop',
            timestamp: Date.now(),
          },
        });
      });

      const first = await coordinator.dispatch({ sessionKey: 'model-change', text: 'turn 1' });
      await coordinator.wait(first.runId, 5000);

      // Simulate the user picking a different model on the agent node.
      (coordinator as any).config.modelId = 'gpt-4o';

      const second = await coordinator.dispatch({ sessionKey: 'model-change', text: 'turn 2' });
      await coordinator.wait(second.runId, 5000);

      const entries = await readTranscript('model-change');
      const changes = entries.filter((e: any) => e.type === 'model_change');
      expect(changes).toHaveLength(1);
      expect((changes[0] as any).provider).toBe('openai');
      expect((changes[0] as any).modelId).toBe('gpt-4o');
    });

    it('does not record a model_change on the first turn when no baseline exists', async () => {
      coordinator.destroy();
      config = makeConfig(storagePath, {
        provider: {
          pluginId: 'openai',
          authMethodId: '',
          envVar: '',
          baseUrl: '',
        } as any,
        modelId: 'gpt-4',
      });
      runtime = mockRuntime();
      coordinator = new RunCoordinator('agent-1', runtime, config, storage);

      const result = await coordinator.dispatch({ sessionKey: 'first-turn-model', text: 'Hello' });
      await coordinator.wait(result.runId, 5000);

      const entries = await readTranscript('first-turn-model');
      const changes = entries.filter((e: any) => e.type === 'model_change');
      expect(changes).toHaveLength(0);
    });

    it('skips the system-prompt entry when the runtime does not expose a getter', async () => {
      // Mock runtime intentionally omits getResolvedSystemPrompt; the
      // coordinator must not throw and must not persist an entry.
      delete (runtime as any).getResolvedSystemPrompt;

      const result = await coordinator.dispatch({ sessionKey: 'no-getter', text: 'Hello' });
      await coordinator.wait(result.runId, 5000);

      const entries = await readTranscript('no-getter');
      const hasSystemPromptEntry = entries.some(
        (e: any) => e.type === 'custom' && e.customType === 'sam.system_prompt',
      );
      expect(hasSystemPromptEntry).toBe(false);
    });

    it('accepts a second dispatch on the same session and leaves it pending', async () => {
      const deferred = createDeferred<void>();
      (runtime.prompt as any).mockImplementationOnce(() => deferred.promise);

      const first = await coordinator.dispatch({ sessionKey: 'same', text: 'First' });
      const second = await coordinator.dispatch({ sessionKey: 'same', text: 'Second' });

      const secondRecord = coordinator.getRunStatus(second.runId)! as any;
      expect(secondRecord.status).toBe('pending');
      expect(secondRecord.queue).toEqual({ sessionPosition: 1, globalPosition: 1 });

      deferred.resolve();
      await coordinator.wait(first.runId, 5000);
    });

    it('injects comm tools into the runtime when commBus is set and agentComm is configured', async () => {
      coordinator.destroy();
      config = makeConfig(storagePath, {
        agentComm: [
          {
            commNodeId: 'comm-1',
            label: 'to-beta',
            targetAgentNodeId: 'agent-2',
            targetAgentName: 'beta',
            protocol: 'direct',
            maxTurns: 10,
            maxDepth: 3,
            tokenBudget: 100_000,
            rateLimitPerMinute: 30,
            messageSizeCap: 16_000,
            direction: 'bidirectional',
          },
        ],
      });
      runtime = mockRuntime();
      coordinator = new RunCoordinator('agent-1', runtime, config, storage);

      // Build a minimal comm-bus stub that exposes bus.send so we can verify
      // the tool wiring, matching the shape of makeCommBusStub in dispatchChannel tests.
      const commBusStub = {
        send: vi.fn(async () => ({ ok: true, depth: 1, turns: 1, queuedWake: false })),
        broadcast: vi.fn(async () => ({ results: [] })),
        readChannelTranscript: vi.fn(async () => []),
        appendChannelAssistantMessages: vi.fn(async () => {}),
        addUsage: vi.fn(async () => {}),
        readChannel: vi.fn(async () => ({})),
      } as any;
      coordinator.setCommBus(commBusStub);

      // Capture all tool arrays passed to addTools during the run.
      const addToolsCalls: any[][] = [];
      (runtime.addTools as any).mockImplementation((tools: any[]) => {
        addToolsCalls.push(tools);
      });

      const result = await coordinator.dispatch({ sessionKey: 'comm-tools-inject', text: 'Hello' });
      await coordinator.wait(result.runId, 5000);

      // At least one addTools call should have included agent_send with depth=0.
      const commInjection = addToolsCalls.find((tools) =>
        tools.some((t: any) => t.name === 'agent_send'),
      );
      expect(commInjection).toBeDefined();

      const sendTool = commInjection!.find((t: any) => t.name === 'agent_send');
      expect(sendTool).toBeDefined();

      // Execute the tool and confirm the bus is called with currentDepth: 0
      // (user-driven turn is at the top of any potential comm chain).
      await sendTool.execute('call-1', { to: 'beta', message: 'hello peer' });
      expect(commBusStub.send).toHaveBeenCalledTimes(1);
      expect(commBusStub.send.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          fromAgentId: 'agent-1',
          toAgentName: 'beta',
          message: 'hello peer',
          currentDepth: 0,
        }),
      );

      // The final addTools([]) call resets per-run tools in the finally block.
      const lastCall = addToolsCalls[addToolsCalls.length - 1];
      expect(lastCall).toEqual([]);
    });
  });

  describe('lifecycle events', () => {
    it('emits lifecycle:start on dispatch', async () => {
      const events: any[] = [];
      coordinator.subscribeAll((event) => events.push(event));

      const { runId } = await coordinator.dispatch({ sessionKey: 'lifecycle-test', text: 'Hello' });
      await coordinator.wait(runId, 5000);

      const startEvent = events.find((e) => e.type === 'lifecycle:start');
      expect(startEvent).toBeDefined();
      expect(startEvent.agentId).toBe('agent-1');
      expect(startEvent.runId).toBeDefined();
      expect(startEvent.sessionId).toBeDefined();
      expect(startEvent.startedAt).toBeDefined();
    });

    it('emits lifecycle:error when runtime.prompt rejects', async () => {
      (runtime.prompt as any).mockRejectedValueOnce(new Error('Model failed'));

      const events: any[] = [];
      coordinator.subscribeAll((event) => events.push(event));

      const { runId } = await coordinator.dispatch({ sessionKey: 'error-test', text: 'Hello' });
      const result = await coordinator.wait(runId, 5000);

      expect(result.status).toBe('error');
      expect(result.error?.code).toBe('internal');
      expect(result.error?.message).toBe('Model failed');

      const errorEvent = events.find((e) => e.type === 'lifecycle:error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent.error.code).toBe('internal');
    });
  });

  describe('wait', () => {
    it('resolves immediately if run is already completed', async () => {
      const { runId } = await coordinator.dispatch({ sessionKey: 'wait-done', text: 'Hello' });
      await coordinator.wait(runId, 5000);

      const result = await coordinator.wait(runId, 100);
      expect(result.status).toBe('ok');
    });

    it('returns timeout status when wait exceeds timeout', async () => {
      (runtime.prompt as any).mockImplementation(() => new Promise(() => {}));

      const { runId } = await coordinator.dispatch({ sessionKey: 'wait-timeout', text: 'Hello' });
      const result = await coordinator.wait(runId, 50);

      expect(result.status).toBe('timeout');
      expect(result.runId).toBe(runId);
    });
  });

  describe('abort', () => {
    it('aborts an active run and emits lifecycle:error', async () => {
      (runtime.prompt as any).mockImplementation(() => new Promise(() => {}));

      const { runId } = await coordinator.dispatch({ sessionKey: 'abort-test', text: 'Hello' });
      await new Promise((r) => setTimeout(r, 10));

      coordinator.abort(runId);

      const result = await coordinator.wait(runId, 1000);
      expect(result.status).toBe('error');
      expect(result.error?.code).toBe('aborted');
      expect(runtime.abort).toHaveBeenCalled();
    });
  });

  describe('sub-agent runtime bridge', () => {
    function makeChildConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
      return makeConfig(storagePath, {
        id: 'agent-1::sub::researcher',
        name: 'Test Agent/researcher',
        provider: { pluginId: 'openai', authMethodId: '', envVar: '', baseUrl: '' } as any,
        tools: {
          profile: 'custom',
          resolvedTools: ['exec', 'sessions_spawn'],
          enabledGroups: [],
          skills: [],
          plugins: [],
          subAgentSpawning: true,
          maxSubAgents: 3,
        },
        subAgents: [makeResolvedSubAgent()],
        ...overrides,
      });
    }

    it('runs a child runtime to completion and persists its transcript and terminal metadata', async () => {
      coordinator.destroy();
      const sessionKey = 'sub:agent:agent-1:main:researcher:abc';
      await createStoredSubSession(sessionKey);

      const childRuntime = mockRuntime();
      (childRuntime as any).getResolvedSystemPrompt = vi.fn(() => ({
        mode: 'manual',
        sections: [{ key: 'manual', label: 'Manual', content: 'Child prompt', tokenEstimate: 2 }],
        assembled: 'Child prompt',
        userInstructions: 'Child prompt',
      }));
      (childRuntime.prompt as any).mockImplementationOnce(async () => {
        (childRuntime as any).emitEvent({
          type: 'message_start',
          message: { role: 'assistant' },
        });
        (childRuntime as any).emitEvent({
          type: 'message_update',
          assistantMessageEvent: {
            type: 'text_delta',
            contentIndex: 0,
            delta: 'Child ',
          },
        });
        (childRuntime as any).emitEvent({
          type: 'message_update',
          assistantMessageEvent: {
            type: 'text_end',
            contentIndex: 0,
            content: 'Child reply',
          },
        });
        (childRuntime as any).emitEvent({
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Child reply' }],
            api: 'openai-completions',
            provider: 'openai',
            model: 'gpt-4',
            usage: makeUsage(),
            stopReason: 'stop',
            timestamp: Date.now(),
          },
        });
      });
      const runtimeFactory = vi.fn((_childConfig: AgentConfig) => childRuntime);
      coordinator = new RunCoordinator(
        'agent-1',
        runtime,
        config,
        storage,
        null,
        undefined,
        undefined,
        runtimeFactory,
      );
      const events: any[] = [];
      const unsubscribe = coordinator.subscribeAll((event) => events.push(event));

      try {
        const result = await coordinator.getSubAgentExecutor().dispatch({
          childRunId: 'child-run-1',
          childSessionKey: sessionKey,
          syntheticConfig: makeChildConfig(),
          message: 'Research X',
          onAbortRegister: () => {},
        });

        expect(result).toEqual({ status: 'completed', text: 'Child reply' });
        expect(runtimeFactory).toHaveBeenCalledOnce();
        expect(runtimeFactory.mock.calls[0][0].subAgents).toEqual([]);
        expect(runtimeFactory.mock.calls[0][0].tools?.resolvedTools).not.toContain('sessions_spawn');
        expect(events.some((event) => (event as any).runId === 'child-run-1')).toBe(true);

        const stored = await storage.getSession(sessionKey);
        expect(stored?.subAgentMeta).toEqual(expect.objectContaining({
          status: 'completed',
          sealed: true,
        }));
        expect(stored?.inputTokens).toBe(10);
        expect(stored?.outputTokens).toBe(5);

        const transcriptPath = storage.resolveTranscriptPath(stored!);
        const entries = SessionManager.open(transcriptPath, storage.getSessionsDir(), process.cwd()).getEntries();
        const roles = entries
          .filter((entry) => entry.type === 'message')
          .map((entry) => (entry as any).message.role);
        expect(roles).toEqual(['user', 'assistant']);
      } finally {
        unsubscribe();
      }
    });

    it('returns a structured error when no runtime factory is wired', async () => {
      const result = await coordinator.getSubAgentExecutor().dispatch({
        childRunId: 'child-run-missing-factory',
        childSessionKey: 'sub:agent:agent-1:main:researcher:missing',
        syntheticConfig: makeChildConfig(),
        message: 'Research X',
        onAbortRegister: () => {},
      });

      expect(result.status).toBe('error');
      expect(result.error).toMatch(/no runtime factory/i);
    });

    it('aborts and destroys an in-flight child runtime', async () => {
      coordinator.destroy();
      const sessionKey = 'sub:agent:agent-1:main:researcher:def';
      await createStoredSubSession(sessionKey);

      const childRuntime = mockRuntime();
      let resolvePrompt: (() => void) | undefined;
      (childRuntime.prompt as any).mockImplementationOnce(() =>
        new Promise<void>((resolve) => {
          resolvePrompt = resolve;
        }),
      );
      (childRuntime.abort as any).mockImplementation(() => {
        resolvePrompt?.();
      });
      const runtimeFactory = vi.fn(() => childRuntime);
      coordinator = new RunCoordinator(
        'agent-1',
        runtime,
        config,
        storage,
        null,
        undefined,
        undefined,
        runtimeFactory,
      );

      const dispatchP = coordinator.getSubAgentExecutor().dispatch({
        childRunId: 'child-run-abort',
        childSessionKey: sessionKey,
        syntheticConfig: makeChildConfig(),
        message: 'Research slowly',
        onAbortRegister: (fn) => coordinator.registerSubAgentAbort('child-run-abort', fn),
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      coordinator.abort('child-run-abort');
      const result = await dispatchP;

      expect(result.status).toBe('aborted');
      expect(childRuntime.abort).toHaveBeenCalled();
      expect(childRuntime.destroy).toHaveBeenCalled();
      const stored = await storage.getSession(sessionKey);
      expect(stored?.subAgentMeta).toEqual(expect.objectContaining({
        status: 'killed',
        sealed: true,
      }));
    });
  });

  describe('integration: stream processor', () => {
    it('streams a synthetic reply when before_agent_reply claims the turn', async () => {
      const hooks = new HookRegistry();
      hooks.register<BeforeAgentReplyContext>(HOOK_NAMES.BEFORE_AGENT_REPLY, {
        pluginId: 'test-plugin',
        priority: 100,
        critical: false,
        handler: (ctx) => {
          ctx.claimed = true;
          ctx.syntheticReply = 'Synthetic hello';
        },
      });

      const hookedCoordinator = new RunCoordinator(
        'agent-1',
        runtime,
        config,
        storage,
        hooks,
      );
      const processor = new StreamProcessor('agent-1', hookedCoordinator, config);
      const emitted: any[] = [];
      processor.subscribe((event) => emitted.push(event));

      try {
        const { runId } = await hookedCoordinator.dispatch({
          sessionKey: 'hook-claim',
          text: 'Hello',
        });
        const result = await hookedCoordinator.wait(runId, 5000);

        expect(result.status).toBe('ok');
        expect(result.payloads).toEqual([{ type: 'text', content: 'Synthetic hello' }]);
        expect(runtime.prompt).not.toHaveBeenCalled();
        expect(emitted.map((event) => event.type)).toEqual(
          expect.arrayContaining(['message:start', 'message:delta', 'message:end', 'lifecycle:end']),
        );
      } finally {
        processor.destroy();
        hookedCoordinator.destroy();
        hooks.destroy();
      }
    });
  });

  describe('dispatchChannel', () => {
    function makeCommBusStub(opts?: {
      transcript?: unknown[];
      channelMeta?: any;
    }) {
      const transcript = opts?.transcript ?? [
        { type: 'message', message: { role: 'user', content: 'Hi from peer' } },
      ];
      const channelMeta = opts?.channelMeta ?? {
        pair: ['agent-1', 'agent-2'],
        pairNames: ['Test Agent', 'beta'],
        ownerAgentId: 'agent-1',
        turns: 1,
        tokensIn: 0,
        tokensOut: 0,
        sealed: false,
        sealedReason: null,
        lastActivityAt: new Date().toISOString(),
      };
      const addUsage = vi.fn(async () => {});
      const readChannel = vi.fn(async () => ({ key: 'channel:agent-1:agent-2', meta: channelMeta }));
      const readChannelTranscript = vi.fn(async () => transcript);
      const appendChannelAssistantMessages = vi.fn(async () => {});
      const send = vi.fn(async () => ({ ok: true, depth: 1, turns: 1, queuedWake: false }));
      const broadcast = vi.fn(async () => ({ results: [] }));
      return { addUsage, readChannel, readChannelTranscript, appendChannelAssistantMessages, send, broadcast } as any;
    }

    function makeCommConfig(): AgentConfig {
      return makeConfig(storagePath, {
        agentComm: [
          {
            commNodeId: 'comm-1',
            label: 'to-beta',
            targetAgentNodeId: 'agent-2',
            targetAgentName: 'beta',
            protocol: 'direct',
            maxTurns: 10,
            maxDepth: 3,
            tokenBudget: 100_000,
            rateLimitPerMinute: 30,
            messageSizeCap: 16_000,
            direction: 'bidirectional',
          },
        ],
      });
    }

    it('runs the receiver against the channel transcript without re-appending the inbound user message', async () => {
      coordinator.destroy();
      config = makeCommConfig();
      runtime = mockRuntime();
      // Stand up a minimal runOnChannel + appendSystemPromptBlock surface
      // so the channel-mode path can run end-to-end against the mock.
      (runtime as any).runOnChannel = vi.fn(async () => {});
      (runtime as any).appendSystemPromptBlock = vi.fn(() => () => {});
      coordinator = new RunCoordinator('agent-1', runtime, config, storage);
      const bus = makeCommBusStub();
      coordinator.setCommBus(bus);

      await coordinator.dispatchChannel({
        channelKey: 'channel:agent-1:agent-2',
        peerName: 'beta',
        depth: 1,
        isFinalTurn: false,
      });

      // Channel-mode path was driven, not the regular prompt path.
      expect((runtime as any).runOnChannel).toHaveBeenCalledTimes(1);
      expect(runtime.prompt).not.toHaveBeenCalled();

      // The runtime's session context was set from the channel transcript;
      // the bus's transcript already contains the inbound user message,
      // so the run sees it without anyone calling prompt(text) to append it.
      expect(runtime.setSessionContext).toHaveBeenCalledTimes(1);
      const messagesPushed = (runtime.setSessionContext as any).mock.calls[0][0];
      expect(messagesPushed).toHaveLength(1);
      expect(messagesPushed[0]).toEqual({ role: 'user', content: 'Hi from peer' });
    });

    it('passes a sealed-channel notice in the system-prompt block when isFinalTurn is true', async () => {
      coordinator.destroy();
      config = makeCommConfig();
      runtime = mockRuntime();
      let receivedBlock = '';
      (runtime as any).runOnChannel = vi.fn(async () => {});
      (runtime as any).appendSystemPromptBlock = vi.fn((block: string) => {
        receivedBlock = block;
        return () => {};
      });
      coordinator = new RunCoordinator('agent-1', runtime, config, storage);
      coordinator.setCommBus(makeCommBusStub());

      await coordinator.dispatchChannel({
        channelKey: 'channel:agent-1:agent-2',
        peerName: 'beta',
        depth: 2,
        isFinalTurn: true,
      });

      expect(receivedBlock).toContain('peer channel-session with agent beta');
      expect(receivedBlock).toContain('this channel is sealed');
      expect(receivedBlock).toContain('channel_sealed');
    });

    it('reports aggregated provider usage to the bus with the receiver-edge token budget after the run', async () => {
      coordinator.destroy();
      config = makeCommConfig();
      runtime = mockRuntime();
      // Drive a synthetic message_end that carries usage so the
      // dispatchChannel subscriber accumulates totals and forwards to addUsage.
      (runtime as any).runOnChannel = vi.fn(async () => {
        (runtime as any).emitEvent({
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'reply' }],
            usage: {
              input: 25,
              output: 17,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 42,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
          },
        });
      });
      (runtime as any).appendSystemPromptBlock = vi.fn(() => () => {});
      coordinator = new RunCoordinator('agent-1', runtime, config, storage);
      const bus = makeCommBusStub();
      coordinator.setCommBus(bus);

      await coordinator.dispatchChannel({
        channelKey: 'channel:agent-1:agent-2',
        peerName: 'beta',
        depth: 1,
        isFinalTurn: false,
      });

      expect(bus.addUsage).toHaveBeenCalledTimes(1);
      const [channelKey, usage, pairBudget] = bus.addUsage.mock.calls[0];
      expect(channelKey).toBe('channel:agent-1:agent-2');
      expect(usage).toEqual({ tokensIn: 25, tokensOut: 17 });
      // pairBudget for v1 is the receiver edge's tokenBudget (100k from
      // makeCommConfig), since the bus already pair-min'd at send-time.
      expect(pairBudget).toBe(100_000);
    });

    it('injects the comm tools with the inbound depth so an outbound agent_send carries depth+1 worth of headroom', async () => {
      coordinator.destroy();
      config = makeCommConfig();
      runtime = mockRuntime();
      let injectedTools: any[] = [];
      (runtime as any).runOnChannel = vi.fn(async () => {});
      (runtime as any).appendSystemPromptBlock = vi.fn(() => () => {});
      // First addTools call is the channel-mode injection; second is the
      // post-run reset to []. Capture only the first.
      (runtime.addTools as any).mockImplementation((tools: any[]) => {
        if (injectedTools.length === 0 && tools.length > 0) {
          injectedTools = tools;
        }
      });
      coordinator = new RunCoordinator('agent-1', runtime, config, storage);
      const bus = makeCommBusStub();
      coordinator.setCommBus(bus);

      await coordinator.dispatchChannel({
        channelKey: 'channel:agent-1:agent-2',
        peerName: 'beta',
        depth: 2,
        isFinalTurn: false,
      });

      const sendTool = injectedTools.find((t: any) => t.name === 'agent_send');
      expect(sendTool).toBeDefined();
      // Drive the tool's execute path and confirm the bus was called
      // with currentDepth=2 (the inbound depth). The bus's send() is
      // responsible for incrementing to 3 before checking maxDepth.
      await sendTool.execute('call-1', { to: 'beta', message: 'next' });
      expect(bus.send).toHaveBeenCalledTimes(1);
      expect(bus.send.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          fromAgentId: 'agent-1',
          toAgentName: 'beta',
          message: 'next',
          currentDepth: 2,
        }),
      );
    });

    it('persists the assistant turn produced during runOnChannel back to the channel transcript', async () => {
      coordinator.destroy();
      config = makeCommConfig();
      runtime = mockRuntime();
      // Simulate pi-agent-core appending an assistant message to state.messages
      // during agent.continue() — this is what happens in the real runtime.
      (runtime as any).runOnChannel = vi.fn(async () => {
        runtime.state.messages.push({
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello from receiver' }],
        });
      });
      (runtime as any).appendSystemPromptBlock = vi.fn(() => () => {});
      coordinator = new RunCoordinator('agent-1', runtime, config, storage);
      const bus = makeCommBusStub();
      coordinator.setCommBus(bus);

      await coordinator.dispatchChannel({
        channelKey: 'channel:agent-1:agent-2',
        peerName: 'beta',
        depth: 1,
        isFinalTurn: false,
      });

      // The new assistant message must be flushed to the channel transcript
      // so the next dispatchChannel call sees the full conversation history.
      expect(bus.appendChannelAssistantMessages).toHaveBeenCalledTimes(1);
      const [channelKey, appended] = bus.appendChannelAssistantMessages.mock.calls[0];
      expect(channelKey).toBe('channel:agent-1:agent-2');
      expect(appended).toHaveLength(1);
      expect((appended[0] as any).role).toBe('assistant');
    });
  });
});
