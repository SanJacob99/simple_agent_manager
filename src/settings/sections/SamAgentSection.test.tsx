import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import SamAgentSection from './SamAgentSection';
import { useSettingsStore } from '../settings-store';
import { useModelCatalogStore } from '../../store/model-catalog-store';
import { useProviderRegistryStore } from '../../store/provider-registry-store';
import { DEFAULT_SAM_AGENT_DEFAULTS } from '../types';

describe('SamAgentSection', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      apiKeys: { openrouter: 'sk-test' },
      samAgentDefaults: { ...DEFAULT_SAM_AGENT_DEFAULTS },
    });
    useModelCatalogStore.setState({
      models: {
        'openrouter::default': {
          'google/gemini-3-pro': {} as any,
          'anthropic/claude-sonnet-4-6': {} as any,
        },
      },
    } as any);
    useProviderRegistryStore.setState({
      providers: [
        {
          id: 'openrouter',
          name: 'OpenRouter',
          description: '',
          auth: [{ methodId: 'api-key', envVar: 'OPENROUTER_API_KEY' }],
        },
      ],
    } as any);
  });

  it('renders model + thinking level controls and shows thinking="high" by default', () => {
    render(<SamAgentSection />);
    const thinking = screen.getByLabelText('SAMAgent thinking level') as HTMLSelectElement;
    expect(thinking.value).toBe('high');
  });

  it('updates thinkingLevel in the settings store', () => {
    render(<SamAgentSection />);
    const thinking = screen.getByLabelText('SAMAgent thinking level') as HTMLSelectElement;
    fireEvent.change(thinking, { target: { value: 'low' } });
    expect(useSettingsStore.getState().samAgentDefaults.thinkingLevel).toBe('low');
  });

  it('selecting a model writes a fully-resolved modelSelection', () => {
    render(<SamAgentSection />);
    const select = screen.getByLabelText('SAMAgent model') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'openrouter::::google/gemini-3-pro' } });
    const sel = useSettingsStore.getState().samAgentDefaults.modelSelection;
    expect(sel?.modelId).toBe('google/gemini-3-pro');
    expect(sel?.provider.pluginId).toBe('openrouter');
    expect(sel?.provider.authMethodId).toBe('api-key');
    expect(sel?.provider.envVar).toBe('OPENROUTER_API_KEY');
  });

  it('warns when the selected provider has no API key', () => {
    useSettingsStore.setState({
      apiKeys: {},
      samAgentDefaults: {
        modelSelection: {
          provider: { pluginId: 'openrouter', authMethodId: 'api-key', envVar: 'OPENROUTER_API_KEY', baseUrl: '' },
          modelId: 'gemini-3-pro',
        },
        thinkingLevel: 'high',
      },
    });
    render(<SamAgentSection />);
    expect(screen.getByText(/no API key configured/i)).toBeInTheDocument();
  });
});
