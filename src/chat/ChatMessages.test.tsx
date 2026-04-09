import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChatMessages from './ChatMessages';
import { useSessionStore } from '../store/session-store';

vi.mock('./ContextUsagePanel', () => ({
  default: () => <div data-testid="context-usage-panel" />,
}));

vi.mock('./MessageBubble', () => ({
  default: ({ msg }: { msg: { content: string } }) => <div>{msg.content}</div>,
}));

const contextInfo = {
  contextWindow: 1000,
  maxTokens: 200,
  source: 'default' as const,
};

describe('ChatMessages', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    useSessionStore.getState().resetAllSessions();
    useSessionStore.setState({
      sessions: {},
      activeSessionKey: {},
      transcriptStatus: {},
    } as any);
    vi.restoreAllMocks();
  });

  it('shows a loading state while the active transcript is loading', () => {
    useSessionStore.setState({
      sessions: {
        'agent:one:main': {
          id: 'agent:one:main',
          sessionKey: 'agent:one:main',
          sessionId: 'sess-1',
          agentId: 'agent-one',
          createdAt: Date.now(),
          lastMessageAt: Date.now(),
          displayName: 'Main session',
          messages: [],
          meta: {} as any,
        },
      },
    } as any);

    render(
      <ChatMessages
        activeSessionKey="agent:one:main"
        isBlocked={false}
        isTranscriptLoading
        isStreaming={false}
        isReasoning={false}
        compacting={false}
        suppressedReply={false}
        streamingMsgId=""
        contextInfo={contextInfo}
        peripheralReservations={[]}
      />,
    );

    expect(screen.getByText('Loading')).toBeInTheDocument();
    expect(screen.queryByText('Send a message to start the conversation')).not.toBeInTheDocument();
  });

  it('pins to the bottom instantly when a transcript finishes hydrating', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    useSessionStore.setState({
      sessions: {
        'agent:one:main': {
          id: 'agent:one:main',
          sessionKey: 'agent:one:main',
          sessionId: 'sess-1',
          agentId: 'agent-one',
          createdAt: Date.now(),
          lastMessageAt: Date.now(),
          displayName: 'Main session',
          messages: [],
          meta: {} as any,
        },
      },
    } as any);

    const { rerender } = render(
      <ChatMessages
        activeSessionKey="agent:one:main"
        isBlocked={false}
        isTranscriptLoading
        isStreaming={false}
        isReasoning={false}
        compacting={false}
        suppressedReply={false}
        streamingMsgId=""
        contextInfo={contextInfo}
        peripheralReservations={[]}
      />,
    );

    useSessionStore.setState({
      sessions: {
        'agent:one:main': {
          id: 'agent:one:main',
          sessionKey: 'agent:one:main',
          sessionId: 'sess-1',
          agentId: 'agent-one',
          createdAt: Date.now(),
          lastMessageAt: Date.now(),
          displayName: 'Main session',
          messages: [
            { id: 'm1', role: 'user', content: 'Older message', timestamp: Date.now() - 1000 },
            { id: 'm2', role: 'assistant', content: 'Newest message', timestamp: Date.now() },
          ],
          meta: {} as any,
        },
      },
    } as any);

    rerender(
      <ChatMessages
        activeSessionKey="agent:one:main"
        isBlocked={false}
        isTranscriptLoading={false}
        isStreaming={false}
        isReasoning={false}
        compacting={false}
        suppressedReply={false}
        streamingMsgId=""
        contextInfo={contextInfo}
        peripheralReservations={[]}
      />,
    );

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'instant' });
    });
  });
});
