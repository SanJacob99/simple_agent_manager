import type WebSocket from 'ws';
import type { StreamProcessor } from './stream-processor';
import type { ServerEvent } from '../../shared/protocol';

/**
 * Thin WebSocket broadcaster. Subscribes to shaped events from StreamProcessor
 * and forwards them to connected WebSocket clients.
 */
export class EventBridge {
  private sockets = new Set<WebSocket>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly agentId: string,
    processor: StreamProcessor,
  ) {
    this.unsubscribe = processor.subscribe((event) => {
      this.broadcast(event);
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

  private broadcast(event: ServerEvent): void {
    const json = JSON.stringify(event);
    for (const socket of this.sockets) {
      if (socket.readyState === (socket as any).OPEN) {
        socket.send(json);
      }
    }
  }
}
