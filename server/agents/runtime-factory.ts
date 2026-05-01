import type { AgentConfig } from '../../shared/agent-config';
import type { AgentRuntime } from '../runtime/agent-runtime';

/**
 * Builds a fresh runtime for a resolved config. AgentManager owns the real
 * dependencies; RunCoordinator receives this as an optional bridge for
 * one-shot sub-agent runs.
 */
export type RuntimeFactory = (config: AgentConfig) => AgentRuntime;
