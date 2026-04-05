import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import AgentProperties from './AgentProperties';
import { useGraphStore } from '../../store/graph-store';
import { useModelCatalogStore } from '../../store/model-catalog-store';

function createAgentData(overrides: Record<string, unknown> = {}) {
  return {
    type: 'agent' as const,
    name: 'Agent',
    nameConfirmed: true,
    systemPrompt: 'Test',
    systemPromptMode: 'auto' as const,
    provider: 'openrouter',
    modelId: 'xiaomi/mimo-v2-pro',
    thinkingLevel: 'off' as const,
    description: '',
    tags: [],
    modelCapabilities: {},
    ...overrides,
  };
}

describe('AgentProperties', () => {
  beforeEach(() => {
    localStorage.clear();

    useModelCatalogStore.setState({
      models: {
        openrouter: {
          'xiaomi/mimo-v2-pro': {
            id: 'xiaomi/mimo-v2-pro',
            provider: 'openrouter',
            inputModalities: ['text'],
            contextWindow: 128000,
            maxTokens: 8192,
            reasoningSupported: true,
            cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 },
          },
        },
      },
      loading: { openrouter: false },
      errors: { openrouter: null },
      lastSyncedKeys: {},
    } as any);
  });

  it('shows a custom model input when the selected model is not in the list', () => {
    const data = createAgentData({ modelId: 'manual/custom-model' });

    render(<AgentProperties nodeId="agent-1" data={data} />);

    expect(screen.getByDisplayValue('manual/custom-model')).toBeInTheDocument();
  });

  it('resets to the first built-in model when the provider changes', () => {
    const data = createAgentData();

    useGraphStore.setState({
      nodes: [
        {
          id: 'agent-1',
          type: 'agent',
          position: { x: 0, y: 0 },
          data,
        },
      ] as any,
      edges: [],
      selectedNodeId: null,
    });

    render(<AgentProperties nodeId="agent-1" data={data} />);

    fireEvent.change(screen.getAllByRole('combobox')[0], {
      target: { value: 'anthropic' },
    });

    const node = useGraphStore.getState().nodes.find((n) => n.id === 'agent-1');
    expect(node?.data.type).toBe('agent');
    if (node?.data.type === 'agent') {
      expect(node.data.modelId).toBe('claude-opus-4-20250514');
    }
  });

  it('renders a system prompt mode selector', () => {
    const data = createAgentData({ systemPromptMode: 'auto' });
    render(<AgentProperties nodeId="agent-1" data={data} />);
    expect(screen.getByLabelText('System Prompt Mode')).toBeInTheDocument();
  });

  it('hides textarea in auto mode', () => {
    const data = createAgentData({ systemPromptMode: 'auto' });
    render(<AgentProperties nodeId="agent-1" data={data} />);
    expect(screen.queryByLabelText('System Prompt')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Your Instructions')).not.toBeInTheDocument();
  });

  it('shows textarea labeled "Your Instructions" in append mode', () => {
    const data = createAgentData({ systemPromptMode: 'append' });
    render(<AgentProperties nodeId="agent-1" data={data} />);
    expect(screen.getByLabelText('Your Instructions')).toBeInTheDocument();
  });

  it('shows textarea and warning in manual mode', () => {
    const data = createAgentData({ systemPromptMode: 'manual' });
    render(<AgentProperties nodeId="agent-1" data={data} />);
    expect(screen.getByLabelText('System Prompt')).toBeInTheDocument();
    expect(screen.getByText(/fully responsible/i)).toBeInTheDocument();
  });

  it('shows discovered capability defaults and writes overrides back to the graph store', () => {
    const data = createAgentData();

    useGraphStore.setState({
      nodes: [
        {
          id: 'agent-1',
          type: 'agent',
          position: { x: 0, y: 0 },
          data,
        },
      ] as any,
      edges: [],
      selectedNodeId: null,
    });

    render(<AgentProperties nodeId="agent-1" data={data} />);

    // The capabilities panel starts collapsed — click the summary bar to expand
    const summaryBar = screen.getByText(/128K ctx/i).closest('button');
    expect(summaryBar).toBeInTheDocument();
    fireEvent.click(summaryBar!);

    // Now the editable inputs should be visible. The context window uses placeholder 'tokens'.
    const contextWindowInputs = screen.getAllByPlaceholderText('tokens');
    // First 'tokens' placeholder is Context Window, second is Max Tokens
    const contextWindowInput = contextWindowInputs[0];
    expect(contextWindowInput).toHaveValue(128000);

    fireEvent.change(contextWindowInput, {
      target: { value: '64000' },
    });

    const node = useGraphStore.getState().nodes.find((n) => n.id === 'agent-1');
    expect(node?.data.type).toBe('agent');
    if (node?.data.type === 'agent') {
      expect(node.data.modelCapabilities.contextWindow).toBe(64000);
    }
  });
});
