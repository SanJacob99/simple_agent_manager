import type { CoordinatorEvent } from '../../../shared/run-types';
import type {
  ToolEndEvent,
  ToolResultAudio,
  ToolResultImage,
} from '../../../shared/protocol';
import type { RunStreamContext, EmitFn, StreamTransform } from './types';

const MAX_SUMMARY_LENGTH = 500;

/**
 * Read a single audio payload out of `tool_execution_end.result.details`.
 * Tools opt in by setting `details = { audio: { mimeType, data, ... } }`
 * (see `TtsAudioDetails` in `server/tools/builtins/tts/text-to-speech.ts`).
 * Multi-clip tools can use `details.audios: [...]` instead.
 */
function extractAudioPayloads(details: unknown): ToolResultAudio[] {
  if (!details || typeof details !== 'object') return [];
  const d = details as { audio?: unknown; audios?: unknown };
  const raw: unknown[] = Array.isArray(d.audios)
    ? d.audios
    : d.audio
      ? [d.audio]
      : [];
  const out: ToolResultAudio[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Partial<ToolResultAudio>;
    if (typeof a.mimeType !== 'string' || typeof a.data !== 'string') continue;
    out.push({
      mimeType: a.mimeType,
      data: a.data,
      path: typeof a.path === 'string' ? a.path : undefined,
      filename: typeof a.filename === 'string' ? a.filename : undefined,
      transcript: typeof a.transcript === 'string' ? a.transcript : undefined,
      provider: typeof a.provider === 'string' ? a.provider : undefined,
    });
  }
  return out;
}

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
      const images: ToolResultImage[] = contentBlocks
        .filter((c) => c.type === 'image' && c.data && c.mimeType)
        .map((c) => ({ mimeType: c.mimeType!, data: c.data! }));
      const audios = extractAudioPayloads(raw.result?.details);

      context.toolSummaries.push({
        toolCallId: raw.toolCallId,
        toolName: raw.toolName,
        resultText,
        isError: !!raw.isError,
      });

      const toolEnd: ToolEndEvent = {
        type: 'tool:end',
        agentId: '',
        runId: context.runId,
        toolCallId: raw.toolCallId,
        toolName: raw.toolName,
        result: resultText.slice(0, MAX_SUMMARY_LENGTH),
        isError: !!raw.isError,
        images: images.length > 0 ? images : undefined,
        audios: audios.length > 0 ? audios : undefined,
      };
      emit(toolEnd as any);

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
