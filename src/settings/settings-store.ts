import { create } from 'zustand';

const STORAGE_KEY = 'agent-manager-api-keys';

interface SettingsStore {
  apiKeys: Record<string, string>;
  setApiKey: (provider: string, key: string) => void;
  getApiKey: (provider: string) => string | undefined;
  removeApiKey: (provider: string) => void;
}

function loadKeys(): Record<string, string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveKeys(keys: Record<string, string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  apiKeys: loadKeys(),

  setApiKey: (provider, key) => {
    const updated = { ...get().apiKeys, [provider]: key };
    saveKeys(updated);
    set({ apiKeys: updated });
  },

  getApiKey: (provider) => {
    return get().apiKeys[provider] || undefined;
  },

  removeApiKey: (provider) => {
    const updated = { ...get().apiKeys };
    delete updated[provider];
    saveKeys(updated);
    set({ apiKeys: updated });
  },
}));
