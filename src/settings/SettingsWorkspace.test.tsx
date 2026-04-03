import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import SettingsWorkspace from './SettingsWorkspace';
import { useSettingsStore } from './settings-store';
import { DEFAULT_AGENT_DEFAULTS } from './types';

describe('SettingsWorkspace', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      apiKeys: {},
      agentDefaults: DEFAULT_AGENT_DEFAULTS,
    });
  });

  it('shows the active section metadata', () => {
    render(
      <SettingsWorkspace
        activeSection="api-keys"
        onExit={() => {}}
      />,
    );

    expect(
      screen.getByText('Manage provider credentials stored in this browser.'),
    ).toBeInTheDocument();
  });

  it('renders catalog idle state when no OpenRouter key exists', () => {
    render(
      <SettingsWorkspace
        activeSection="model-catalog"
        onExit={() => {}}
      />,
    );

    expect(
      screen.getByText(/Add an OpenRouter API key/i),
    ).toBeInTheDocument();
  });
});
