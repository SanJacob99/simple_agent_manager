import { agentClient } from './index';
import type { SamAgentEvent } from '../../shared/sam-agent/protocol-types';
import type { GraphSnapshot } from '../../shared/sam-agent/workflow-patch';
import type { ThinkingLevel } from '../types/nodes';

export interface SamAgentModelSelection {
  provider: { pluginId: string; authMethodId: string; envVar: string; baseUrl: string };
  modelId: string;
  thinkingLevel: ThinkingLevel;
}

export const samAgentClient = {
  start(): void {
    agentClient.send({ type: 'samAgent:start' });
  },

  prompt(text: string, currentGraph: GraphSnapshot, modelSelection: SamAgentModelSelection): void {
    agentClient.send({ type: 'samAgent:prompt', text, currentGraph, modelSelection });
  },

  abort(): void {
    agentClient.send({ type: 'samAgent:abort' });
  },

  clear(): void {
    agentClient.send({ type: 'samAgent:clear' });
  },

  hitlRespond(
    toolCallId: string,
    answer: { kind: 'text'; answer: string } | { kind: 'confirm'; answer: 'yes' | 'no' },
  ): void {
    agentClient.send({ type: 'samAgent:hitlRespond', toolCallId, answer });
  },

  patchState(messageId: string, toolCallId: string, state: 'applied' | 'discarded' | 'failed'): void {
    agentClient.send({ type: 'samAgent:patchState', messageId, toolCallId, state });
  },

  /**
   * Subscribe to SAMAgent events emitted by the server.
   * The server wraps each SamAgentEvent in a `samAgent:event` envelope —
   * this method unwraps it before calling the handler.
   * Returns an unsubscribe function.
   */
  onEvent(handler: (event: SamAgentEvent) => void): () => void {
    return agentClient.onEvent((serverEvent) => {
      if (serverEvent.type === 'samAgent:event') {
        handler(serverEvent.event);
      }
    });
  },
};
