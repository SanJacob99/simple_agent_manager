import { AgentClient } from './agent-client';
import { useSettingsStore } from '../settings/settings-store';

// Determine WebSocket URL based on environment
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${wsProtocol}//${window.location.host}/ws`;

export const agentClient = new AgentClient(wsUrl);

// Send current API keys whenever the connection opens
agentClient.onStatusChange((status) => {
  if (status === 'connected') {
    const keys = useSettingsStore.getState().apiKeys;
    if (Object.keys(keys).length > 0) {
      agentClient.send({ type: 'config:setApiKeys', keys });
    }
  }
});

// Re-send API keys whenever they change in the settings store
useSettingsStore.subscribe(
  (state, prev) => {
    if (state.apiKeys !== prev.apiKeys && agentClient.status === 'connected') {
      agentClient.send({ type: 'config:setApiKeys', keys: state.apiKeys });
    }
  },
);

// Connect on import
agentClient.connect();
