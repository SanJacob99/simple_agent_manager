import { create } from 'zustand';
import type { ProviderPluginSummary } from '../../shared/plugin-sdk';

interface ProviderRegistryState {
  providers: ProviderPluginSummary[];
  loading: boolean;
  error: string | null;
  loadProviders: () => Promise<void>;
  getProvider: (pluginId: string) => ProviderPluginSummary | undefined;
}

export const useProviderRegistryStore = create<ProviderRegistryState>(
  (set, get) => ({
    providers: [],
    loading: false,
    error: null,

    loadProviders: async () => {
      set({ loading: true, error: null });
      try {
        const res = await fetch('/api/providers');
        if (!res.ok) throw new Error(`Failed to load providers: ${res.status}`);
        const providers = (await res.json()) as ProviderPluginSummary[];
        set({ providers, loading: false });
      } catch (err) {
        set({ error: (err as Error).message, loading: false });
      }
    },

    getProvider: (pluginId: string) => {
      return get().providers.find((p) => p.id === pluginId);
    },
  }),
);
