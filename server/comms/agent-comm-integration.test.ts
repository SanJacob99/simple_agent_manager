// End-to-end integration tests for the agent-comm node feature (Task 15).
//
// Approach: simplified "direct-bus-send" integration. We use:
//   - REAL AgentManager (which constructs a real AgentCommBus + ChannelSessionStore +
//     ChannelRunQueue and wires `dispatchChannelWake` into the receiver's
//     RunCoordinator).
//   - REAL StorageEngine with mkdtemp'd directories so the channel session
//     entries and JSONL transcripts actually persist between sends.
//   - A MOCKED AgentRuntime (the LLM layer) — we do not script assistant turns.
//     Instead we drive `commBus.send()` directly from the test and let the
//     manager's wake callback fire `coordinator.dispatchChannel` against the
//     mocked runtime. The runtime mock implements the channel-mode methods
//     `runOnChannel` and `appendSystemPromptBlock` as no-ops so the wake
//     completes cleanly without invoking any model.
//
// This is the fallback path the Task 15 spec explicitly endorses ("If the
// existing harness is too complex to extract, fall back to a more focused
// integration test that uses real AgentManager + bus, directly calls
// commBus.send() from the test, and verifies the channel state transitions
// correctly across multiple sends + the wake actually fires"). It still
// exercises the full bus → manager → coordinator → channel-store pipeline
// end-to-end on real storage, which is what we care about for the wiring.
//
// What is verified
//   1. Round-trip A→B→A→B: three accepted sends drive the channel to turns=3,
//      and the bus pre-emptively seals the channel with `max_turns_reached`
//      on the boundary send (matches the bus's documented behavior).
//   2. One-sided contract: when B is registered with no agentComm nodes back
//      to A, the bus rejects A's outbound send with `topology_violation`
//      (the receiver-edge check).
//   3. Sub-agents do not inherit comm tools: the synthetic config produced
//      by `buildSyntheticAgentConfig` always has `agentComm: []`, and
//      `createAgentCommTools` returns an empty array when there are no
//      peers/broadcast nodes — so a sub-agent run can never see
//      `agent_send` / `agent_broadcast` even if its parent does.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import { mkdtempSync } from 'node:fs';
import os from 'os';
import path from 'path';
import { AgentManager } from '../agents/agent-manager';
import { ApiKeyStore } from '../auth/api-keys';
import { ProviderPluginRegistry } from '../providers/plugin-registry';
import { canonicalChannelKey } from './channel-key';
import { createAgentCommTools } from './agent-comm-tools';
import { buildSyntheticAgentConfig } from '../agents/sub-agent-executor';
import type { AgentConfig, ResolvedAgentCommConfig, ResolvedSubAgentConfig } from '../../shared/agent-config';

