import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import PropertiesPanel from './PropertiesPanel';
import { useGraphStore } from '../store/graph-store';
import {
  DEFAULT_CHAT_DRAWER_WIDTH,
  DEFAULT_PROPERTIES_PANEL_WIDTH,
  useUILayoutStore,
} from '../store/ui-layout-store';
import { useAgentConnectionStore } from '../store/agent-connection-store';

describe('PropertiesPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    useGraphStore.setState({
      nodes: [
        {
          id: 'memory-1',
          type: 'memory',
          position: { x: 0, y: 0 },
          data: {
            type: 'memory',
            label: 'Memory',
            backend: 'builtin',
            maxSessionMessages: 100,
            persistAcrossSessions: false,
            compactionEnabled: false,
            compactionStrategy: 'summary',
            compactionThreshold: 0.8,
            exposeMemorySearch: true,
            exposeMemoryGet: true,
            exposeMemorySave: true,
            searchMode: 'keyword',
            externalEndpoint: '',
            externalApiKey: '',
          },
        },
      ],
      edges: [],
      selectedNodeId: 'memory-1',
      pendingNameNodeId: null,
      pendingDeleteAgent: null,
    } as any);
    useAgentConnectionStore.setState({
      chatAgentNodeId: null,
      agents: {},
    } as any);
    useUILayoutStore.setState({
      propertiesPanelWidth: DEFAULT_PROPERTIES_PANEL_WIDTH,
      chatDrawerWidth: DEFAULT_CHAT_DRAWER_WIDTH,
    });
  });

  it('does not break hook ordering when deleting the selected node', () => {
    render(<PropertiesPanel />);

    fireEvent.click(screen.getByTitle('Delete node'));

    expect(useGraphStore.getState().selectedNodeId).toBeNull();
    expect(useGraphStore.getState().nodes).toEqual([]);
    expect(screen.queryByTitle('Delete node')).not.toBeInTheDocument();
  });
});
