import type WebSocket from 'ws';
import type { AgentManager } from '../agents/agent-manager';
import type { ApiKeyStore } from '../auth/api-keys';
import type { Command, AgentStateEvent } from '../../shared/protocol';

/**
 * Handles a single WebSocket connection: parses incoming commands,
 * routes them to AgentManager, manages socket lifecycle.
 */
export function handleConnection(
  socket: WebSocket,
  manager: AgentManager,
  apiKeys: ApiKeyStore,
): void {
  console.log('[ws] Client connected');

  socket.on('message', async (data) => {
    let command: Command;
    try {
      command = JSON.parse(data.toString()) as Command;
      console.log(`[ws] Received command: ${command.type}`, command.type === 'agent:prompt' ? `(Agent: ${command.agentId})` : '');
    } catch {
      socket.send(JSON.stringify({ type: 'error', error: 'Invalid JSON' }));
      return;
    }

    try {
      switch (command.type) {
        case 'agent:start': {
          manager.start(command.config);
          manager.addSocket(command.agentId, socket);
          socket.send(JSON.stringify({
            type: 'agent:ready',
            agentId: command.agentId,
          }));
          break;
        }

        case 'agent:prompt': {
          manager.addSocket(command.agentId, socket);
          await manager.prompt(command.agentId, command.sessionId, command.text, command.attachments);
          break;
        }

        case 'agent:abort': {
          manager.abort(command.agentId);
          break;
        }

        case 'agent:destroy': {
          manager.destroy(command.agentId);
          break;
        }

        case 'agent:sync': {
          const status = manager.getStatus(command.agentId);
          manager.addSocket(command.agentId, socket);

          const stateEvent: AgentStateEvent = {
            type: 'agent:state',
            agentId: command.agentId,
            status: status,
            messages: [], // Messages loaded via existing StorageEngine REST routes
          };
          socket.send(JSON.stringify(stateEvent));
          break;
        }

        case 'config:setApiKeys': {
          apiKeys.setAll(command.keys);
          break;
        }
      }
    } catch (err) {
      socket.send(JSON.stringify({
        type: 'agent:error',
        agentId: (command as any).agentId ?? 'unknown',
        error: err instanceof Error ? err.message : 'Unknown error',
      }));
    }
  });

  socket.on('close', () => {
    console.log('[ws] Client disconnected');
    manager.removeSocketFromAll(socket);
  });

  socket.on('error', (err) => {
    console.error('[ws] Socket error:', err.message);
    manager.removeSocketFromAll(socket);
  });
}
