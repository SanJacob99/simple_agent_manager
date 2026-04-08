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
  RunQueueSnapshot,
  RunUsage,
  StructuredError,
  CoordinatorEvent,
  RunEventListener,
} from '../../shared/run-types';
import { RunConcurrencyController } from './run-concurrency-controller';

export type RunStatus = 'pending' | 'running' | 'completed' | 'error';

export interface RunRecord {
  runId: string;
  agentId: string;
  sessionId: string;
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
}

const RUN_RECORD_TTL_MS = 5 * 60 * 1000;
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const NO_REPLY_PATTERN = /^no_reply$/i;

interface TranscriptState {
  assistantText: string;
  assistantSuppressed: boolean;
}

// OPTIMIZATION: Single-pass iteration to avoid large intermediate array allocations
// during high-frequency streaming events
function extractTextContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  let result = '';
  for (let i = 0; i < content.length; i++) {
    const block = content[i];
    if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      result += block.text;
    }
  }

  return result;
}

export class RunCoordinator {
  private readonly runs = new Map<string, RunRecord>();
  private readonly waiters = new Map<string, Array<(result: WaitResult) => void>>();
  private readonly runSubscribers = new Map<string, Set<RunEventListener>>();
  private readonly allSubscribers = new Set<RunEventListener>();
  private readonly cleanupTimers = new Set<ReturnType<typeof setTimeout>>();
  private readonly pendingParams = new Map<string, DispatchParams>();
  private readonly concurrency = new RunConcurrencyController();

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

    const sessionId = await this.resolveSession(params.sessionKey);
    const runId = randomUUID();
    const acceptedAt = Date.now();

    const record: RunRecord = {
      runId,
      agentId: this.agentId,
      sessionId,
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
        sessionId,
        text: params.text,
        blocked: false,
        blockReason: undefined,
      };
      await this.hooks.invoke(HOOK_NAMES.MESSAGE_RECEIVED, msgCtx);

