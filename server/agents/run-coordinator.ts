import { randomUUID } from 'crypto';
import type { SessionManager } from '@mariozechner/pi-coding-agent';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { AssistantMessage, ToolResultMessage, Usage, UserMessage } from '@mariozechner/pi-ai';
import type { AgentRuntime, RuntimeEvent } from '../runtime/agent-runtime';
import type { StorageEngine } from '../runtime/storage-engine';
import type { AgentConfig } from '../../shared/agent-config';
import type { SessionStoreEntry } from '../../shared/storage-types';
import type { HookRegistry } from '../hooks/hook-registry';
import { log } from '../logger';
import { SessionRouter, type RouteRequest, type RouteResult } from '../runtime/session-router';
import { SessionTranscriptStore } from '../runtime/session-transcript-store';
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
  type RunDiagnosticData,
} from '../../shared/session-diagnostics';
import { RunConcurrencyController } from './run-concurrency-controller';
import { SubAgentRegistry } from '../runtime/sub-agent-registry';
import { createSessionTools, type SessionToolContext } from '../runtime/session-tools';
import { SESSION_TOOL_NAMES } from '../../shared/resolve-tool-names';

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
const NO_REPLY_PATTERN = /^no_reply$/i;
const SESSION_TOOL_NAME_SET = new Set<string>(SESSION_TOOL_NAMES);

interface TranscriptState {
  assistantText: string;
  assistantSuppressed: boolean;
  compactionCount: number;
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

  return content
    .filter((block): block is { type?: string; text?: string } => !!block && typeof block === 'object')
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text ?? '')
    .join('');
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

  private async resolveSession(sessionKeyHint: string): Promise<RouteResult> {
    const routeRequest = await this.resolveRouteRequest(sessionKeyHint);
    const routed = await this.sessionRouter!.route(routeRequest);

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
    
    const unsubscribe = this.runtime.subscribe((event: RuntimeEvent) => {
      if ('type' in event) {
        if (event.type === 'message_start' && (event as any).message?.role === 'assistant') {
          _apiCallCount++;
          _firstTextDeltaLogged = false;
          _firstThinkingDeltaLogged = false;
          
          let passInfo = `pass=${_apiCallCount}`;
          if (_apiCallCount === 2) {
            passInfo += `, fallback_or_retry`;
          } else if (_apiCallCount > 2) {
            passInfo += `, tool_retry`;
          }
          _lap(`api:message_start [${passInfo}]`);
        }
        else if (
          !_firstTextDeltaLogged &&
          event.type === 'message_update' &&
          (event as any).assistantMessageEvent?.type === 'text_delta'
        ) {
          _lap(`api:first_text_delta [pass=${_apiCallCount}]`);
          _firstTextDeltaLogged = true;
        }
        else if (
          !_firstThinkingDeltaLogged &&
          event.type === 'message_update' &&
          (event as any).assistantMessageEvent?.type === 'thinking_delta'
        ) {
          _lap(`api:first_thinking_delta [pass=${_apiCallCount}]`);
          _firstThinkingDeltaLogged = true;
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

      const assistantMessage = this.buildAssistantMessage(raw.message, fallbackText);
      transcriptManager.appendMessage(assistantMessage);
      await this.applyAssistantUsage(record.sessionKey, assistantMessage);

      transcriptState.assistantText = '';
      transcriptState.assistantSuppressed = false;
      return;
    }

    if (raw.type === 'tool_execution_end') {
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
    return {
      role: 'assistant',
      content: Array.isArray(rawMessage?.content) && rawMessage.content.length > 0
        ? rawMessage.content
        : [{ type: 'text', text: fallbackText }],
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
    await this.sessionRouter.updateAfterTurn(sessionKey, {
      updatedAt: new Date(assistantMessage.timestamp).toISOString(),
      inputTokens: status.inputTokens + usage.input,
      outputTokens: status.outputTokens + usage.output,
      totalTokens: status.totalTokens + usage.totalTokens,
      cacheRead: status.cacheRead + usage.cacheRead,
      cacheWrite: status.cacheWrite + usage.cacheWrite,
      totalEstimatedCostUsd: status.totalEstimatedCostUsd + costTotalUsd,
    });
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

  private buildRunDiagnostic(record: RunRecord, error: StructuredError): RunDiagnosticData {
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

    // Notify SubAgentRegistry if this was a sub-agent run
    if (record.sessionKey.startsWith('sub:')) {
      const assistantText = record.payloads
        .filter((p) => p.type === 'text')
        .map((p) => p.content)
        .join('');
      this.subAgentRegistry.onComplete(record.runId, assistantText);
    }

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
