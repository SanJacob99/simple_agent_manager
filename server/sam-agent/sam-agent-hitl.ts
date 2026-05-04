import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';

export type SamAgentHitlKind = 'text' | 'confirm';

export type SamAgentHitlAnswer =
  | { kind: 'text'; answer: string }
  | { kind: 'confirm'; answer: 'yes' | 'no' }
  | { cancelled: true; reason: 'timeout' | 'aborted' };

export interface SamAgentHitlEvent {
  type: 'hitl:input_required' | 'hitl:resolved' | 'hitl:cancelled';
  toolCallId: string;
  kind?: SamAgentHitlKind;
  question?: string;
  timeoutMs?: number;
  answer?: SamAgentHitlAnswer;
}

export interface SamAgentHitlRegisterParams {
  toolCallId: string;
  kind: SamAgentHitlKind;
  question: string;
  timeoutMs: number;
}

interface PendingEntry {
  params: SamAgentHitlRegisterParams;
  resolve: (a: SamAgentHitlAnswer) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class SamAgentHitlRegistry {
  private readonly pending = new Map<string, PendingEntry>();

  constructor(private readonly emit: (event: SamAgentHitlEvent) => void = () => {}) {}

  register(params: SamAgentHitlRegisterParams): Promise<SamAgentHitlAnswer> {
    return new Promise<SamAgentHitlAnswer>((resolve) => {
      const finalize = (answer: SamAgentHitlAnswer) => {
        const entry = this.pending.get(params.toolCallId);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.pending.delete(params.toolCallId);
        resolve(answer);
        const eventType: SamAgentHitlEvent['type'] = (answer as any).cancelled
          ? 'hitl:cancelled'
          : 'hitl:resolved';
        this.emit({ type: eventType, toolCallId: params.toolCallId, answer });
      };

      const timer = setTimeout(
        () => finalize({ cancelled: true, reason: 'timeout' }),
        params.timeoutMs,
      );

      this.pending.set(params.toolCallId, { params, resolve: finalize, timer });

      this.emit({
        type: 'hitl:input_required',
        toolCallId: params.toolCallId,
        kind: params.kind,
        question: params.question,
        timeoutMs: params.timeoutMs,
      });
    });
  }

  resolve(toolCallId: string, answer: SamAgentHitlAnswer): boolean {
    const entry = this.pending.get(toolCallId);
    if (!entry) return false;
    entry.resolve(answer);
    return true;
  }

  cancelAll(reason: 'timeout' | 'aborted' = 'aborted'): void {
    // Snapshot the keys to avoid mutation during iteration.
    const ids = [...this.pending.keys()];
    for (const id of ids) {
      const entry = this.pending.get(id);
      if (entry) entry.resolve({ cancelled: true, reason });
    }
  }
}

function textResult(text: string): AgentToolResult<null> {
  return { content: [{ type: 'text', text }], details: null };
}

const ASK_SCHEMA = Type.Object(
  { question: Type.String({ description: 'The question to ask the user' }) },
  { additionalProperties: false },
);

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export function buildSamAgentHitlTools(registry: SamAgentHitlRegistry): AgentTool[] {
  const ask: AgentTool = {
    name: 'samagent_ask',
    label: 'Ask the User',
    description:
      'Ask the user a clarifying free-text question. Returns the user\'s answer string.',
    parameters: ASK_SCHEMA,
    execute: async (toolCallId: string, params: any, _signal?: AbortSignal) => {
      const answer = await registry.register({
        toolCallId,
        kind: 'text',
        question: String(params?.question ?? ''),
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
      if ((answer as any).cancelled) return textResult('cancelled');
      if (answer.kind === 'text') return textResult(answer.answer);
      return textResult('unexpected');
    },
  };

  const confirm: AgentTool = {
    name: 'samagent_confirm',
    label: 'Confirm with the User',
    description: 'Ask the user a yes/no confirmation question. Returns "yes" or "no".',
    parameters: ASK_SCHEMA,
    execute: async (toolCallId: string, params: any, _signal?: AbortSignal) => {
      const answer = await registry.register({
        toolCallId,
        kind: 'confirm',
        question: String(params?.question ?? ''),
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
      if ((answer as any).cancelled) return textResult('cancelled');
      if (answer.kind === 'confirm') return textResult(answer.answer);
      return textResult('unexpected');
    },
  };

  return [ask, confirm];
}
