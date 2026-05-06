import { create } from 'zustand';
import {
  DEFAULT_AGENT_DEFAULTS,
  DEFAULT_PROVIDER_DEFAULTS,
  DEFAULT_STORAGE_DEFAULTS,
  DEFAULT_CONTEXT_ENGINE_DEFAULTS,
  DEFAULT_MEMORY_DEFAULTS,
  DEFAULT_CRON_DEFAULTS,
  DEFAULT_AGENT_COMM_DEFAULTS,
  DEFAULT_CHAT_UI_DEFAULTS,
  DEFAULT_SAFETY_SETTINGS,
  DEFAULT_SAM_AGENT_DEFAULTS,
  type AgentDefaults,
  type ProviderDefaults,
  type StorageDefaults,
  type ContextEngineDefaults,
  type MemoryDefaults,
  type CronDefaults,
  type AgentCommDefaults,
  type ChatUIDefaults,
  type SafetySettings,
  type SamAgentDefaults,
} from './types';

interface PersistedSettings {
  apiKeys: Record<string, string>;
  agentDefaults: AgentDefaults;
  providerDefaults: ProviderDefaults;
  storageDefaults: StorageDefaults;
  contextEngineDefaults: ContextEngineDefaults;
  memoryDefaults: MemoryDefaults;
  cronDefaults: CronDefaults;
  agentCommDefaults: AgentCommDefaults;
  chatUIDefaults: ChatUIDefaults;
  safety: SafetySettings;
  samAgentDefaults: SamAgentDefaults;
}

interface SettingsStore extends PersistedSettings {
  loaded: boolean;
  setApiKey: (provider: string, key: string) => void;
  getApiKey: (provider: string) => string | undefined;
  removeApiKey: (provider: string) => void;
  setAgentDefaults: (updates: Partial<AgentDefaults>) => void;
  setProviderDefaults: (updates: Partial<ProviderDefaults>) => void;
  setStorageDefaults: (updates: Partial<StorageDefaults>) => void;
  setContextEngineDefaults: (updates: Partial<ContextEngineDefaults>) => void;
  setMemoryDefaults: (updates: Partial<MemoryDefaults>) => void;
  setCronDefaults: (updates: Partial<CronDefaults>) => void;
  setAgentCommDefaults: (updates: Partial<AgentCommDefaults>) => void;
  setChatUIDefaults: (updates: Partial<ChatUIDefaults>) => void;
  setSafetySettings: (updates: Partial<SafetySettings>) => void;
  setSamAgentDefaults: (updates: Partial<SamAgentDefaults>) => void;
  resetSettings: () => void;
  loadFromServer: () => Promise<void>;
}

const INITIAL_DEFAULTS: Omit<PersistedSettings, 'apiKeys'> = {
  agentDefaults: DEFAULT_AGENT_DEFAULTS,
  providerDefaults: DEFAULT_PROVIDER_DEFAULTS,
  storageDefaults: DEFAULT_STORAGE_DEFAULTS,
  contextEngineDefaults: DEFAULT_CONTEXT_ENGINE_DEFAULTS,
  memoryDefaults: DEFAULT_MEMORY_DEFAULTS,
  cronDefaults: DEFAULT_CRON_DEFAULTS,
  agentCommDefaults: DEFAULT_AGENT_COMM_DEFAULTS,
  chatUIDefaults: DEFAULT_CHAT_UI_DEFAULTS,
  safety: DEFAULT_SAFETY_SETTINGS,
  samAgentDefaults: DEFAULT_SAM_AGENT_DEFAULTS,
};

async function fetchSettings(): Promise<PersistedSettings> {
  const res = await fetch('/api/settings');
  if (!res.ok) throw new Error(`Failed to load settings: ${res.status}`);
  const data = (await res.json()) as Partial<PersistedSettings>;
  return {
    apiKeys: data.apiKeys ?? {},
    agentDefaults: { ...DEFAULT_AGENT_DEFAULTS, ...(data.agentDefaults ?? {}) },
    providerDefaults: { ...DEFAULT_PROVIDER_DEFAULTS, ...(data.providerDefaults ?? {}) },
    storageDefaults: { ...DEFAULT_STORAGE_DEFAULTS, ...(data.storageDefaults ?? {}) },
    contextEngineDefaults: { ...DEFAULT_CONTEXT_ENGINE_DEFAULTS, ...(data.contextEngineDefaults ?? {}) },
    memoryDefaults: { ...DEFAULT_MEMORY_DEFAULTS, ...(data.memoryDefaults ?? {}) },
    cronDefaults: { ...DEFAULT_CRON_DEFAULTS, ...(data.cronDefaults ?? {}) },
    agentCommDefaults: { ...DEFAULT_AGENT_COMM_DEFAULTS, ...(data.agentCommDefaults ?? {}) },
    chatUIDefaults: { ...DEFAULT_CHAT_UI_DEFAULTS, ...(data.chatUIDefaults ?? {}) },
    safety: { ...DEFAULT_SAFETY_SETTINGS, ...(data.safety ?? {}) },
    samAgentDefaults: { ...DEFAULT_SAM_AGENT_DEFAULTS, ...(data.samAgentDefaults ?? {}) },
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
    providerDefaults: state.providerDefaults,
    storageDefaults: state.storageDefaults,
    contextEngineDefaults: state.contextEngineDefaults,
    memoryDefaults: state.memoryDefaults,
    cronDefaults: state.cronDefaults,
    agentCommDefaults: state.agentCommDefaults,
    chatUIDefaults: state.chatUIDefaults,
    safety: state.safety,
    samAgentDefaults: state.samAgentDefaults,
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

  setProviderDefaults: (updates) => {
    const next = { ...get().providerDefaults, ...updates };
    set({ providerDefaults: next });
    saveSettings({ ...getSnapshot(get()), providerDefaults: next });
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

  setAgentCommDefaults: (updates) => {
    const next = { ...( get().agentCommDefaults ?? DEFAULT_AGENT_COMM_DEFAULTS), ...updates };
    set({ agentCommDefaults: next });
    saveSettings({ ...getSnapshot(get()), agentCommDefaults: next });
  },

  setChatUIDefaults: (updates) => {
    const next = { ...get().chatUIDefaults, ...updates };
    set({ chatUIDefaults: next });
    saveSettings({ ...getSnapshot(get()), chatUIDefaults: next });
  },

  setSafetySettings: (updates) => {
    const next = { ...get().safety, ...updates };
    set({ safety: next });
    saveSettings({ ...getSnapshot(get()), safety: next });
  },

  setSamAgentDefaults: (updates) => {
    const next = { ...get().samAgentDefaults, ...updates };
    set({ samAgentDefaults: next });
    saveSettings({ ...getSnapshot(get()), samAgentDefaults: next });
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
