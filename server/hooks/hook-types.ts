// server/hooks/hook-types.ts
// All hook context interfaces for Layer 4: Hooks & Plugin Lifecycle

import type { AgentConfig } from '../../shared/agent-config';
import type { RunPayload, RunUsage, StructuredError } from '../../shared/run-types';

// ---------------------------------------------------------------------------
// Hook handler type
// ---------------------------------------------------------------------------

export type HookHandler<TContext> = (context: TContext) => Promise<void> | void;

export interface HookRegistration<TContext = unknown> {
  pluginId: string;           // 'internal' for built-in hooks
  handler: HookHandler<TContext>;
  priority: number;           // lower = earlier, default 100
  critical: boolean;          // if true, error in handler stops the pipeline
}

// ---------------------------------------------------------------------------
// Core hook contexts (fully wired)
// ---------------------------------------------------------------------------

/** Fires after session resolution, before model is used. No messages available. */
export interface BeforeModelResolveContext {
  agentId: string;
  runId: string;
  sessionId: string;
  config: Readonly<AgentConfig>;
  overrides: {
    provider?: string; // runtimeProviderId override, not pluginId
    modelId?: string;
  };
}

/** Fires after session load, before system prompt is finalized. */
export interface BeforePromptBuildContext {
  agentId: string;
  runId: string;
  sessionId: string;
  config: Readonly<AgentConfig>;
  messages: ReadonlyArray<unknown>;
  overrides: {
    prependContext?: string;
    systemPrompt?: string;
    prependSystemContext?: string;
    appendSystemContext?: string;
  };
}

/** Fires before the first LLM call. Plugin can claim the turn. */
export interface BeforeAgentReplyContext {
  agentId: string;
  runId: string;
  sessionId: string;
  messages: ReadonlyArray<unknown>;
  claimed: boolean;
  syntheticReply?: string;
  silent: boolean;
}

/** Fires before each tool execution. */
export interface BeforeToolCallContext {
  agentId: string;
  runId: string;
  toolCallId: string;
  toolName: string;
  params: Record<string, unknown>;
  blocked: boolean;
  blockReason?: string;
}

/** Fires after each tool execution. */
export interface AfterToolCallContext {
  agentId: string;
  runId: string;
  toolCallId: string;
  toolName: string;
  params: Record<string, unknown>;
  result: string;
  isError: boolean;
  transformedResult?: string;
}

/** Fires after a run completes (success or error). Read-only. */
export interface AgentEndContext {
  agentId: string;
  runId: string;
  sessionId: string;
  status: 'completed' | 'error';
  payloads: ReadonlyArray<RunPayload>;
  usage?: RunUsage;
  error?: StructuredError;
}

// ---------------------------------------------------------------------------
// Scaffolded hook contexts (types defined, integration deferred)
// ---------------------------------------------------------------------------

/** Synchronously transform tool results before transcript persistence. */
export interface ToolResultPersistContext {
  agentId: string;
  runId: string;
  toolCallId: string;
  toolName: string;
  result: string;
  transformedResult?: string;
}

/** Fires before/after compaction cycles. */
export interface CompactionHookContext {
  agentId: string;
  runId: string;
  sessionId: string;
  messageCount: number;
  strategy: string;
  phase: 'before' | 'after';
  summary?: string;
}

/** Fires before a skill or plugin install. Can block. */
export interface BeforeInstallContext {
  agentId: string;
  itemType: 'skill' | 'plugin';
  itemId: string;
  itemName: string;
  blocked: boolean;
  blockReason?: string;
}

/** Fires on dispatch, after validation but before queueing. */
export interface MessageReceivedContext {
  agentId: string;
  runId: string;
  sessionId: string;
  text: string;
  blocked: boolean;
  blockReason?: string;
}

/** Fires before reply is emitted to frontend. */
export interface MessageSendingContext {
  agentId: string;
  runId: string;
  payloads: RunPayload[];
  transformedPayloads?: RunPayload[];
}

/** Fires after reply has been broadcast. Read-only. */
export interface MessageSentContext {
  agentId: string;
  runId: string;
  payloads: ReadonlyArray<RunPayload>;
}

/** Session lifecycle boundaries. */
export interface SessionLifecycleContext {
  agentId: string;
  sessionId: string;
  sessionKey: string;
  phase: 'start' | 'end';
}

/** Backend lifecycle events (global, not per-agent). */
export interface BackendLifecycleContext {
  phase: 'start' | 'stop';
  timestamp: number;
}

/** Internal hook: bootstrap file injection during system prompt build. */
export interface AgentBootstrapContext {
  agentId: string;
  bootstrapFiles: Array<{ name: string; content: string }>;
  added: Array<{ name: string; content: string }>;
  removed: string[];
}

// ---------------------------------------------------------------------------
// Hook name constants
// ---------------------------------------------------------------------------

export const HOOK_NAMES = {
  // Core (fully wired)
  BEFORE_MODEL_RESOLVE: 'before_model_resolve',
  BEFORE_PROMPT_BUILD: 'before_prompt_build',
  BEFORE_AGENT_REPLY: 'before_agent_reply',
  BEFORE_TOOL_CALL: 'before_tool_call',
  AFTER_TOOL_CALL: 'after_tool_call',
  AGENT_END: 'agent_end',

  // Scaffolded
  TOOL_RESULT_PERSIST: 'tool_result_persist',
  BEFORE_COMPACTION: 'before_compaction',
  AFTER_COMPACTION: 'after_compaction',
  BEFORE_INSTALL: 'before_install',
  MESSAGE_RECEIVED: 'message_received',
  MESSAGE_SENDING: 'message_sending',
  MESSAGE_SENT: 'message_sent',
  SESSION_START: 'session_start',
  SESSION_END: 'session_end',
  BACKEND_START: 'backend_start',
  BACKEND_STOP: 'backend_stop',
  AGENT_BOOTSTRAP: 'agent:bootstrap',
} as const;

export type HookName = typeof HOOK_NAMES[keyof typeof HOOK_NAMES];
