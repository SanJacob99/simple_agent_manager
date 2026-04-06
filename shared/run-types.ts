// shared/run-types.ts
// Note: shared/ must not import from server/. Stream events use `unknown` for the wrapped event.

export interface DispatchParams {
  sessionKey: string;
  text: string;
  attachments?: import('./protocol').ImageAttachment[];
  timeoutMs?: number;
}

export interface DispatchResult {
  runId: string;
  sessionId: string;
  acceptedAt: number;
}

export interface RunQueueSnapshot {
  sessionPosition: number;
  globalPosition: number;
}

export interface WaitResult {
  runId: string;
  status: 'ok' | 'error' | 'timeout';
  phase: 'pending' | 'running' | 'completed' | 'error';
  acceptedAt: number;
  startedAt?: number;
  endedAt?: number;
  queue?: RunQueueSnapshot;
  payloads: RunPayload[];
  usage?: RunUsage;
  error?: StructuredError;
}

export interface StructuredError {
  code: 'model_refused' | 'rate_limited' | 'timeout' | 'aborted' | 'internal';
  message: string;
  retriable: boolean;
}

export interface RunPayload {
  type: 'text' | 'reasoning' | 'tool_summary' | 'error';
  content: string;
}

export interface RunUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
}

export type CoordinatorEvent =
  | {
      type: 'queue:entered';
      runId: string;
      agentId: string;
      sessionId: string;
      acceptedAt: number;
      sessionPosition: number;
      globalPosition: number;
    }
  | {
      type: 'queue:updated';
      runId: string;
      agentId: string;
      sessionId: string;
      updatedAt: number;
      sessionPosition: number;
      globalPosition: number;
    }
  | {
      type: 'queue:left';
      runId: string;
      agentId: string;
      sessionId: string;
      leftAt: number;
      reason: 'started' | 'aborted' | 'destroyed';
    }
  | { type: 'lifecycle:start'; runId: string; agentId: string; sessionId: string; startedAt: number }
  | { type: 'lifecycle:end'; runId: string; status: 'ok'; startedAt: number; endedAt: number; payloads: RunPayload[]; usage?: RunUsage }
  | { type: 'lifecycle:error'; runId: string; status: 'error'; error: StructuredError; startedAt?: number; endedAt: number }
  | { type: 'stream'; runId: string; event: unknown };

export type RunEventListener = (event: CoordinatorEvent) => void;
