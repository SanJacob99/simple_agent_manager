import type { AgentConfig } from './agent-config';
import type { RunPayload, RunUsage, StructuredError, WaitResult } from './run-types';

// --- Commands (frontend → backend) ---

export interface AgentStartCommand {
  type: 'agent:start';
  agentId: string;
  config: AgentConfig;
}

export interface ImageAttachment {
  data: string;     // base64-encoded image data (no data: URI prefix)
  mimeType: string; // e.g. 'image/jpeg'
}

export interface AgentPromptCommand {
  type: 'agent:prompt';
  agentId: string;
  sessionId: string;
  text: string;
  attachments?: ImageAttachment[];
}

export interface AgentAbortCommand {
  type: 'agent:abort';
  agentId: string;
  runId?: string;
}

export interface AgentDestroyCommand {
  type: 'agent:destroy';
  agentId: string;
}

export interface AgentSyncCommand {
  type: 'agent:sync';
  agentId: string;
}

export interface AgentDispatchCommand {
  type: 'agent:dispatch';
  agentId: string;
  sessionKey: string;
  text: string;
  attachments?: ImageAttachment[];
}

export interface RunWaitCommand {
  type: 'run:wait';
  agentId: string;
  runId: string;
  timeoutMs?: number;
}

export interface SetApiKeysCommand {
  type: 'config:setApiKeys';
  keys: Record<string, string>;
}

export type Command =
  | AgentStartCommand
  | AgentPromptCommand
  | AgentDispatchCommand
  | AgentAbortCommand
  | AgentDestroyCommand
  | AgentSyncCommand
  | RunWaitCommand
  | SetApiKeysCommand;

// --- Events (backend → frontend) ---

export interface MessageUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
}

export interface AgentReadyEvent {
  type: 'agent:ready';
  agentId: string;
}

export interface AgentErrorEvent {
  type: 'agent:error';
  agentId: string;
  error: string;
}

export interface MessageStartEvent {
  type: 'message:start';
  agentId: string;
  runId?: string;
  message: { role: string };
}

export interface MessageDeltaEvent {
  type: 'message:delta';
  agentId: string;
  runId?: string;
  delta: string;
}

export interface MessageEndEvent {
  type: 'message:end';
  agentId: string;
  runId?: string;
  message: { role: string; usage?: MessageUsage };
}

export interface ToolStartEvent {
  type: 'tool:start';
  agentId: string;
  runId?: string;
  toolCallId: string;
  toolName: string;
}

export interface ToolEndEvent {
  type: 'tool:end';
  agentId: string;
  runId?: string;
  toolCallId: string;
  toolName: string;
  result: string;
  isError: boolean;
}

export interface AgentEndEvent {
  type: 'agent:end';
  agentId: string;
}

export interface RunAcceptedEvent {
  type: 'run:accepted';
  agentId: string;
  runId: string;
  sessionId: string;
  acceptedAt: number;
}

export interface LifecycleStartEvent {
  type: 'lifecycle:start';
  agentId: string;
  runId: string;
  sessionId: string;
  startedAt: number;
}

export interface LifecycleEndEvent {
  type: 'lifecycle:end';
  agentId: string;
  runId: string;
  status: 'ok';
  startedAt: number;
  endedAt: number;
  payloads: RunPayload[];
  usage?: RunUsage;
}

export interface LifecycleErrorEvent {
  type: 'lifecycle:error';
  agentId: string;
  runId: string;
  status: 'error';
  error: StructuredError;
  startedAt?: number;
  endedAt: number;
}

export interface QueueEnteredEvent {
  type: 'queue:entered';
  agentId: string;
  runId: string;
  sessionId: string;
  acceptedAt: number;
  sessionPosition: number;
  globalPosition: number;
}

export interface QueueUpdatedEvent {
  type: 'queue:updated';
  agentId: string;
  runId: string;
  sessionId: string;
  updatedAt: number;
  sessionPosition: number;
  globalPosition: number;
}

export interface QueueLeftEvent {
  type: 'queue:left';
  agentId: string;
  runId: string;
  sessionId: string;
  leftAt: number;
  reason: 'started' | 'aborted' | 'destroyed';
}

export interface RunWaitResultEvent extends WaitResult {
  type: 'run:wait:result';
  agentId: string;
}

export interface AgentStateEvent {
  type: 'agent:state';
  agentId: string;
  status: 'idle' | 'running' | 'error' | 'not_found';
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'tool';
    content: string;
    timestamp: number;
    tokenCount?: number;
    usage?: MessageUsage;
  }>;
}

export interface ReasoningStartEvent {
  type: 'reasoning:start';
  agentId: string;
  runId: string;
}

export interface ReasoningDeltaEvent {
  type: 'reasoning:delta';
  agentId: string;
  runId: string;
  delta: string;
}

export interface ReasoningEndEvent {
  type: 'reasoning:end';
  agentId: string;
  runId: string;
  content: string;
}

export interface MessageSuppressedEvent {
  type: 'message:suppressed';
  agentId: string;
  runId: string;
  reason: 'no_reply' | 'messaging_tool_dedup';
}

export interface CompactionStartEvent {
  type: 'compaction:start';
  agentId: string;
  runId: string;
}

export interface CompactionEndEvent {
  type: 'compaction:end';
  agentId: string;
  runId: string;
  retrying: boolean;
}

export interface ToolSummaryEvent {
  type: 'tool:summary';
  agentId: string;
  runId: string;
  toolCallId: string;
  toolName: string;
  summary: string;
}

export type ServerEvent =
  | AgentReadyEvent
  | AgentErrorEvent
  | MessageStartEvent
  | MessageDeltaEvent
  | MessageEndEvent
  | ToolStartEvent
  | ToolEndEvent
  | AgentEndEvent
  | AgentStateEvent
  | RunAcceptedEvent
  | QueueEnteredEvent
  | QueueUpdatedEvent
  | QueueLeftEvent
  | RunWaitResultEvent
  | LifecycleStartEvent
  | LifecycleEndEvent
  | LifecycleErrorEvent
  | ReasoningStartEvent
  | ReasoningDeltaEvent
  | ReasoningEndEvent
  | MessageSuppressedEvent
  | CompactionStartEvent
  | CompactionEndEvent
  | ToolSummaryEvent;
