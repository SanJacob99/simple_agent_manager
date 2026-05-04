import { randomUUID } from 'node:crypto';
import type { AgentRuntime, RuntimeEvent } from '../runtime/agent-runtime';
import type { GraphSnapshot } from '../../shared/sam-agent/workflow-patch';
import {
  SamAgentTranscriptStore,
  type SamAgentMessage,
  type SamAgentToolResult,
} from './sam-agent-transcript';
import { SamAgentHitlRegistry, type SamAgentHitlAnswer } from './sam-agent-hitl';
import { buildSamAgentTools } from './sam-agent-tools';
import { buildSamAgentSystemPrompt } from './sam-agent-system-prompt';
import { buildSamAgentConfig, type SamAgentModelSelection } from './sam-agent-config';
import type { SamAgentEvent, SamAgentEventEnvelope } from '../../shared/sam-agent/protocol-types';

// Re-export so existing server-internal code that imports these from this module still compiles.
export type { SamAgentEvent, SamAgentEventEnvelope } from '../../shared/sam-agent/protocol-types';

export interface SamAgentDispatchParams {
  text: string;
  currentGraph: GraphSnapshot;
  modelSelection: SamAgentModelSelection;
}

export interface SamAgentCoordinatorOptions {
  transcriptPath: string;
  repoRoot: string;
  buildRuntime: (config: ReturnType<typeof buildSamAgentConfig>) => AgentRuntime;
  emit: (event: SamAgentEventEnvelope) => void;
}

export class SamAgentCoordinator {
  private readonly transcript: SamAgentTranscriptStore;
  private readonly hitl: SamAgentHitlRegistry;
  private snapshot: GraphSnapshot = { nodes: [], edges: [] };
  private currentRuntime: AgentRuntime | null = null;
  private currentMessageId: string | null = null;
  private currentText = '';
  private toolResults: SamAgentToolResult[] = [];

  constructor(private readonly opts: SamAgentCoordinatorOptions) {
    this.transcript = new SamAgentTranscriptStore(opts.transcriptPath);
    this.hitl = new SamAgentHitlRegistry((event) => {
      // Forward HITL events to the WS layer as samAgent:event envelopes.
      if (event.type === 'hitl:input_required') {
        this.opts.emit({
          type: 'samAgent:event',
          event: {
            type: 'hitl:input_required',
            toolCallId: event.toolCallId,
            kind: event.kind!,
            question: event.question!,
            timeoutMs: event.timeoutMs!,
          },
        });
      } else if (event.type === 'hitl:resolved' || event.type === 'hitl:cancelled') {
        this.opts.emit({
          type: 'samAgent:event',
          event: { type: 'hitl:resolved', toolCallId: event.toolCallId, answer: event.answer! },
        });
      }
    });
  }

  async readTranscript(): Promise<SamAgentMessage[]> {
    return this.transcript.read();
  }

  async clear(): Promise<void> {
    this.hitl.cancelAll('aborted');
    await this.transcript.clear();
  }

  resolveHitl(toolCallId: string, answer: SamAgentHitlAnswer): boolean {
    return this.hitl.resolve(toolCallId, answer);
  }

  async updatePatchState(
    messageId: string,
    toolCallId: string,
    state: NonNullable<SamAgentToolResult['patchState']>,
  ): Promise<boolean> {
    return this.transcript.updatePatchState(messageId, toolCallId, state);
  }

  abort(): void {
    this.hitl.cancelAll('aborted');
    this.currentRuntime?.abort();
  }

