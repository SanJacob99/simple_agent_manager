import { create } from 'zustand';
import type { SessionMeta, SessionEntry } from '../../shared/storage-types';
import type { StorageClient } from '../runtime/storage-client';

/** Anything that quacks like StorageBackend or StorageClient */
type StorageBackend = StorageClient;

// ── Message types ──────────────────────────────────────────────────────────

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

// ── Session type ───────────────────────────────────────────────────────────

export interface ChatSession {
  id: string;
  agentName: string;
  llmSlug: string;
  createdAt: number;
  lastMessageAt: number;
  messages: Message[];
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

function isTranscriptMessageEntry(entry: SessionEntry): boolean {
  return entry.type === 'message';
}

function toStoredMessage(entry: SessionEntry): Message | null {
  const raw = entry.message as { role?: string; content?: unknown; timestamp?: number } | undefined;
  if (!raw?.role) {
    return null;
  }

  return {
    id: entry.id,
    role: raw.role as 'user' | 'assistant' | 'tool',
    content: extractMessageContent(raw.content),
    timestamp: raw.timestamp ?? new Date(entry.timestamp).getTime(),
    tokenCount:
      typeof (entry as any).tokenCount === 'number'
        ? (entry as any).tokenCount
        : undefined,
    usage:
      (entry as any).usage && typeof (entry as any).usage === 'object'
        ? (entry as any).usage as MessageUsage
        : undefined,
  };
}

// ── Store ──────────────────────────────────────────────────────────────────

interface SessionStore {
  /** All sessions keyed by session ID */
  sessions: Record<string, ChatSession>;
  /** Maps nodeId → active sessionId */
  activeSessionId: Record<string, string>;
  /** Bound storage engine (null until a storage node is connected) */
  storageEngine: StorageBackend | null;

  // Storage binding
  bindStorage: (engine: StorageBackend) => void;
  unbindStorage: () => void;
  loadSessionsFromDisk: () => Promise<void>;

  // Session lifecycle
  createSession: (
    agentName: string,
    provider: string,
    modelId: string,
    isDefault?: boolean,
  ) => Promise<string>;
  deleteSession: (sessionId: string) => Promise<void>;
  deleteAllSessionsForAgent: (agentName: string) => Promise<void>;

  // Active session mapping
  setActiveSession: (nodeId: string, sessionId: string) => void;
  getActiveSessionId: (nodeId: string) => string | null;
  clearActiveSession: (nodeId: string) => void;

  // Message operations
  addMessage: (sessionId: string, message: Message) => Promise<void>;
  updateMessage: (
    sessionId: string,
    messageId: string,
    updater: (msg: Message) => Message,
  ) => void;
  deleteMessage: (sessionId: string, messageId: string) => void;
  clearSessionMessages: (sessionId: string) => void;
  flushSession: (sessionId: string) => Promise<void>;

  // Querying
  getSessionsForAgent: (agentName: string) => ChatSession[];

