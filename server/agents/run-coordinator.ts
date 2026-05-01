import { randomUUID } from 'crypto';
import type { SessionManager } from '@mariozechner/pi-coding-agent';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { AssistantMessage, ToolResultMessage, Usage, UserMessage } from '@mariozechner/pi-ai';
import type { AgentRuntime, RuntimeEvent } from '../runtime/agent-runtime';
import type { StorageEngine } from '../storage/storage-engine';
import type { AgentConfig } from '../../shared/agent-config';
import type { SessionStoreEntry } from '../../shared/storage-types';
import type { HookRegistry } from '../hooks/hook-registry';
import { log } from '../logger';
import { SessionRouter, type RouteRequest, type RouteResult } from '../sessions/session-router';
import { SessionTranscriptStore } from '../sessions/session-transcript-store';
import {
  sanitizeAssistantVisibleText,
  sanitizeAssistantContentBlocks,
} from '../../shared/text/assistant-visible-text';
import {
  HOOK_NAMES,
  type BeforeModelResolveContext,
  type BeforePromptBuildContext,
  type BeforeAgentReplyContext,
  type AgentEndContext,
  type SessionLifecycleContext,
  type MessageReceivedContext,
} from '../hooks/hook-types';
import type {
  DispatchParams,
  DispatchResult,
  WaitResult,
  RunPayload,
  RunQueueSnapshot,
  RunUsage,
  StructuredError,
  CoordinatorEvent,
  RunEventListener,
} from '../../shared/run-types';
import {
  RUN_DIAGNOSTIC_CUSTOM_TYPE,
  SUB_AGENT_RESUME_CUSTOM_TYPE,
  SUB_AGENT_SPAWN_CUSTOM_TYPE,
  type RunDiagnosticData,
  type RunErrorDiagnosticData,
  type SubAgentResumeData,
  type SubAgentResumeResult,
} from '../../shared/session-diagnostics';
import {
  contextTokensFromUsage,
  foldActualIntoBreakdown,
  TRANSCRIPT_SYSTEM_PROMPT_TYPE,
  type ContextUsage,
  type ContextUsageBreakdown,
  type TranscriptSystemPromptData,
} from '../../shared/context-usage';
import { estimateMessagesTokens } from '../../shared/token-estimator';
import { RunConcurrencyController } from './run-concurrency-controller';
import { SubAgentRegistry } from './sub-agent-registry';
import { createSessionTools, type SessionToolContext } from '../sessions/session-tools';
import type { ResumePayload, SetYieldResult } from './sub-agent-registry';
import { SESSION_TOOL_NAMES } from '../../shared/resolve-tool-names';
import {
  SubAgentExecutor,
  type ChildRunOptions,
  type ChildRunResult,
} from './sub-agent-executor';

export type RunStatus = 'pending' | 'running' | 'completed' | 'error';

export interface RunRecord {
  runId: string;
  agentId: string;
  sessionKey: string;
  sessionId: string;
  transcriptPath: string;
  status: RunStatus;
  acceptedAt: number;
  startedAt?: number;
  endedAt?: number;
  queue?: RunQueueSnapshot;
  payloads: RunPayload[];
  usage?: RunUsage;
  error?: StructuredError;
  abortController: AbortController;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
  pendingDiagnostic?: RunDiagnosticData;
  diagnosticPersisted?: boolean;
}

const RUN_RECORD_TTL_MS = 5 * 60 * 1000;
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const STREAM_IDLE_TIMEOUT_MS = 30_000; // abort if no real token within 30s of message_start
const NO_REPLY_PATTERN = /^no_reply$/i;
const SESSION_TOOL_NAME_SET = new Set<string>(SESSION_TOOL_NAMES);

interface TranscriptState {
  assistantText: string;
  assistantSuppressed: boolean;
  compactionCount: number;
  assistantPersisted: boolean;
  toolInvoked: boolean;
}

interface NormalizedUsage {
  usage: Usage;
  costTotalUsd: number;
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  // ⚡ Bolt Optimization: Use a single-pass loop to avoid intermediate array allocations
  // from chained .filter().map().join() in this high-frequency text extraction path.
  let result = '';
  for (let i = 0; i < content.length; i++) {
    const block = content[i] as any;
    if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      result += block.text;
    }
  }
  return result;
}

function hasThinkingContent(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some(
    (block) =>
      block && typeof block === 'object' &&
      (block as { type?: string }).type === 'thinking' &&
      typeof (block as { thinking?: unknown }).thinking === 'string' &&
      ((block as { thinking: string }).thinking).trim().length > 0,
  );
}

function hasToolCallContent(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some(
    (block) =>
      block && typeof block === 'object' &&
      (block as { type?: string }).type === 'toolCall',
  );
}

function readLastRecordedModel(
  entries: ReadonlyArray<unknown>,
): { provider: string; modelId: string } | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i] as {
      type?: string;
      provider?: unknown;
      modelId?: unknown;
      message?: { role?: string; provider?: unknown; model?: unknown };
    } | undefined;
    if (!entry) continue;
    if (entry.type === 'model_change'
      && typeof entry.provider === 'string'
      && typeof entry.modelId === 'string') {
      return { provider: entry.provider, modelId: entry.modelId };
    }
    if (entry.type === 'message' && entry.message?.role === 'assistant') {
      const provider = entry.message.provider;
      const modelId = entry.message.model;
      if (typeof provider === 'string' && provider && typeof modelId === 'string' && modelId) {
        return { provider, modelId };
      }
    }
  }
  return null;
}

function readLastRecordedThinkingLevel(entries: ReadonlyArray<unknown>): string | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i] as { type?: string; thinkingLevel?: unknown } | undefined;
    if (entry?.type === 'thinking_level_change' && typeof entry.thinkingLevel === 'string') {
      return entry.thinkingLevel;
    }
  }
  return null;
}

export class RunCoordinator {
  private readonly runs = new Map<string, RunRecord>();
  private readonly waiters = new Map<string, Array<(result: WaitResult) => void>>();
  private readonly runSubscribers = new Map<string, Set<RunEventListener>>();
  private readonly allSubscribers = new Set<RunEventListener>();
  private readonly cleanupTimers = new Set<ReturnType<typeof setTimeout>>();
  private readonly pendingParams = new Map<string, DispatchParams>();
  private readonly concurrency = new RunConcurrencyController();
  private readonly transcriptStore: SessionTranscriptStore | null;
  private readonly sessionRouter: SessionRouter | null;
  private readonly subAgentRegistry: SubAgentRegistry;
  private readonly subAgentExecutor: SubAgentExecutor;
  /**
   * Map of child runId -> abort handler. Populated by SessionToolContext's
   * registerSubAgentAbort wiring and consumed by `abort(runId)` so REST kill
   * and the `subagents` tool can terminate a running child.
   */
  private readonly childAborts = new Map<string, () => void>();

  /**
   * Last `preview` breakdown we saw, keyed by sessionKey. The provider
   * returns a single total for `actual`, so we reuse the non-messages
   * sections here and recompute `messages` as the remainder. This
   * keeps the per-section display stable across the `preview -> actual`
   * handoff within a single turn.
   */
  private readonly lastPreviewBreakdown = new Map<string, ContextUsageBreakdown>();

  constructor(
    private readonly agentId: string,
    private readonly runtime: AgentRuntime,
    private readonly config: AgentConfig,
    private readonly storage: StorageEngine | null,
    private readonly hooks: HookRegistry | null = null,
    sessionRouter?: SessionRouter,
    transcriptStore?: SessionTranscriptStore,
  ) {
    this.transcriptStore = transcriptStore
      ?? (storage && config.storage
        ? new SessionTranscriptStore(storage.getSessionsDir(), process.cwd())
        : null);

    this.sessionRouter = sessionRouter
      ?? (storage && config.storage && this.transcriptStore
        ? new SessionRouter(storage, this.transcriptStore, config.storage, agentId)
        : null);

    this.subAgentRegistry = new SubAgentRegistry();

    // Sub-agent executor: bridges to runChild() below, which constructs a
    // dedicated runtime per spawn. emits run-events on the same stream the
    // parent uses, tagged with the child runId so subscribers can filter.
    this.subAgentExecutor = new SubAgentExecutor({
      runChild: (o) => this.runChild(o),
      eventBus: {
        emit: (event) => {
          // Best-effort forward to the same listener set used for parent
          // events. Child events carry runId on the event itself; existing
          // subscribers filter by runId so this is safe.
          for (const listener of this.allSubscribers) {
            try { listener(event as any); } catch (err) {
              console.error('[RunCoordinator] sub-agent event listener threw:', err);
            }
          }
        },
      },
    });
  }

