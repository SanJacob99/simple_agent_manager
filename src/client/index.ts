import { AgentClient } from './agent-client';

// Determine WebSocket URL based on environment
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${wsProtocol}//${window.location.host}/ws`;

export const agentClient = new AgentClient(wsUrl);

// Connect on import
agentClient.connect();
