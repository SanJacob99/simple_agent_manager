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
  const pendingStarts = new Map<string, Promise<void>>();

  socket.on('message', async (data) => {
    let command: Command;
    try {
      command = JSON.parse(data.toString()) as Command;
      console.log(`[ws] Received command: ${command.type}`, 'agentId' in command ? `(Agent: ${(command as any).agentId})` : '');
    } catch {
      socket.send(JSON.stringify({ type: 'error', error: 'Invalid JSON' }));
      return;
    }

    try {
      switch (command.type) {
        case 'agent:start': {
          const startPromise = manager.start(command.config);
          pendingStarts.set(command.agentId, startPromise);
          try {
            await startPromise;
          } finally {
            if (pendingStarts.get(command.agentId) === startPromise) {
              pendingStarts.delete(command.agentId);
            }
          }
          manager.addSocket(command.agentId, socket);
          socket.send(JSON.stringify({
            type: 'agent:ready',
            agentId: command.agentId,
          }));
          break;
        }

        case 'agent:dispatch': {
          await pendingStarts.get(command.agentId);
          manager.addSocket(command.agentId, socket);
          const result = await manager.dispatch(command.agentId, {
            sessionKey: command.sessionKey,
            text: command.text,
            attachments: command.attachments,
          });
          socket.send(JSON.stringify({
            type: 'run:accepted',
            agentId: command.agentId,
            runId: result.runId,
            sessionId: result.sessionId,
            acceptedAt: result.acceptedAt,
          }));
          break;
        }

        case 'agent:prompt': {
          // Backwards compat: translate to dispatch
          await pendingStarts.get(command.agentId);
          manager.addSocket(command.agentId, socket);
          const result = await manager.dispatch(command.agentId, {
            sessionKey: command.sessionId,
            text: command.text,
            attachments: command.attachments,
          });
          socket.send(JSON.stringify({
            type: 'run:accepted',
            agentId: command.agentId,
            runId: result.runId,
            sessionId: result.sessionId,
            acceptedAt: result.acceptedAt,
          }));
          break;
        }

        case 'run:wait': {
          const waitResult = await manager.wait(command.agentId, command.runId, command.timeoutMs);
          socket.send(JSON.stringify({
            type: 'run:wait:result',
            agentId: command.agentId,
            ...waitResult,
          }));
          break;
        }

        case 'agent:abort': {
          manager.abort(command.agentId, command.runId);
          break;
        }

        case 'agent:destroy': {
          manager.destroy(command.agentId);
          break;
        }

        case 'agent:sync': {
          manager.addSocket(command.agentId, socket);
          const stateEvent: AgentStateEvent = {
            type: 'agent:state',
            agentId: command.agentId,
            status: manager.getStatus(command.agentId),
            messages: [],
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