  async dispatch(params: DispatchParams): Promise<DispatchResult> {
    if (!this.storage || !this.sessionRouter) {
      throw new Error('Cannot dispatch: no storage configured for this agent');
    }

    const _t0 = Date.now();
    const _lap = (label: string) => log('TIMING:SERVER', `+${Date.now() - _t0}ms ${label}`);
    _lap('dispatch_received');

    const routed = await this.resolveSession(params.sessionKey);
    _lap('session_resolved');
    const runId = randomUUID();
    const acceptedAt = Date.now();

    const record: RunRecord = {
      runId,
      agentId: this.agentId,
      sessionKey: routed.sessionKey,
      sessionId: routed.sessionId,
      transcriptPath: routed.transcriptPath,
      status: 'pending',
      acceptedAt,
      payloads: [],
      abortController: new AbortController(),
      timeoutTimer: null,
    };

    this.runs.set(runId, record);
    this.pendingParams.set(runId, params);

    if (this.hooks) {
      const msgCtx: MessageReceivedContext = {
        agentId: this.agentId,
        runId,
        sessionId: routed.sessionId,
        text: params.text,
        blocked: false,
        blockReason: undefined,
      };
      await this.hooks.invoke(HOOK_NAMES.MESSAGE_RECEIVED, msgCtx);
      _lap('after_hook:message_received');

      if (msgCtx.blocked) {
        this.pendingParams.delete(runId);
        const error = {
          code: 'aborted',
          message: `Message blocked: ${msgCtx.blockReason ?? 'blocked by hook'}`,
          retriable: false,
        } satisfies StructuredError;
        record.pendingDiagnostic = this.buildRunDiagnostic(record, error);
        await this.persistDiagnosticEntry(record).catch((persistError) => {
          console.error('[RunCoordinator] failed to persist run diagnostic:', persistError);
        });
        this.finalizeRunError(record, error);
        return { runId, sessionId: routed.sessionId, acceptedAt };
      }
    }

    const { snapshot, affectedRunIds } = this.concurrency.enqueue(runId, routed.sessionId);
    record.queue = snapshot;
    this.emitQueueEntered(record);
    this.emitQueueUpdates(affectedRunIds);
    this.tryStartNextRun();

    return { runId, sessionId: routed.sessionId, acceptedAt };
  }

  async wait(runId: string, timeoutMs?: number): Promise<WaitResult> {
    const record = this.runs.get(runId);
    if (!record) {
      return {
        runId,
        status: 'error',
        phase: 'error',
        acceptedAt: 0,
        payloads: [],
        error: { code: 'internal', message: `Run ${runId} not found`, retriable: false },
      };
    }

    if (record.status === 'completed' || record.status === 'error') {
      return this.buildWaitResult(record);
    }

    const timeout = timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    return new Promise<WaitResult>((resolve) => {
      const timer = setTimeout(() => {
        const waiters = this.waiters.get(runId);
        if (waiters) {
          const index = waiters.indexOf(wrappedResolve);
          if (index !== -1) {
            waiters.splice(index, 1);
          }
        }
        resolve({
          runId,
          status: 'timeout',
          phase: record.status,
          acceptedAt: record.acceptedAt,
          startedAt: record.startedAt,
          queue: record.queue,
          payloads: [],
        });
      }, timeout);

      const wrappedResolve = (result: WaitResult) => {
        clearTimeout(timer);
        resolve(result);
      };

      if (!this.waiters.has(runId)) {
        this.waiters.set(runId, []);
      }
      this.waiters.get(runId)!.push(wrappedResolve);
    });
  }

  subscribe(runId: string, listener: RunEventListener): () => void {
    if (!this.runSubscribers.has(runId)) {
      this.runSubscribers.set(runId, new Set());
    }
    this.runSubscribers.get(runId)!.add(listener);
    return () => {
      this.runSubscribers.get(runId)?.delete(listener);
    };
  }

  subscribeAll(listener: RunEventListener): () => void {
    this.allSubscribers.add(listener);
    return () => {
      this.allSubscribers.delete(listener);
    };
  }

  /**
   * Public accessor for the sub-agent executor — used by `SessionToolContext`
   * wiring so that `sessions_spawn` can dispatch one-shot child runs without
   * touching the parent's run-concurrency queue.
   */
  getSubAgentExecutor(): SubAgentExecutor {
    return this.subAgentExecutor;
  }

  /** Public accessor for the sub-agent registry — used by REST routes. */
  getSubAgentRegistry(): SubAgentRegistry {
    return this.subAgentRegistry;
  }

  /**
   * Register an abort handler for a child runId. Called by `sessions_spawn`
   * when it kicks off a child run via the executor. Cleared by
   * `unregisterSubAgentAbort` when the child run completes.
   */
  registerSubAgentAbort(childRunId: string, fn: () => void): void {
    this.childAborts.set(childRunId, fn);
  }

  unregisterSubAgentAbort(childRunId: string): void {
    this.childAborts.delete(childRunId);
  }

  abort(runId: string): void {
    // Sub-agent runs go through the executor and don't have RunRecords. If
    // this runId matches a registered child abort, fire it.
    const childAbort = this.childAborts.get(runId);
    if (childAbort) {
      childAbort();
      this.childAborts.delete(runId);
      return;
    }

    const record = this.runs.get(runId);
    if (!record || record.status === 'completed' || record.status === 'error') {
      return;
    }

    record.abortController.abort();

    if (record.status === 'pending') {
      const result = this.concurrency.abortPending(runId);
      if (!result.removed) {
        return;
      }
      const error = {
        code: 'aborted',
        message: 'Run aborted by caller',
        retriable: false,
      } satisfies StructuredError;
      this.pendingParams.delete(runId);
      record.queue = undefined;
      record.pendingDiagnostic = this.buildRunDiagnostic(record, error);
      this.emitQueueLeft(record, 'aborted');
      this.emitQueueUpdates(result.affectedRunIds);
      void this.persistDiagnosticEntry(record).catch((persistError) => {
        console.error('[RunCoordinator] failed to persist run diagnostic:', persistError);
      });
      this.finalizeRunError(record, error);
      this.tryStartNextRun();
      return;
    }

    const error = {
      code: 'aborted',
      message: 'Run aborted by caller',
      retriable: false,
    } satisfies StructuredError;
    record.pendingDiagnostic ??= this.buildRunDiagnostic(record, error);
    this.runtime.abort();
    // Cancel any outstanding HITL prompts for this session — the agent
    // signal fires the tool's abort listener, but doing this explicitly
    // makes cancellation deterministic regardless of listener timing.
    this.runtime.cancelPendingHitl(record.sessionKey, 'aborted');
    this.concurrency.release(record.runId, record.sessionId);
    this.finalizeRunError(record, error);
    this.tryStartNextRun();
  }

  getRunStatus(runId: string): RunRecord | undefined {
    return this.runs.get(runId);
  }

  getLatestActiveRunId(): string | undefined {
    let latest: RunRecord | undefined;
    for (const record of this.runs.values()) {
      if (record.status !== 'pending' && record.status !== 'running') {
        continue;
      }
      if (!latest || record.acceptedAt > latest.acceptedAt) {
        latest = record;
      }
    }
    return latest?.runId;
  }

