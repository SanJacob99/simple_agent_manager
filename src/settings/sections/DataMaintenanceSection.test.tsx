import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DataMaintenanceSection from './DataMaintenanceSection';
import { useGraphStore } from '../../store/graph-store';
import { useSessionStore } from '../../store/session-store';
import { useSettingsStore } from '../settings-store';

vi.mock('../../utils/export-import', () => ({
  exportGraph: vi.fn(() => ({ version: 2, exportedAt: 1, graph: {} })),
  importGraph: vi.fn(() => null),
  downloadJson: vi.fn(),
  uploadJson: vi.fn(async () => ({ invalid: true })),
}));

describe('DataMaintenanceSection', () => {
  beforeEach(() => {
    useGraphStore.setState({
      nodes: [{ id: 'agent-1', type: 'agent' }] as any,
      edges: [],
      selectedNodeId: 'agent-1',
      pendingNameNodeId: null,
    });
    useSessionStore.setState({
      sessions: {
        s1: {
          id: 's1',
          agentName: 'Agent',
          llmSlug: 'openai/gpt-4o',
          createdAt: 1,
          lastMessageAt: 1,
          messages: [],
        },
      },
      activeSessionId: { 'agent-1': 's1' },
    } as any);
    useSettingsStore.setState({
      apiKeys: { openrouter: 'key-1' },
      agentDefaults: {
        provider: 'openai',
        modelId: 'gpt-4o',
        thinkingLevel: 'high',
        systemPrompt: 'Be concise.',
      },
    });
  });

  it('shows an inline error when an imported graph is invalid', async () => {
    render(<DataMaintenanceSection />);

    fireEvent.click(screen.getByRole('button', { name: /Import Graph/i }));

    await waitFor(() => {
      expect(screen.getByText(/Invalid graph file format/i)).toBeInTheDocument();
    });
  });

  it('clears sessions only after confirmation', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<DataMaintenanceSection />);

    fireEvent.click(screen.getByRole('button', { name: /Clear Chat Sessions/i }));

    expect(useSessionStore.getState().sessions).toEqual({});
    expect(useSessionStore.getState().activeSessionId).toEqual({});
  });
});
