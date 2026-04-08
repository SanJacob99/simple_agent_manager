import { create } from 'zustand';
import type { SessionEntry } from '@mariozechner/pi-coding-agent';
import type { SessionStoreEntry } from '../../shared/storage-types';
import type { StorageClient } from '../runtime/storage-client';

type StorageBackend = StorageClient;

export interface MessageUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  tokenCount?: number;
  usage?: MessageUsage;
}

export interface ChatSession {
  id: string;
  sessionKey: string;
  sessionId: string;
  agentId: string;
  createdAt: number;
  lastMessageAt: number;
  displayName: string;
  messages: Message[];
  meta: SessionStoreEntry;
}

function extractMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part && typeof part === 'object' && 'text' in part) {
          return typeof part.text === 'string' ? part.text : '';
        }
        return '';
      })
      .join('');
  }

  return '';
}

function toStoredMessage(entry: SessionEntry): Message | null {
  if (entry.type !== 'message') {
    return null;
  }

  const raw = entry.message as { role?: string; content?: unknown; timestamp?: number; usage?: MessageUsage } | undefined;
  if (!raw?.role) {
    return null;
  }

  const role = raw.role === 'toolResult' ? 'tool' : raw.role;
  if (role !== 'user' && role !== 'assistant' && role !== 'tool') {
    return null;
  }

  return {
    id: entry.id,
    role,
    content: extractMessageContent(raw.content),
    timestamp: raw.timestamp ?? new Date(entry.timestamp).getTime(),
    tokenCount: raw.role === 'assistant' ? raw.usage?.output : undefined,
    usage: raw.role === 'assistant' ? raw.usage : undefined,
  };
}

function toChatSession(meta: SessionStoreEntry, messages: Message[] = []): ChatSession {
  return {
    id: meta.sessionKey,
    sessionKey: meta.sessionKey,
    sessionId: meta.sessionId,
    agentId: meta.agentId,
    createdAt: new Date(meta.createdAt).getTime(),
    lastMessageAt: new Date(meta.updatedAt).getTime(),
    displayName: meta.displayName ?? meta.subject ?? meta.sessionKey.split(':').slice(-1)[0] ?? 'Session',
    messages,
    meta,
  };
}

interface SessionStore {
  sessions: Record<string, ChatSession>;
  activeSessionKey: Record<string, string>;
  storageEngine: StorageBackend | null;
  storageEngines: Record<string, StorageBackend>;

  bindStorage: (engine: StorageBackend) => void;
  unbindStorage: () => void;
  loadSessionsFromDisk: () => Promise<void>;

  createSession: (
    agentId: string,
    provider: string,
    modelId: string,
    isDefault?: boolean,
  ) => Promise<string>;
  deleteSession: (sessionKey: string) => Promise<void>;
  deleteAllSessionsForAgent: (agentId: string) => Promise<void>;

  setActiveSession: (nodeId: string, sessionKey: string) => void;
  getActiveSessionKey: (nodeId: string) => string | null;
  clearActiveSession: (nodeId: string) => void;

  addMessage: (sessionKey: string, message: Message) => Promise<void>;
  updateMessage: (
    sessionKey: string,
    messageId: string,
    updater: (msg: Message) => Message,
  ) => void;
  deleteMessage: (sessionKey: string, messageId: string) => void;
  clearSessionMessages: (sessionKey: string) => Promise<void>;
  flushSession: (sessionKey: string) => Promise<void>;

  getSessionsForAgent: (agentId: string) => ChatSession[];

  pruneOrphanSessions: (validAgentIds: string[]) => Promise<void>;
  enforceSessionLimit: (agentId: string, maxSessions?: number) => Promise<void>;
  resetAllSessions: () => void;
}

