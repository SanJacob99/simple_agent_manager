import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DefaultsSection from './DefaultsSection';
import { useSettingsStore } from '../settings-store';
import { useGraphStore } from '../../store/graph-store';

describe('DefaultsSection', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      apiKeys: {},
      agentDefaults: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-20250514',
        thinkingLevel: 'off',
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
  });

  it('updates stored defaults when the form changes', () => {
    render(<DefaultsSection />);

    fireEvent.change(screen.getByLabelText('System Prompt'), {
      target: { value: 'New defaults prompt' },
    });

    expect(useSettingsStore.getState().agentDefaults.systemPrompt).toBe(
      'New defaults prompt',
    );
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
      screen.getByRole('button', { name: /Apply defaults to existing agents/i }),
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
});
