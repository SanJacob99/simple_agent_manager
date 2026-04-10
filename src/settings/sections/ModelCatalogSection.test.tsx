import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ModelCatalogSection from './ModelCatalogSection';
import { useSettingsStore } from '../settings-store';
import { useModelCatalogStore } from '../../store/model-catalog-store';
import {
  DEFAULT_OPENROUTER_REQUEST,
  buildProviderCatalogKey,
} from '../../store/model-catalog-store';
import { useProviderRegistryStore } from '../../store/provider-registry-store';

describe('ModelCatalogSection', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      apiKeys: { openrouter: 'key-1' },
      providerDefaults: {
        pluginId: 'openrouter',
        authMethodId: 'api-key',
        envVar: 'OPENROUTER_API_KEY',
        baseUrl: '',
      },
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
      refreshCatalog: vi.fn(async () => undefined),
    } as any);
  });

  it('calls refreshCatalog with the default provider request when Sync Models is clicked', async () => {
    render(<ModelCatalogSection />);

    fireEvent.click(screen.getByRole('button', { name: /sync models/i }));

    await waitFor(() => {
      expect(useModelCatalogStore.getState().refreshCatalog).toHaveBeenCalledWith(
        DEFAULT_OPENROUTER_REQUEST,
      );
    });
  });

  it('shows cached sync metadata when a catalog exists', () => {
    useModelCatalogStore.setState({
      models: {
        [buildProviderCatalogKey(DEFAULT_OPENROUTER_REQUEST)]: {
          'openai/gpt-4o': { id: 'openai/gpt-4o', provider: 'openrouter' },
        },
      },
      syncedAt: {
        [buildProviderCatalogKey(DEFAULT_OPENROUTER_REQUEST)]: '2026-04-08T16:00:00.000Z',
      },
    } as any);

    render(<ModelCatalogSection />);

    expect(screen.getByText(/cached openrouter catalog last updated/i)).toBeInTheDocument();
  });

  it('shows a refresh-required hint when userModelsRequireRefresh is true', () => {
    useModelCatalogStore.setState({
      userModelsRequireRefresh: {
        [buildProviderCatalogKey(DEFAULT_OPENROUTER_REQUEST)]: true,
      },
    } as any);

    render(<ModelCatalogSection />);

    expect(screen.getByText(/api key changed/i)).toBeInTheDocument();
  });
});
