import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { X, Send, Bot, Loader2, Square, Trash2, Wrench, Plus, ChevronDown, Unplug, ImagePlus, Brain, RefreshCw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useGraphStore } from '../store/graph-store';
import { useAgentConnectionStore } from '../store/agent-connection-store';
import { useUILayoutStore } from '../store/ui-layout-store';
import { resolveAgentConfig } from '../utils/graph-to-agent';
import type { ImageAttachment } from '../../shared/protocol';
import { useSessionStore, type Message } from '../store/session-store';
import { StorageClient } from '../runtime/storage-client';
import { estimateTokens } from '../../shared/token-estimator';
import { useContextWindow, usePeripheralReservations } from './useContextWindow';
import ContextUsagePanel from './ContextUsagePanel';
import { useChatStream } from './useChatStream';
import { useRightAnchoredResize } from '../panels/useRightAnchoredResize';
import PanelResizeHandle from '../panels/PanelResizeHandle';

interface ChatDrawerProps {
  agentNodeId: string;
  onClose: () => void;
}

function formatTokenBadge(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
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
  const storedWidth = useUILayoutStore((s) => s.chatDrawerWidth);
  const setChatDrawerWidth = useUILayoutStore((s) => s.setChatDrawerWidth);

  const config = resolveAgentConfig(agentNodeId, nodes, edges);
  const { width, onResizeStart } = useRightAnchoredResize({
    width: storedWidth,
    minWidth: 360,
    maxWidth: 960,
    onWidthChange: setChatDrawerWidth,
  });

  // Session store
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
  const messages = activeSession?.messages ?? [];

  const creatingSessionRef = useRef(false);

  // Auto-create default session if none exists
  useEffect(() => {
    if (!config || !agentName || !storageReady) return;

    if (agentSessions.length === 0) {
      if (creatingSessionRef.current) return;
      creatingSessionRef.current = true;
      
      // No sessions at all — create default
      createSession(agentNodeId, config.provider, config.modelId, true)
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

  // Context window and peripheral reservations
  const contextInfo = useContextWindow(config);
  const peripheralReservations = usePeripheralReservations(config);

  const chatStream = useChatStream(agentNodeId);

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [attachmentPreviews, setAttachmentPreviews] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isStreaming = chatStream.isStreaming;
  const supportsVision = config?.modelCapabilities?.inputModalities?.includes('image') ?? false;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
    if (!config || !agentName) return;

    // Enforce limit before creating
    await enforceSessionLimit(agentNodeId, 3);

    // Check if we're at the limit after enforcement
    const currentSessions = getSessionsForAgent(agentNodeId);
    if (currentSessions.length >= 3) {
      const oldest = currentSessions[currentSessions.length - 1];
      await deleteSession(oldest.id);
    }

    const id = await createSession(agentNodeId, config.provider, config.modelId, false);
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
        } else if (config) {
          // Create a new default session
          const id = await createSession(agentNodeId, config.provider, config.modelId, true);
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

  const sendMessage = useCallback(async () => {
    if ((!input.trim() && attachments.length === 0) || isStreaming || !config || !activeSessionKey) return;

    const trimmedInput = input.trim();
    const currentAttachments = attachments;
    const userMessage: Message = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: trimmedInput || `[${currentAttachments.length} image${currentAttachments.length > 1 ? 's' : ''}]`,
      timestamp: Date.now(),
      tokenCount: estimateTokens(trimmedInput),
    };

    addMessage(activeSessionKey, userMessage);
    setInput('');
    setAttachments([]);
    setAttachmentPreviews([]);

    // Ensure agent is started with current config
    startAgent(agentNodeId, config);

    // Delegate streaming event handling to useChatStream
    chatStream.sendMessage(trimmedInput, activeSessionKey, currentAttachments.length ? currentAttachments : undefined);
  }, [input, attachments, isStreaming, config, agentNodeId, activeSessionKey, startAgent, chatStream]);

  const handleStop = () => {
    abortAgent(agentNodeId);
  };

  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        // dataUrl format: "data:<mimeType>;base64,<data>"
        const [header, data] = dataUrl.split(',');
        const mimeType = header.split(':')[1].split(';')[0];
        setAttachments((prev) => [...prev, { data, mimeType }]);
        setAttachmentPreviews((prev) => [...prev, dataUrl]);
      };
      reader.readAsDataURL(file);
    });
    // Reset file input so the same file can be re-selected
    e.target.value = '';
  }, []);

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

    if (connectionStatus === 'disconnected') {
      missing.push({
        key: 'disconnected',
        label: 'Connection Lost',
        description: 'The WebSocket connection to the backend has dropped.',
        hint: 'Please refresh the page to reconnect to the server.',
      });
    }

    return missing;
  }, [config, connectionStatus]);

  const isBlocked = missingPeripherals.length > 0;

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
              {config.provider} / {config.modelId}
            </p>
          </div>
          {isStreaming && (
            <Loader2 size={14} className="animate-spin text-blue-400" />
          )}
          {messages.length > 0 && (
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
                   style={{ backgroundColor: '#1a2332' }}>
                {agentSessions.map((session) => (
                  <div
                    key={session.id}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] cursor-pointer transition ${
                      session.id === activeSessionKey
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
                      className={`flex-shrink-0 rounded p-0.5 transition ${
                        deleteConfirmId === session.id
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

      {/* Messages */}
      <div className={`flex-1 overflow-y-auto p-4 space-y-3 ${isBlocked ? 'pointer-events-none select-none blur-[2px]' : ''}`}>
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <p className="text-xs text-slate-600">
              Send a message to start the conversation
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className="max-w-[85%]">
              <div
                className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : msg.role === 'tool'
                      ? 'border border-slate-700 bg-slate-800/50 text-slate-400 italic'
                      : 'bg-slate-800 text-slate-200'
                }`}
              >
                {msg.role === 'assistant' ? (
                  <div className="prose-sm max-w-none text-slate-200 break-words">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        p: (props: any) => { const {node, ...rest} = props; return <p className="mb-2 last:mb-0 leading-relaxed" {...rest} /> },
                        a: (props: any) => { const {node, ...rest} = props; return <a className="text-blue-400 hover:text-blue-300 underline underline-offset-2" target="_blank" rel="noopener noreferrer" {...rest} /> },
                        ul: (props: any) => { const {node, ...rest} = props; return <ul className="list-disc pl-4 mb-2 space-y-1" {...rest} /> },
                        ol: (props: any) => { const {node, ...rest} = props; return <ol className="list-decimal pl-4 mb-2 space-y-1" {...rest} /> },
                        li: (props: any) => { const {node, ...rest} = props; return <li className="marker:text-slate-500" {...rest} /> },
                        h1: (props: any) => { const {node, ...rest} = props; return <h1 className="text-lg font-bold mt-4 mb-2 text-slate-100" {...rest} /> },
                        h2: (props: any) => { const {node, ...rest} = props; return <h2 className="text-base font-bold mt-4 mb-2 text-slate-100 border-b border-slate-700/50 pb-1" {...rest} /> },
                        h3: (props: any) => { const {node, ...rest} = props; return <h3 className="text-sm font-bold mt-3 mb-1 text-slate-200" {...rest} /> },
                        table: (props: any) => { const {node, ...rest} = props; return <div className="overflow-x-auto my-3"><table className="w-full text-left border-collapse" {...rest} /></div> },
                        th: (props: any) => { const {node, ...rest} = props; return <th className="border border-slate-700 bg-slate-900/50 px-3 py-2 font-semibold text-slate-100" {...rest} /> },
                        td: (props: any) => { const {node, ...rest} = props; return <td className="border border-slate-700 px-3 py-2 text-slate-300" {...rest} /> },
                        blockquote: (props: any) => { const {node, ...rest} = props; return <blockquote className="border-l-4 border-blue-500/50 bg-slate-900/30 pl-3 py-1 pr-2 my-2 italic text-slate-400 rounded-r" {...rest} /> },
                        code(props: any) {
                          const {children, className, node, ...rest} = props;
                          const match = /language-(\w+)/.exec(className || '');
                          return match ? (
                            <div className="rounded-md bg-[#0d1117] border border-slate-700/60 my-3 overflow-hidden shadow-sm">
                              <div className="bg-slate-800/80 px-3 py-1.5 text-[10px] text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-700/60">
                                {match[1]}
                              </div>
                              <pre className="p-3 overflow-x-auto text-[11px] font-mono text-slate-300 leading-normal">
                                <code className={className} {...rest}>
                                  {children}
                                </code>
                              </pre>
                            </div>
                          ) : (
                            <code className="bg-slate-900/60 px-1.5 py-0.5 rounded border border-slate-700/50 text-slate-300 font-mono text-[11px]" {...rest}>
                              {children}
                            </code>
                          );
                        }
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap font-sans break-words">{msg.content}</pre>
                )}
                {msg.role === 'assistant' && !msg.content && isStreaming && (
                  <span className="inline-block h-3 w-1 animate-pulse bg-slate-400" />
                )}
              </div>
              {/* Token badge */}
              {msg.tokenCount != null && msg.tokenCount > 0 && (
                <div className={`flex items-center gap-1 mt-0.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'tool' && <Wrench size={8} className="text-slate-600" />}
                  <span className="text-[8px] tabular-nums text-slate-600 font-mono">
                    {formatTokenBadge(msg.tokenCount)} tokens
                  </span>
                  {msg.usage && (
                    <span className="text-[8px] text-slate-600 font-mono">
                      (in:{formatTokenBadge(msg.usage.input)} out:{formatTokenBadge(msg.usage.output)})
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {/* Reasoning indicator */}
        {chatStream.isReasoning && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-purple-500/10 border border-purple-500/20">
            <Brain size={12} className="text-purple-400 animate-pulse" />
            <span className="text-[10px] text-purple-300">Thinking...</span>
          </div>
        )}
        {/* Compaction indicator */}
        {chatStream.compacting && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/20">
            <RefreshCw size={12} className="text-amber-400 animate-spin" />
            <span className="text-[10px] text-amber-300">Compacting context...</span>
          </div>
        )}
        {/* Suppressed reply notice */}
        {chatStream.suppressedReply && !isStreaming && (
          <div className="flex justify-start">
            <div className="rounded-lg px-3 py-2 text-[10px] text-slate-500 italic bg-slate-800/30 border border-slate-700/50">
              Agent chose not to reply
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Context Usage Panel — above input */}
      <div className={isBlocked ? 'pointer-events-none select-none blur-[2px]' : ''}>
        <ContextUsagePanel
          messages={messages}
          contextInfo={contextInfo}
          peripheralReservations={peripheralReservations}
        />
      </div>

      {/* Input */}
      <div className={`border-t border-slate-800 p-3 ${isBlocked ? 'pointer-events-none select-none blur-[2px]' : ''}`}>
        {/* Image attachment thumbnails */}
        {attachmentPreviews.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {attachmentPreviews.map((preview, i) => (
              <div key={i} className="relative group">
                <img
                  src={preview}
                  alt={`attachment ${i + 1}`}
                  className="h-14 w-14 rounded object-cover border border-slate-700"
                />
                <button
                  type="button"
                  onClick={() => {
                    setAttachments((prev) => prev.filter((_, idx) => idx !== i));
                    setAttachmentPreviews((prev) => prev.filter((_, idx) => idx !== i));
                  }}
                  className="absolute -top-1 -right-1 hidden group-hover:flex items-center justify-center w-4 h-4 rounded-full bg-slate-900 border border-slate-600 text-slate-300 hover:text-white text-[10px]"
                  title="Remove image"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          {supportsVision && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleImageSelect}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isStreaming || isBlocked}
                className="rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-400 transition hover:text-slate-200 hover:border-slate-600 disabled:opacity-50"
                title="Attach images"
              >
                <ImagePlus size={14} />
              </button>
            </>
          )}
          <input
            className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder="Type a message..."
            disabled={isStreaming || isBlocked}
          />
          {isStreaming ? (
            <button
              onClick={handleStop}
              className="rounded-lg bg-red-600 p-2 text-white transition hover:bg-red-500"
              title="Stop Agent"
            >
              <Square fill="currentColor" size={14} />
            </button>
          ) : (
            <button
              onClick={sendMessage}
              disabled={(!input.trim() && attachments.length === 0) || isBlocked}
              className="rounded-lg bg-blue-600 p-2 text-white transition hover:bg-blue-500 disabled:opacity-50"
              title="Send Message"
            >
              <Send size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
