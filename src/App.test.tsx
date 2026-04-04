import { fireEvent, render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { useGraphStore } from './store/graph-store';
import { useAgentConnectionStore } from './store/agent-connection-store';

vi.mock('./canvas/FlowCanvas', () => ({
  default: () => <div>Flow Canvas Stub</div>,
}));

vi.mock('./panels/PropertiesPanel', () => ({
  default: () => <div>Properties Panel Stub</div>,
}));

vi.mock('./chat/ChatDrawer', () => ({
  default: () => <div>Chat Drawer Stub</div>,
}));

describe('App settings workspace shell', () => {
  beforeEach(() => {
    useGraphStore.setState({
      nodes: [],
      edges: [],
      selectedNodeId: 'agent-1',
      pendingNameNodeId: null,
    } as any);
    useAgentConnectionStore.setState({
      chatAgentNodeId: 'agent-1',
      agents: {},
    } as any);
  });

  it('switches to settings mode without clearing selected node state', () => {
    render(
      <ReactFlowProvider>
        <App />
      </ReactFlowProvider>,
    );

    fireEvent.click(screen.getByTitle('Settings'));

    expect(screen.queryByText('Flow Canvas Stub')).not.toBeInTheDocument();
    expect(screen.queryByText('Properties Panel Stub')).not.toBeInTheDocument();
    expect(screen.queryByText('Chat Drawer Stub')).not.toBeInTheDocument();
    expect(useGraphStore.getState().selectedNodeId).toBe('agent-1');
    expect(
      screen.getByRole('heading', { name: 'Providers & API Keys' }),
    ).toBeInTheDocument();
  });
});
