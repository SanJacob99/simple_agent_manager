import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('ui layout store', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('loads persisted panel widths from localStorage', async () => {
    localStorage.setItem(
      'agent-manager-ui-layout',
      JSON.stringify({
        propertiesPanelWidth: 360,
        chatDrawerWidth: 520,
      }),
    );

    const { useUILayoutStore } = await import('./ui-layout-store');

    expect(useUILayoutStore.getState().propertiesPanelWidth).toBe(360);
    expect(useUILayoutStore.getState().chatDrawerWidth).toBe(520);
  });

  it('persists width updates back to localStorage', async () => {
    const { useUILayoutStore } = await import('./ui-layout-store');

    useUILayoutStore.getState().setPropertiesPanelWidth(340);
    useUILayoutStore.getState().setChatDrawerWidth(610);

    expect(
      JSON.parse(localStorage.getItem('agent-manager-ui-layout') ?? '{}'),
    ).toEqual({
      propertiesPanelWidth: 340,
      chatDrawerWidth: 610,
      chatPanelOpen: true,
    });
  });
});
