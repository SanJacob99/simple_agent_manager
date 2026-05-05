import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { X, Bot, Loader2, Trash2, Plus, ChevronDown, Unplug } from 'lucide-react';
import { useGraphStore } from '../store/graph-store';
import { useAgentConnectionStore } from '../store/agent-connection-store';
import { useUILayoutStore } from '../store/ui-layout-store';
import { resolveAgentConfig } from '../utils/graph-to-agent';
import type { ImageAttachment } from '../../shared/protocol';
import { useSessionStore, type Message } from '../store/session-store';
import ChatInput from './ChatInput';
import ChatMessages from './ChatMessages';
import HitlBanner from './HitlBanner';
import { StorageClient } from '../runtime/storage-client';
import { estimateTokens } from '../../shared/token-estimator';
import { useContextWindow } from './useContextWindow';
import { useChatStream } from './useChatStream';
import { useRightAnchoredResize } from '../panels/useRightAnchoredResize';
import PanelResizeHandle from '../panels/PanelResizeHandle';
import { getChatConnectionIssue } from './chat-connection-state';
import { shouldShowTranscriptLoading } from './transcript-loading';
import PeerChannelsSection from './PeerChannelsSection';

interface ChatDrawerProps {
  agentNodeId: string;
  onClose: () => void;
}


function formatSessionDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  if (isToday) {
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function formatSessionLabel(label: string, lastMessageAt: number, isMain: boolean): string {
  const dateStr = formatSessionDate(lastMessageAt);
  const prefix = isMain ? 'Main · ' : '';
  return `${prefix}${label} · ${dateStr}`;
}

export default function ChatDrawer({ agentNodeId, onClose }: ChatDrawerProps) {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const startAgent = useAgentConnectionStore((s) => s.startAgent);
  const abortAgent = useAgentConnectionStore((s) => s.abortAgent);
  const destroyAgent = useAgentConnectionStore((s) => s.destroyAgent);
  const connectionStatus = useAgentConnectionStore((s) => s.connectionStatus);
  const hasConnectedOnce = useAgentConnectionStore((s) => s.hasConnectedOnce);
  const storedWidth = useUILayoutStore((s) => s.chatDrawerWidth);
  const setChatDrawerWidth = useUILayoutStore((s) => s.setChatDrawerWidth);

  const config = useMemo(
    () => resolveAgentConfig(agentNodeId, nodes, edges),
    [agentNodeId, nodes, edges],
  );
  const { width, onResizeStart } = useRightAnchoredResize({
    width: storedWidth,
    minWidth: 360,
    maxWidth: 960,
    onWidthChange: setChatDrawerWidth,
  });

  // Session store — subscribe only to metadata, never to message content.
  // Message content subscriptions live in ChatMessages so streaming deltas
  // don't re-render this component.
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionKeyMap = useSessionStore((s) => s.activeSessionKey);
  const createSession = useSessionStore((s) => s.createSession);
  const deleteSession = useSessionStore((s) => s.deleteSession);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const addMessage = useSessionStore((s) => s.addMessage);
  const clearSessionMessages = useSessionStore((s) => s.clearSessionMessages);
  const getSessionsForAgent = useSessionStore((s) => s.getSessionsForAgent);
  const enforceSessionLimit = useSessionStore((s) => s.enforceSessionLimit);
  const bindStorage = useSessionStore((s) => s.bindStorage);
  const unbindStorage = useSessionStore((s) => s.unbindStorage);
  const loadSessionsFromDisk = useSessionStore((s) => s.loadSessionsFromDisk);
  const transcriptStatus = useSessionStore((s) => s.transcriptStatus);

  // Find the agent node to get name
  const agentNode = nodes.find((n) => n.id === agentNodeId && n.data.type === 'agent');
  const agentName =
    agentNode?.data.type === 'agent' ? (agentNode.data as { name: string }).name : '';

  // Bind StorageClient when storage config is available
  const [storageReady, setStorageReady] = useState(false);
  useEffect(() => {
    if (!config?.storage || !agentName) {
      setStorageReady(false);
      return;
    }

    const client = new StorageClient(config.storage, agentName, agentNodeId);
    client.init()
      .then(() => {
        bindStorage(client);
        return loadSessionsFromDisk();
      })
      .then(() => setStorageReady(true))
      .catch(console.error);

    return () => {
      unbindStorage();
      setStorageReady(false);
    };
  }, [config?.storage?.storagePath, agentName]);

  // Get sessions for this agent
  const agentSessions = useMemo(
    () => getSessionsForAgent(agentNodeId),
    [sessions, agentNodeId, getSessionsForAgent],
  );

  // Active session key
  const activeSessionKey = activeSessionKeyMap[agentNodeId] ?? null;
  const activeSession = activeSessionKey ? sessions[activeSessionKey] : null;
  const activeTranscriptStatus = activeSessionKey ? transcriptStatus[activeSessionKey] ?? 'idle' : 'idle';

  const creatingSessionRef = useRef(false);

  // Auto-create default session if none exists
  useEffect(() => {
    if (!config || !agentName || !storageReady || !config.provider.pluginId) return;

    if (agentSessions.length === 0) {
      if (creatingSessionRef.current) return;
      creatingSessionRef.current = true;

      // No sessions at all — create default
      createSession(agentNodeId, config.provider.pluginId, config.modelId, true)
        .then((id) => {
          setActiveSession(agentNodeId, id);
          creatingSessionRef.current = false;
        })
        .catch((err) => {
          console.error(err);
          creatingSessionRef.current = false;
        });
    } else if (!activeSessionKey || !sessions[activeSessionKey]) {
      // No active session or active session was deleted — pick the most recent
      setActiveSession(agentNodeId, agentSessions[0].id);
    }
  }, [agentNodeId, config, agentSessions.length, activeSessionKey, storageReady]);

  // UI state
  const [showSessionDropdown, setShowSessionDropdown] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const contextInfo = useContextWindow(config);

  const chatStream = useChatStream(agentNodeId);

  // Reconnect: when the active session changes (open, switch, reconnect),
  // ask the server for any pending HITL prompt so the banner shows up
  // without requiring a new tool call.
  const queryPendingHitl = chatStream.queryPendingHitl;
  useEffect(() => {
    if (activeSessionKey && connectionStatus === 'connected') {
      queryPendingHitl(activeSessionKey);
    }
  }, [activeSessionKey, connectionStatus, queryPendingHitl]);

  const isStreaming = chatStream.isStreaming;
  const supportsVision = config?.modelCapabilities?.inputModalities?.includes('image') ?? false;

  // Close dropdown on click outside
  useEffect(() => {
    if (!showSessionDropdown) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowSessionDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSessionDropdown]);

  const handleNewSession = async () => {
    if (!config || !agentName || !config.provider.pluginId) return;

    // Enforce limit before creating
    await enforceSessionLimit(agentNodeId, 3);

    // Check if we're at the limit after enforcement
    const currentSessions = getSessionsForAgent(agentNodeId);
    if (currentSessions.length >= 3) {
      const oldest = currentSessions[currentSessions.length - 1];
      await deleteSession(oldest.id);
    }

    const id = await createSession(
      agentNodeId,
      config.provider.pluginId,
      config.modelId,
      false,
    );
    setActiveSession(agentNodeId, id);
    setShowSessionDropdown(false);

    // Destroy current agent so a fresh one is used for the new session
    destroyAgent(agentNodeId);
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (deleteConfirmId === sessionId) {
      await deleteSession(sessionId);
      setDeleteConfirmId(null);

      // If we deleted the active session, switch to another
      if (activeSessionKey === sessionId) {
        const remaining = getSessionsForAgent(agentNodeId);
        if (remaining.length > 0) {
          setActiveSession(agentNodeId, remaining[0].id);
        } else if (config?.provider.pluginId) {
          // Create a new default session
          const id = await createSession(
            agentNodeId,
            config.provider.pluginId,
            config.modelId,
            true,
          );
          setActiveSession(agentNodeId, id);
        }
      }
    } else {
      setDeleteConfirmId(sessionId);
    }
  };

  const handleSwitchSession = (sessionId: string) => {
    setActiveSession(agentNodeId, sessionId);
    setShowSessionDropdown(false);
    // Destroy agent so it rebuilds with the new session's context
    destroyAgent(agentNodeId);
  };

  const handleSend = useCallback((text: string, attachments: ImageAttachment[]) => {
    if (!config || !activeSessionKey) return;

    const userMessage: Message = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: text || `[${attachments.length} image${attachments.length > 1 ? 's' : ''}]`,
      timestamp: Date.now(),
      tokenCount: estimateTokens(text),
    };

    // When the agent is waiting on a human prompt, route the text as the HITL
    // answer instead of starting a new turn. For kind='confirm', strict
    // yes/no parsing is enforced server-side — non-matching text gets an
    // agent:error reply and the prompt stays open.
    if (chatStream.pendingHitl && chatStream.pendingHitl.sessionKey === activeSessionKey) {
      addMessage(activeSessionKey, userMessage);
      chatStream.sendHitlResponse(
        activeSessionKey,
        chatStream.pendingHitl.toolCallId,
        chatStream.pendingHitl.kind,
        text,
      );
      return;
    }

    addMessage(activeSessionKey, userMessage);
    startAgent(agentNodeId, config);
    chatStream.sendMessage(text, activeSessionKey, attachments.length ? attachments : undefined);
  }, [config, agentNodeId, activeSessionKey, addMessage, startAgent, chatStream]);

  // Clicking a Yes/No button on the HITL banner: send via the structured
  // hitl:respond path AND add a synthetic user message so the answer shows
  // up in the transcript just like a typed response would.
  const handleHitlConfirm = useCallback(
    (answer: 'yes' | 'no') => {
      if (!activeSessionKey || !chatStream.pendingHitl) return;
      addMessage(activeSessionKey, {
        id: `msg_${Date.now()}`,
        role: 'user',
        content: answer,
        timestamp: Date.now(),
        tokenCount: estimateTokens(answer),
      });
      chatStream.sendHitlResponse(
        activeSessionKey,
        chatStream.pendingHitl.toolCallId,
        'confirm',
        answer,
      );
    },
    [activeSessionKey, chatStream, addMessage],
  );

  const handleStop = useCallback(() => {
    abortAgent(agentNodeId);
  }, [abortAgent, agentNodeId]);

  const handleClose = () => {
    destroyAgent(agentNodeId);
    onClose();
  };

  // Determine what's missing for the overlay message
  const missingPeripherals = useMemo(() => {
    if (!config) return [];
    const missing: { key: string; label: string; description: string; hint: string }[] = [];

    if (!config.contextEngine) {
      missing.push({
        key: 'contextEngine',
        label: 'Context Engine Required',
        description:
          'A Context Engine manages the conversation\'s token budget, compaction strategy, and memory window. Without it, the agent cannot track how much context is available, when to summarize or trim history, or how to allocate space for tools and system prompts.',
        hint: 'Drag a Context Engine node onto the canvas and connect it to this agent to enable chat.',
      });
    }

    if (!config.storage) {
      missing.push({
        key: 'storage',
        label: 'Storage Required',
        description:
          'A Storage node defines where sessions, messages, and memory files are persisted. Without it, the agent has nowhere to save conversation history.',
        hint: 'Drag a Storage node onto the canvas and connect it to this agent.',
      });
    }

    if (!config.provider.pluginId) {
      missing.push({
        key: 'provider',
        label: 'Provider Required',
        description:
          'A Provider node defines which model provider the agent uses and how the runtime resolves its auth and base URL.',
        hint: 'Connect a Provider node to this agent to enable chat.',
      });
    }

    const connectionIssue = getChatConnectionIssue(connectionStatus, hasConnectedOnce);
    if (connectionIssue) {
      missing.push(connectionIssue);
    }

    return missing;
  }, [config, connectionStatus, hasConnectedOnce]);

  const isBlocked = missingPeripherals.length > 0;
  const isTranscriptLoading = shouldShowTranscriptLoading({
    isBlocked,
    storageReady,
    activeTranscriptStatus,
    activeSessionKey,
    messageCount: activeSession?.messages.length ?? 0,
  });

  if (!config) return null;

  return (
    <div
      className="fixed inset-y-0 right-0 z-50 flex flex-col border-l border-slate-700 bg-slate-900 shadow-2xl relative"
      style={{ width }}
    >
      <PanelResizeHandle
        title="Resize chat drawer"
        onMouseDown={onResizeStart}
      />
      {/* Header */}
      <div className="flex flex-col border-b border-slate-800">
        {/* Top row: agent name + controls */}
        <div className="flex items-center gap-3 px-4 py-3">
          <Bot size={18} className="text-blue-400" />
          <div className="flex-1">
            <h3 className="text-sm font-bold text-slate-100">{config.name}</h3>
            <p className="text-[10px] text-slate-500">
              {config.provider.pluginId || 'no provider'} / {config.modelId}
            </p>
          </div>
          {isStreaming && (
            <Loader2 size={14} className="animate-spin text-blue-400" />
          )}
          {(activeSession?.messages.length ?? 0) > 0 && (
            <button
              onClick={() => activeSessionKey && clearSessionMessages(activeSessionKey)}
              className="rounded p-1 text-slate-500 transition hover:bg-slate-800 hover:text-red-400"
              title="Clear Messages"
            >
              <Trash2 size={16} />
            </button>
          )}
          <button
            onClick={handleClose}
            className="relative z-20 rounded p-1 text-slate-500 transition hover:bg-slate-800 hover:text-slate-300"
          >
            <X size={16} />
          </button>
        </div>

        {/* Session selector row */}
        <div className="flex items-center gap-1.5 border-t border-slate-800/50 px-4 py-1.5">
          <span className="text-[9px] uppercase tracking-wider text-slate-600 font-semibold">
            Session
          </span>
          <div className="relative flex-1" ref={dropdownRef}>
            <button
              onClick={() => setShowSessionDropdown(!showSessionDropdown)}
              className="flex w-full items-center justify-between gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] text-slate-300 transition hover:border-slate-600"
            >
              <span className="truncate">
                {activeSession
                  ? formatSessionLabel(
                    activeSession.displayName,
                    activeSession.lastMessageAt,
                    activeSession.sessionKey.endsWith(':main'),
                  )
                  : 'No session'}
              </span>
              <ChevronDown size={10} className="flex-shrink-0 text-slate-500" />
            </button>

            {/* Dropdown */}
            {showSessionDropdown && (
              <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-lg border border-slate-700 bg-slate-850 shadow-xl overflow-hidden"
                style={{ backgroundColor: 'var(--c-chat-input-bg)' }}>
                {agentSessions.map((session) => (
                  <div
                    key={session.id}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] cursor-pointer transition ${session.id === activeSessionKey
                      ? 'bg-blue-500/10 text-blue-300'
                      : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
                      }`}
                  >
                    <button
                      className="flex-1 text-left truncate"
                      onClick={() => handleSwitchSession(session.id)}
                    >
                      {formatSessionLabel(
                        session.displayName,
                        session.lastMessageAt,
                        session.sessionKey.endsWith(':main'),
                      )}
                      <span className="ml-1 text-[8px] text-slate-600">
                        ({session.messages.length} msgs)
                      </span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSession(session.id);
                      }}
                      className={`flex-shrink-0 rounded p-0.5 transition ${deleteConfirmId === session.id
                        ? 'bg-red-500/20 text-red-400'
                        : 'text-slate-600 hover:text-red-400'
                        }`}
                      title={
                        deleteConfirmId === session.id
                          ? 'Click again to confirm'
                          : 'Delete session'
                      }
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                ))}
                {agentSessions.length === 0 && (
                  <div className="px-2.5 py-2 text-[10px] text-slate-600 italic">
                    No sessions
                  </div>
                )}
              </div>
            )}
          </div>

          {/* New session button */}
          <button
            onClick={handleNewSession}
            className="rounded p-1 text-slate-500 transition hover:bg-slate-800 hover:text-blue-400"
            title="New Session"
          >
            <Plus size={14} />
          </button>
        </div>

        {/* Peer channels — read-only view of agent-to-agent channel sessions */}
        <PeerChannelsSection
          agentId={agentNodeId}
          hasPeers={(config.agentComm ?? []).some(
            (c) => c.protocol === 'direct' && c.targetAgentNodeId,
          )}
        />
      </div>

      {/* Missing Peripherals Overlay */}
      {isBlocked && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-slate-900/80 backdrop-blur-sm px-8">
          <div className="rounded-full bg-amber-500/10 p-4">
            <Unplug size={32} className="text-amber-400" />
          </div>
          {missingPeripherals.map((p) => (
            <div key={p.key} className="flex flex-col items-center gap-1.5">
              <h4 className="text-sm font-semibold text-slate-100 text-center">
                {p.label}
              </h4>
              <p className="text-xs text-slate-400 text-center leading-relaxed max-w-[280px]">
                {p.description}
              </p>
              <p className="text-[10px] text-slate-500 text-center max-w-[260px]">
                {p.hint}
              </p>
            </div>
          ))}
        </div>
      )}

      <ChatMessages
        activeSessionKey={activeSessionKey}
        isBlocked={isBlocked}
        isTranscriptLoading={isTranscriptLoading}
        isStreaming={isStreaming}
        isReasoning={chatStream.isReasoning}
        compacting={chatStream.compacting}
        suppressedReply={chatStream.suppressedReply}
        streamingMsgId={chatStream.streamingMsgId}
        contextInfo={contextInfo}
        hasTools={!!config.tools}
      />

      {/* HITL sticky banner — sits above the input when the agent is waiting. */}
      {chatStream.pendingHitl
        && chatStream.pendingHitl.sessionKey === activeSessionKey
        && !isBlocked && (
        <HitlBanner
          pending={chatStream.pendingHitl}
          onConfirmAnswer={handleHitlConfirm}
        />
      )}

      {/* Input */}
      <ChatInput
        isStreaming={isStreaming}
        isBlocked={isBlocked}
        supportsVision={supportsVision}
        hitlPending={
          !!chatStream.pendingHitl
          && chatStream.pendingHitl.sessionKey === activeSessionKey
        }
        onSend={handleSend}
        onStop={handleStop}
      />
    </div>
  );
}