export const useSessionStore = create<SessionStore>()((set, get) => ({
  sessions: {},
  activeSessionKey: {},
  storageEngine: null,
  storageEngines: {},

  bindStorage: (engine) => {
    set((state) => ({
      storageEngine: engine,
      storageEngines: {
        ...state.storageEngines,
        [engine.agentId]: engine,
      },
    }));
  },

  unbindStorage: () => {
    set({ storageEngine: null });
  },

  loadSessionsFromDisk: async () => {
    const { storageEngine } = get();
    if (!storageEngine) return;

    const metas = await storageEngine.listSessions();
    set((state) => {
      const nextSessions = { ...state.sessions };
      const currentAgentKeys = new Set<string>();

      for (const meta of metas) {
        currentAgentKeys.add(meta.sessionKey);
        nextSessions[meta.sessionKey] = toChatSession(
          meta,
          state.sessions[meta.sessionKey]?.messages ?? [],
        );
      }

      for (const [sessionKey, session] of Object.entries(nextSessions)) {
        if (session.agentId === storageEngine.agentId && !currentAgentKeys.has(sessionKey)) {
          delete nextSessions[sessionKey];
        }
      }

      const nextActive = { ...state.activeSessionKey };
      for (const [nodeId, sessionKey] of Object.entries(nextActive)) {
        if (!(sessionKey in nextSessions)) {
          delete nextActive[nodeId];
        }
      }
      return {
        sessions: nextSessions,
        activeSessionKey: nextActive,
      };
    });
  },

  createSession: async (agentId, provider, modelId, isDefault = false) => {
    const storageEngine = get().storageEngines[agentId] ?? get().storageEngine;
    if (!storageEngine) {
      throw new Error('Cannot create session without a bound storage backend');
    }

    const subKey = isDefault ? 'main' : `session-${Date.now()}`;
    const routed = await storageEngine.routeSession({
      subKey,
      chatType: 'direct',
      provider,
      displayName: isDefault ? 'Main session' : `${provider}/${modelId}`,
    });
    const meta = await storageEngine.getSession(routed.sessionKey);

    if (!meta) {
      throw new Error(`Session ${routed.sessionKey} was created but metadata could not be read back`);
    }

    set((state) => ({
      sessions: {
        ...state.sessions,
        [meta.sessionKey]: toChatSession(meta),
      },
    }));

    return meta.sessionKey;
  },

  deleteSession: async (sessionKey) => {
    const session = get().sessions[sessionKey];
    const storageEngine = session
      ? get().storageEngines[session.agentId] ?? get().storageEngine
      : get().storageEngine;
    if (storageEngine) {
      await storageEngine.deleteSession(sessionKey);
    }

    set((state) => {
      const { [sessionKey]: _deleted, ...rest } = state.sessions;
      const nextActive = { ...state.activeSessionKey };
      for (const [nodeId, activeKey] of Object.entries(nextActive)) {
        if (activeKey === sessionKey) delete nextActive[nodeId];
      }
      return { sessions: rest, activeSessionKey: nextActive };
    });
  },

  deleteAllSessionsForAgent: async (agentId) => {
    const storageEngine = get().storageEngines[agentId] ?? get().storageEngine;
    const toDelete = Object.values(get().sessions).filter((session) => session.agentId === agentId);

    if (storageEngine) {
      await Promise.all(toDelete.map((session) => storageEngine.deleteSession(session.sessionKey)));
    }

    set((state) => {
      const nextSessions: Record<string, ChatSession> = {};
      const nextActive = { ...state.activeSessionKey };

      for (const [sessionKey, session] of Object.entries(state.sessions)) {
        if (session.agentId !== agentId) {
          nextSessions[sessionKey] = session;
        }
      }
      for (const [nodeId, activeKey] of Object.entries(nextActive)) {
        if (!(activeKey in nextSessions)) delete nextActive[nodeId];
      }
      return { sessions: nextSessions, activeSessionKey: nextActive };
    });
  },

  setActiveSession: (nodeId, sessionKey) => {
    set((state) => ({
      activeSessionKey: { ...state.activeSessionKey, [nodeId]: sessionKey },
    }));
  },

  getActiveSessionKey: (nodeId) => get().activeSessionKey[nodeId] ?? null,

  clearActiveSession: (nodeId) => {
    set((state) => {
      const { [nodeId]: _cleared, ...rest } = state.activeSessionKey;
      return { activeSessionKey: rest };
    });
  },

  addMessage: async (sessionKey, message) => {
    set((state) => {
      const session = state.sessions[sessionKey];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionKey]: {
            ...session,
            messages: [...session.messages, message],
            lastMessageAt: Date.now(),
          },
        },
      };
    });
  },

  updateMessage: (sessionKey, messageId, updater) => {
    set((state) => {
      const session = state.sessions[sessionKey];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionKey]: {
            ...session,
            messages: session.messages.map((message) =>
              message.id === messageId ? updater(message) : message,
            ),
            lastMessageAt: Date.now(),
          },
        },
      };
    });
  },

  deleteMessage: (sessionKey, messageId) => {
    set((state) => {
      const session = state.sessions[sessionKey];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionKey]: {
            ...session,
            messages: session.messages.filter((message) => message.id !== messageId),
          },
        },
      };
    });
  },

  clearSessionMessages: async (sessionKey) => {
    const session = get().sessions[sessionKey];
    const storageEngine = session
      ? get().storageEngines[session.agentId] ?? get().storageEngine
      : get().storageEngine;
    if (storageEngine) {
      const routed = await storageEngine.resetSession(sessionKey);
      const meta = await storageEngine.getSession(routed.sessionKey);
      if (meta) {
        set((state) => ({
          sessions: {
            ...state.sessions,
            [sessionKey]: toChatSession(meta),
          },
        }));
        return;
      }
    }

    set((state) => {
      const session = state.sessions[sessionKey];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionKey]: {
            ...session,
            messages: [],
            lastMessageAt: Date.now(),
          },
        },
      };
    });
  },

  flushSession: async (sessionKey) => {
    const session = get().sessions[sessionKey];
    if (!session) return;
    const storageEngine = get().storageEngines[session.agentId] ?? get().storageEngine;
    if (!storageEngine) return;

    const [transcript, meta] = await Promise.all([
      storageEngine.getTranscript(sessionKey),
      storageEngine.getSession(sessionKey),
    ]);

    const messages = transcript.entries
      .map((entry) => toStoredMessage(entry))
      .filter((message): message is Message => message !== null);

    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionKey]: toChatSession(meta ?? session.meta, messages),
      },
    }));
  },

  getSessionsForAgent: (agentId) => {
    const { sessions } = get();
    return Object.values(sessions)
      .filter((session) => session.agentId === agentId)
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  },

  pruneOrphanSessions: async (validAgentIds) => {
    const validIds = new Set(validAgentIds);

    set((state) => {
      const nextSessions: Record<string, ChatSession> = {};
      const nextActive = { ...state.activeSessionKey };

      for (const [sessionKey, session] of Object.entries(state.sessions)) {
        if (validIds.has(session.agentId)) {
          nextSessions[sessionKey] = session;
        }
      }
      for (const [nodeId, activeKey] of Object.entries(nextActive)) {
        if (!(activeKey in nextSessions)) delete nextActive[nodeId];
      }
      return { sessions: nextSessions, activeSessionKey: nextActive };
    });
  },

  enforceSessionLimit: async (agentId, maxSessions = 50) => {
    const storageEngine = get().storageEngines[agentId] ?? get().storageEngine;
    const sessions = get().getSessionsForAgent(agentId);

    if (sessions.length <= maxSessions) {
      return;
    }

    const overflow = sessions.slice(maxSessions);
    if (storageEngine) {
      await Promise.all(overflow.map((session) => storageEngine.deleteSession(session.sessionKey)));
    }

    set((state) => {
      const nextSessions = { ...state.sessions };
      const nextActive = { ...state.activeSessionKey };

      for (const session of overflow) {
        delete nextSessions[session.sessionKey];
      }
      for (const [nodeId, activeKey] of Object.entries(nextActive)) {
        if (!(activeKey in nextSessions)) delete nextActive[nodeId];
      }

      return { sessions: nextSessions, activeSessionKey: nextActive };
    });
  },

  resetAllSessions: () => {
    const storages = Object.values(get().storageEngines);
    for (const storage of storages) {
      void storage.deleteAllSessions().catch(console.error);
    }
    set({ sessions: {}, activeSessionKey: {} });
  },
}));
