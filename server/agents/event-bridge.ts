import type WebSocket from 'ws';
import type { RunCoordinator } from './run-coordinator';
import type { CoordinatorEvent } from '../../shared/run-types';
import type { ServerEvent } from '../../shared/protocol';

/**
 * Bridges CoordinatorEvents from a RunCoordinator to connected WebSocket clients.
 * One EventBridge per managed agent.
 */
export class EventBridge {
  private sockets = new Set<WebSocket>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly agentId: string,
    coordinator: RunCoordinator,
  ) {
    this.unsubscribe = coordinator.subscribeAll((event) => {
      this.handleCoordinatorEvent(event);
    });
  }

  addSocket(socket: WebSocket): void {
    this.sockets.add(socket);
  }

  removeSocket(socket: WebSocket): void {
    this.sockets.delete(socket);
  }

  get socketCount(): number {
    return this.sockets.size;
  }

  destroy(): void {
    this.unsubscribe?.();
    this.sockets.clear();
  }

  private handleCoordinatorEvent(event: CoordinatorEvent): void {
    switch (event.type) {
      case 'lifecycle:start':
        this.broadcast({
          type: 'lifecycle:start',
          agentId: this.agentId,
          runId: event.runId,
          sessionId: event.sessionId,
          startedAt: event.startedAt,
        } as any);
        break;

      case 'lifecycle:end':
        this.broadcast({
          type: 'lifecycle:end',
          agentId: this.agentId,
          runId: event.runId,
          status: 'ok',
          startedAt: event.startedAt,
          endedAt: event.endedAt,
          payloads: event.payloads,
          usage: event.usage,
        } as any);
        // Backwards compat
        this.broadcast({ type: 'agent:end', agentId: this.agentId });
        break;

      case 'lifecycle:error':
        this.broadcast({
          type: 'lifecycle:error',
          agentId: this.agentId,
          runId: event.runId,
          status: 'error',
          error: event.error,
          startedAt: event.startedAt,
          endedAt: event.endedAt,
        } as any);
        // Backwards compat
        this.broadcast({
          type: 'agent:error',
          agentId: this.agentId,
          error: event.error.message,
        });
        break;

      case 'stream':
        this.handleStreamEvent(event.runId, event.event);
        break;
    }
  }

  private handleStreamEvent(runId: string, event: unknown): void {
    const e = event as any;
    const agentId = this.agentId;

    switch (e.type) {
      case 'message_start': {
        const msg = e.message as { role?: string };
        if (msg.role === 'assistant') {
          this.broadcast({ type: 'message:start', agentId, runId, message: { role: 'assistant' } } as any);
        }
        break;
      }

      case 'message_update': {
        const aEvent = e.assistantMessageEvent;
        if (aEvent.type === 'text_delta') {
          this.broadcast({ type: 'message:delta', agentId, runId, delta: aEvent.delta } as any);
        }
        if (aEvent.type === 'error') {
          this.broadcast({
            type: 'agent:error',
            agentId,
            error: aEvent.error?.errorMessage || 'Unknown provider error',
          });
        }
        break;
      }

      case 'message_end': {
        const endMsg = e.message as { role?: string; usage?: any };
        if (endMsg.role === 'assistant') {
          this.broadcast({
            type: 'message:end',
            agentId,
            runId,
            message: { role: 'assistant', usage: endMsg.usage },
          } as any);
        }
        break;
      }

      case 'tool_execution_start':
        this.broadcast({
          type: 'tool:start',
          agentId,
          runId,
          toolCallId: e.toolCallId,
          toolName: e.toolName,
        } as any);
        break;

      case 'tool_execution_end': {
        const resultText = e.result?.content
          ?.map((c: { type: string; text?: string }) => c.type === 'text' ? c.text : '')
          .join('') || '';
        this.broadcast({
          type: 'tool:end',
          agentId,
          runId,
          toolCallId: e.toolCallId,
          toolName: e.toolName,
          result: resultText.slice(0, 500),
          isError: !!e.isError,
        } as any);
        break;
      }
    }
  }

  private broadcast(event: ServerEvent): void {
    const json = JSON.stringify(event);
    for (const socket of this.sockets) {
      if (socket.readyState === (socket as any).OPEN) {
        socket.send(json);
      }
    }
  }
}
