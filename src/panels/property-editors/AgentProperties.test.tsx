import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import AgentProperties from './AgentProperties';
import { useGraphStore } from '../../store/graph-store';
import {
  DEFAULT_OPENROUTER_REQUEST,
  buildProviderCatalogKey,
  useModelCatalogStore,
} from '../../store/model-catalog-store';

const openRouterCatalogKey = buildProviderCatalogKey(DEFAULT_OPENROUTER_REQUEST);

function createAgentData(overrides: Record<string, unknown> = {}) {
  return {
    type: 'agent' as const,
    name: 'Agent',
    nameConfirmed: true,
    systemPrompt: 'Test',
    systemPromptMode: 'append' as const,
    modelId: 'xiaomi/mimo-v2-pro',
    thinkingLevel: 'off' as const,
    description: '',
    tags: [],
    modelCapabilities: {},
    showReasoning: false,
    verbose: false,
    ...overrides,
  };
}

function seedGraph(
  agentData: ReturnType<typeof createAgentData>,
  pluginId = 'openrouter',
) {
  useGraphStore.setState({
    nodes: [
      {
        id: 'agent-1',
        type: 'agent',
        position: { x: 0, y: 0 },
        data: agentData,
      },
      {
        id: 'provider-1',
        type: 'provider',
        position: { x: 0, y: 0 },
        data: {
          type: 'provider',
          label: 'Provider',
          pluginId,
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
    selectedNodeId: null,
  } as any);
}

describe('AgentProperties', () => {
  beforeEach(() => {
    localStorage.clear();

    useModelCatalogStore.setState({
      models: {
        [openRouterCatalogKey]: {
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
      loading: { [openRouterCatalogKey]: false },
      errors: { [openRouterCatalogKey]: null },
      lastSyncedKeys: {},
    } as any);
  });

  it('shows a custom model input when the selected model is not in the list', () => {
    const data = createAgentData({ modelId: 'manual/custom-model' });

    render(<AgentProperties nodeId="agent-1" data={data} />);

    expect(screen.getByDisplayValue('manual/custom-model')).toBeInTheDocument();
  });

  it('derives discovered models from the connected Provider node and no longer renders a provider selector', () => {
    const data = createAgentData();
    seedGraph(data);
    useModelCatalogStore.setState({
      models: {
        [openRouterCatalogKey]: {
          'acme/edge-router-pro': {
            id: 'acme/edge-router-pro',
            provider: 'openrouter',
            inputModalities: ['text'],
            supportedParameters: ['tools'],
          },
        },
      },
      loading: { [openRouterCatalogKey]: false },
      errors: { [openRouterCatalogKey]: null },
      lastSyncedKeys: {},
    } as any);

    render(<AgentProperties nodeId="agent-1" data={data} />);

    expect(screen.queryByText(/^Provider$/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /model picker/i }));
    expect(screen.getByText('acme/edge-router-pro')).toBeInTheDocument();
  });

  it('renders a system prompt mode selector', () => {
    const data = createAgentData({ systemPromptMode: 'auto' });
    render(<AgentProperties nodeId="agent-1" data={data} />);
    expect(screen.getByLabelText('System Prompt Mode')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /auto/i })).not.toBeInTheDocument();
  });

  it('shows a searchable model popover with free and capability filters', () => {
    useModelCatalogStore.setState({
      models: {
        [openRouterCatalogKey]: {
          'qwen/qwen3.6-plus:free': {
            id: 'qwen/qwen3.6-plus:free',
            provider: 'openrouter',
            supportedParameters: ['tools', 'tool_choice', 'reasoning'],
            reasoningSupported: true,
            inputModalities: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
          'openai/gpt-4o': {
            id: 'openai/gpt-4o',
            provider: 'openrouter',
            supportedParameters: ['tools', 'tool_choice'],
            inputModalities: ['text'],
            cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 },
          },
          'google/lyria-3-pro-preview': {
            id: 'google/lyria-3-pro-preview',
            provider: 'openrouter',
            supportedParameters: ['max_tokens', 'response_format'],
            inputModalities: ['image'],
            cost: { input: 0.3, output: 0.4, cacheRead: 0, cacheWrite: 0 },
          },
        },
      },
      loading: { [openRouterCatalogKey]: false },
      errors: { [openRouterCatalogKey]: null },
      lastSyncedKeys: {},
    } as any);

    const data = createAgentData({ modelId: 'openai/gpt-4o' });
    seedGraph(data);
    render(<AgentProperties nodeId="agent-1" data={data} />);

    fireEvent.click(screen.getByRole('button', { name: /model picker/i }));
    const results = screen.getByLabelText('Model results');

    expect(screen.getByLabelText('Search models')).toBeInTheDocument();
    expect(within(results).getByText('openai/gpt-4o')).toBeInTheDocument();
    expect(within(results).getByText('qwen/qwen3.6-plus:free')).toBeInTheDocument();
    expect(within(results).queryByText('google/lyria-3-pro-preview')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /free only/i }));
    expect(within(results).getByText('qwen/qwen3.6-plus:free')).toBeInTheDocument();
    expect(within(results).queryByText('openai/gpt-4o')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /free only/i }));
    fireEvent.change(screen.getByLabelText('Search models'), {
      target: { value: 'qwen' },
    });
    expect(within(results).getByText('qwen/qwen3.6-plus:free')).toBeInTheDocument();
    expect(within(results).queryByText('openai/gpt-4o')).not.toBeInTheDocument();
  });

  it('treats legacy auto mode as append mode', () => {
    const data = createAgentData({ systemPromptMode: 'auto' });
    render(<AgentProperties nodeId="agent-1" data={data} />);
    expect(screen.getByLabelText('Your Instructions')).toBeInTheDocument();
    expect(screen.queryByLabelText('System Prompt')).not.toBeInTheDocument();
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
    seedGraph(data);

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
