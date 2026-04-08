import { create } from 'zustand';
import {
  DEFAULT_AGENT_DEFAULTS,
  DEFAULT_STORAGE_DEFAULTS,
  DEFAULT_CONTEXT_ENGINE_DEFAULTS,
  DEFAULT_MEMORY_DEFAULTS,
  DEFAULT_CRON_DEFAULTS,
  type AgentDefaults,
  type StorageDefaults,
  type ContextEngineDefaults,
  type MemoryDefaults,
  type CronDefaults,
} from './types';

interface PersistedSettings {
  apiKeys: Record<string, string>;
  agentDefaults: AgentDefaults;
  storageDefaults: StorageDefaults;
  contextEngineDefaults: ContextEngineDefaults;
  memoryDefaults: MemoryDefaults;
  cronDefaults: CronDefaults;
}

interface SettingsStore extends PersistedSettings {
  loaded: boolean;
  setApiKey: (provider: string, key: string) => void;
  getApiKey: (provider: string) => string | undefined;
  removeApiKey: (provider: string) => void;
  setAgentDefaults: (updates: Partial<AgentDefaults>) => void;
  setStorageDefaults: (updates: Partial<StorageDefaults>) => void;
  setContextEngineDefaults: (updates: Partial<ContextEngineDefaults>) => void;
  setMemoryDefaults: (updates: Partial<MemoryDefaults>) => void;
  setCronDefaults: (updates: Partial<CronDefaults>) => void;
  resetSettings: () => void;
  loadFromServer: () => Promise<void>;
}

const INITIAL_DEFAULTS: Omit<PersistedSettings, 'apiKeys'> = {
  agentDefaults: DEFAULT_AGENT_DEFAULTS,
  storageDefaults: DEFAULT_STORAGE_DEFAULTS,
  contextEngineDefaults: DEFAULT_CONTEXT_ENGINE_DEFAULTS,
  memoryDefaults: DEFAULT_MEMORY_DEFAULTS,
  cronDefaults: DEFAULT_CRON_DEFAULTS,
};

async function fetchSettings(): Promise<PersistedSettings> {
  const res = await fetch('/api/settings');
  if (!res.ok) throw new Error(`Failed to load settings: ${res.status}`);
  const data = (await res.json()) as Partial<PersistedSettings>;
  return {
    apiKeys: data.apiKeys ?? {},
    agentDefaults: { ...DEFAULT_AGENT_DEFAULTS, ...(data.agentDefaults ?? {}) },
    storageDefaults: { ...DEFAULT_STORAGE_DEFAULTS, ...(data.storageDefaults ?? {}) },
    contextEngineDefaults: { ...DEFAULT_CONTEXT_ENGINE_DEFAULTS, ...(data.contextEngineDefaults ?? {}) },
    memoryDefaults: { ...DEFAULT_MEMORY_DEFAULTS, ...(data.memoryDefaults ?? {}) },
    cronDefaults: { ...DEFAULT_CRON_DEFAULTS, ...(data.cronDefaults ?? {}) },
  };
}

async function saveSettings(settings: PersistedSettings): Promise<void> {
  try {
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
  } catch {
    // Server unreachable — settings will be retried on next mutation
  }
}

function getSnapshot(state: SettingsStore): PersistedSettings {
  return {
    apiKeys: state.apiKeys,
    agentDefaults: state.agentDefaults,
    storageDefaults: state.storageDefaults,
    contextEngineDefaults: state.contextEngineDefaults,
    memoryDefaults: state.memoryDefaults,
    cronDefaults: state.cronDefaults,
  };
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  apiKeys: {},
  ...INITIAL_DEFAULTS,
  loaded: false,

  loadFromServer: async () => {
    try {
      const settings = await fetchSettings();
      set({ ...settings, loaded: true });
    } catch {
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
    const next = { ...get().agentDefaults, ...updates };
    set({ agentDefaults: next });
    saveSettings({ ...getSnapshot(get()), agentDefaults: next });
  },

  setStorageDefaults: (updates) => {
    const next = { ...get().storageDefaults, ...updates };
    set({ storageDefaults: next });
    saveSettings({ ...getSnapshot(get()), storageDefaults: next });
  },

  setContextEngineDefaults: (updates) => {
    const next = { ...get().contextEngineDefaults, ...updates };
    set({ contextEngineDefaults: next });
    saveSettings({ ...getSnapshot(get()), contextEngineDefaults: next });
  },

  setMemoryDefaults: (updates) => {
    const next = { ...get().memoryDefaults, ...updates };
    set({ memoryDefaults: next });
    saveSettings({ ...getSnapshot(get()), memoryDefaults: next });
  },

  setCronDefaults: (updates) => {
    const next = { ...get().cronDefaults, ...updates };
    set({ cronDefaults: next });
    saveSettings({ ...getSnapshot(get()), cronDefaults: next });
  },

  resetSettings: () => {
    const resetState: PersistedSettings = {
      apiKeys: {},
      ...INITIAL_DEFAULTS,
    };
    set(resetState);
    saveSettings(resetState);
  },
}));
