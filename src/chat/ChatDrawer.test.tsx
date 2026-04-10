import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChatDrawer from './ChatDrawer';
import { useAgentConnectionStore } from '../store/agent-connection-store';
import { useGraphStore } from '../store/graph-store';
import { useSessionStore } from '../store/session-store';
import { useUILayoutStore } from '../store/ui-layout-store';
import { resolveAgentConfig } from '../utils/graph-to-agent';

vi.mock('../client', () => ({
  agentClient: {
    status: 'connected',
    send: vi.fn(),
    onEvent: vi.fn(() => vi.fn()),
    onStatusChange: vi.fn(() => vi.fn()),
    trackAgent: vi.fn(),
    untrackAgent: vi.fn(),
  },
}));

vi.mock('./ChatInput', () => ({
  default: () => <div data-testid="chat-input" />,
}));

vi.mock('./ChatMessages', () => ({
  default: () => <div data-testid="chat-messages" />,
}));

vi.mock('./useChatStream', () => ({
  useChatStream: () => ({
    isStreaming: false,
    isReasoning: false,
    compacting: false,
    suppressedReply: false,
    streamingMsgId: '',
    sendMessage: vi.fn(),
  }),
}));

vi.mock('./useContextWindow', () => ({
  useContextWindow: () => ({
    contextWindow: 128000,
    maxTokens: 4096,
    source: 'default',
  }),
  usePeripheralReservations: () => [],
}));

vi.mock('../panels/useRightAnchoredResize', () => ({
  useRightAnchoredResize: () => ({
    width: 420,
    onResizeStart: vi.fn(),
  }),
}));

vi.mock('../panels/PanelResizeHandle', () => ({
  default: () => <div data-testid="resize-handle" />,
}));

vi.mock('./chat-connection-state', () => ({
  getChatConnectionIssue: () => null,
}));

vi.mock('./transcript-loading', () => ({
  shouldShowTranscriptLoading: () => false,
}));

vi.mock('../runtime/storage-client', () => ({
  StorageClient: class {
    agentId = 'agent-1';

    init = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('../utils/graph-to-agent', () => ({
  resolveAgentConfig: vi.fn(),
}));

function makeConfig(pluginId: string) {
  return {
    id: 'agent-1',
    name: 'Agent',
    provider: {
      pluginId,
      authMethodId: 'api-key',
      envVar: 'OPENROUTER_API_KEY',
      baseUrl: '',
    },
    modelId: 'anthropic/claude-sonnet-4-20250514',
    modelCapabilities: {},
    contextEngine: { tokenBudget: 128000 },
    storage: { storagePath: 'C:/tmp/storage' },
  } as any;
}

describe('ChatDrawer', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();

    useGraphStore.setState({
      nodes: [
        {
          id: 'agent-1',
          type: 'agent',
          position: { x: 0, y: 0 },
          data: {
            type: 'agent',
            name: 'Agent',
            nameConfirmed: true,
            systemPrompt: 'Test',
            systemPromptMode: 'append',
            modelId: 'anthropic/claude-sonnet-4-20250514',
            thinkingLevel: 'off',
            description: '',
            tags: [],
            modelCapabilities: {},
            showReasoning: false,
            verbose: false,
          },
        },
      ] as any,
      edges: [],
      selectedNodeId: null,
      pendingNameNodeId: null,
    } as any);

    useUILayoutStore.setState({
      chatDrawerWidth: 420,
      setChatDrawerWidth: vi.fn(),
    } as any);

    useAgentConnectionStore.setState({
      connectionStatus: 'connected',
      hasConnectedOnce: true,
      startAgent: vi.fn(),
      abortAgent: vi.fn(),
      destroyAgent: vi.fn(),
    } as any);
  });

  it('blocks chat when the resolved config has no provider plugin id', () => {
    vi.mocked(resolveAgentConfig).mockReturnValue(makeConfig(''));

    useSessionStore.setState({
      sessions: {},
      activeSessionKey: {},
      transcriptStatus: {},
      createSession: vi.fn(async () => 'agent-1:main'),
      deleteSession: vi.fn(async () => undefined),
      setActiveSession: vi.fn(),
      addMessage: vi.fn(async () => undefined),
      clearSessionMessages: vi.fn(async () => undefined),
      getSessionsForAgent: vi.fn(() => []),
      enforceSessionLimit: vi.fn(async () => undefined),
      bindStorage: vi.fn(),
      unbindStorage: vi.fn(),
      loadSessionsFromDisk: vi.fn(async () => undefined),
    } as any);

    render(<ChatDrawer agentNodeId="agent-1" onClose={vi.fn()} />);

    expect(
      screen.getByText('Connect a Provider node to this agent to enable chat.'),
    ).toBeInTheDocument();
  });

  it('uses provider.pluginId for session creation and header display', async () => {
    vi.mocked(resolveAgentConfig).mockReturnValue(makeConfig('openrouter'));
    const createSession = vi.fn(async () => 'agent-1:main');

    useSessionStore.setState({
      sessions: {},
      activeSessionKey: {},
      transcriptStatus: {},
      createSession,
      deleteSession: vi.fn(async () => undefined),
      setActiveSession: vi.fn(),
      addMessage: vi.fn(async () => undefined),
      clearSessionMessages: vi.fn(async () => undefined),
      getSessionsForAgent: vi.fn(() => []),
      enforceSessionLimit: vi.fn(async () => undefined),
      bindStorage: vi.fn(),
      unbindStorage: vi.fn(),
      loadSessionsFromDisk: vi.fn(async () => undefined),
    } as any);

    render(<ChatDrawer agentNodeId="agent-1" onClose={vi.fn()} />);

    expect(
      screen.getByText('openrouter / anthropic/claude-sonnet-4-20250514'),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(createSession).toHaveBeenCalledWith(
        'agent-1',
        'openrouter',
        'anthropic/claude-sonnet-4-20250514',
        true,
      );
    });
  });
});
