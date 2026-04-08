import { create } from 'zustand';
import {
  DEFAULT_AGENT_DEFAULTS,
  DEFAULT_STORAGE_DEFAULTS,
  type AgentDefaults,
  type StorageDefaults,
} from './types';

interface PersistedSettings {
  apiKeys: Record<string, string>;
  agentDefaults: AgentDefaults;
  storageDefaults: StorageDefaults;
}

interface SettingsStore {
  apiKeys: Record<string, string>;
  agentDefaults: AgentDefaults;
  storageDefaults: StorageDefaults;
  loaded: boolean;
  setApiKey: (provider: string, key: string) => void;
  getApiKey: (provider: string) => string | undefined;
  removeApiKey: (provider: string) => void;
  setAgentDefaults: (updates: Partial<AgentDefaults>) => void;
  setStorageDefaults: (updates: Partial<StorageDefaults>) => void;
  resetSettings: () => void;
  loadFromServer: () => Promise<void>;
}

async function fetchSettings(): Promise<PersistedSettings> {
  const res = await fetch('/api/settings');
  if (!res.ok) throw new Error(`Failed to load settings: ${res.status}`);
  const data = (await res.json()) as Partial<PersistedSettings>;
  return {
    apiKeys: data.apiKeys ?? {},
    agentDefaults: { ...DEFAULT_AGENT_DEFAULTS, ...(data.agentDefaults ?? {}) },
    storageDefaults: { ...DEFAULT_STORAGE_DEFAULTS, ...(data.storageDefaults ?? {}) },
  };
}

async function saveSettings(settings: PersistedSettings): Promise<void> {
  await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
}

function getSnapshot(state: SettingsStore): PersistedSettings {
  return {
    apiKeys: state.apiKeys,
    agentDefaults: state.agentDefaults,
    storageDefaults: state.storageDefaults,
  };
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  apiKeys: {},
  agentDefaults: DEFAULT_AGENT_DEFAULTS,
  storageDefaults: DEFAULT_STORAGE_DEFAULTS,
  loaded: false,

  loadFromServer: async () => {
    try {
      const settings = await fetchSettings();
      set({ ...settings, loaded: true });
    } catch {
      // Fall back to defaults if server is unreachable
      set({ loaded: true });
    }
  },

  setApiKey: (provider, key) => {
    const updated = { ...get().apiKeys, [provider]: key };
    set({ apiKeys: updated });
    saveSettings({ ...getSnapshot(get()), apiKeys: updated });
  },

  getApiKey: (provider) => {
    return get().apiKeys[provider] || undefined;
  },

  removeApiKey: (provider) => {
    const updated = { ...get().apiKeys };
    delete updated[provider];
    set({ apiKeys: updated });
    saveSettings({ ...getSnapshot(get()), apiKeys: updated });
  },

  setAgentDefaults: (updates) => {
    const nextAgentDefaults = { ...get().agentDefaults, ...updates };
    set({ agentDefaults: nextAgentDefaults });
    saveSettings({ ...getSnapshot(get()), agentDefaults: nextAgentDefaults });
  },

  setStorageDefaults: (updates) => {
    const nextStorageDefaults = { ...get().storageDefaults, ...updates };
    set({ storageDefaults: nextStorageDefaults });
    saveSettings({ ...getSnapshot(get()), storageDefaults: nextStorageDefaults });
  },

  resetSettings: () => {
    const resetState: PersistedSettings = {
      apiKeys: {},
      agentDefaults: DEFAULT_AGENT_DEFAULTS,
      storageDefaults: DEFAULT_STORAGE_DEFAULTS,
    };
    set(resetState);
    saveSettings(resetState);
  },
}));
