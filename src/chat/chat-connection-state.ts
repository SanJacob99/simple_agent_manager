import type { ConnectionStatus } from '../client/agent-client';

export interface ChatConnectionIssue {
  key: 'connecting' | 'reconnecting' | 'disconnected';
  label: string;
  description: string;
  hint: string;
}

export function getChatConnectionIssue(
  connectionStatus: ConnectionStatus,
  hasConnectedOnce: boolean,
): ChatConnectionIssue | null {
  if (connectionStatus === 'connected') {
    return null;
  }

  if (!hasConnectedOnce) {
    return {
      key: 'connecting',
      label: 'Connecting to Backend',
      description: 'The app is still establishing its first WebSocket connection to the backend.',
      hint: 'If this keeps spinning, make sure the backend server is running and reachable.',
    };
  }

  if (connectionStatus === 'connecting') {
    return {
      key: 'reconnecting',
      label: 'Reconnecting to Backend',
      description: 'The WebSocket connection dropped and the app is trying to reconnect now.',
      hint: 'Please wait a moment while the connection is restored.',
    };
  }

  return {
    key: 'disconnected',
    label: 'Connection Lost',
    description: 'The WebSocket connection to the backend has dropped.',
    hint: 'Please refresh the page to reconnect to the server.',
  };
}
