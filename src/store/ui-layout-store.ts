import { create } from 'zustand';

const STORAGE_KEY = 'agent-manager-ui-layout';

export const DEFAULT_PROPERTIES_PANEL_WIDTH = 288;
export const DEFAULT_CHAT_DRAWER_WIDTH = 420;
export const DEFAULT_CHAT_PANEL_OPEN = true;

interface UILayoutState {
  propertiesPanelWidth: number;
  chatDrawerWidth: number;
  chatPanelOpen: boolean;
  setPropertiesPanelWidth: (width: number) => void;
  setChatDrawerWidth: (width: number) => void;
  setChatPanelOpen: (open: boolean) => void;
  toggleChatPanel: () => void;
}

interface PersistedUILayout {
  propertiesPanelWidth: number;
  chatDrawerWidth: number;
  chatPanelOpen: boolean;
}

function loadUILayout(): PersistedUILayout {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return {
        propertiesPanelWidth: DEFAULT_PROPERTIES_PANEL_WIDTH,
        chatDrawerWidth: DEFAULT_CHAT_DRAWER_WIDTH,
        chatPanelOpen: DEFAULT_CHAT_PANEL_OPEN,
      };
    }

    const parsed = JSON.parse(stored) as Partial<PersistedUILayout>;
    return {
      propertiesPanelWidth:
        parsed.propertiesPanelWidth ?? DEFAULT_PROPERTIES_PANEL_WIDTH,
      chatDrawerWidth: parsed.chatDrawerWidth ?? DEFAULT_CHAT_DRAWER_WIDTH,
      chatPanelOpen: parsed.chatPanelOpen ?? DEFAULT_CHAT_PANEL_OPEN,
    };
  } catch {
    return {
      propertiesPanelWidth: DEFAULT_PROPERTIES_PANEL_WIDTH,
      chatDrawerWidth: DEFAULT_CHAT_DRAWER_WIDTH,
      chatPanelOpen: DEFAULT_CHAT_PANEL_OPEN,
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
      chatPanelOpen: get().chatPanelOpen,
    });
    set({ propertiesPanelWidth: width });
  },

  setChatDrawerWidth: (width) => {
    saveUILayout({
      propertiesPanelWidth: get().propertiesPanelWidth,
      chatDrawerWidth: width,
      chatPanelOpen: get().chatPanelOpen,
    });
    set({ chatDrawerWidth: width });
  },

  setChatPanelOpen: (open) => {
    saveUILayout({
      propertiesPanelWidth: get().propertiesPanelWidth,
      chatDrawerWidth: get().chatDrawerWidth,
      chatPanelOpen: open,
    });
    set({ chatPanelOpen: open });
  },

  toggleChatPanel: () => {
    const next = !get().chatPanelOpen;
    saveUILayout({
      propertiesPanelWidth: get().propertiesPanelWidth,
      chatDrawerWidth: get().chatDrawerWidth,
      chatPanelOpen: next,
    });
    set({ chatPanelOpen: next });
  },
}));
