import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DataMaintenanceSection from './DataMaintenanceSection';
import { useGraphStore } from '../../store/graph-store';
import { useSessionStore } from '../../store/session-store';
import { useSettingsStore } from '../settings-store';

const storageClientMocks = vi.hoisted(() => ({
  construct: vi.fn(),
  init: vi.fn(async () => undefined),
  deleteAllSessions: vi.fn(async () => undefined),
}));

const resolveAgentConfigMock = vi.hoisted(() => vi.fn());

vi.mock('../../utils/export-import', () => ({
  exportGraph: vi.fn(() => ({ version: 2, exportedAt: 1, graph: {} })),
  importGraph: vi.fn(() => null),
  downloadJson: vi.fn(),
  uploadJson: vi.fn(async () => ({ invalid: true })),
}));

vi.mock('../../runtime/storage-client', () => ({
  StorageClient: class MockStorageClient {
    agentId: string;

    constructor(config: unknown, agentName: string, agentId: string) {
      storageClientMocks.construct(config, agentName, agentId);
      this.agentId = agentId;
    }

    init = storageClientMocks.init;
    deleteAllSessions = storageClientMocks.deleteAllSessions;
  },
}));

vi.mock('../../utils/graph-to-agent', () => ({
  resolveAgentConfig: resolveAgentConfigMock,
}));

describe('DataMaintenanceSection', () => {
  beforeEach(() => {
    resolveAgentConfigMock.mockReset();
    resolveAgentConfigMock.mockReturnValue({ storage: { baseDir: 'sessions' } });
    storageClientMocks.construct.mockClear();
    storageClientMocks.init.mockClear();
    storageClientMocks.deleteAllSessions.mockClear();

    useGraphStore.setState({
      nodes: [
        {
          id: 'agent-1',
          type: 'agent',
          data: { type: 'agent', name: 'Alpha' },
        },
      ] as any,
      edges: [],
      selectedNodeId: 'agent-1',
      pendingNameNodeId: null,
    });
    useSessionStore.setState({
      sessions: {
        s1: {
          id: 's1',
          sessionKey: 's1',
          sessionId: 'sess-1',
          agentId: 'agent-1',
          createdAt: 1,
          lastMessageAt: 1,
          displayName: 'Main session',
          messages: [],
          meta: {
            sessionKey: 's1',
            sessionId: 'sess-1',
            agentId: 'agent-1',
            createdAt: '2026-04-07T12:00:00.000Z',
            updatedAt: '2026-04-07T12:00:00.000Z',
            chatType: 'direct',
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            contextTokens: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalEstimatedCostUsd: 0,
            compactionCount: 0,
          },
        },
      },
      activeSessionKey: { 'agent-1': 's1' },
    } as any);
    useSettingsStore.setState({
      apiKeys: { openrouter: 'key-1' },
      agentDefaults: {
        provider: 'openai',
        modelId: 'gpt-4o',
        thinkingLevel: 'high',
        systemPromptMode: 'append',
        systemPrompt: 'Be concise.',
        safetyGuardrails: 'Be safe.',
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

  it('clears sessions only after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<DataMaintenanceSection />);

    fireEvent.click(screen.getByRole('button', { name: /Clear Chat Sessions/i }));

    await waitFor(() => {
      expect(useSessionStore.getState().sessions).toEqual({});
      expect(useSessionStore.getState().activeSessionKey).toEqual({});
    });
  });

  it('deletes persisted sessions for configured agents before clearing local state', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<DataMaintenanceSection />);

    fireEvent.click(screen.getByRole('button', { name: /Clear Chat Sessions/i }));

    await waitFor(() => {
      expect(storageClientMocks.construct).toHaveBeenCalledWith(
        { baseDir: 'sessions' },
        'Alpha',
        'agent-1',
      );
      expect(storageClientMocks.init).toHaveBeenCalledOnce();
      expect(storageClientMocks.deleteAllSessions).toHaveBeenCalledOnce();
    });

    expect(useSessionStore.getState().sessions).toEqual({});
    expect(useSessionStore.getState().activeSessionKey).toEqual({});
  });
});
