import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import ProvidersApiKeysSection from './ProvidersApiKeysSection';
import { useSettingsStore } from '../settings-store';
import { DEFAULT_AGENT_DEFAULTS } from '../types';
import { useProviderRegistryStore } from '../../store/provider-registry-store';

describe('ProvidersApiKeysSection', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      apiKeys: {},
      agentDefaults: DEFAULT_AGENT_DEFAULTS,
      providerDefaults: {
        pluginId: 'openrouter',
        authMethodId: 'api-key',
        envVar: 'OPENROUTER_API_KEY',
        baseUrl: '',
      },
    });
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
          id: 'sandbox-provider',
          name: 'Sandbox Provider',
          description: 'Sandbox provider',
          defaultBaseUrl: 'https://sandbox.example/v1',
          auth: [
            {
              methodId: 'api-key',
              label: 'API Key',
              type: 'api-key',
              envVar: 'SANDBOX_PROVIDER_API_KEY',
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
  });

  it('renders plugin-managed providers from the registry and keeps static provider guidance', () => {
    render(<ProvidersApiKeysSection />);

    expect(screen.getByText('Sandbox Provider')).toBeInTheDocument();
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
  });

  it('updates provider key values in settings store', () => {
    render(<ProvidersApiKeysSection />);

    fireEvent.change(screen.getByPlaceholderText('Enter OpenAI API key'), {
      target: { value: 'sk-test-openai' },
    });

    expect(useSettingsStore.getState().apiKeys.openai).toBe('sk-test-openai');
  });
});
