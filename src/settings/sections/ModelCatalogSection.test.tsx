import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ModelCatalogSection from './ModelCatalogSection';
import { useSettingsStore } from '../settings-store';
import { useModelCatalogStore } from '../../store/model-catalog-store';

describe('ModelCatalogSection', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      apiKeys: { openrouter: 'key-1' },
    } as any);
    useModelCatalogStore.setState({
      models: { openrouter: {} },
      userModels: { openrouter: {} },
      syncedAt: { openrouter: null },
      userModelsRequireRefresh: { openrouter: false },
      loading: { openrouter: false },
      errors: { openrouter: null },
      refreshOpenRouterCatalog: vi.fn(async () => undefined),
    } as any);
  });

  it('calls refreshOpenRouterCatalog when Sync Models is clicked', async () => {
    render(<ModelCatalogSection />);

    fireEvent.click(screen.getByRole('button', { name: /sync models/i }));

    await waitFor(() => {
      expect(useModelCatalogStore.getState().refreshOpenRouterCatalog).toHaveBeenCalled();
    });
  });

  it('shows cached sync metadata when a catalog exists', () => {
    useModelCatalogStore.setState({
      models: {
        openrouter: {
          'openai/gpt-4o': { id: 'openai/gpt-4o', provider: 'openrouter' },
        },
      },
      syncedAt: { openrouter: '2026-04-08T16:00:00.000Z' },
    } as any);

    render(<ModelCatalogSection />);

    expect(screen.getByText(/cached openrouter catalog last updated/i)).toBeInTheDocument();
  });

  it('shows a refresh-required hint when userModelsRequireRefresh is true', () => {
    useModelCatalogStore.setState({
      userModelsRequireRefresh: { openrouter: true },
    } as any);

    render(<ModelCatalogSection />);

    expect(screen.getByText(/api key changed/i)).toBeInTheDocument();
  });
});
