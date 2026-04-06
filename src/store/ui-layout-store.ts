import { create } from 'zustand';

const STORAGE_KEY = 'agent-manager-ui-layout';

export const DEFAULT_PROPERTIES_PANEL_WIDTH = 288;
export const DEFAULT_CHAT_DRAWER_WIDTH = 420;

interface UILayoutState {
  propertiesPanelWidth: number;
  chatDrawerWidth: number;
  setPropertiesPanelWidth: (width: number) => void;
  setChatDrawerWidth: (width: number) => void;
}

interface PersistedUILayout {
  propertiesPanelWidth: number;
  chatDrawerWidth: number;
}

function loadUILayout(): PersistedUILayout {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return {
        propertiesPanelWidth: DEFAULT_PROPERTIES_PANEL_WIDTH,
        chatDrawerWidth: DEFAULT_CHAT_DRAWER_WIDTH,
      };
    }

    const parsed = JSON.parse(stored) as Partial<PersistedUILayout>;
    return {
      propertiesPanelWidth:
        parsed.propertiesPanelWidth ?? DEFAULT_PROPERTIES_PANEL_WIDTH,
      chatDrawerWidth: parsed.chatDrawerWidth ?? DEFAULT_CHAT_DRAWER_WIDTH,
    };
  } catch {
    return {
      propertiesPanelWidth: DEFAULT_PROPERTIES_PANEL_WIDTH,
      chatDrawerWidth: DEFAULT_CHAT_DRAWER_WIDTH,
    };
  }
}

function saveUILayout(layout: PersistedUILayout) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
}

export const useUILayoutStore = create<UILayoutState>((set, get) => ({
  ...loadUILayout(),

  setPropertiesPanelWidth: (width) => {
    saveUILayout({
      propertiesPanelWidth: width,
      chatDrawerWidth: get().chatDrawerWidth,
    });
    set({ propertiesPanelWidth: width });
  },

  setChatDrawerWidth: (width) => {
    saveUILayout({
      propertiesPanelWidth: get().propertiesPanelWidth,
      chatDrawerWidth: width,
    });
    set({ chatDrawerWidth: width });
  },
}));
