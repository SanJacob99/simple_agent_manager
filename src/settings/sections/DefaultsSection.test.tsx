import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DefaultsSection from './DefaultsSection';
import { useSettingsStore } from '../settings-store';
import { useGraphStore } from '../../store/graph-store';
import { useModelCatalogStore } from '../../store/model-catalog-store';
import {
  DEFAULT_OPENROUTER_REQUEST,
  buildProviderCatalogKey,
} from '../../store/model-catalog-store';
import { useProviderRegistryStore } from '../../store/provider-registry-store';

describe('DefaultsSection', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      apiKeys: {},
      agentDefaults: {
        modelId: 'claude-sonnet-4-20250514',
        thinkingLevel: 'off',
        systemPromptMode: 'append',
        systemPrompt: 'You are a helpful assistant.',
        safetyGuardrails: 'Default guardrails.',
      },
      providerDefaults: {
        pluginId: 'openrouter',
        authMethodId: 'api-key',
        envVar: 'OPENROUTER_API_KEY',
        baseUrl: '',
      },
    });
    useGraphStore.setState({
      nodes: [
        {
          id: 'agent-1',
          type: 'agent',
          position: { x: 0, y: 0 },
          data: {
            type: 'agent',
            name: 'Agent',
            nameConfirmed: true,
            modelId: 'claude-sonnet-4-20250514',
            thinkingLevel: 'off',
            systemPrompt: 'Old prompt',
            description: '',
            tags: [],
            modelCapabilities: {},
            systemPromptMode: 'append',
            showReasoning: false,
            verbose: false,
          },
        },
      ],
    } as any);
    useProviderRegistryStore.setState({
      providers: [
        {
          id: 'openrouter',
          name: 'OpenRouter',
          description: 'OpenRouter provider',
          defaultBaseUrl: 'https://openrouter.ai/api/v1',
          auth: [
            {
              methodId: 'api-key',
              label: 'API Key',
              type: 'api-key',
              envVar: 'OPENROUTER_API_KEY',
            },
          ],
          supportsCatalog: true,
          supportsWebSearch: false,
          supportsWebFetch: false,
        },
        {
          id: 'mock-provider',
          name: 'Mock Provider',
          description: 'Mock provider',
          defaultBaseUrl: 'https://mock.example/v1',
          auth: [
            {
              methodId: 'api-key',
              label: 'API Key',
              type: 'api-key',
              envVar: 'MOCK_PROVIDER_API_KEY',
            },
          ],
          supportsCatalog: false,
          supportsWebSearch: false,
          supportsWebFetch: false,
        },
      ],
      loading: false,
      error: null,
    });
    useModelCatalogStore.setState({
      models: { [buildProviderCatalogKey(DEFAULT_OPENROUTER_REQUEST)]: {} },
      userModels: { [buildProviderCatalogKey(DEFAULT_OPENROUTER_REQUEST)]: {} },
      syncedAt: { [buildProviderCatalogKey(DEFAULT_OPENROUTER_REQUEST)]: null },
      userModelsRequireRefresh: {
        [buildProviderCatalogKey(DEFAULT_OPENROUTER_REQUEST)]: false,
      },
      loading: { [buildProviderCatalogKey(DEFAULT_OPENROUTER_REQUEST)]: false },
      errors: { [buildProviderCatalogKey(DEFAULT_OPENROUTER_REQUEST)]: null },
    } as any);
  });

  it('updates stored defaults when the form changes', () => {
    useSettingsStore.setState((s) => ({
      ...s,
      agentDefaults: { ...s.agentDefaults, systemPromptMode: 'manual' },
    }));
    render(<DefaultsSection />);

    fireEvent.change(screen.getByLabelText('System Prompt'), {
      target: { value: 'New defaults prompt' },
    });

    expect(useSettingsStore.getState().agentDefaults.systemPrompt).toBe(
      'New defaults prompt',
    );
  });

  it('can change the system prompt mode', () => {
    render(<DefaultsSection />);
    fireEvent.change(screen.getByLabelText('System Prompt Mode'), {
      target: { value: 'append' },
    });
    expect(useSettingsStore.getState().agentDefaults.systemPromptMode).toBe('append');
  });

  it('updates provider defaults in the dedicated provider sub-section', () => {
    render(<DefaultsSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Provider' }));
    fireEvent.change(screen.getByLabelText('Provider Plugin'), {
      target: { value: 'mock-provider' },
    });

    expect(useSettingsStore.getState().providerDefaults.pluginId).toBe('mock-provider');
    expect(useSettingsStore.getState().providerDefaults.authMethodId).toBe('api-key');
    expect(useSettingsStore.getState().providerDefaults.envVar).toBe('MOCK_PROVIDER_API_KEY');
  });

  it('requires confirmation before applying defaults to existing agents and does not overwrite systemPrompt', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<DefaultsSection />);
    fireEvent.click(
      screen.getByRole('button', { name: /Apply to existing agents/i }),
    );

    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'model and thinking level',
      ),
    );
    expect(useGraphStore.getState().nodes[0].data.type).toBe('agent');
    if (useGraphStore.getState().nodes[0].data.type === 'agent') {
      expect(useGraphStore.getState().nodes[0].data.systemPrompt).toBe(
        'Old prompt',
      );
    }
  });

  it('shows a searchable picker for default agent models', () => {
    render(<DefaultsSection />);

    fireEvent.click(screen.getByRole('button', { name: /model picker/i }));

    expect(screen.getByLabelText('Search models')).toBeInTheDocument();
    expect(screen.getByLabelText('Model results')).toBeInTheDocument();
  });

  it('allows a manual custom OpenRouter model ID in defaults', () => {
    useSettingsStore.setState((state) => ({
      ...state,
      agentDefaults: {
        ...state.agentDefaults,
        modelId: 'manual/custom-model',
      },
    }));

    render(<DefaultsSection />);

    expect(screen.getByDisplayValue('manual/custom-model')).toBeInTheDocument();
  });

  it('shows discovered OpenRouter models in the default picker', () => {
    useSettingsStore.setState((state) => ({
      ...state,
      agentDefaults: {
        ...state.agentDefaults,
        modelId: 'anthropic/claude-sonnet-4-20250514',
      },
    }));
    useModelCatalogStore.setState({
      models: {
        [buildProviderCatalogKey(DEFAULT_OPENROUTER_REQUEST)]: {
          'xiaomi/mimo-v2-pro': {
            id: 'xiaomi/mimo-v2-pro',
            provider: 'openrouter',
            name: 'Mimo V2 Pro',
            supportedParameters: ['tools'],
          },
        },
      },
    } as any);

    render(<DefaultsSection />);

    fireEvent.click(screen.getByRole('button', { name: /model picker/i }));

    expect(screen.getByText('xiaomi/mimo-v2-pro')).toBeInTheDocument();
  });
});
