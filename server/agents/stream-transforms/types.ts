import type { RunPayload, RunUsage, CoordinatorEvent } from '../../../shared/run-types';
import type { ServerEvent } from '../../../shared/protocol';

export interface ToolSummaryEntry {
  toolCallId: string;
  toolName: string;
  resultText: string;
  isError: boolean;
}

export interface RunStreamContext {
  runId: string;
  textBuffer: string;
  reasoningBuffer: string;
  toolSummaries: ToolSummaryEntry[];
  noReplyDetected: boolean;
  messageSuppressed: boolean;
  compactionRetrying: boolean;
  payloads: RunPayload[];
  usage?: RunUsage;
}

export type EmitFn = (event: ServerEvent) => void;

export interface StreamTransform {
  process(event: CoordinatorEvent, context: RunStreamContext, emit: EmitFn): void;
}

export function createRunStreamContext(runId: string): RunStreamContext {
  return {
    runId,
    textBuffer: '',
    reasoningBuffer: '',
    toolSummaries: [],
    noReplyDetected: false,
    messageSuppressed: false,
    compactionRetrying: false,
    payloads: [],
    usage: undefined,
  };
}
