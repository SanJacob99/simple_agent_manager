import type { CoordinatorEvent } from '../../../shared/run-types';
import type { RunStreamContext, EmitFn, StreamTransform } from './types';

const MAX_SUMMARY_LENGTH = 500;

export class ToolSummaryCollector implements StreamTransform {
  constructor(private readonly verbose: boolean) {}

  process(event: CoordinatorEvent, context: RunStreamContext, emit: EmitFn): void {
    if (event.type !== 'stream') return;

    const raw = event.event as any;

    if (raw.type === 'tool_execution_start') {
      emit({
        type: 'tool:start',
        agentId: '',
        runId: context.runId,
        toolCallId: raw.toolCallId,
        toolName: raw.toolName,
      } as any);
      return;
    }

    if (raw.type === 'tool_execution_end') {
      const contentBlocks = (raw.result?.content ?? []) as Array<{
        type: string;
        text?: string;
        mimeType?: string;
        data?: string;
      }>;
      const resultText = contentBlocks
        .map((c) => (c.type === 'text' ? c.text ?? '' : ''))
        .join('');
      const images = contentBlocks
        .filter((c) => c.type === 'image' && c.data && c.mimeType)
        .map((c) => ({ mimeType: c.mimeType!, data: c.data! }));

      context.toolSummaries.push({
        toolCallId: raw.toolCallId,
        toolName: raw.toolName,
        resultText,
        isError: !!raw.isError,
      });

      emit({
        type: 'tool:end',
        agentId: '',
        runId: context.runId,
        toolCallId: raw.toolCallId,
        toolName: raw.toolName,
        result: resultText.slice(0, MAX_SUMMARY_LENGTH),
        images: images.length > 0 ? images : undefined,
        isError: !!raw.isError,
      } as any);

      if (this.verbose) {
        emit({
          type: 'tool:summary',
          agentId: '',
          runId: context.runId,
          toolCallId: raw.toolCallId,
          toolName: raw.toolName,
          summary: resultText.slice(0, MAX_SUMMARY_LENGTH),
        } as any);
      }
      return;
    }
  }
}
