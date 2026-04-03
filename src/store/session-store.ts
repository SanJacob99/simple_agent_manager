import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { buildSessionId, isSessionForAgent, parseSessionId } from '../utils/session-id';

// ── Message types (moved from chat-store) ──────────────────────────────────

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

// ── Store ──────────────────────────────────────────────────────────────────

const DEFAULT_MAX_SESSIONS = 3;

interface SessionStore {
  /** All sessions keyed by session ID */
  sessions: Record<string, ChatSession>;
  /** Maps nodeId → active sessionId */
  activeSessionId: Record<string, string>;

  // Session lifecycle
  createSession: (
    agentName: string,
    provider: string,
    modelId: string,
    isDefault?: boolean,
  ) => string;
  deleteSession: (sessionId: string) => void;
  deleteAllSessionsForAgent: (agentName: string) => void;

  // Active session mapping
  setActiveSession: (nodeId: string, sessionId: string) => void;
  getActiveSessionId: (nodeId: string) => string | null;
  clearActiveSession: (nodeId: string) => void;

  // Message operations
  addMessage: (sessionId: string, message: Message) => void;
  updateMessage: (
    sessionId: string,
    messageId: string,
    updater: (msg: Message) => Message,
  ) => void;
  clearSessionMessages: (sessionId: string) => void;

  // Querying
  getSessionsForAgent: (agentName: string) => ChatSession[];

  // Maintenance
  pruneOrphanSessions: (validAgentNames: string[]) => void;
  enforceSessionLimit: (agentName: string, maxSessions?: number) => void;
  resetAllSessions: () => void;
}

export const useSessionStore = create<SessionStore>()(
  persist(
    (set, get) => ({
      sessions: {},
      activeSessionId: {},

      createSession: (agentName, provider, modelId, isDefault = false) => {
        const id = buildSessionId(agentName, provider, modelId, isDefault);
        const now = Date.now();
        const slug = `${provider}/${modelId}`;

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

        return id;
      },

      deleteSession: (sessionId) => {
        set((state) => {
          const { [sessionId]: _, ...rest } = state.sessions;
          // Also clear any active mappings that point to this session
          const nextActive = { ...state.activeSessionId };
          for (const [nodeId, activeId] of Object.entries(nextActive)) {
            if (activeId === sessionId) {
              delete nextActive[nodeId];
            }
          }
          return { sessions: rest, activeSessionId: nextActive };
        });
      },

      deleteAllSessionsForAgent: (agentName) => {
        set((state) => {
          const nextSessions: Record<string, ChatSession> = {};
          const nextActive = { ...state.activeSessionId };

          for (const [id, session] of Object.entries(state.sessions)) {
            if (session.agentName !== agentName) {
              nextSessions[id] = session;
            }
          }

          // Clear active mappings that were pointing to deleted sessions
          for (const [nodeId, activeId] of Object.entries(nextActive)) {
            if (!(activeId in nextSessions)) {
              delete nextActive[nodeId];
            }
          }

          return { sessions: nextSessions, activeSessionId: nextActive };
        });
      },

      setActiveSession: (nodeId, sessionId) => {
        set((state) => ({
          activeSessionId: { ...state.activeSessionId, [nodeId]: sessionId },
        }));
      },

      getActiveSessionId: (nodeId) => {
        return get().activeSessionId[nodeId] ?? null;
      },

      clearActiveSession: (nodeId) => {
        set((state) => {
          const { [nodeId]: _, ...rest } = state.activeSessionId;
          return { activeSessionId: rest };
        });
      },

      addMessage: (sessionId, message) => {
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
      },

      getSessionsForAgent: (agentName) => {
        const { sessions } = get();
        return Object.values(sessions)
          .filter((s) => s.agentName === agentName)
          .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
      },

      pruneOrphanSessions: (validAgentNames) => {
        const nameSet = new Set(validAgentNames);
        set((state) => {
          const nextSessions: Record<string, ChatSession> = {};
          const nextActive = { ...state.activeSessionId };

          for (const [id, session] of Object.entries(state.sessions)) {
            if (nameSet.has(session.agentName)) {
              nextSessions[id] = session;
            }
          }

          // Clean up active mappings that point to pruned sessions
          for (const [nodeId, activeId] of Object.entries(nextActive)) {
            if (!(activeId in nextSessions)) {
              delete nextActive[nodeId];
            }
          }

          return { sessions: nextSessions, activeSessionId: nextActive };
        });
      },

      enforceSessionLimit: (agentName, maxSessions = DEFAULT_MAX_SESSIONS) => {
        set((state) => {
          const agentSessions = Object.values(state.sessions)
            .filter((s) => s.agentName === agentName)
            .sort((a, b) => b.lastMessageAt - a.lastMessageAt);

          if (agentSessions.length <= maxSessions) return state;

          // Keep the newest N sessions
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

          // Clean up active mappings
          for (const [nodeId, activeId] of Object.entries(nextActive)) {
            if (!(activeId in nextSessions)) {
              delete nextActive[nodeId];
            }
          }

          return { sessions: nextSessions, activeSessionId: nextActive };
        });
      },

      resetAllSessions: () => {
        set({
          sessions: {},
          activeSessionId: {},
        });
      },
    }),
    {
      name: 'agent-manager-sessions',
    },
  ),
);
