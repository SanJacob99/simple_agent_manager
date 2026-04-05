import type { AgentConfig } from './agent-config';

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
}

export interface AgentDestroyCommand {
  type: 'agent:destroy';
  agentId: string;
}

export interface AgentSyncCommand {
  type: 'agent:sync';
  agentId: string;
}

export interface SetApiKeysCommand {
  type: 'config:setApiKeys';
  keys: Record<string, string>;
}

export type Command =
  | AgentStartCommand
  | AgentPromptCommand
  | AgentAbortCommand
  | AgentDestroyCommand
  | AgentSyncCommand
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
  message: { role: string };
}

export interface MessageDeltaEvent {
  type: 'message:delta';
  agentId: string;
  delta: string;
}

export interface MessageEndEvent {
  type: 'message:end';
  agentId: string;
  message: { role: string; usage?: MessageUsage };
}

export interface ToolStartEvent {
  type: 'tool:start';
  agentId: string;
  toolCallId: string;
  toolName: string;
}

export interface ToolEndEvent {
  type: 'tool:end';
  agentId: string;
  toolCallId: string;
  toolName: string;
  result: string;
  isError: boolean;
}

export interface AgentEndEvent {
  type: 'agent:end';
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

export type ServerEvent =
  | AgentReadyEvent
  | AgentErrorEvent
  | MessageStartEvent
  | MessageDeltaEvent
  | MessageEndEvent
  | ToolStartEvent
  | ToolEndEvent
  | AgentEndEvent
  | AgentStateEvent;
