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
    name: 'Test Agent',
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
  });

  it('renders the agent name and a target handle', () => {
    renderAgentNode();

    expect(screen.getByText('Test Agent')).toBeInTheDocument();
    expect(screen.getByTestId('handle-target')).toBeInTheDocument();
  });

  it('opens the chat drawer when the chat button is clicked', () => {
    const openChat = vi.fn();
    useAgentConnectionStore.setState({
      chatAgentNodeId: null,
      openChatDrawer: openChat,
    } as any);

    renderAgentNode();
    screen.getByTitle('Open Chat').click();

    expect(openChat).toHaveBeenCalledWith('agent-1');
  });
});
