import { act, fireEvent, render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { useGraphStore } from './store/graph-store';
import { useAgentConnectionStore } from './store/agent-connection-store';
import { useSettingsStore } from './settings/settings-store';
import { useModelCatalogStore } from './store/model-catalog-store';
import { useProviderRegistryStore } from './store/provider-registry-store';

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
    useSettingsStore.setState({
      apiKeys: { openrouter: 'key-1' },
      providerDefaults: {
        pluginId: 'openrouter',
        authMethodId: 'api-key',
        envVar: 'OPENROUTER_API_KEY',
        baseUrl: '',
      },
      loaded: true,
      loadFromServer: vi.fn(async () => undefined),
    } as any);
    useModelCatalogStore.setState({
      loadOpenRouterCatalog: vi.fn(async () => undefined),
    } as any);
    useProviderRegistryStore.setState({
      loadProviders: vi.fn(async () => undefined),
    } as any);
  });

  it('shows only the chat drawer when chat and selected node are both present', () => {
    render(
      <ReactFlowProvider>
        <App />
      </ReactFlowProvider>,
    );

    expect(screen.getByText('Chat Drawer Stub')).toBeInTheDocument();
    expect(screen.queryByText('Properties Panel Stub')).not.toBeInTheDocument();
    expect(useGraphStore.getState().selectedNodeId).toBe('agent-1');
  });

  it('closes chat and shows properties when a node is selected', () => {
    render(
      <ReactFlowProvider>
        <App />
      </ReactFlowProvider>,
    );

    act(() => {
      useGraphStore.getState().setSelectedNode('agent-2');
    });

    expect(screen.queryByText('Chat Drawer Stub')).not.toBeInTheDocument();
    expect(screen.getByText('Properties Panel Stub')).toBeInTheDocument();
    expect(useGraphStore.getState().selectedNodeId).toBe('agent-2');
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

  it('loads the cached OpenRouter catalog after settings load completes', () => {
    render(
      <ReactFlowProvider>
        <App />
      </ReactFlowProvider>,
    );

    expect(useModelCatalogStore.getState().loadOpenRouterCatalog).toHaveBeenCalled();
  });

  it('loads the provider registry on mount', () => {
    render(
      <ReactFlowProvider>
        <App />
      </ReactFlowProvider>,
    );

    expect(useProviderRegistryStore.getState().loadProviders).toHaveBeenCalled();
  });
});
