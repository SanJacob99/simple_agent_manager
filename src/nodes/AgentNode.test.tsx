import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AgentNode from './AgentNode';
import { useAgentConnectionStore } from '../store/agent-connection-store';
import { useGraphStore } from '../store/graph-store';

vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual<typeof import('@xyflow/react')>('@xyflow/react');
  return {
    ...actual,
    Handle: ({ type }: { type: string }) => <div data-testid={`handle-${type}`} />,
  };
});

function createAgentData() {
  return {
    type: 'agent' as const,
    name: 'Agent',
    nameConfirmed: true,
    systemPrompt: 'Test prompt',
    systemPromptMode: 'append' as const,
    modelId: 'anthropic/claude-sonnet-4-20250514',
    thinkingLevel: 'off' as const,
    description: '',
    tags: [],
    modelCapabilities: {},
    showReasoning: false,
    verbose: false,
  };
}

function renderAgentNode() {
  return render(
    <AgentNode
      {...({
        id: 'agent-1',
        data: createAgentData(),
        selected: false,
        dragging: false,
        zIndex: 0,
        isConnectable: true,
        type: 'agent',
        xPos: 0,
        yPos: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as any)}
    />,
  );
}

describe('AgentNode', () => {
  beforeEach(() => {
    useAgentConnectionStore.setState({
      chatAgentNodeId: null,
      openChatDrawer: vi.fn(),
    } as any);
  });

  it('shows the connected Provider node plugin id in the badge', () => {
    useGraphStore.setState({
      nodes: [
        {
          id: 'agent-1',
          type: 'agent',
          position: { x: 0, y: 0 },
          data: createAgentData(),
        },
        {
          id: 'provider-1',
          type: 'provider',
          position: { x: 0, y: 0 },
          data: {
            type: 'provider',
            label: 'Provider',
            pluginId: 'openrouter',
            authMethodId: 'api-key',
            envVar: 'OPENROUTER_API_KEY',
            baseUrl: '',
          },
        },
      ] as any,
      edges: [
        {
          id: 'edge_provider-1_agent-1',
          source: 'provider-1',
          target: 'agent-1',
          type: 'data',
        },
      ] as any,
    } as any);

    renderAgentNode();

    expect(screen.getByText('openrouter')).toBeInTheDocument();
  });

  it('shows a missing-provider badge when no Provider node is connected', () => {
    useGraphStore.setState({
      nodes: [
        {
          id: 'agent-1',
          type: 'agent',
          position: { x: 0, y: 0 },
          data: createAgentData(),
        },
      ] as any,
      edges: [],
    } as any);

    renderAgentNode();

    expect(screen.getByText('no provider')).toBeInTheDocument();
  });
});
