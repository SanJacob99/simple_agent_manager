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

function toSessionEntry(message: Message): SessionEntry {
  return {
    type: 'message',
    id: message.id,
    parentId: null,
    timestamp: new Date(message.timestamp).toISOString(),
    message: {
      role: message.role,
      content: [{ type: 'text', text: message.content }],
      timestamp: message.timestamp,
    },
  };
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
  };
}

const persistenceQueue = new Map<string, Promise<void>>();

function enqueueSessionPersistence(sessionId: string, task: () => Promise<void>): Promise<void> {
  const previous = persistenceQueue.get(sessionId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);

  persistenceQueue.set(
    sessionId,
    next.finally(() => {
      if (persistenceQueue.get(sessionId) === next) {
        persistenceQueue.delete(sessionId);
      }
    }),
  );

  return next;
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

function buildSessionId(agentName: string, provider: string, modelId: string): string {
  const slug = `${provider}/${modelId}`;
  const hash = Math.random().toString(36).slice(2, 10);
  return `${agentName}:${slug}:${hash}`;
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
      const id = buildSessionId(agentName, provider, modelId);
      const now = Date.now();
      const slug = `${provider}/${modelId}`;
      const nowIso = new Date(now).toISOString();
      const safeId = id.replace(/[^a-zA-Z0-9-]/g, '-');

      const meta: SessionMeta = {
        sessionId: id,
        agentName,
        llmSlug: slug,
        startedAt: nowIso,
        updatedAt: nowIso,
        sessionFile: `sessions/${safeId}.jsonl`,
        contextTokens: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalEstimatedCostUsd: 0,
        totalTokens: 0,
      };

      const { storageEngine } = get();

      // Update state optimistically to prevent React effects from triggering concurrent creations
      set((state) => ({
        sessions: {
          ...state.sessions,
          [id]: {
            id,
            agentName,
            llmSlug: slug,
            createdAt: now,
            lastMessageAt: now,
            messages: [],
          },
        },
      }));

      if (storageEngine) {
        await storageEngine.createSession(meta);
      }

      return id;
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
      const { storageEngine } = get();

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

      if (storageEngine) {
        await enqueueSessionPersistence(sessionId, async () => {
          await storageEngine.appendEntry(sessionId, toSessionEntry(message));
          await storageEngine.updateSessionMeta(sessionId, {
            updatedAt: new Date().toISOString(),
          });
        });
      }
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

      void get().flushSession(sessionId);
    },

    flushSession: async (sessionId) => {
      const { storageEngine } = get();
      if (!storageEngine) return;

      await enqueueSessionPersistence(sessionId, async () => {
        const session = get().sessions[sessionId];
        if (!session) return;

        const existingEntries = await storageEngine.readEntries(sessionId);
        const preservedEntries = existingEntries.filter((entry) => !isTranscriptMessageEntry(entry));
        const rewrittenEntries = [
          ...preservedEntries,
          ...session.messages.map((message) => toSessionEntry(message)),
        ];

        await storageEngine.replaceEntries(sessionId, rewrittenEntries);
        await storageEngine.updateSessionMeta(sessionId, {
          updatedAt: new Date().toISOString(),
        });
      });
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
