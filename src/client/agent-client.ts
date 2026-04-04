import type { Command, ServerEvent } from '../../shared/protocol';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';
export type EventHandler = (event: ServerEvent) => void;
export type StatusHandler = (status: ConnectionStatus) => void;

/**
 * Singleton WebSocket manager for the frontend.
 * Connects to the backend, sends commands, dispatches events.
 * Auto-reconnects with exponential backoff.
 */
export class AgentClient {
  private socket: WebSocket | null = null;
  private _status: ConnectionStatus = 'disconnected';
  private eventListeners = new Set<EventHandler>();
  private statusListeners = new Set<StatusHandler>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSyncs = new Set<string>();

  constructor(private readonly url: string) {}

  get status(): ConnectionStatus {
    return this._status;
  }

  connect(): void {
    if (this.socket && this._status !== 'disconnected') return;
    this.setStatus('connecting');

    this.socket = new WebSocket(this.url);

    this.socket.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus('connected');
      // Re-sync any pending agents
      for (const agentId of this.pendingSyncs) {
        this.send({ type: 'agent:sync', agentId });
      }
    };

    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as ServerEvent;
        for (const handler of this.eventListeners) {
          handler(data);
        }
      } catch {
        console.error('[AgentClient] Failed to parse message:', event.data);
      }
    };

    this.socket.onclose = () => {
      this.setStatus('disconnected');
      this.scheduleReconnect();
    };

    this.socket.onerror = () => {
      // onclose will fire after onerror
    };
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.setStatus('disconnected');
  }

  send(command: Command): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn('[AgentClient] Cannot send, socket not open');
      return;
    }
    this.socket.send(JSON.stringify(command));
  }

  /** Register for sync on reconnect. */
  trackAgent(agentId: string): void {
    this.pendingSyncs.add(agentId);
  }

  /** Stop tracking an agent for reconnect sync. */
  untrackAgent(agentId: string): void {
    this.pendingSyncs.delete(agentId);
  }

  onEvent(handler: EventHandler): () => void {
    this.eventListeners.add(handler);
    return () => this.eventListeners.delete(handler);
  }

  onStatusChange(handler: StatusHandler): () => void {
    this.statusListeners.add(handler);
    return () => this.statusListeners.delete(handler);
  }

  private setStatus(status: ConnectionStatus): void {
    this._status = status;
    for (const handler of this.statusListeners) {
      handler(status);
    }
  }

  private scheduleReconnect(): void {
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }
}
