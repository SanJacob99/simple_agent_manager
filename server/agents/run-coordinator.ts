import { randomUUID } from 'crypto';
import type { AgentRuntime, RuntimeEvent } from '../runtime/agent-runtime';
import type { StorageEngine } from '../runtime/storage-engine';
import type { AgentConfig } from '../../shared/agent-config';
import type { SessionMeta } from '../../shared/storage-types';
import type { HookRegistry } from '../hooks/hook-registry';
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
  RunUsage,
  StructuredError,
  CoordinatorEvent,
  RunEventListener,
} from '../../shared/run-types';

export type RunStatus = 'pending' | 'running' | 'completed' | 'error';

export interface RunRecord {
  runId: string;
  agentId: string;
  sessionId: string;
  status: RunStatus;
  startedAt: number;
  endedAt?: number;
  payloads: RunPayload[];
  usage?: RunUsage;
  error?: StructuredError;
  abortController: AbortController;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
}

const RUN_RECORD_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;

export class RunCoordinator {
  private runs = new Map<string, RunRecord>();
  private waiters = new Map<string, Array<(result: WaitResult) => void>>();
  private runSubscribers = new Map<string, Set<RunEventListener>>();
  private allSubscribers = new Set<RunEventListener>();
  private activeSessionRuns = new Map<string, string>(); // sessionId → runId
  private cleanupTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    private readonly agentId: string,
    private readonly runtime: AgentRuntime,
    private readonly config: AgentConfig,
    private readonly storage: StorageEngine | null,
    private readonly hooks: HookRegistry | null = null,
  ) {}

  async dispatch(params: DispatchParams): Promise<DispatchResult> {
    if (!this.storage) {
      throw new Error('Cannot dispatch: no storage configured for this agent');
    }

    // Resolve session
    const sessionId = await this.resolveSession(params.sessionKey);

    // Guard: one run per session
    if (this.activeSessionRuns.has(sessionId)) {
      throw new Error(`A run is already active on session ${sessionId}`);
    }

    // Create run record
    const runId = randomUUID();
    const startedAt = Date.now();
    const abortController = new AbortController();

    const record: RunRecord = {
      runId,
      agentId: this.agentId,
      sessionId,
      status: 'pending',
      startedAt,
      payloads: [],
      abortController,
      timeoutTimer: null,
    };

    this.runs.set(runId, record);
    this.activeSessionRuns.set(sessionId, runId);

    // --- message_received hook (scaffolded) ---
    if (this.hooks) {
      const msgCtx: MessageReceivedContext = {
        agentId: this.agentId,
        runId,
        sessionId,
        text: params.text,
        blocked: false,
        blockReason: undefined,
      };
      await this.hooks.invoke(HOOK_NAMES.MESSAGE_RECEIVED, msgCtx);

      if (msgCtx.blocked) {
        this.activeSessionRuns.delete(sessionId);
        this.finalizeRun(record, {
          code: 'aborted',
          message: `Message blocked: ${msgCtx.blockReason ?? 'blocked by hook'}`,
          retriable: false,
        });
        return { runId, sessionId, acceptedAt: startedAt };
      }
    }

    // Fire-and-forget the execution
    this.executeRun(record, params);

    return { runId, sessionId, acceptedAt: startedAt };
  }

  async wait(runId: string, timeoutMs?: number): Promise<WaitResult> {
    const record = this.runs.get(runId);
    if (!record) {
      return {
        runId,
        status: 'error',
        startedAt: 0,
        payloads: [],
        error: { code: 'internal', message: `Run ${runId} not found`, retriable: false },
      };
    }

    // Already terminal
    if (record.status === 'completed' || record.status === 'error') {
      return this.buildWaitResult(record);
    }

    // Wait for completion or timeout
    const timeout = timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    return new Promise<WaitResult>((resolve) => {
      const timer = setTimeout(() => {
        // Remove this waiter
        const waiters = this.waiters.get(runId);
        if (waiters) {
          const idx = waiters.indexOf(wrappedResolve);
          if (idx !== -1) waiters.splice(idx, 1);
        }
        resolve({
          runId,
          status: 'timeout',
          startedAt: record.startedAt,
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

  abort(runId: string): void {
    const record = this.runs.get(runId);
    if (!record || record.status === 'completed' || record.status === 'error') return;

    record.abortController.abort();
    this.runtime.abort();
    this.finalizeRun(record, {
      code: 'aborted',
      message: 'Run aborted by caller',
      retriable: false,
    });
  }

  getRunStatus(runId: string): RunRecord | undefined {
    return this.runs.get(runId);
  }

  getLatestActiveRunId(): string | undefined {
    for (const [, record] of this.runs) {
      if (record.status === 'pending' || record.status === 'running') {
        return record.runId;
      }
    }
    return undefined;
  }

  setRunPayloads(runId: string, payloads: RunPayload[], usage?: RunUsage): void {
    const record = this.runs.get(runId);
    if (!record) return;
    record.payloads = payloads;
    if (usage) record.usage = usage;
  }

  destroy(): void {
    for (const [, record] of this.runs) {
      if (record.status === 'pending' || record.status === 'running') {
        record.abortController.abort();
        if (record.timeoutTimer) clearTimeout(record.timeoutTimer);
      }
    }
    for (const timer of this.cleanupTimers) {
      clearTimeout(timer);
    }
    this.runs.clear();
    this.waiters.clear();
    this.runSubscribers.clear();
    this.allSubscribers.clear();
    this.activeSessionRuns.clear();
    this.cleanupTimers.clear();
  }

  // --- Private ---

  private async resolveSession(sessionKey: string): Promise<string> {
    const existing = await this.storage!.getSessionByKey(sessionKey);
    if (existing) {
      await this.storage!.updateSessionMeta(existing.sessionId, {
        updatedAt: new Date().toISOString(),
      });
      return existing.sessionId;
    }

    // Create new session
    const sessionId = randomUUID();
    const now = new Date().toISOString();
    const meta: SessionMeta = {
      sessionId,
      sessionKey,
      agentName: this.config.name,
      llmSlug: `${this.config.provider}/${this.config.modelId}`,
      startedAt: now,
      updatedAt: now,
      sessionFile: `sessions/${sessionId}.jsonl`,
      contextTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalEstimatedCostUsd: 0,
      totalTokens: 0,
    };

    await this.storage!.createSession(meta);
    await this.storage!.enforceRetention(this.config.storage!.sessionRetention);

    // --- session_start hook (scaffolded) ---
    if (this.hooks) {
      const sessionCtx: SessionLifecycleContext = {
        agentId: this.agentId,
        sessionId,
        sessionKey,
        phase: 'start',
      };
      await this.hooks.invoke(HOOK_NAMES.SESSION_START, sessionCtx);
    }

    return sessionId;
  }

  private async executeRun(record: RunRecord, params: DispatchParams): Promise<void> {
    record.status = 'running';

    // --- before_model_resolve hook ---
    if (this.hooks) {
      const modelCtx: BeforeModelResolveContext = {
        agentId: this.agentId,
        runId: record.runId,
        sessionId: record.sessionId,
        config: this.config,
        overrides: {},
      };

      await this.hooks.invoke(HOOK_NAMES.BEFORE_MODEL_RESOLVE, modelCtx);

      // Apply model overrides
      if (modelCtx.overrides.provider || modelCtx.overrides.modelId) {
        const provider = modelCtx.overrides.provider ?? this.config.provider;
        const modelId = modelCtx.overrides.modelId ?? this.config.modelId;
        this.runtime.setModel(provider, modelId);
      }
    }

    // --- before_prompt_build hook ---
    let promptText = params.text;

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

      // Apply prompt overrides
      if (promptCtx.overrides.systemPrompt) {
        this.runtime.setSystemPrompt(promptCtx.overrides.systemPrompt);
      } else if (promptCtx.overrides.prependSystemContext || promptCtx.overrides.appendSystemContext) {
        // Apply prepend/append to existing system prompt
        let currentPrompt = this.runtime.getSystemPrompt();

        if (promptCtx.overrides.prependSystemContext) {
          currentPrompt = promptCtx.overrides.prependSystemContext + '\n\n' + currentPrompt;
        }
        if (promptCtx.overrides.appendSystemContext) {
          currentPrompt = currentPrompt + '\n\n' + promptCtx.overrides.appendSystemContext;
        }

        this.runtime.setSystemPrompt(currentPrompt);
      }

      // Apply prepend context to user message
      if (promptCtx.overrides.prependContext) {
        promptText = promptCtx.overrides.prependContext + '\n\n' + promptText;
      }
    }

    // --- before_agent_reply hook (pre-first-call version) ---
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

      if (replyCtx.claimed) {
        // Plugin claimed the turn — skip model call
        if (replyCtx.silent) {
          // Silent turn — no reply
          record.payloads = [];
        } else if (replyCtx.syntheticReply) {
          record.payloads = [{ type: 'text', content: replyCtx.syntheticReply }];
        }

        this.finalizeRunSuccess(record);
        return;
      }
    }

    // Emit lifecycle:start
    this.emit({
      type: 'lifecycle:start',
      runId: record.runId,
      agentId: this.agentId,
      sessionId: record.sessionId,
      startedAt: record.startedAt,
    });

    // Start timeout timer
    const timeoutMs = params.timeoutMs ?? this.config.runTimeoutMs;
    record.timeoutTimer = setTimeout(() => {
      if (record.status === 'running' || record.status === 'pending') {
        this.runtime.abort();
        this.finalizeRun(record, {
          code: 'timeout',
          message: `Run timed out after ${timeoutMs}ms`,
          retriable: false,
        });
      }
    }, timeoutMs);

    // Subscribe to runtime events — forward to stream subscribers (StreamProcessor handles shaping)
    const unsubscribe = this.runtime.subscribe((event: RuntimeEvent) => {
      this.emitForRun(record.runId, { type: 'stream', runId: record.runId, event });
    });

    // Run the prompt
    this.runtime.prompt(promptText, params.attachments)
      .then(() => {
        unsubscribe();
        this.invokeAgentEndHook(record, 'completed');
        this.finalizeRunSuccess(record);
      })
      .catch((error: unknown) => {
        unsubscribe();
        // Don't double-finalize if already handled (timeout/abort)
        if (record.status === 'running') {
          const structuredError = classifyError(error);
          this.invokeAgentEndHook(record, 'error', structuredError);
          this.finalizeRun(record, structuredError);
        }
      });
  }

  /**
   * Invoke the agent_end hook. Fire-and-forget — errors are logged, not propagated.
   */
  private invokeAgentEndHook(
    record: RunRecord,
    status: 'completed' | 'error',
    error?: StructuredError,
  ): void {
    if (!this.hooks) return;

    const ctx: AgentEndContext = {
      agentId: this.agentId,
      runId: record.runId,
      sessionId: record.sessionId,
      status,
      payloads: record.payloads,
      usage: record.usage,
      error,
    };

    // Fire-and-forget, don't await
    this.hooks.invoke(HOOK_NAMES.AGENT_END, ctx).catch((err) => {
      console.error('[RunCoordinator] agent_end hook error:', err);
    });
  }

  private finalizeRunSuccess(record: RunRecord): void {
    if (record.timeoutTimer) clearTimeout(record.timeoutTimer);
    record.status = 'completed';
    record.endedAt = Date.now();
    this.activeSessionRuns.delete(record.sessionId);

    this.emit({
      type: 'lifecycle:end',
      runId: record.runId,
      status: 'ok',
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      payloads: record.payloads,
      usage: record.usage,
    });

    this.resolveWaiters(record);
    this.scheduleCleanup(record.runId);
  }

  private finalizeRun(record: RunRecord, error: StructuredError): void {
    if (record.timeoutTimer) clearTimeout(record.timeoutTimer);
    record.status = 'error';
    record.error = error;
    record.endedAt = Date.now();
    this.activeSessionRuns.delete(record.sessionId);

    this.emit({
      type: 'lifecycle:error',
      runId: record.runId,
      status: 'error',
      error,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
    });

    this.resolveWaiters(record);
    this.scheduleCleanup(record.runId);
  }

  private resolveWaiters(record: RunRecord): void {
    const waiters = this.waiters.get(record.runId);
    if (waiters) {
      const result = this.buildWaitResult(record);
      for (const resolve of waiters) {
        resolve(result);
      }
      this.waiters.delete(record.runId);
    }
  }

  private buildWaitResult(record: RunRecord): WaitResult {
    return {
      runId: record.runId,
      status: record.status === 'completed' ? 'ok' : 'error',
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      payloads: record.payloads,
      usage: record.usage,
      error: record.error,
    };
  }

  private scheduleCleanup(runId: string): void {
    const timer = setTimeout(() => {
      this.runs.delete(runId);
      this.runSubscribers.delete(runId);
      this.cleanupTimers.delete(timer);
    }, RUN_RECORD_TTL_MS);
    this.cleanupTimers.add(timer);
  }

  private emit(event: CoordinatorEvent): void {
    for (const listener of this.allSubscribers) {
      try { listener(event); } catch { /* don't break the loop */ }
    }
  }

  private emitForRun(runId: string, event: CoordinatorEvent): void {
    // Emit to run-specific subscribers
    const subs = this.runSubscribers.get(runId);
    if (subs) {
      for (const listener of subs) {
        try { listener(event); } catch { /* don't break the loop */ }
      }
    }
    // Also emit to all-subscribers
    this.emit(event);
  }
}

export function classifyError(error: unknown): StructuredError {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('rate limit') || msg.includes('429')) {
      return { code: 'rate_limited', message: error.message, retriable: true };
    }
    if (msg.includes('content policy') || msg.includes('refused') || msg.includes('safety')) {
      return { code: 'model_refused', message: error.message, retriable: false };
    }
  }
  const message = error instanceof Error ? error.message : 'Unknown error';
  return { code: 'internal', message, retriable: false };
}
