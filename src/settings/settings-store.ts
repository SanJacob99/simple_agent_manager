import { create } from 'zustand';
import {
  DEFAULT_AGENT_DEFAULTS,
  DEFAULT_STORAGE_DEFAULTS,
  type AgentDefaults,
  type StorageDefaults,
} from './types';

const STORAGE_KEY = 'agent-manager-settings';
const LEGACY_API_KEYS_STORAGE_KEY = 'agent-manager-api-keys';

interface SettingsStore {
  apiKeys: Record<string, string>;
  agentDefaults: AgentDefaults;
  storageDefaults: StorageDefaults;
  setApiKey: (provider: string, key: string) => void;
  getApiKey: (provider: string) => string | undefined;
  removeApiKey: (provider: string) => void;
  setAgentDefaults: (updates: Partial<AgentDefaults>) => void;
  setStorageDefaults: (updates: Partial<StorageDefaults>) => void;
  resetSettings: () => void;
}

interface PersistedSettings {
  apiKeys: Record<string, string>;
  agentDefaults: AgentDefaults;
  storageDefaults: StorageDefaults;
}

function loadSettings(): PersistedSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<PersistedSettings>;
      return {
        apiKeys: parsed.apiKeys ?? {},
        agentDefaults: {
          ...DEFAULT_AGENT_DEFAULTS,
          ...(parsed.agentDefaults ?? {}),
        },
        storageDefaults: {
          ...DEFAULT_STORAGE_DEFAULTS,
          ...(parsed.storageDefaults ?? {}),
        },
      };
    }

    const legacyKeys = localStorage.getItem(LEGACY_API_KEYS_STORAGE_KEY);
    return {
      apiKeys: legacyKeys ? JSON.parse(legacyKeys) : {},
      agentDefaults: DEFAULT_AGENT_DEFAULTS,
      storageDefaults: DEFAULT_STORAGE_DEFAULTS,
    };
  } catch {
    return {
      apiKeys: {},
      agentDefaults: DEFAULT_AGENT_DEFAULTS,
      storageDefaults: DEFAULT_STORAGE_DEFAULTS,
    };
  }
}

function saveSettings(settings: PersistedSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  ...loadSettings(),

  setApiKey: (provider, key) => {
    const updated = { ...get().apiKeys, [provider]: key };
    saveSettings({
      apiKeys: updated,
      agentDefaults: get().agentDefaults,
      storageDefaults: get().storageDefaults,
    });
    set({ apiKeys: updated });
  },

  getApiKey: (provider) => {
    return get().apiKeys[provider] || undefined;
  },

  removeApiKey: (provider) => {
    const updated = { ...get().apiKeys };
    delete updated[provider];
    saveSettings({
      apiKeys: updated,
      agentDefaults: get().agentDefaults,
      storageDefaults: get().storageDefaults,
    });
    set({ apiKeys: updated });
  },

  setAgentDefaults: (updates) => {
    const nextAgentDefaults = {
      ...get().agentDefaults,
      ...updates,
    };
    saveSettings({
      apiKeys: get().apiKeys,
      agentDefaults: nextAgentDefaults,
      storageDefaults: get().storageDefaults,
    });
    set({ agentDefaults: nextAgentDefaults });
  },

  setStorageDefaults: (updates) => {
    const nextStorageDefaults = {
      ...get().storageDefaults,
      ...updates,
    };
    saveSettings({
      apiKeys: get().apiKeys,
      agentDefaults: get().agentDefaults,
      storageDefaults: nextStorageDefaults,
    });
    set({ storageDefaults: nextStorageDefaults });
  },

  resetSettings: () => {
    const resetState: PersistedSettings = {
      apiKeys: {},
      agentDefaults: DEFAULT_AGENT_DEFAULTS,
      storageDefaults: DEFAULT_STORAGE_DEFAULTS,
    };
    saveSettings(resetState);
    set(resetState);
  },
}));
