import type { RunCoordinator } from './run-coordinator';
import type { AgentConfig } from '../../shared/agent-config';
import type { CoordinatorEvent } from '../../shared/run-types';
import type { ServerEvent } from '../../shared/protocol';
import { createRunStreamContext, type RunStreamContext, type EmitFn, type StreamTransform } from './stream-transforms/types';
import { ReasoningGate } from './stream-transforms/reasoning-gate';
import { ReplyFilter } from './stream-transforms/reply-filter';
import { ToolSummaryCollector } from './stream-transforms/tool-summary-collector';
import { CompactionHandler } from './stream-transforms/compaction-handler';
import { ReplyAssembler } from './stream-transforms/reply-assembler';

export class StreamProcessor {
  private readonly contexts = new Map<string, RunStreamContext>();
  private readonly listeners = new Set<(event: ServerEvent) => void>();
  private readonly unsubscribe: () => void;
  private readonly replyFilters = new Map<string, ReplyFilter>();
  private readonly sharedTransforms: StreamTransform[];

  constructor(
    private readonly agentId: string,
    coordinator: RunCoordinator,
    config: AgentConfig,
  ) {
    const showReasoning = config.showReasoning ?? false;
    const verbose = config.verbose ?? false;

    // Shared transforms (stateless across runs or use RunStreamContext for state)
    this.sharedTransforms = [
      new ReasoningGate(showReasoning),
      // ReplyFilter is per-run — managed separately
      new ToolSummaryCollector(verbose),
      new CompactionHandler(),
      new ReplyAssembler(showReasoning, verbose, (runId, payloads, usage) => {
        coordinator.setRunPayloads(runId, payloads, usage);
      }),
    ];

    this.unsubscribe = coordinator.subscribeAll((event) => {
      this.handleEvent(event);
    });
  }

  subscribe(listener: (event: ServerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  hasRunContext(runId: string): boolean {
    return this.contexts.has(runId);
  }

  destroy(): void {
    this.unsubscribe();
    this.contexts.clear();
    this.replyFilters.clear();
    this.listeners.clear();
  }

  private handleEvent(event: CoordinatorEvent): void {
    // Create context on lifecycle:start
    if (event.type === 'lifecycle:start') {
      const ctx = createRunStreamContext(event.runId);
      this.contexts.set(event.runId, ctx);
      this.replyFilters.set(event.runId, new ReplyFilter());

      this.emit({
        type: 'lifecycle:start',
        agentId: this.agentId,
        runId: event.runId,
        sessionId: event.sessionId,
        startedAt: event.startedAt,
      } as any);
      return;
    }

    // Resolve runId and context
    const runId = 'runId' in event ? event.runId : undefined;
    if (!runId) return;

    const context = this.contexts.get(runId);
    if (!context) {
      if (event.type === 'lifecycle:error') {
        const errorEvent = event as any;
        this.emit({
          type: 'lifecycle:error',
          agentId: this.agentId,
          runId,
          status: 'error',
          error: errorEvent.error,
          startedAt: errorEvent.startedAt,
          endedAt: errorEvent.endedAt,
        });
        this.emit({
          type: 'agent:error',
          agentId: this.agentId,
          error: errorEvent.error?.message ?? 'Unknown error',
        });
      }
      return;
    }

    // Build emit function that stamps agentId
    const finalEmit: EmitFn = (shaped) => {
      const stamped = { ...shaped, agentId: this.agentId } as any;
      this.emit(stamped);
    };

    // Run through all transforms in order
    const replyFilter = this.replyFilters.get(runId)!;
    const allTransforms: StreamTransform[] = [
      this.sharedTransforms[0], // ReasoningGate
      replyFilter,              // ReplyFilter (per-run)
      ...this.sharedTransforms.slice(1), // ToolSummaryCollector, CompactionHandler, ReplyAssembler
    ];

    for (const transform of allTransforms) {
      transform.process(event, context, finalEmit);
    }

    // Backwards compat emissions + cleanup
    if (event.type === 'lifecycle:end') {
      this.emit({ type: 'agent:end', agentId: this.agentId });
      this.contexts.delete(runId);
      this.replyFilters.delete(runId);
    } else if (event.type === 'lifecycle:error') {
      const errorEvent = event as any;
      this.emit({
        type: 'agent:error',
        agentId: this.agentId,
        error: errorEvent.error?.message ?? 'Unknown error',
      });
      this.contexts.delete(runId);
      this.replyFilters.delete(runId);
    }
  }

  private emit(event: ServerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Don't break the loop
      }
    }
  }
}