  /**
   * Run compaction against the stored transcript for a given session
   * outside of any active turn. Persists the compaction entry, snapshots
   * the transcript file, bumps the session's compactionCount, and
   * returns a summary of the token delta. Refuses to run if the session
   * has an active run in flight -- the transform would then race with
   * the coordinator's own compaction.
   */
  async manualCompact(sessionKey: string): Promise<{
    compacted: boolean;
    messagesBefore: number;
    messagesAfter: number;
    tokensBefore: number;
    tokensAfter: number;
  }> {
    if (!this.transcriptStore || !this.sessionRouter || !this.storage) {
      throw new Error('Cannot compact: storage is not configured for this agent');
    }

    for (const record of this.runs.values()) {
      if (record.sessionKey !== sessionKey) continue;
      if (record.status === 'pending' || record.status === 'running') {
        throw new Error(`Cannot compact: session ${sessionKey} has an active run`);
      }
    }

    const status = await this.sessionRouter.getStatus(sessionKey);
    if (!status) {
      throw new Error(`Session ${sessionKey} not found`);
    }

    const transcriptPath = this.storage.resolveTranscriptPath(status);
    const transcriptManager = this.transcriptStore.openSession(transcriptPath);
    const messagesBefore = transcriptManager.buildSessionContext().messages as AgentMessage[];
    const tokensBefore = estimateMessagesTokens(
      messagesBefore as Array<{ content?: string | unknown }>,
    );

    this.runtime.setActiveSession(transcriptManager);
    let messagesAfter: AgentMessage[];
    try {
      messagesAfter = await this.runtime.runContextCompaction(messagesBefore);
    } finally {
      this.runtime.clearActiveSession();
    }

    const tokensAfter = estimateMessagesTokens(
      messagesAfter as Array<{ content?: string | unknown }>,
    );
    const compacted = messagesAfter.length !== messagesBefore.length;

    if (compacted) {
      await this.transcriptStore.snapshot(transcriptManager);
      await this.sessionRouter.updateAfterTurn(sessionKey, {
        compactionCount: (status.compactionCount ?? 0) + 1,
      });
    }

    return {
      compacted,
      messagesBefore: messagesBefore.length,
      messagesAfter: messagesAfter.length,
      tokensBefore,
      tokensAfter,
    };
  }

  /**
   * Build the aggregated user-message text + transcript marker for a
   * yield resume, persist the marker, then dispatch a synthetic user
   * turn against the parent's session. Errors are swallowed: a
   * deleted parent session simply means the resume is dropped.
   */
  private async handleYieldResume(payload: ResumePayload): Promise<void> {
    if (!this.transcriptStore || !this.sessionRouter) return;

    const parent = await this.sessionRouter.getStatus(payload.parentSessionKey);
    if (!parent) return;

    const transcriptPath = this.storage!.resolveTranscriptPath(parent);
    const text = formatYieldResumeText(payload);
    const data: SubAgentResumeData = {
      generatedFromRunId: payload.parentRunId,
      reason: payload.reason,
      generatedAt: Date.now(),
      results: payload.results.map<SubAgentResumeResult>((r) => ({
        subAgentId: r.subAgentId,
        targetAgentId: r.targetAgentId,
        sessionKey: r.sessionKey,
        status: r.status,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        durationMs: r.durationMs,
        text: r.text,
        error: r.error,
      })),
    };

    try {
      const transcriptManager = this.transcriptStore.openSession(transcriptPath);
      transcriptManager.appendCustomEntry(SUB_AGENT_RESUME_CUSTOM_TYPE, data);
      await this.transcriptStore.snapshot(transcriptManager);
    } catch (err) {
      console.error('[RunCoordinator] failed to persist sam.sub_agent_resume entry:', err);
      // Continue and still dispatch — the marker is a UI hint, not load-bearing.
    }

    try {
      await this.dispatch({ sessionKey: payload.parentSessionKey, text });
    } catch (err) {
      console.error('[RunCoordinator] yield resume dispatch failed:', err);
    }
  }

  setRunPayloads(runId: string, payloads: RunPayload[], usage?: RunUsage): void {
    const record = this.runs.get(runId);
    if (!record) {
      return;
    }
    record.payloads = payloads;
    if (usage) {
      record.usage = usage;
    }
  }

  destroy(): void {
    // Cancel ALL outstanding yields, not just those keyed by sessions in
    // `this.runs`. Completed runs are evicted from `this.runs` after
    // RUN_RECORD_TTL_MS (5 min) but yield timers default to 10 min, so a
    // per-run loop would miss yields whose parent runs were already cleaned up.
    this.subAgentRegistry.cancelAllYields();

    // Fire any registered child-abort handlers so in-flight sub-agent runs
    // terminate cleanly on coordinator shutdown. Sub-agent runs don't have
    // RunRecords on this coordinator, so the records loop below misses them.
    for (const [, abortFn] of this.childAborts) {
      try { abortFn(); } catch (err) {
        console.error('[RunCoordinator] child abort handler threw on destroy:', err);
      }
    }
    this.childAborts.clear();

    const pendingRunIds = new Set(this.concurrency.destroy());

    for (const record of this.runs.values()) {
      if (record.status === 'completed' || record.status === 'error') {
        continue;
      }
      record.abortController.abort();
      if (record.timeoutTimer) {
        clearTimeout(record.timeoutTimer);
      }
      if (pendingRunIds.has(record.runId)) {
        this.pendingParams.delete(record.runId);
      } else if (record.status === 'running') {
        this.runtime.abort();
      }
    }

    for (const timer of this.cleanupTimers) {
      clearTimeout(timer);
    }

    this.runs.clear();
    this.waiters.clear();
    this.runSubscribers.clear();
    this.allSubscribers.clear();
    this.cleanupTimers.clear();
    this.pendingParams.clear();
  }

  private async resolveSession(sessionKeyHint: string): Promise<RouteResult> {
    const routeRequest = await this.resolveRouteRequest(sessionKeyHint);
    const routed = await this.sessionRouter!.route(routeRequest);

    // Seed the persisted context breakdown for newly created or reset
    // sessions so reopening the session shows the per-section panel
    // without waiting for the first turn. Uses a baseline breakdown
    // (systemPrompt + skills + tools, messages = 0).
    if (routed.created || routed.reset) {
      await this.seedInitialContextBreakdown(routed.sessionKey);
    }

    if (this.hooks && (routed.created || routed.reset)) {
      const sessionCtx: SessionLifecycleContext = {
        agentId: this.agentId,
        sessionId: routed.sessionId,
        sessionKey: routed.sessionKey,
        phase: 'start',
      };
      await this.hooks.invoke(HOOK_NAMES.SESSION_START, sessionCtx);
    }

    return routed;
  }