  async dispatch(params: SamAgentDispatchParams): Promise<void> {
    const userMessage: SamAgentMessage = {
      id: randomUUID(),
      role: 'user',
      text: params.text,
      timestamp: Date.now(),
    };
    await this.transcript.append(userMessage);

    this.snapshot = params.currentGraph;
    const systemPromptText = buildSamAgentSystemPrompt(this.snapshot);
    const config = buildSamAgentConfig({ modelSelection: params.modelSelection, systemPromptText });

    const runtime = this.opts.buildRuntime(config);
    this.currentRuntime = runtime;
    runtime.addTools(
      buildSamAgentTools({
        repoRoot: this.opts.repoRoot,
        patchCtx: { getSnapshot: () => this.snapshot },
        hitlRegistry: this.hitl,
      }),
    );

    this.currentMessageId = randomUUID();
    this.currentText = '';
    this.toolResults = [];

    // AgentRuntime.subscribe(listener) returns an unsubscribe function.
    // This is the actual API exposed by server/runtime/agent-runtime.ts.
    const handler = (e: RuntimeEvent) => this.onRuntimeEvent(e);
    const unsubscribe = runtime.subscribe(handler);

    this.opts.emit({ type: 'samAgent:event', event: { type: 'lifecycle:start' } });

    try {
      await runtime.prompt(params.text);
    } catch (err) {
      this.opts.emit({
        type: 'samAgent:event',
        event: { type: 'lifecycle:error', error: err instanceof Error ? err.message : String(err) },
      });
    } finally {
      unsubscribe();
    }

    const assistantMessage: SamAgentMessage = {
      id: this.currentMessageId,
      role: 'assistant',
      text: this.currentText,
      timestamp: Date.now(),
      toolResults: this.toolResults.length > 0 ? this.toolResults : undefined,
    };
    await this.transcript.append(assistantMessage);
    this.opts.emit({ type: 'samAgent:event', event: { type: 'lifecycle:end' } });
  }

  /**
   * Map real AgentEvent discriminator names (underscores, from pi-agent-core) to
   * shaped SamAgentEvents (colon-delimited) for the WS layer.
   *
   * Event mapping:
   *   message_start            → message:start
   *   message_update/text_delta → message:delta  (only text_delta assistantMessageEvents)
   *   message_end              → message:end
   *   tool_execution_start     → tool:start
   *   tool_execution_end       → tool:end
   *   agent_end, others        → ignored (lifecycle:end is emitted in dispatch())
   */
  private onRuntimeEvent(e: RuntimeEvent): void {
    const t = (e as any).type as string;
    if (!t) return;

    switch (t) {
      case 'message_start':
        this.opts.emit({
          type: 'samAgent:event',
          event: { type: 'message:start', messageId: this.currentMessageId! },
        });
        break;

      case 'message_update': {
        // assistantMessageEvent contains the granular streaming event from pi-ai.
        // We emit message:delta only for text_delta events to pass text chunks.
        const ame = (e as any).assistantMessageEvent;
        if (ame?.type === 'text_delta') {
          const delta: string = ame.delta ?? '';
          this.currentText += delta;
          this.opts.emit({
            type: 'samAgent:event',
            event: { type: 'message:delta', messageId: this.currentMessageId!, textDelta: delta },
          });
        }
        break;
      }

      case 'message_end': {
        // Extract the final text from the message's content blocks.
        const msg = (e as any).message;
        if (msg?.content && Array.isArray(msg.content)) {
          const textContent = msg.content
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text ?? '')
            .join('');
          if (textContent) this.currentText = textContent;
        }
        this.opts.emit({
          type: 'samAgent:event',
          event: { type: 'message:end', messageId: this.currentMessageId!, text: this.currentText },
        });
        break;
      }

      case 'tool_execution_start': {
        const argsJson = (() => {
          try { return JSON.stringify((e as any).args ?? {}); } catch { return '{}'; }
        })();
        this.opts.emit({
          type: 'samAgent:event',
          event: {
            type: 'tool:start',
            toolCallId: (e as any).toolCallId ?? '',
            toolName: (e as any).toolName ?? '',
            argsJson,
          },
        });
        break;
      }

      case 'tool_execution_end': {
        const toolName: string = (e as any).toolName ?? '';
        const toolCallId: string = (e as any).toolCallId ?? '';
        const resultJson: string = (() => {
          try { return JSON.stringify((e as any).result ?? {}); } catch { return '{}'; }
        })();
        if (toolName === 'propose_workflow_patch') {
          this.toolResults.push({ toolName, toolCallId, resultJson, patchState: 'pending' });
        }
        this.opts.emit({
          type: 'samAgent:event',
          event: { type: 'tool:end', toolCallId, resultJson },
        });
        break;
      }

      // agent_end, runtime_ready, runtime_error, memory_compaction, context_usage_preview, etc.
      // are either handled elsewhere (lifecycle:end in dispatch()) or not relevant for v1.
      default:
        break;
    }
  }
}