  // Maintenance
  pruneOrphanSessions: (validAgentNames: string[]) => Promise<void>;
  enforceSessionLimit: (agentName: string, maxSessions?: number) => Promise<void>;
  resetAllSessions: () => void;
}

export const useSessionStore = create<SessionStore>()(
  (set, get) => ({
    sessions: {},
    activeSessionId: {},
    storageEngine: null,

    bindStorage: (engine) => {
      set({ storageEngine: engine });
    },

    unbindStorage: () => {
      set({ storageEngine: null, sessions: {}, activeSessionId: {} });
    },

    loadSessionsFromDisk: async () => {
      const { storageEngine } = get();
      if (!storageEngine) return;

      const metas = await storageEngine.listSessions();
      const sessions: Record<string, ChatSession> = {};

      for (const meta of metas) {
        const entries = await storageEngine.readEntries(meta.sessionId);
        const messages: Message[] = entries
          .filter((entry) => isTranscriptMessageEntry(entry) && entry.message)
          .map((entry) => toStoredMessage(entry))
          .filter((message): message is Message => message !== null);

        sessions[meta.sessionId] = {
          id: meta.sessionId,
          agentName: meta.agentName,
          llmSlug: meta.llmSlug,
          createdAt: new Date(meta.startedAt).getTime(),
          lastMessageAt: new Date(meta.updatedAt).getTime(),
          messages,
        };
      }

      set({ sessions });
    },

    createSession: async (agentName, provider, modelId, _isDefault = false) => {
      const slug = `${provider}/${modelId}`;
      const { storageEngine } = get();
      if (!storageEngine) {
        throw new Error('Cannot create session without a bound storage backend');
      }
      const meta = await storageEngine.createManagedSession(slug);
      const createdAt = new Date(meta.startedAt).getTime();
      const updatedAt = new Date(meta.updatedAt).getTime();

      set((state) => ({
        sessions: {
          ...state.sessions,
          [meta.sessionId]: {
            id: meta.sessionId,
            agentName: meta.agentName,
            llmSlug: slug,
            createdAt,
            lastMessageAt: updatedAt,
            messages: [],
          },
        },
      }));

      return meta.sessionId;
    },

    deleteSession: async (sessionId) => {
      const { storageEngine } = get();
      if (storageEngine) {
        await storageEngine.deleteSession(sessionId);
      }

      set((state) => {
        const { [sessionId]: _, ...rest } = state.sessions;
        const nextActive = { ...state.activeSessionId };
        for (const [nodeId, activeId] of Object.entries(nextActive)) {
          if (activeId === sessionId) delete nextActive[nodeId];
        }
        return { sessions: rest, activeSessionId: nextActive };
      });
    },

    deleteAllSessionsForAgent: async (agentName) => {
      const { storageEngine } = get();
      const toDelete = Object.values(get().sessions).filter(
        (s) => s.agentName === agentName,
      );

      if (storageEngine) {
        for (const s of toDelete) {
          await storageEngine.deleteSession(s.id);
        }
      }

      set((state) => {
        const nextSessions: Record<string, ChatSession> = {};
        const nextActive = { ...state.activeSessionId };

        for (const [id, session] of Object.entries(state.sessions)) {
          if (session.agentName !== agentName) nextSessions[id] = session;
        }
        for (const [nodeId, activeId] of Object.entries(nextActive)) {
          if (!(activeId in nextSessions)) delete nextActive[nodeId];
        }
        return { sessions: nextSessions, activeSessionId: nextActive };
      });
    },

    setActiveSession: (nodeId, sessionId) => {
      set((state) => ({
        activeSessionId: { ...state.activeSessionId, [nodeId]: sessionId },
      }));
    },

    getActiveSessionId: (nodeId) => get().activeSessionId[nodeId] ?? null,

    clearActiveSession: (nodeId) => {
      set((state) => {
        const { [nodeId]: _, ...rest } = state.activeSessionId;
        return { activeSessionId: rest };
      });
    },

    addMessage: async (sessionId, message) => {
      set((state) => {
        const session = state.sessions[sessionId];
        if (!session) return state;
        return {
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...session,
              messages: [...session.messages, message],
              lastMessageAt: Date.now(),
            },
          },
        };
      });
    },

    updateMessage: (sessionId, messageId, updater) => {
      set((state) => {
        const session = state.sessions[sessionId];
        if (!session) return state;
        return {
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...session,
              messages: session.messages.map((m) =>
                m.id === messageId ? updater(m) : m,
              ),
              lastMessageAt: Date.now(),
            },
          },
        };
      });
    },

    deleteMessage: (sessionId, messageId) => {
      set((state) => {
        const session = state.sessions[sessionId];
        if (!session) return state;
        return {
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...session,
              messages: session.messages.filter((m) => m.id !== messageId),
            },
          },
        };
      });
    },

    clearSessionMessages: (sessionId) => {
      const { storageEngine } = get();
      set((state) => {
        const session = state.sessions[sessionId];
        if (!session) return state;
        return {
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...session,
              messages: [],
              lastMessageAt: Date.now(),
            },
          },
        };
      });

      if (storageEngine) {
        void (async () => {
          const existingEntries = await storageEngine.readEntries(sessionId);
          const preservedEntries = existingEntries.filter((entry) => !isTranscriptMessageEntry(entry));
          await storageEngine.replaceEntries(sessionId, preservedEntries);
          await storageEngine.updateSessionMeta(sessionId, {
            updatedAt: new Date().toISOString(),
          });
        })();
      }
    },

    flushSession: async (sessionId) => {
      const { storageEngine } = get();
      if (!storageEngine) return;
      const session = get().sessions[sessionId];
      if (!session) return;

      const entries = await storageEngine.readEntries(sessionId);
      const messages = entries
        .filter((entry) => isTranscriptMessageEntry(entry) && entry.message)
        .map((entry) => toStoredMessage(entry))
        .filter((message): message is Message => message !== null);

      const meta = await storageEngine.getSessionMeta(sessionId);

      set((state) => ({
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...state.sessions[sessionId],
            lastMessageAt: meta ? new Date(meta.updatedAt).getTime() : state.sessions[sessionId].lastMessageAt,
            messages,
          },
        },
      }));
    },

    getSessionsForAgent: (agentName) => {
      const { sessions } = get();
      return Object.values(sessions)
        .filter((s) => s.agentName === agentName)
        .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    },

    pruneOrphanSessions: async (validAgentNames) => {
      const nameSet = new Set(validAgentNames);
      const { storageEngine } = get();

      set((state) => {
        const nextSessions: Record<string, ChatSession> = {};
        const nextActive = { ...state.activeSessionId };

        for (const [id, session] of Object.entries(state.sessions)) {
          if (nameSet.has(session.agentName)) {
            nextSessions[id] = session;
          } else if (storageEngine) {
            storageEngine.deleteSession(id).catch(console.error);
          }
        }
        for (const [nodeId, activeId] of Object.entries(nextActive)) {
          if (!(activeId in nextSessions)) delete nextActive[nodeId];
        }
        return { sessions: nextSessions, activeSessionId: nextActive };
      });
    },

    enforceSessionLimit: async (agentName, maxSessions = 50) => {
      const { storageEngine } = get();
      if (storageEngine) {
        await storageEngine.enforceRetention(maxSessions);
      }

      set((state) => {
        const agentSessions = Object.values(state.sessions)
          .filter((s) => s.agentName === agentName)
          .sort((a, b) => b.lastMessageAt - a.lastMessageAt);

        if (agentSessions.length <= maxSessions) return state;

        const toKeep = new Set(
          agentSessions.slice(0, maxSessions).map((s) => s.id),
        );
        const nextSessions: Record<string, ChatSession> = {};
        const nextActive = { ...state.activeSessionId };

        for (const [id, session] of Object.entries(state.sessions)) {
          if (session.agentName !== agentName || toKeep.has(id)) {
            nextSessions[id] = session;
          }
        }
        for (const [nodeId, activeId] of Object.entries(nextActive)) {
          if (!(activeId in nextSessions)) delete nextActive[nodeId];
        }
        return { sessions: nextSessions, activeSessionId: nextActive };
      });
    },

    resetAllSessions: () => {
      set({ sessions: {}, activeSessionId: {} });
    },
  }),
);