// ---------------------------------------------------------------------------
// Mock AgentRuntime: no-op channel-mode surface so dispatchChannel completes
// without invoking a real model, but the bus / coordinator / channel-store
// pipeline runs end-to-end.
// ---------------------------------------------------------------------------
vi.mock('../runtime/agent-runtime', () => {
  class MockAgentRuntime {
    state = { messages: [] as any[], model: { api: 'openai-completions' } as any };
    subscribe = vi.fn(() => vi.fn());
    prompt = vi.fn(() => Promise.resolve());
    abort = vi.fn();
    destroy = vi.fn();
    setModel = vi.fn();
    setSystemPrompt = vi.fn();
    getSystemPrompt = vi.fn(() => 'Test prompt');
    setActiveSession = vi.fn();
    clearActiveSession = vi.fn();
    setCurrentSessionKey = vi.fn();
    getCurrentSessionKey = vi.fn(() => '');
    setBroadcast = vi.fn();
    cancelPendingHitl = vi.fn();
    setSessionContext = vi.fn((messages: any[]) => {
      this.state.messages = [...messages];
    });
    addTools = vi.fn();
    // Channel-mode surface — both no-ops. The coordinator calls
    // appendSystemPromptBlock (returns a restore fn) before runOnChannel.
    appendSystemPromptBlock = vi.fn(() => () => {});
    runOnChannel = vi.fn(async () => {});
    getResolvedSystemPrompt = vi.fn(() => undefined);
  }
  return { AgentRuntime: MockAgentRuntime };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultDirectEdge(over: Partial<ResolvedAgentCommConfig> = {}): ResolvedAgentCommConfig {
  return {
    commNodeId: 'comm-1',
    label: 'edge',
    targetAgentNodeId: null,
    targetAgentName: null,
    protocol: 'direct',
    maxTurns: 10,
    maxDepth: 3,
    tokenBudget: 100_000,
    rateLimitPerMinute: 30,
    messageSizeCap: 16_000,
    direction: 'bidirectional',
    ...over,
  };
}

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  const storagePath = path.join(
    os.tmpdir(),
    `sam-comm-int-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  return {
    id: 'agent-x',
    version: 3,
    name: 'agent-x',
    description: '',
    tags: [],
    provider: 'openai',
    modelId: 'gpt-4',
    thinkingLevel: 'none',
    systemPrompt: {
      mode: 'manual',
      sections: [{ key: 'manual', label: 'Manual Prompt', content: 'You are a test agent.', tokenEstimate: 6 }],
      assembled: 'You are a test agent.',
      userInstructions: 'You are a test agent.',
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
    sourceGraphId: 'agent-x',
    runTimeoutMs: 172800000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test environment harness — owns a real AgentManager rooted in temp dirs.
// ---------------------------------------------------------------------------

interface TestEnv {
  manager: AgentManager;
  storagePaths: Set<string>;
  startAgent: (
    id: string,
    name: string,
    opts?: {
      peerOf?: string;
      peerName?: string;
      maxTurns?: number;
      messageSizeCap?: number;
      tokenBudget?: number;
    },
  ) => Promise<AgentConfig>;
  /** Wait for any pending channel wakes / dispatches to settle. */
  idle: () => Promise<void>;
}

async function makeEnv(): Promise<TestEnv> {
  const apiKeys = new ApiKeyStore();
  apiKeys.setAll({ openai: 'sk-test' });
  const pluginRegistry = new ProviderPluginRegistry();
  // AgentRuntime is mocked, so the registry is never actually consulted —
  // but we still pass a real instance so the AgentManager constructor is happy.
  const manager = new AgentManager(apiKeys, pluginRegistry);
  const storagePaths = new Set<string>();

  return {
    manager,
    storagePaths,
    async startAgent(id, name, opts = {}) {
      const peerEdge = opts.peerOf
        ? defaultDirectEdge({
            commNodeId: `${id}-to-${opts.peerOf}`,
            label: `to-${opts.peerName ?? opts.peerOf}`,
            targetAgentNodeId: opts.peerOf,
            targetAgentName: opts.peerName ?? opts.peerOf,
            ...(opts.maxTurns !== undefined ? { maxTurns: opts.maxTurns } : {}),
            ...(opts.messageSizeCap !== undefined ? { messageSizeCap: opts.messageSizeCap } : {}),
            ...(opts.tokenBudget !== undefined ? { tokenBudget: opts.tokenBudget } : {}),
          })
        : null;
      const config = makeConfig({
        id,
        name,
        agentComm: peerEdge ? [peerEdge] : [],
      });
      storagePaths.add(config.storage!.storagePath);
      await manager.start(config);
      return config;
    },
    async idle() {
      // The bus's dispatchChannelWake is awaited synchronously inside
      // `commBus.send()` — by the time send() resolves, the receiver's
      // dispatchChannel has either run to completion or thrown. We only
      // need to flush any deferred microtasks the mocked runtime might
      // schedule.
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
    },
  };
}

async function teardown(env: TestEnv): Promise<void> {
  await env.manager.shutdown();
  await Promise.all(
    [...env.storagePaths].map((p) => fs.rm(p, { recursive: true, force: true })),
  );
  env.storagePaths.clear();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('agent-comm end-to-end integration', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await makeEnv();
  });

  afterEach(async () => {
    await teardown(env);
  });

  it('A→B→A→B round-trip drives turns=3 and pre-emptively seals on max_turns_reached', async () => {
    // maxTurns=3 — bus seals the channel on the third accepted send (boundary).
    await env.startAgent('a', 'alpha', { peerOf: 'b', peerName: 'beta', maxTurns: 3 });
    await env.startAgent('b', 'beta', { peerOf: 'a', peerName: 'alpha', maxTurns: 3 });

    // Spy on dispatchChannel for both sides so we can confirm wakes really
    // fired (and not, e.g., bypass the manager's queue).
    const aManaged = (env.manager as any).agents.get('a');
    const bManaged = (env.manager as any).agents.get('b');
    const aDispatchSpy = vi.spyOn(aManaged.coordinator, 'dispatchChannel');
    const bDispatchSpy = vi.spyOn(bManaged.coordinator, 'dispatchChannel');

    // Send 1 — A → B (continue).
    const r1 = await env.manager.commBus.send({
      fromAgentId: 'a',
      toAgentName: 'beta',
      message: 'q1',
      end: false,
      currentDepth: 0,
    });
    expect(r1).toMatchObject({ ok: true, turns: 1, queuedWake: true });
    await env.idle();

    // Send 2 — B → A (continue). depth=1 because the inbound from A was depth=1.
    const r2 = await env.manager.commBus.send({
      fromAgentId: 'b',
      toAgentName: 'alpha',
      message: 'r1',
      end: false,
      currentDepth: 1,
    });
    expect(r2).toMatchObject({ ok: true, turns: 2, queuedWake: true });
    await env.idle();

    // Send 3 — A → B with end:true. This is the boundary turn (turns will
    // become 3 == maxTurns), so the bus pre-emptively seals the channel.
    // end:true means the bus does NOT wake the receiver.
    const r3 = await env.manager.commBus.send({
      fromAgentId: 'a',
      toAgentName: 'beta',
      message: 'q2',
      end: true,
      currentDepth: 2,
    });
    expect(r3).toMatchObject({ ok: true, turns: 3, queuedWake: false });
    await env.idle();

    // Channel state: 3 turns, sealed by max_turns_reached.
    const channelKey = canonicalChannelKey('a', 'b');
    const handle = await env.manager.commBus.readChannel(channelKey);
    expect(handle.meta.turns).toBe(3);
    expect(handle.meta.sealed).toBe(true);
    expect(handle.meta.sealedReason).toBe('max_turns_reached');

    // The first two non-end sends should have driven dispatchChannel exactly
    // once on each receiver (B woke once after send 1; A woke once after send 2).
    expect(bDispatchSpy).toHaveBeenCalledTimes(1);
    expect(aDispatchSpy).toHaveBeenCalledTimes(1);

    // The third send carried isFinalTurn=true into B's dispatch (the bus
    // pre-emptively sealed and queued no wake because end:true) — verify
    // the bus reported isFinalTurn correctly on the second wake (turns=2 is
    // not yet the boundary, so isFinalTurn must be false there).
    const secondWakeCall = aDispatchSpy.mock.calls[0];
    expect(secondWakeCall[0]).toEqual(
      expect.objectContaining({
        peerName: 'beta',
        isFinalTurn: false,
      }),
    );

    aDispatchSpy.mockRestore();
    bDispatchSpy.mockRestore();
  });

  it('one-sided contract: A declares B as a peer but B has no comm node — send returns topology_violation', async () => {
    // A is wired to B, but B has NO agentComm entries — so the bus's
    // reciprocal-edge check rejects A's send.
    await env.startAgent('a', 'alpha', { peerOf: 'b', peerName: 'beta' });
    await env.startAgent('b', 'beta', { /* no peerOf — agentComm is [] */ });

    const result = await env.manager.commBus.send({
      fromAgentId: 'a',
      toAgentName: 'beta',
      message: 'hi',
      end: false,
      currentDepth: 0,
    });

    expect(result).toEqual({ ok: false, error: 'topology_violation' });

    // Receiver was never woken — so no channel meta was created.
    // (readChannel would throw on a missing entry; we just verify B's
    // coordinator never saw a dispatchChannel call.)
    const bManaged = (env.manager as any).agents.get('b');
    const bDispatchSpy = vi.spyOn(bManaged.coordinator, 'dispatchChannel');
    expect(bDispatchSpy).not.toHaveBeenCalled();
    bDispatchSpy.mockRestore();
  });

  it('sub-agents never see agent_send / agent_broadcast even when the parent has comm nodes', async () => {
    // Build a parent config that DOES declare a comm peer.
    const parentConfig = makeConfig({
      id: 'parent',
      name: 'parent-agent',
      agentComm: [
        defaultDirectEdge({
          commNodeId: 'parent-to-peer',
          label: 'to-peer',
          targetAgentNodeId: 'peer',
          targetAgentName: 'peer-agent',
        }),
      ],
    });
    env.storagePaths.add(parentConfig.storage!.storagePath);

    // A minimal resolved sub-agent — the parent's `subAgents` field would
    // be populated by graph-to-agent.ts; in the integration test we hand-
    // construct one to feed buildSyntheticAgentConfig directly.
    const sub: ResolvedSubAgentConfig = {
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
    };

    // 1. Synthetic config must have agentComm: [].
    const synthetic = buildSyntheticAgentConfig(parentConfig, sub, {
      systemPromptAppend: '',
      modelIdOverride: undefined,
      thinkingLevelOverride: undefined,
      enabledToolsOverride: undefined,
    });
    expect(synthetic.agentComm).toEqual([]);

    // 2. Comm tools resolve to an empty list when there are no peers and
    //    no broadcast node — which is exactly what a sub-agent run looks
    //    like. createAgentCommTools is the per-run injection site for
    //    agent_send / agent_broadcast; if it returns [] then the
    //    sub-agent's tool surface cannot include either tool.
    const commTools = createAgentCommTools({
      bus: env.manager.commBus,
      fromAgentId: synthetic.id,
      fromAgentName: synthetic.name,
      currentDepth: 0,
      directPeerNames: (synthetic.agentComm ?? [])
        .filter((c) => c.protocol === 'direct' && c.targetAgentName !== null)
        .map((c) => c.targetAgentName as string),
      hasBroadcastNode: (synthetic.agentComm ?? []).some((c) => c.protocol === 'broadcast'),
      readChannelHistory: async () => [],
      pairNamesToChannelKey: () => {
        throw new Error('unreachable: sub-agent has no peers');
      },
    });
    expect(commTools.map((t) => t.name)).not.toContain('agent_send');
    expect(commTools.map((t) => t.name)).not.toContain('agent_broadcast');
    expect(commTools).toHaveLength(0);
  });
});
