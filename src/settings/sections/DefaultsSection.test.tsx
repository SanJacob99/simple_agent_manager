import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DefaultsSection from './DefaultsSection';
import { useSettingsStore } from '../settings-store';
import { useGraphStore } from '../../store/graph-store';
import { useModelCatalogStore } from '../../store/model-catalog-store';

describe('DefaultsSection', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      apiKeys: {},
      agentDefaults: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-20250514',
        thinkingLevel: 'off',
        systemPromptMode: 'append',
        systemPrompt: 'You are a helpful assistant.',
        safetyGuardrails: 'Default guardrails.',
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
            provider: 'anthropic',
            modelId: 'claude-sonnet-4-20250514',
            thinkingLevel: 'off',
            systemPrompt: 'Old prompt',
            description: '',
            tags: [],
            modelCapabilities: {},
          },
        },
      ],
    } as any);
    useModelCatalogStore.setState({
      models: { openrouter: {} },
      userModels: { openrouter: {} },
      syncedAt: { openrouter: null },
      userModelsRequireRefresh: { openrouter: false },
      loading: { openrouter: false },
      errors: { openrouter: null },
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

  it('resets the default model when the default provider changes', () => {
    render(<DefaultsSection />);

    fireEvent.change(screen.getByLabelText('Provider'), {
      target: { value: 'openai' },
    });

    expect(useSettingsStore.getState().agentDefaults.provider).toBe('openai');
    expect(useSettingsStore.getState().agentDefaults.modelId).toBe('gpt-4o');
  });

  it('requires confirmation before applying defaults to existing agents and does not overwrite systemPrompt', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<DefaultsSection />);
    fireEvent.click(
      screen.getByRole('button', { name: /Apply to existing agents/i }),
    );

    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'provider, model, and thinking level',
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
        provider: 'openrouter',
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
        provider: 'openrouter',
        modelId: 'anthropic/claude-sonnet-4-20250514',
      },
    }));
    useModelCatalogStore.setState({
      models: {
        openrouter: {
          'xiaomi/mimo-v2-pro': {
            id: 'xiaomi/mimo-v2-pro',
            provider: 'openrouter',
            name: 'Mimo V2 Pro',
          },
        },
      },
    } as any);

    render(<DefaultsSection />);

    fireEvent.click(screen.getByRole('button', { name: /model picker/i }));

    expect(screen.getByText('xiaomi/mimo-v2-pro')).toBeInTheDocument();
  });
});
