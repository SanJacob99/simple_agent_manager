import type WebSocket from 'ws';
import type { AgentManager } from '../agents/agent-manager';
import type { ApiKeyStore } from '../auth/api-keys';
import type { Command, AgentStateEvent, HitlListResultEvent } from '../../shared/protocol';
import type { SamAgentCoordinator, SamAgentEventEnvelope } from '../sam-agent/sam-agent-coordinator';
import { log, logError, logConsoleAndFile } from '../logger';

/**
 * Handles a single WebSocket connection: parses incoming commands,
 * routes them to AgentManager, manages socket lifecycle.
 */
export function handleConnection(
  socket: WebSocket,
  manager: AgentManager,
  apiKeys: ApiKeyStore,
  samAgent?: SamAgentCoordinator,
  samAgentBroadcasters?: Set<(envelope: SamAgentEventEnvelope) => void>,
): void {
  logConsoleAndFile('ws', 'Client connected');
  const pendingStarts = new Map<string, Promise<void>>();

  // Register a per-socket broadcaster for samAgent:event envelopes.
  // It is added immediately on connection so that events emitted during
  // the very first dispatch turn are not lost.
  if (samAgent && samAgentBroadcasters) {
    const broadcastFn = (envelope: SamAgentEventEnvelope) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(envelope));
      }
    };
    samAgentBroadcasters.add(broadcastFn);
    socket.on('close', () => {
      samAgentBroadcasters.delete(broadcastFn);
    });
  }

  socket.on('message', async (data) => {
    let command: Command;
    try {
      command = JSON.parse(data.toString()) as Command;
      log('ws', `Received command: ${command.type}${'agentId' in command ? ` (Agent: ${(command as any).agentId})` : ''}`);
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

          // If a HITL prompt is pending for this session, interpret the
          // user's text as the HITL answer instead of starting a new turn.
          // For kind='confirm', non-yes/no text is rejected here and the
          // prompt stays open so the user can try again.
          const hitlRouted = manager.hitlRegistry.resolveForSession(
            command.agentId,
            command.sessionKey,
            command.text,
          );
          if (hitlRouted && 'parseError' in hitlRouted) {
            socket.send(JSON.stringify({
              type: 'agent:error',
              agentId: command.agentId,
              error: hitlRouted.parseError,
            }));
            break;
          }
          if (hitlRouted) {
            const bridge = manager.getBridge(command.agentId);
            bridge?.broadcast({
              type: 'hitl:resolved',
              agentId: command.agentId,
              sessionKey: command.sessionKey,
              toolCallId: hitlRouted.resolved.toolCallId,
              outcome: 'answered',
            });
            socket.send(JSON.stringify({
              type: 'run:accepted',
              agentId: command.agentId,
              runId: `hitl-${hitlRouted.resolved.toolCallId}`,
              sessionId: command.sessionKey,
              acceptedAt: Date.now(),
            }));
            break;
          }

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

          const hitlRouted = manager.hitlRegistry.resolveForSession(
            command.agentId,
            command.sessionId,
            command.text,
          );
          if (hitlRouted && 'parseError' in hitlRouted) {
            socket.send(JSON.stringify({
              type: 'agent:error',
              agentId: command.agentId,
              error: hitlRouted.parseError,
            }));
            break;
          }
          if (hitlRouted) {
            const bridge = manager.getBridge(command.agentId);
            bridge?.broadcast({
              type: 'hitl:resolved',
              agentId: command.agentId,
              sessionKey: command.sessionId,
              toolCallId: hitlRouted.resolved.toolCallId,
              outcome: 'answered',
            });
            socket.send(JSON.stringify({
              type: 'run:accepted',
              agentId: command.agentId,
              runId: `hitl-${hitlRouted.resolved.toolCallId}`,
              sessionId: command.sessionId,
              acceptedAt: Date.now(),
            }));
            break;
          }

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

        case 'hitl:respond': {
          const { agentId, sessionKey, toolCallId, kind, answer } = command;
          manager.addSocket(agentId, socket);
          if (kind === 'confirm') {
            if (answer !== 'yes' && answer !== 'no') {
              socket.send(JSON.stringify({
                type: 'agent:error',
                agentId,
                error: 'hitl:respond kind=confirm requires answer "yes" or "no".',
              }));
              break;
            }
            manager.hitlRegistry.resolve(agentId, sessionKey, toolCallId, {
              kind: 'confirm',
              answer,
            });
          } else {
            manager.hitlRegistry.resolve(agentId, sessionKey, toolCallId, {
              kind: 'text',
              answer,
            });
          }
          manager.getBridge(agentId)?.broadcast({
            type: 'hitl:resolved',
            agentId,
            sessionKey,
            toolCallId,
            outcome: 'answered',
          });
          break;
        }

        case 'hitl:list': {
          manager.addSocket(command.agentId, socket);
          const pending = manager.hitlRegistry.listForSession(
            command.agentId,
            command.sessionKey,
          );
          const event: HitlListResultEvent = {
            type: 'hitl:list:result',
            agentId: command.agentId,
            sessionKey: command.sessionKey,
            pending: pending.map((p) => ({
              toolCallId: p.toolCallId,
              toolName: p.toolName,
              kind: p.kind,
              question: p.question,
              createdAt: p.createdAt,
              timeoutMs: p.timeoutMs,
            })),
          };
          socket.send(JSON.stringify(event));
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

        // --- SAMAgent commands ---

        case 'samAgent:start': {
          if (samAgent) {
            const messages = await samAgent.readTranscript();
            socket.send(JSON.stringify({ type: 'samAgent:transcript', messages }));
          }
          break;
        }

        case 'samAgent:prompt': {
          if (samAgent && samAgentBroadcasters) {
            // Run dispatch in the background; events stream to the client via broadcaster.
            samAgent.dispatch({
              text: command.text,
              currentGraph: command.currentGraph,
              modelSelection: command.modelSelection,
            }).catch((err) => {
              samAgentBroadcasters.forEach((fn) => fn({
                type: 'samAgent:event',
                event: {
                  type: 'lifecycle:error',
                  error: err instanceof Error ? err.message : String(err),
                },
              }));
            });
          }
          break;
        }

        case 'samAgent:abort': {
          samAgent?.abort();
          break;
        }

        case 'samAgent:clear': {
          if (samAgent) {
            await samAgent.clear();
            socket.send(JSON.stringify({ type: 'samAgent:transcript', messages: [] }));
          }
          break;
        }

        case 'samAgent:hitlRespond': {
          samAgent?.resolveHitl(command.toolCallId, command.answer);
          break;
        }

        case 'samAgent:patchState': {
          if (samAgent) {
            await samAgent.updatePatchState(command.messageId, command.toolCallId, command.state);
          }
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
    logConsoleAndFile('ws', 'Client disconnected');
    manager.removeSocketFromAll(socket);
  });

  socket.on('error', (err) => {
    logError('ws', `Socket error: ${err.message}`);
    manager.removeSocketFromAll(socket);
  });
}
