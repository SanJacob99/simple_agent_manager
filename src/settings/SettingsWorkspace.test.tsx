import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SettingsWorkspace from './SettingsWorkspace';

describe('SettingsWorkspace', () => {
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
});
