import type WebSocket from 'ws';
import type { RuntimeEvent } from '../runtime/agent-runtime';
import type { ServerEvent } from '../../shared/protocol';

/**
 * Bridges RuntimeEvents from an AgentRuntime to connected WebSocket clients.
 * One EventBridge per managed agent.
 */
export class EventBridge {
  private sockets = new Set<WebSocket>();

  constructor(private readonly agentId: string) {}

  addSocket(socket: WebSocket): void {
    this.sockets.add(socket);
  }

  removeSocket(socket: WebSocket): void {
    this.sockets.delete(socket);
  }

  get socketCount(): number {
    return this.sockets.size;
  }

  handleRuntimeEvent(event: RuntimeEvent): void {
    const serverEvent = this.mapEvent(event);
    if (!serverEvent) return;
    this.broadcast(serverEvent);
  }

  private broadcast(event: ServerEvent): void {
    const json = JSON.stringify(event);
    for (const socket of this.sockets) {
      if (socket.readyState === socket.OPEN) {
        socket.send(json);
      }
    }
  }

  private mapEvent(event: RuntimeEvent): ServerEvent | null {
    const agentId = this.agentId;

    switch (event.type) {
      case 'runtime_ready':
        return { type: 'agent:ready', agentId };

      case 'runtime_error':
        return { type: 'agent:error', agentId, error: event.error };

      case 'message_start': {
        const msg = event.message as { role?: string };
        if (msg.role === 'assistant') {
          return { type: 'message:start', agentId, message: { role: 'assistant' } };
        }
        return null;
      }

      case 'message_update': {
        const aEvent = event.assistantMessageEvent;
        if (aEvent.type === 'text_delta') {
          return { type: 'message:delta', agentId, delta: aEvent.delta };
        }
        if (aEvent.type === 'error') {
          return {
            type: 'agent:error',
            agentId,
            error: aEvent.error?.errorMessage || 'Unknown provider error',
          };
        }
        return null;
      }

      case 'message_end': {
        const endMsg = event.message as {
          role?: string;
          usage?: {
            input: number;
            output: number;
            cacheRead: number;
            cacheWrite: number;
            totalTokens: number;
          };
        };
        if (endMsg.role === 'assistant') {
          return {
            type: 'message:end',
            agentId,
            message: { role: 'assistant', usage: endMsg.usage },
          };
        }
        return null;
      }

      case 'tool_execution_start':
        return {
          type: 'tool:start',
          agentId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
        };

      case 'tool_execution_end': {
        const resultText =
          event.result?.content
            ?.map((c: { type: string; text?: string }) =>
              c.type === 'text' ? c.text : '',
            )
            .join('') || '';
        return {
          type: 'tool:end',
          agentId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: resultText.slice(0, 500),
          isError: !!event.isError,
        };
      }

      case 'agent_end':
        return { type: 'agent:end', agentId };

      default:
        return null;
    }
  }
}
