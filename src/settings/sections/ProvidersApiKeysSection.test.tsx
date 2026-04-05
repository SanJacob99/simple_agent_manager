import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import ProvidersApiKeysSection from './ProvidersApiKeysSection';
import { useSettingsStore } from '../settings-store';
import { DEFAULT_AGENT_DEFAULTS } from '../types';

describe('ProvidersApiKeysSection', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      apiKeys: {},
      agentDefaults: DEFAULT_AGENT_DEFAULTS,
    });
  });

  it('renders setup guidance and docs links for newly supported providers', () => {
    render(<ProvidersApiKeysSection />);

    expect(screen.getByText('Azure OpenAI')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Get Azure OpenAI key/i })).toHaveAttribute(
      'href',
      'https://ai.azure.com/',
    );

    expect(screen.getByText('Cerebras')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Get Cerebras key/i })).toHaveAttribute(
      'href',
      'https://cloud.cerebras.ai/platform/api-keys',
    );
  });

  it('updates provider key values in settings store', () => {
    render(<ProvidersApiKeysSection />);

    fireEvent.change(screen.getByPlaceholderText('Enter OpenAI API key'), {
      target: { value: 'sk-test-openai' },
    });

    expect(useSettingsStore.getState().apiKeys.openai).toBe('sk-test-openai');
  });
});