      if (msgCtx.blocked) {
        this.pendingParams.delete(runId);
        this.finalizeRunError(record, {
          code: 'aborted',
          message: `Message blocked: ${msgCtx.blockReason ?? 'blocked by hook'}`,
          retriable: false,
        });
        return { runId, sessionId, acceptedAt };
      }
    }

    const { snapshot, affectedRunIds } = this.concurrency.enqueue(runId, sessionId);
    record.queue = snapshot;
    this.emitQueueEntered(record);
    this.emitQueueUpdates(affectedRunIds);
    this.tryStartNextRun();

    return { runId, sessionId, acceptedAt };
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

  abort(runId: string): void {
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
      this.pendingParams.delete(runId);
      record.queue = undefined;
      this.emitQueueLeft(record, 'aborted');
      this.emitQueueUpdates(result.affectedRunIds);
      this.finalizeRunError(record, {
        code: 'aborted',
        message: 'Run aborted by caller',
        retriable: false,
      });
      this.tryStartNextRun();
      return;
    }

    this.runtime.abort();
    this.concurrency.release(record.runId, record.sessionId);
    this.finalizeRunError(record, {
      code: 'aborted',
      message: 'Run aborted by caller',
      retriable: false,
    });
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

  private async resolveSession(sessionKey: string): Promise<string> {
    const existing = await this.storage!.getSessionByKey(sessionKey);
    if (existing) {
      await this.storage!.updateSessionMeta(existing.sessionId, {
        updatedAt: new Date().toISOString(),
      });
      return existing.sessionId;
    }

    const existingById = await this.storage!.getSessionMeta(sessionKey);
    if (existingById) {
      await this.storage!.updateSessionMeta(existingById.sessionId, {
        updatedAt: new Date().toISOString(),
      });
      return existingById.sessionId;
    }

    const meta = await this.storage!.createManagedSession(
      `${this.config.provider}/${this.config.modelId}`,
      sessionKey,
    );
    await this.storage!.enforceRetention(this.config.storage!.sessionRetention);

    if (this.hooks) {
      const sessionCtx: SessionLifecycleContext = {
        agentId: this.agentId,
        sessionId: meta.sessionId,
        sessionKey,
        phase: 'start',
      };
      await this.hooks.invoke(HOOK_NAMES.SESSION_START, sessionCtx);
    }

    return meta.sessionId;
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

  private async executeRun(record: RunRecord, params: DispatchParams): Promise<void> {
    record.status = 'running';
    record.startedAt = Date.now();

    let promptText = params.text;
    const transcriptState: TranscriptState = {
      assistantText: '',
      assistantSuppressed: false,
    };
    let transcriptWrites = Promise.resolve();
    const queueTranscriptWrite = (task: () => Promise<void>) => {
      transcriptWrites = transcriptWrites
        .then(task)
        .catch((error) => {
          console.error('[RunCoordinator] transcript persistence failed:', error);
        });
    };

    try {
      await this.persistUserMessage(record.sessionId, params);

      if (this.hooks) {
        const modelCtx: BeforeModelResolveContext = {
          agentId: this.agentId,
          runId: record.runId,
          sessionId: record.sessionId,
          config: this.config,
          overrides: {},
        };

        await this.hooks.invoke(HOOK_NAMES.BEFORE_MODEL_RESOLVE, modelCtx);

        if (modelCtx.overrides.provider || modelCtx.overrides.modelId) {
          const provider = modelCtx.overrides.provider ?? this.config.provider;
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
            await this.appendTranscriptMessage(record.sessionId, {
              role: 'assistant',
              content: replyCtx.syntheticReply,
              timestamp: Date.now(),
            });
            this.emitSyntheticAssistantReply(record, replyCtx.syntheticReply);
          }

          this.concurrency.release(record.runId, record.sessionId);
          this.finalizeRunSuccess(record);
          this.tryStartNextRun();
          return;
        }
      }
    } catch (error) {
      if (record.status === 'running') {
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
      this.runtime.abort();
      this.concurrency.release(record.runId, record.sessionId);
      transcriptWrites.finally(() => {
        this.finalizeRunError(record, {
          code: 'timeout',
          message: `Run timed out after ${timeoutMs}ms`,
          retriable: false,
        });
        this.tryStartNextRun();
      });
    }, timeoutMs);

    const unsubscribe = this.runtime.subscribe((event: RuntimeEvent) => {
      queueTranscriptWrite(() => this.persistRuntimeEvent(record.sessionId, event, transcriptState));
      this.emitForRun(record.runId, { type: 'stream', runId: record.runId, event });
    });

    try {
      await this.runtime.prompt(promptText, params.attachments);
      if (record.status !== 'running') {
        return;
      }
      await transcriptWrites;
      this.concurrency.release(record.runId, record.sessionId);
      this.finalizeRunSuccess(record);
      this.tryStartNextRun();
    } catch (error) {
      if (record.status !== 'running') {
        return;
      }
      await transcriptWrites;
      this.concurrency.release(record.runId, record.sessionId);
      this.finalizeRunError(record, classifyError(error));
      this.tryStartNextRun();
    } finally {
      unsubscribe();
      await transcriptWrites;
    }
  }

  private async persistUserMessage(sessionId: string, params: DispatchParams): Promise<void> {
    const content = params.text.trim()
      || (params.attachments?.length
        ? `[${params.attachments.length} image${params.attachments.length === 1 ? '' : 's'}]`
        : '');

    if (!content) {
      return;
    }

    await this.appendTranscriptMessage(sessionId, {
      role: 'user',
      content,
      timestamp: Date.now(),
    });
  }

  private async persistRuntimeEvent(
    sessionId: string,
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
        const content = typeof assistantEvent.content === 'string'
          ? assistantEvent.content
          : transcriptState.assistantText;
        transcriptState.assistantText = content;
        transcriptState.assistantSuppressed = NO_REPLY_PATTERN.test(content.trim());
      }
      return;
    }

    if (raw.type === 'message_end' && raw.message?.role === 'assistant') {
      const fallbackText =
        transcriptState.assistantText || extractTextContent(raw.message.content);

      if (
        !fallbackText
        || transcriptState.assistantSuppressed
        || NO_REPLY_PATTERN.test(fallbackText.trim())
      ) {
        transcriptState.assistantText = '';
        transcriptState.assistantSuppressed = false;
        return;
      }

      const usage = raw.message.usage
        ? {
            input: raw.message.usage.input ?? 0,
            output: raw.message.usage.output ?? 0,
            cacheRead: raw.message.usage.cacheRead ?? 0,
            cacheWrite: raw.message.usage.cacheWrite ?? 0,
            totalTokens: raw.message.usage.totalTokens ?? 0,
          }
        : undefined;

      await this.appendTranscriptMessage(sessionId, {
        role: 'assistant',
        content: fallbackText,
        timestamp: Date.now(),
        tokenCount: usage?.output,
        usage,
      });

      transcriptState.assistantText = '';
      transcriptState.assistantSuppressed = false;
      return;
    }

    if (raw.type === 'tool_execution_end') {
      const resultText = extractTextContent(raw.result?.content);
      const content = `${raw.toolName}: ${resultText}${raw.isError ? ' (error)' : ''}`;
      await this.appendTranscriptMessage(sessionId, {
        role: 'tool',
        content,
        timestamp: Date.now(),
      });
    }
  }

  private async appendTranscriptMessage(
    sessionId: string,
    message: {
      role: 'user' | 'assistant' | 'tool';
      content: string;
      timestamp: number;
      tokenCount?: number;
      usage?: RunUsage;
    },
  ): Promise<void> {
    if (!this.storage) {
      return;
    }

    const timestampIso = new Date(message.timestamp).toISOString();
    await this.storage.appendEntry(sessionId, {
      type: 'message',
      id: randomUUID(),
      parentId: null,
      timestamp: timestampIso,
      ...(typeof message.tokenCount === 'number' ? { tokenCount: message.tokenCount } : {}),
      ...(message.usage ? { usage: message.usage } : {}),
      message: {
        role: message.role,
        content: [{ type: 'text', text: message.content }],
        timestamp: message.timestamp,
      },
    } as any);

    const partial: Partial<SessionMeta> = {
      updatedAt: timestampIso,
    };

    if (message.usage) {
      const meta = await this.storage.getSessionMeta(sessionId);
      if (meta) {
        partial.totalInputTokens = meta.totalInputTokens + message.usage.input;
        partial.totalOutputTokens = meta.totalOutputTokens + message.usage.output;
        partial.cacheRead = meta.cacheRead + message.usage.cacheRead;
        partial.cacheWrite = meta.cacheWrite + message.usage.cacheWrite;
        partial.totalTokens = meta.totalTokens + message.usage.totalTokens;
      }
    }

    await this.storage.updateSessionMeta(sessionId, partial);
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