  /**
   * Persist a baseline context-usage breakdown on the session entry.
   * Uses the runtime's finalized system prompt + skills + resolved
   * tools with messages = 0. The real value is refreshed every turn
   * via `applyAssistantUsage`.
   *
   * Safe to call for already-persisted sessions: if a real turn has
   * run (inputTokens > 0), we do NOT overwrite its breakdown with the
   * naive baseline -- the turn's folded breakdown is more accurate.
   * For zero-turn sessions (freshly created or opened for the first
   * time), this seeds the panel so the UI can show it immediately.
   */
  async seedInitialContextBreakdown(sessionKey: string): Promise<void> {
    if (!this.sessionRouter) return;
    try {
      const status = await this.sessionRouter.getStatus(sessionKey);
      if (!status) return;
      if (status.inputTokens > 0) return; // real turn data takes priority

      const breakdown = this.runtime.buildInitialBreakdown();
      const contextTokens =
        breakdown.systemPrompt + breakdown.skills + breakdown.tools + breakdown.messages;
      // Persist the resolved system prompt (post runtime-injected
      // sections) so `SystemPromptPreview` shows exactly what the LLM
      // sees. Optional -- tests may mock AgentRuntime without this.
      const resolvedSystemPrompt = this.runtime.getResolvedSystemPrompt?.();
      await this.sessionRouter.updateAfterTurn(sessionKey, {
        contextTokens,
        contextBreakdown: breakdown,
        ...(resolvedSystemPrompt ? { resolvedSystemPrompt } : {}),
      });
      // Also emit the snapshot so any already-open client sees the
      // baseline without refetching the session entry.
      this.emitContextUsage(sessionKey, undefined, contextTokens, 'persisted', undefined, breakdown);
    } catch (err) {
      log('RunCoordinator', `seedInitialContextBreakdown failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private tryStartNextRun(): void {
    const decision = this.concurrency.drain();
    if (!decision) {
      return;
    }

    const record = this.runs.get(decision.runId);
    const params = this.pendingParams.get(decision.runId);
    if (!record || !params) {
      return;
    }

    const { affectedRunIds } = this.concurrency.start(decision.runId, decision.sessionId);
    this.pendingParams.delete(decision.runId);
    record.queue = undefined;
    this.emitQueueLeft(record, 'started');
    this.emitQueueUpdates(affectedRunIds);
    void this.executeRun(record, params);
  }

  /**
   * Bridge implementation passed to `SubAgentExecutor`. For each one-shot
   * sub-agent spawn, build the per-spawn runtime, send the message, await
   * completion, and return the final assistant text.
   *
   * **Status: SCAFFOLDED.** The full integration with `AgentRuntime` is
   * deferred to a follow-up. Today the parent's runtime is constructed once
   * by `AgentManager.start()` and pinned to the parent's `AgentConfig`; a
   * sub-agent run needs a *separate* runtime instance configured with the
   * sub's synthetic `AgentConfig`. That construction lives in `AgentManager`,
   * not in `RunCoordinator`, so threading the construction here cleanly
   * requires either:
   *   1. exposing a `buildRuntimeFromConfig(config)` factory from the
   *      `AgentManager`, or
   *   2. having `RunCoordinator` accept an optional runtime-factory in its
   *      constructor and using it for sub-agent runs.
   *
   * Both are tractable but out of scope for the backend-foundation slice.
   * For now `runChild` returns a structured error so callers (the rewritten
   * `sessions_spawn` in Task 14) can surface "not yet integrated" upstream
   * rather than silently producing empty results. The abort plumbing,
   * SessionToolContext extensions, and event-emission tagging that depend
   * on this method's *signature* are fully in place; only the runtime
   * dispatch itself is stubbed.
   *
   * Once the runtime factory lands, this method:
   *   - resolves the sub-session via `sessionRouter.routeBySessionKey`
   *   - opens the transcript via `transcriptStore.openSession`
   *   - constructs an `AgentRuntime` from `opts.syntheticConfig`
   *   - calls `runtime.send(...)` and awaits the assistant message
   *   - persists the message via the transcript store
   *   - returns `{ status: 'completed', text }`
   *
   * Abort is honored throughout: callers register an abort handler on
   * `opts.onAbort`, and the executor calls it when `coordinator.abort` fires
   * for the child runId.
   */
  private async runChild(opts: ChildRunOptions): Promise<ChildRunResult> {
    // Wire the abort plumbing immediately so callers can request abort even
    // while the runtime construction is still stubbed.
    const abortController = new AbortController();
    opts.onAbort = () => abortController.abort();

    if (abortController.signal.aborted) {
      return { status: 'aborted' };
    }

    return {
      status: 'error',
      error:
        'Sub-agent runtime dispatch is not yet integrated with AgentManager\'s ' +
        'runtime factory; child runs cannot execute. The executor surface, ' +
        'abort plumbing, and SessionToolContext wiring are in place — only ' +
        'the runtime construction is stubbed. See run-coordinator.ts:runChild ' +
        'for the integration plan.',
    };
  }

  private async executeRun(record: RunRecord, params: DispatchParams): Promise<void> {
    if (!this.transcriptStore) {
      throw new Error('Cannot execute run without transcript storage');
    }

    const _t0 = Date.now();
    const _lap = (label: string) => log('TIMING:SERVER', `+${Date.now() - _t0}ms ${label} [runId=${record.runId.slice(0, 8)}]`);
    _lap('execute_run_start');

    record.status = 'running';
    record.startedAt = Date.now();

    let promptText = params.text;
    let transcriptManager = this.transcriptStore.openSession(record.transcriptPath);
    const transcriptState: TranscriptState = {
      assistantText: '',
      assistantSuppressed: false,
      compactionCount: 0,
      assistantPersisted: false,
      toolInvoked: false,
    };
    let transcriptWrites = Promise.resolve();
    let transcriptFinalized = false;
    const queueTranscriptWrite = (task: () => Promise<void>) => {
      transcriptWrites = transcriptWrites
        .then(task)
        .catch((error) => {
          console.error('[RunCoordinator] transcript persistence failed:', error);
        });
    };
    const finalizeTranscript = async () => {
      if (transcriptFinalized) {
        return;
      }
      transcriptFinalized = true;
      await transcriptWrites;
      this.appendPendingDiagnostic(record, transcriptManager);
      transcriptManager = await this.finishTranscript(record, transcriptManager, transcriptState);
      record.transcriptPath = transcriptManager.getSessionFile() ?? record.transcriptPath;
    };

    try {
      this.runtime.setSessionContext(
        transcriptManager.buildSessionContext().messages as AgentMessage[],
      );
      this.runtime.setActiveSession(transcriptManager);
      this.runtime.setCurrentSessionKey(record.sessionKey);

      const enabledSessionToolNames = this.config.tools?.resolvedTools.filter((toolName) =>
        SESSION_TOOL_NAME_SET.has(toolName),
      ) ?? [];

      // Inject session tools only when explicitly resolved from the tool node.
      if (
        this.storage
        && this.sessionRouter
        && this.transcriptStore
        && enabledSessionToolNames.length > 0
      ) {
        const sessionToolCtx: SessionToolContext = {
          callerSessionKey: record.sessionKey,
          callerAgentId: this.agentId,
          callerRunId: record.runId,
          sessionRouter: this.sessionRouter,
          storageEngine: this.storage,
          transcriptStore: this.transcriptStore,
          coordinator: this,
          subAgentRegistry: this.subAgentRegistry,
          coordinatorLookup: () => null, // Cross-agent lookup wired at server level later
          subAgentSpawning: this.config.tools?.subAgentSpawning ?? false,
          enabledToolNames: enabledSessionToolNames,
          resolveYield: (parentSessionKey, opts): SetYieldResult => {
            const onResolve = (payload: ResumePayload) => {
              this.handleYieldResume(payload).catch((err) => {
                console.error('[RunCoordinator] yield resume failed:', err);
              });
            };
            return this.subAgentRegistry.setYieldPending(parentSessionKey, opts, onResolve);
          },
          subAgentExecutor: this.subAgentExecutor,
          registerSubAgentAbort: (id, fn) => this.registerSubAgentAbort(id, fn),
          unregisterSubAgentAbort: (id) => this.unregisterSubAgentAbort(id),
          parentAgentConfig: this.config,
          parentSubAgents: this.config.subAgents,
          persistSubAgentSpawn: async (data) => {
            if (!this.transcriptStore) return;
            transcriptManager.appendCustomEntry(SUB_AGENT_SPAWN_CUSTOM_TYPE, data);
            await this.transcriptStore.snapshot(transcriptManager);
          },
          persistSubAgentMeta: async (sessionKey, meta) => {
            if (!this.storage) return;
            await this.storage.updateSession(sessionKey, { subAgentMeta: meta });
          },
          abortRun: (runId) => this.abort(runId),
        };
        const sessionTools = createSessionTools(sessionToolCtx);
        if (sessionTools.length > 0) {
          this.runtime.addTools(sessionTools);
        }
      }

      await this.persistUserMessage(record, params, transcriptManager);
      _lap('after_persist_user_message');

      if (this.hooks) {
        const modelCtx: BeforeModelResolveContext = {
          agentId: this.agentId,
          runId: record.runId,
          sessionId: record.sessionId,
          config: this.config,
          overrides: {},
        };

        await this.hooks.invoke(HOOK_NAMES.BEFORE_MODEL_RESOLVE, modelCtx);
        _lap('after_hook:before_model_resolve');

        if (modelCtx.overrides.provider || modelCtx.overrides.modelId) {
          const provider = modelCtx.overrides.provider ?? this.config.provider.pluginId;
          const modelId = modelCtx.overrides.modelId ?? this.config.modelId;
          this.runtime.setModel(provider, modelId);
        }
      }

      if (this.hooks) {
        const promptCtx: BeforePromptBuildContext = {
          agentId: this.agentId,
          runId: record.runId,
          sessionId: record.sessionId,
          config: this.config,
          messages: this.runtime.state.messages,
          overrides: {},
        };

        await this.hooks.invoke(HOOK_NAMES.BEFORE_PROMPT_BUILD, promptCtx);
        _lap('after_hook:before_prompt_build');

        if (promptCtx.overrides.systemPrompt) {
          this.runtime.setSystemPrompt(promptCtx.overrides.systemPrompt);
        } else if (promptCtx.overrides.prependSystemContext || promptCtx.overrides.appendSystemContext) {
          let currentPrompt = this.runtime.getSystemPrompt();

          if (promptCtx.overrides.prependSystemContext) {
            currentPrompt = `${promptCtx.overrides.prependSystemContext}\n\n${currentPrompt}`;
          }
          if (promptCtx.overrides.appendSystemContext) {
            currentPrompt = `${currentPrompt}\n\n${promptCtx.overrides.appendSystemContext}`;
          }

          this.runtime.setSystemPrompt(currentPrompt);
        }

        if (promptCtx.overrides.prependContext) {
          promptText = `${promptCtx.overrides.prependContext}\n\n${promptText}`;
        }
      }

      if (this.hooks) {
        const replyCtx: BeforeAgentReplyContext = {
          agentId: this.agentId,
          runId: record.runId,
          sessionId: record.sessionId,
          messages: this.runtime.state.messages,
          claimed: false,
          syntheticReply: undefined,
          silent: false,
        };

        await this.hooks.invoke(HOOK_NAMES.BEFORE_AGENT_REPLY, replyCtx);
        _lap('after_hook:before_agent_reply');

        if (replyCtx.claimed) {
          if (replyCtx.silent) {
            record.payloads = [];
          } else if (replyCtx.syntheticReply) {
            record.payloads = [{ type: 'text', content: replyCtx.syntheticReply }];
          }

          this.emitForRun(record.runId, {
            type: 'lifecycle:start',
            runId: record.runId,
            agentId: this.agentId,
            sessionId: record.sessionId,
            startedAt: record.startedAt,
          });

          if (!replyCtx.silent && replyCtx.syntheticReply) {
            const assistantMessage = this.buildAssistantMessage(
              {
                role: 'assistant',
                content: [{ type: 'text', text: replyCtx.syntheticReply }],
                provider: this.config.provider.pluginId,
                model: this.config.modelId,
                stopReason: 'stop',
                timestamp: Date.now(),
              },
              replyCtx.syntheticReply,
            );
            transcriptManager.appendMessage(assistantMessage);
            await this.applyAssistantUsage(record.sessionKey, assistantMessage);
            this.emitSyntheticAssistantReply(record, replyCtx.syntheticReply);
          }

          await finalizeTranscript();
          this.concurrency.release(record.runId, record.sessionId);
          this.finalizeRunSuccess(record);
          this.tryStartNextRun();
          return;
        }
      }
    } catch (error) {
      if (record.status === 'running') {
        record.pendingDiagnostic ??= this.buildRunDiagnostic(record, classifyError(error));
        await finalizeTranscript();
        this.concurrency.release(record.runId, record.sessionId);
        this.finalizeRunError(record, classifyError(error));
        this.tryStartNextRun();
      }
      return;
    }

    this.emitForRun(record.runId, {
      type: 'lifecycle:start',
      runId: record.runId,
      agentId: this.agentId,
      sessionId: record.sessionId,
      startedAt: record.startedAt,
    });

    const timeoutMs = params.timeoutMs ?? this.config.runTimeoutMs;
    record.timeoutTimer = setTimeout(() => {
      if (record.status !== 'running') {
        return;
      }
      record.pendingDiagnostic ??= this.buildRunDiagnostic(record, {
        code: 'timeout',
        message: `Run timed out after ${timeoutMs}ms`,
        retriable: false,
      });
      this.runtime.abort();
      this.concurrency.release(record.runId, record.sessionId);
      void finalizeTranscript().finally(() => {
        this.finalizeRunError(record, {
          code: 'timeout',
          message: `Run timed out after ${timeoutMs}ms`,
          retriable: false,
        });
        this.tryStartNextRun();
      });
    }, timeoutMs);

    let _apiCallCount = 0;
    let _firstTextDeltaLogged = false;
    let _firstThinkingDeltaLogged = false;
    let _thinkingChars = 0;
    let _textChars = 0;
    const _assistantEventTypes = new Set<string>();
    const logStreamSummary = (reason: 'message_end' | 'run_end') => {
      log(
        'stream',
        `[${this.agentId}] ${reason} pass=${_apiCallCount} ` +
          `model=${this.config.modelId} ` +
          `thinking_chars=${_thinkingChars} text_chars=${_textChars} ` +
          `events=[${[..._assistantEventTypes].join(',')}]`,
      );
    };

    // Streaming idle timeout: abort if no real token (thinking_delta, text_delta,
    // toolcall_delta) arrives within STREAM_IDLE_TIMEOUT_MS of message_start.
    // This catches OpenRouter's `: OPENROUTER PROCESSING` keep-alive stalls
    // where the HTTP stream stays open but no model output is produced.
    let _streamIdleTimer: ReturnType<typeof setTimeout> | null = null;
    const clearStreamIdleTimer = () => {
      if (_streamIdleTimer) {
        clearTimeout(_streamIdleTimer);
        _streamIdleTimer = null;
      }
    };
    const resetStreamIdleTimer = () => {
      clearStreamIdleTimer();
      _streamIdleTimer = setTimeout(() => {
        if (record.status !== 'running') return;
        log(
          'stream',
          `[${this.agentId}] stream idle timeout after ${STREAM_IDLE_TIMEOUT_MS}ms ` +
            `pass=${_apiCallCount} — aborting`,
        );
        this.runtime.abort();
      }, STREAM_IDLE_TIMEOUT_MS);
    };

    const unsubscribe = this.runtime.subscribe((event: RuntimeEvent) => {
      // Predictive context-usage: emit as a first-class coordinator
      // event so the UI updates before the provider responds. Does not
      // touch the transcript and does not flow through the stream
      // transforms.
      if ('type' in event && event.type === 'context_usage_preview') {
        const ev = event as {
          estimatedTokens: number;
          contextWindow: number;
          breakdown: ContextUsageBreakdown;
        };
        this.lastPreviewBreakdown.set(record.sessionKey, ev.breakdown);
        this.emitContextUsage(
          record.sessionKey,
          undefined,
          ev.estimatedTokens,
          'preview',
          record.runId,
          ev.breakdown,
        );
        return;
      }

      if ('type' in event) {
        if (event.type === 'message_start' && (event as any).message?.role === 'assistant') {
          _apiCallCount++;
          _firstTextDeltaLogged = false;
          _firstThinkingDeltaLogged = false;
          _thinkingChars = 0;
          _textChars = 0;
          _assistantEventTypes.clear();

          let passInfo = `pass=${_apiCallCount}`;
          if (_apiCallCount === 2) {
            passInfo += `, fallback_or_retry`;
          } else if (_apiCallCount > 2) {
            passInfo += `, tool_retry`;
          }
          _lap(`api:message_start [${passInfo}]`);
          log(
            'stream',
            `[${this.agentId}] message_start ${passInfo} model=${this.config.modelId} ` +
              `thinkingLevel=${this.config.thinkingLevel ?? 'unset'} ` +
              `showReasoning=${this.config.showReasoning ?? false}`,
          );
          resetStreamIdleTimer();
        }
        else if (event.type === 'message_update') {
          const assistantEvent = (event as any).assistantMessageEvent;
          if (assistantEvent?.type) {
            _assistantEventTypes.add(assistantEvent.type);
          }
          // Any real content delta resets the idle timer
          if (assistantEvent?.type === 'text_delta' || assistantEvent?.type === 'thinking_delta' || assistantEvent?.type === 'toolcall_delta') {
            resetStreamIdleTimer();
          }

          if (assistantEvent?.type === 'text_delta') {
            _textChars += (assistantEvent.delta ?? '').length;
            if (!_firstTextDeltaLogged) {
              _lap(`api:first_text_delta [pass=${_apiCallCount}]`);
              _firstTextDeltaLogged = true;
            }
          }
          else if (assistantEvent?.type === 'thinking_delta') {
            _thinkingChars += (assistantEvent.delta ?? '').length;
            if (!_firstThinkingDeltaLogged) {
              _lap(`api:first_thinking_delta [pass=${_apiCallCount}]`);
              log(
                'stream',
                `[${this.agentId}] first_thinking_delta pass=${_apiCallCount} ` +
                  `model=${this.config.modelId}`,
              );
              _firstThinkingDeltaLogged = true;
            }
          }
        }
        else if (event.type === 'message_end' && (event as any).message?.role === 'assistant') {
          clearStreamIdleTimer();
          logStreamSummary('message_end');
        }
      }
      queueTranscriptWrite(() => this.persistRuntimeEvent(record, transcriptManager, event, transcriptState));
      this.emitForRun(record.runId, { type: 'stream', runId: record.runId, event });
    });

    try {
      _lap('api_call_start');
      await this.runtime.prompt(promptText, params.attachments);
      _lap('api_call_complete');
      if (record.status !== 'running') {
        return;
      }
      await transcriptWrites;
      if (!transcriptState.assistantPersisted && !transcriptState.toolInvoked) {
        record.pendingDiagnostic ??= {
          kind: 'empty_reply',
          runId: record.runId,
          sessionId: record.sessionId,
          provider: this.config.provider.pluginId,
          modelId: this.config.modelId,
          apiError: this.runtime.lastApiError ?? undefined,
          createdAt: Date.now(),
        };
      }
      await finalizeTranscript();
      this.concurrency.release(record.runId, record.sessionId);
      this.finalizeRunSuccess(record);
      this.tryStartNextRun();
    } catch (error) {
      if (record.status !== 'running') {
        return;
      }
      record.pendingDiagnostic ??= this.buildRunDiagnostic(record, classifyError(error));
      await finalizeTranscript();
      this.concurrency.release(record.runId, record.sessionId);
      this.finalizeRunError(record, classifyError(error));
      this.tryStartNextRun();
    } finally {
      clearStreamIdleTimer();
      unsubscribe();
      await finalizeTranscript();
      this.runtime.clearActiveSession();
    }
  }

  private async persistUserMessage(
    record: RunRecord,
    params: DispatchParams,
    transcriptManager: SessionManager,
  ): Promise<void> {
    const message = this.buildUserMessage(params);
    if (!message) {
      return;
    }

    // Record any drift in the agent's configured model/provider/thinking
    // level since the last entry, so per-turn settings are auditable in
    // the transcript when the user edits the agent between runs.
    this.persistConfigChanges(transcriptManager);

    // Record the exact system prompt pi-ai will send, right before the
    // user turn that triggers the run. Uses pi-core's CustomEntry so
    // it's a first-class transcript record but does NOT participate in
    // LLM context on subsequent turns. Skipped when unchanged from the
    // most recent recorded prompt to keep the transcript compact.
    this.persistResolvedSystemPrompt(transcriptManager);

    transcriptManager.appendMessage(message);
    // Fire-and-forget: touchSession is a metadata timestamp update (read+write
    // of session JSON). It does not need to complete before the API call starts.
    this.touchSession(record.sessionKey, message.timestamp).catch((err) => {
      console.error('[RunCoordinator] touchSession failed:', err);
    });
  }

  private async persistRuntimeEvent(
    record: RunRecord,
    transcriptManager: SessionManager,
    event: RuntimeEvent,
    transcriptState: TranscriptState,
  ): Promise<void> {
    const raw = event as any;

    if (raw.type === 'message_start' && raw.message?.role === 'assistant') {
      transcriptState.assistantText = '';
      transcriptState.assistantSuppressed = false;
      return;
    }

    if (raw.type === 'message_update') {
      const assistantEvent = raw.assistantMessageEvent;
      if (!assistantEvent) {
        return;
      }

      if (assistantEvent.type === 'text_delta') {
        transcriptState.assistantText += assistantEvent.delta ?? '';
        return;
      }

      if (assistantEvent.type === 'text_end') {
        const rawContent = typeof assistantEvent.content === 'string'
          ? assistantEvent.content
          : transcriptState.assistantText;
        const content = sanitizeAssistantVisibleText(rawContent);
        transcriptState.assistantText = content;
        transcriptState.assistantSuppressed = NO_REPLY_PATTERN.test(content.trim());
      }
      return;
    }

    if (raw.type === 'message_end' && raw.message?.role === 'assistant') {
      const fallbackText =
        transcriptState.assistantText || extractTextContent(raw.message.content);
      const thinkingOnly = !fallbackText && hasThinkingContent(raw.message.content);
      const hasToolCalls = hasToolCallContent(raw.message.content);

      if (
        (!fallbackText && !thinkingOnly && !hasToolCalls)
        || transcriptState.assistantSuppressed
        || (!thinkingOnly && !hasToolCalls && NO_REPLY_PATTERN.test((fallbackText ?? '').trim()))
      ) {
        transcriptState.assistantText = '';
        transcriptState.assistantSuppressed = false;
        return;
      }

      const assistantMessage = this.buildAssistantMessage(raw.message, fallbackText || '');
      transcriptManager.appendMessage(assistantMessage);
      await this.applyAssistantUsage(record.sessionKey, assistantMessage);
      transcriptState.assistantPersisted = true;

      transcriptState.assistantText = '';
      transcriptState.assistantSuppressed = false;
      return;
    }

    if (raw.type === 'tool_execution_end') {
      transcriptState.toolInvoked = true;
      const toolMessage: ToolResultMessage = {
        role: 'toolResult',
        toolCallId: raw.toolCallId ?? randomUUID(),
        toolName: raw.toolName ?? 'tool',
        content: raw.result?.content ?? [{ type: 'text', text: extractTextContent(raw.result?.content) }],
        details: raw.result?.details,
        isError: Boolean(raw.isError),
        timestamp: Date.now(),
      };
      transcriptManager.appendMessage(toolMessage);
      await this.touchSession(record.sessionKey, toolMessage.timestamp);
      return;
    }

    if (raw.type === 'memory_compaction') {
      transcriptState.compactionCount += 1;
      return;
    }
  }

  private async resolveRouteRequest(sessionKeyHint: string): Promise<RouteRequest> {
    const existingById = this.storage
      ? await this.storage.getSessionById(sessionKeyHint)
      : null;

    if (existingById?.agentId === this.agentId) {
      return {
        agentId: this.agentId,
        subKey: this.extractSubKey(existingById.sessionKey),
      };
    }

    if (sessionKeyHint.startsWith(`agent:${this.agentId}:`)) {
      return {
        agentId: this.agentId,
        subKey: this.extractSubKey(sessionKeyHint),
      };
    }

    return {
      agentId: this.agentId,
      subKey: sessionKeyHint || 'main',
    };
  }

  private extractSubKey(sessionKey: string): string {
    const prefix = `agent:${this.agentId}:`;
    return sessionKey.startsWith(prefix)
      ? sessionKey.slice(prefix.length) || 'main'
      : sessionKey || 'main';
  }

  private buildUserMessage(params: DispatchParams): UserMessage | null {
    const text = params.text.trim();
    const attachments = params.attachments ?? [];

    if (!text && attachments.length === 0) {
      return null;
    }

    if (attachments.length === 0) {
      return {
        role: 'user',
        content: text,
        timestamp: Date.now(),
      };
    }

    const content = [];
    if (text) {
      content.push({ type: 'text' as const, text });
    }
    for (const attachment of attachments) {
      content.push({
        type: 'image' as const,
        data: attachment.data,
        mimeType: attachment.mimeType,
      });
    }

    return {
      role: 'user',
      content,
      timestamp: Date.now(),
    };
  }

  private buildAssistantMessage(rawMessage: any, fallbackText: string): AssistantMessage {
    const normalized = this.normalizeUsage(rawMessage?.usage);
    const rawContent = Array.isArray(rawMessage?.content) && rawMessage.content.length > 0
      ? rawMessage.content
      : [{ type: 'text', text: fallbackText }];
    const content = sanitizeAssistantContentBlocks(rawContent);
    return {
      role: 'assistant',
      content,
      api: rawMessage?.api ?? (this.runtime.state.model as any)?.api ?? 'openai-completions',
      provider: rawMessage?.provider ?? this.config.provider.pluginId,
      model: rawMessage?.model ?? this.config.modelId,
      responseId: rawMessage?.responseId,
      usage: normalized.usage,
      stopReason: rawMessage?.stopReason ?? 'stop',
      errorMessage: rawMessage?.errorMessage,
      timestamp: rawMessage?.timestamp ?? Date.now(),
    };
  }

  private normalizeUsage(rawUsage: any): NormalizedUsage {
    const usage: Usage = {
      input: rawUsage?.input ?? 0,
      output: rawUsage?.output ?? 0,
      cacheRead: rawUsage?.cacheRead ?? 0,
      cacheWrite: rawUsage?.cacheWrite ?? 0,
      totalTokens: rawUsage?.totalTokens ?? 0,
      cost: {
        input: rawUsage?.cost?.input ?? 0,
        output: rawUsage?.cost?.output ?? 0,
        cacheRead: rawUsage?.cost?.cacheRead ?? 0,
        cacheWrite: rawUsage?.cost?.cacheWrite ?? 0,
        total: rawUsage?.cost?.total ?? 0,
      },
    };

    return {
      usage,
      costTotalUsd: usage.cost.total,
    };
  }

  /**
   * Append `model_change` / `thinking_level_change` entries when the
   * agent's currently configured provider/modelId/thinkingLevel differ
   * from the most recently recorded values in the transcript. Lets the
   * user edit the agent between runs (model swap, thinking-level bump)
   * and have those changes show up in the session log alongside the
   * messages they affected.
   *
   * Baselines:
   * - Model baseline = most recent `model_change` entry, or the
   *   provider/model on the most recent assistant message (matches how
   *   pi-coding-agent's `buildSessionContext` resolves the active
   *   model). On a fresh session there is no baseline yet -- the first
   *   assistant message will record the model implicitly, so we skip.
   * - Thinking-level baseline = most recent `thinking_level_change`
   *   entry, defaulting to `'off'` (pi's default) when none exist. We
   *   record on the first turn too if the configured level differs
   *   from `'off'`, so replays know what level was in effect.
   */
  private persistConfigChanges(transcriptManager: SessionManager): void {
    const entries = transcriptManager.getEntries();

    const provider = this.config.provider?.pluginId;
    const modelId = this.config.modelId;
    if (typeof provider === 'string' && provider && typeof modelId === 'string' && modelId) {
      const lastModel = readLastRecordedModel(entries);
      if (lastModel && (lastModel.provider !== provider || lastModel.modelId !== modelId)) {
        transcriptManager.appendModelChange(provider, modelId);
      }
    }

    const thinkingLevel = this.config.thinkingLevel;
    if (typeof thinkingLevel === 'string' && thinkingLevel) {
      const baseline = readLastRecordedThinkingLevel(entries) ?? 'off';
      if (baseline !== thinkingLevel) {
        transcriptManager.appendThinkingLevelChange(thinkingLevel);
      }
    }
  }

  /**
   * Append a `sam.system_prompt` custom entry to the transcript
   * carrying the resolved system prompt about to be sent. Skipped if
   * the runtime doesn't expose the getter (test mocks) or if the
   * prompt is identical (by `assembled` text) to the most recent
   * recorded prompt. This keeps the transcript auditable without
   * bloating it on multi-turn chats with a stable prompt.
   */
  private persistResolvedSystemPrompt(transcriptManager: SessionManager): void {
    const resolved = this.runtime.getResolvedSystemPrompt?.();
    if (!resolved) return;

    const entries = transcriptManager.getEntries();
    let lastAssembled: string | undefined;
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i] as unknown as {
        type?: string;
        customType?: string;
        data?: { assembled?: unknown };
      };
      if (entry?.type === 'custom' && entry.customType === TRANSCRIPT_SYSTEM_PROMPT_TYPE) {
        const assembled = entry.data?.assembled;
        if (typeof assembled === 'string') lastAssembled = assembled;
        break;
      }
    }

    if (lastAssembled === resolved.assembled) return;

    const data: TranscriptSystemPromptData = resolved;
    transcriptManager.appendCustomEntry(TRANSCRIPT_SYSTEM_PROMPT_TYPE, data);
  }

  private async touchSession(sessionKey: string, timestamp: number): Promise<void> {
    if (!this.sessionRouter) {
      return;
    }

    await this.sessionRouter.updateAfterTurn(sessionKey, {
      updatedAt: new Date(timestamp).toISOString(),
    });
  }

  private async applyAssistantUsage(
    sessionKey: string,
    assistantMessage: AssistantMessage,
  ): Promise<void> {
    if (!this.sessionRouter) {
      return;
    }

    const status = await this.sessionRouter.getStatus(sessionKey);
    if (!status) {
      return;
    }

    const { usage, costTotalUsd } = this.normalizeUsage(assistantMessage.usage);
    const runUsage: RunUsage = {
      input: usage.input,
      output: usage.output,
      cacheRead: usage.cacheRead,
      cacheWrite: usage.cacheWrite,
      totalTokens: usage.totalTokens,
    };
    const contextTokens = contextTokensFromUsage(runUsage);

    // Fold the provider's real total into the most recent preview's
    // section shape so the UI keeps a stable breakdown. If there is no
    // preview cached (e.g. turn ran before onPayload fired), omit the
    // breakdown -- the client will degrade to showing only the total.
    const previewBreakdown = this.lastPreviewBreakdown.get(sessionKey);
    const breakdown = previewBreakdown
      ? foldActualIntoBreakdown(previewBreakdown, contextTokens)
      : undefined;

    await this.sessionRouter.updateAfterTurn(sessionKey, {
      updatedAt: new Date(assistantMessage.timestamp).toISOString(),
      inputTokens: status.inputTokens + usage.input,
      outputTokens: status.outputTokens + usage.output,
      totalTokens: status.totalTokens + usage.totalTokens,
      // contextTokens is a non-cumulative snapshot of the most recent
      // turn's context fill. Everything else in this object is cumulative.
      contextTokens,
      // Persist the per-section breakdown so reopening the session
      // shows the panel immediately instead of waiting for a new turn.
      ...(breakdown ? { contextBreakdown: breakdown } : {}),
      // Refresh the resolved system prompt every turn so any hook
      // that rewrote it via setSystemPrompt() is reflected. Guarded
      // to stay compatible with test mocks that don't define this
      // optional runtime method.
      ...(this.runtime.getResolvedSystemPrompt
        ? { resolvedSystemPrompt: this.runtime.getResolvedSystemPrompt() }
        : {}),
      cacheRead: status.cacheRead + usage.cacheRead,
      cacheWrite: status.cacheWrite + usage.cacheWrite,
      totalEstimatedCostUsd: status.totalEstimatedCostUsd + costTotalUsd,
    });

    this.emitContextUsage(sessionKey, runUsage, contextTokens, 'actual', undefined, breakdown);
  }

  /** Resolve the model's context window in tokens (override > catalog > default). */
  private resolveContextWindow(): number {
    const runtimeCw = (this.runtime.state.model as { contextWindow?: number })?.contextWindow;
    if (typeof runtimeCw === 'number' && runtimeCw > 0) return runtimeCw;
    const override = this.config.modelCapabilities?.contextWindow;
    if (typeof override === 'number' && override > 0) return override;
    return 128_000;
  }

  /** Emit a `context:usage` coordinator event (optionally run-scoped). */
  private emitContextUsage(
    sessionKey: string,
    usage: RunUsage | undefined,
    contextTokens: number,
    source: ContextUsage['source'],
    runId?: string,
    breakdown?: ContextUsageBreakdown,
  ): void {
    const snapshot: ContextUsage = {
      sessionKey,
      runId,
      at: Date.now(),
      contextTokens,
      contextWindow: this.resolveContextWindow(),
      usage,
      breakdown,
      source,
    };
    const event: CoordinatorEvent = {
      type: 'context:usage',
      runId: runId ?? '',
      agentId: this.agentId,
      sessionKey,
      usage: snapshot,
    };
    if (runId) {
      this.emitForRun(runId, event);
    } else {
      this.emit(event);
    }
  }

  private async finishTranscript(
    record: RunRecord,
    transcriptManager: SessionManager,
    transcriptState: TranscriptState,
  ): Promise<SessionManager> {
    const reopened = await this.transcriptStore!.snapshot(transcriptManager);

    if (transcriptState.compactionCount > 0 && this.sessionRouter) {
      const status = await this.sessionRouter.getStatus(record.sessionKey);
      if (status) {
        await this.sessionRouter.updateAfterTurn(record.sessionKey, {
          compactionCount: status.compactionCount + transcriptState.compactionCount,
        });
      }
    }

    return reopened;
  }

  private buildRunDiagnostic(record: RunRecord, error: StructuredError): RunErrorDiagnosticData {
    return {
      kind: 'run_error',
      runId: record.runId,
      sessionId: record.sessionId,
      code: error.code,
      message: error.message,
      phase: record.startedAt ? 'running' : 'pending',
      retriable: error.retriable,
      createdAt: Date.now(),
    };
  }

  private appendPendingDiagnostic(record: RunRecord, transcriptManager: SessionManager): void {
    if (!record.pendingDiagnostic || record.diagnosticPersisted) {
      return;
    }

    transcriptManager.appendCustomEntry(RUN_DIAGNOSTIC_CUSTOM_TYPE, record.pendingDiagnostic);
    record.diagnosticPersisted = true;
  }

  private async persistDiagnosticEntry(record: RunRecord): Promise<void> {
    if (!this.transcriptStore || !record.pendingDiagnostic || record.diagnosticPersisted) {
      return;
    }

    const transcriptManager = this.transcriptStore.openSession(record.transcriptPath);
    transcriptManager.appendCustomEntry(RUN_DIAGNOSTIC_CUSTOM_TYPE, record.pendingDiagnostic);
    await this.transcriptStore.snapshot(transcriptManager);
    record.transcriptPath = transcriptManager.getSessionFile() ?? record.transcriptPath;
    record.diagnosticPersisted = true;
  }

  private invokeAgentEndHook(
    record: RunRecord,
    status: 'completed' | 'error',
    error?: StructuredError,
  ): void {
    if (!this.hooks) {
      return;
    }

    const ctx: AgentEndContext = {
      agentId: this.agentId,
      runId: record.runId,
      sessionId: record.sessionId,
      status,
      payloads: record.payloads,
      usage: record.usage,
      error,
    };

    this.hooks.invoke(HOOK_NAMES.AGENT_END, ctx).catch((hookError) => {
      console.error('[RunCoordinator] agent_end hook error:', hookError);
    });
  }

  private emitSyntheticAssistantReply(record: RunRecord, content: string): void {
    const message = {
      role: 'assistant',
      content: [{ type: 'text', text: content }],
      timestamp: Date.now(),
    };

    this.emitForRun(record.runId, {
      type: 'stream',
      runId: record.runId,
      event: { type: 'message_start', message },
    });
    this.emitForRun(record.runId, {
      type: 'stream',
      runId: record.runId,
      event: {
        type: 'message_update',
        message,
        assistantMessageEvent: {
          type: 'text_delta',
          contentIndex: 0,
          delta: content,
        },
      },
    });
    this.emitForRun(record.runId, {
      type: 'stream',
      runId: record.runId,
      event: {
        type: 'message_update',
        message,
        assistantMessageEvent: {
          type: 'text_end',
          contentIndex: 0,
          content,
        },
      },
    });
    this.emitForRun(record.runId, {
      type: 'stream',
      runId: record.runId,
      event: { type: 'message_end', message },
    });
  }

  private finalizeRunSuccess(record: RunRecord): void {
    if (record.timeoutTimer) {
      clearTimeout(record.timeoutTimer);
    }
    record.status = 'completed';
    record.endedAt = Date.now();

    this.emitForRun(record.runId, {
      type: 'lifecycle:end',
      runId: record.runId,
      status: 'ok',
      startedAt: record.startedAt ?? record.acceptedAt,
      endedAt: record.endedAt,
      payloads: record.payloads,
      usage: record.usage,
    });

    this.invokeAgentEndHook(record, 'completed');

    // Notify SubAgentRegistry unconditionally — it tracks sub-agents by
    // runId and is a safe no-op for runs it doesn't know about. We can't
    // gate on sessionKey.startsWith('sub:') because SessionRouter.route()
    // prefixes the SAM-generated `sub:<parent>:<uuid>` key with
    // `agent:<agentId>:`, so the actual record.sessionKey is
    // `agent:<agentId>:sub:<parent>:<uuid>` — that guard never matches and
    // a yield would only ever resolve via the safety timeout.
    let assistantText = '';
    for (let i = 0; i < record.payloads.length; i++) {
      const p = record.payloads[i];
      if (p.type === 'text') {
        assistantText += p.content;
      }
    }
    this.subAgentRegistry.onComplete(record.runId, assistantText);

    this.resolveWaiters(record);
    this.scheduleCleanup(record.runId);
  }

  private finalizeRunError(record: RunRecord, error: StructuredError): void {
    if (record.timeoutTimer) {
      clearTimeout(record.timeoutTimer);
    }
    record.status = 'error';
    record.error = error;
    record.endedAt = Date.now();

    this.emitForRun(record.runId, {
      type: 'lifecycle:error',
      runId: record.runId,
      status: 'error',
      error,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
    });

    this.invokeAgentEndHook(record, 'error', error);

    // See finalizeRunSuccess: notify unconditionally because the post-route
    // sessionKey is `agent:<agentId>:sub:...`, not `sub:...`. The registry
    // is a safe no-op for non-sub-agent runs.
    this.subAgentRegistry.onError(record.runId, error.message);

    this.resolveWaiters(record);
    this.scheduleCleanup(record.runId);
  }

  private resolveWaiters(record: RunRecord): void {
    const waiters = this.waiters.get(record.runId);
    if (!waiters) {
      return;
    }

    const result = this.buildWaitResult(record);
    for (const resolve of waiters) {
      resolve(result);
    }
    this.waiters.delete(record.runId);
  }

  private buildWaitResult(record: RunRecord): WaitResult {
    return {
      runId: record.runId,
      status: record.status === 'completed' ? 'ok' : 'error',
      phase: record.status,
      acceptedAt: record.acceptedAt,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      queue: record.queue,
      payloads: record.payloads,
      usage: record.usage,
      error: record.error,
    };
  }

  private scheduleCleanup(runId: string): void {
    const timer = setTimeout(() => {
      this.runs.delete(runId);
      this.runSubscribers.delete(runId);
      this.pendingParams.delete(runId);
      this.cleanupTimers.delete(timer);
    }, RUN_RECORD_TTL_MS);
    this.cleanupTimers.add(timer);
  }

  private emitQueueEntered(record: RunRecord): void {
    if (!record.queue) {
      return;
    }

    this.emitForRun(record.runId, {
      type: 'queue:entered',
      runId: record.runId,
      agentId: this.agentId,
      sessionId: record.sessionId,
      acceptedAt: record.acceptedAt,
      sessionPosition: record.queue.sessionPosition,
      globalPosition: record.queue.globalPosition,
    });
  }

  private emitQueueUpdates(runIds: string[]): void {
    const updatedAt = Date.now();
    for (const runId of runIds) {
      const record = this.runs.get(runId);
      if (!record) {
        continue;
      }
      const snapshot = this.concurrency.getSnapshot(runId);
      if (!snapshot) {
        record.queue = undefined;
        continue;
      }
      if (
        record.queue &&
        record.queue.sessionPosition === snapshot.sessionPosition &&
        record.queue.globalPosition === snapshot.globalPosition
      ) {
        continue;
      }

      record.queue = snapshot;
      this.emitForRun(runId, {
        type: 'queue:updated',
        runId,
        agentId: this.agentId,
        sessionId: record.sessionId,
        updatedAt,
        sessionPosition: snapshot.sessionPosition,
        globalPosition: snapshot.globalPosition,
      });
    }
  }

  private emitQueueLeft(record: RunRecord, reason: 'started' | 'aborted' | 'destroyed'): void {
    this.emitForRun(record.runId, {
      type: 'queue:left',
      runId: record.runId,
      agentId: this.agentId,
      sessionId: record.sessionId,
      leftAt: Date.now(),
      reason,
    });
  }

  private emit(event: CoordinatorEvent): void {
    for (const listener of this.allSubscribers) {
      try {
        listener(event);
      } catch {
        // Listener errors should not break runtime delivery.
      }
    }
  }

  private emitForRun(runId: string, event: CoordinatorEvent): void {
    const subscribers = this.runSubscribers.get(runId);
    if (subscribers) {
      for (const listener of subscribers) {
        try {
          listener(event);
        } catch {
          // Listener errors should not break runtime delivery.
        }
      }
    }

    this.emit(event);
  }
}

export function classifyError(error: unknown): StructuredError {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes('rate limit') || message.includes('429')) {
      return { code: 'rate_limited', message: error.message, retriable: true };
    }
    if (message.includes('content policy') || message.includes('refused') || message.includes('safety')) {
      return { code: 'model_refused', message: error.message, retriable: false };
    }
  }

  const message = error instanceof Error ? error.message : 'Unknown error';
  return { code: 'internal', message, retriable: false };
}

const YIELD_RESUME_PER_SUB_CAP = 1500;
const YIELD_RESUME_TOTAL_CAP = 8000;

function formatYieldResumeText(payload: ResumePayload): string {
  const header = `Sub-agents finished (N=${payload.results.length}, reason=${payload.reason}).`;
  const lines: string[] = [header, ''];

  let used = header.length + 1;
  for (let i = 0; i < payload.results.length; i++) {
    const r = payload.results[i];
    const durationSec = (r.durationMs / 1000).toFixed(1);
    const head = `[${i + 1}/${payload.results.length}] sub=${r.subAgentId.slice(0, 8)}... agent=${r.targetAgentId} status=${r.status} (${durationSec}s)`;
    const body = r.status === 'error'
      ? `error: ${r.error ?? 'unknown error'}`
      : truncateForResume(r.text ?? '', YIELD_RESUME_PER_SUB_CAP);

    const block = `${head}\n${body}`;
    if (used + block.length + 2 > YIELD_RESUME_TOTAL_CAP) {
      lines.push('…(truncated)');
      break;
    }
    lines.push(block);
    lines.push('');
    used += block.length + 2;
  }

  return lines.join('\n').trimEnd();
}

function truncateForResume(value: string, cap: number): string {
  if (value.length <= cap) return value;
  return `${value.slice(0, cap)}…(truncated)`;
}
