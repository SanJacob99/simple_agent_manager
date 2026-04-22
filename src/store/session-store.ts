import { create } from 'zustand';
import type { SessionEntry } from '@mariozechner/pi-coding-agent';
import type { SessionStoreEntry, BranchTree, SessionLineage } from '../../shared/storage-types';
import {
  RUN_DIAGNOSTIC_CUSTOM_TYPE,
  formatRunDiagnostic,
  isRunDiagnosticData,
} from '../../shared/session-diagnostics';
import type { StorageClient } from '../runtime/storage-client';

type StorageBackend = StorageClient;

export interface MessageUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
}

export interface MessageImage {
  mimeType: string;
  data: string; // base64
}

export interface MessageAudio {
  mimeType: string;
  /** Base64-encoded audio bytes — rendered via a `data:` URL. */
  data: string;
  path?: string;
  filename?: string;
  transcript?: string;
  provider?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  tokenCount?: number;
  usage?: MessageUsage;
  kind?: 'diagnostic';
  thinking?: string;
  toolName?: string;
  isToolError?: boolean;
  images?: MessageImage[];
  audios?: MessageAudio[];
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

export type TranscriptStatus = 'idle' | 'loading' | 'ready';

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

function extractThinkingContent(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;

  const parts = content
    .map((part) => {
      if (part && typeof part === 'object' && part !== null) {
        const p = part as { type?: unknown; thinking?: unknown; text?: unknown };
        if (p.type === 'thinking' && typeof p.thinking === 'string') {
          return p.thinking;
        }
      }
      return '';
    })
    .filter((t) => t.length > 0);

  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

function extractImageContent(content: unknown): MessageImage[] | undefined {
  if (!Array.isArray(content)) return undefined;
  const images: MessageImage[] = [];
  for (const part of content) {
    if (part && typeof part === 'object') {
      const p = part as { type?: unknown; mimeType?: unknown; data?: unknown };
      if (p.type === 'image' && typeof p.mimeType === 'string' && typeof p.data === 'string') {
        images.push({ mimeType: p.mimeType, data: p.data });
      }
    }
  }
  return images.length > 0 ? images : undefined;
}

/**
 * Pull playable audio clips out of a tool result's `details` payload.
 * Tools surface audio via `details.audio` (single) or `details.audios`
 * (multi); anything else is ignored. See `TtsAudioDetails` in the TTS
 * module for the producer side of this contract.
 */
function extractAudioDetails(details: unknown): MessageAudio[] | undefined {
  if (!details || typeof details !== 'object') return undefined;
  const d = details as { audio?: unknown; audios?: unknown };
  const raw: unknown[] = Array.isArray(d.audios)
    ? d.audios
    : d.audio
      ? [d.audio]
      : [];
  const audios: MessageAudio[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Partial<MessageAudio>;
    if (typeof a.mimeType !== 'string' || typeof a.data !== 'string') continue;
    audios.push({
      mimeType: a.mimeType,
      data: a.data,
      path: typeof a.path === 'string' ? a.path : undefined,
      filename: typeof a.filename === 'string' ? a.filename : undefined,
      transcript: typeof a.transcript === 'string' ? a.transcript : undefined,
      provider: typeof a.provider === 'string' ? a.provider : undefined,
    });
  }
  return audios.length > 0 ? audios : undefined;
}

function toStoredMessage(entry: SessionEntry): Message | null {
  if (entry.type === 'custom') {
    const customEntry = entry as SessionEntry & { customType?: unknown; data?: unknown };
    if (
      customEntry.customType === RUN_DIAGNOSTIC_CUSTOM_TYPE
      && isRunDiagnosticData(customEntry.data)
    ) {
      return {
        id: entry.id,
        role: 'assistant',
        content: formatRunDiagnostic(customEntry.data),
        timestamp: customEntry.data.createdAt ?? new Date(entry.timestamp).getTime(),
        kind: 'diagnostic',
      };
    }
    return null;
  }

  if (entry.type !== 'message') {
    return null;
  }

  const raw = entry.message as {
    role?: string;
    content?: unknown;
    timestamp?: number;
    usage?: MessageUsage;
    toolName?: string;
    isError?: boolean;
    details?: unknown;
  } | undefined;
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
    thinking: raw.role === 'assistant' ? extractThinkingContent(raw.content) : undefined,
    toolName: role === 'tool' ? raw.toolName : undefined,
    isToolError: role === 'tool' ? raw.isError : undefined,
    images: extractImageContent(raw.content),
    audios: role === 'tool' ? extractAudioDetails(raw.details) : undefined,
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

const NUMBERED_SESSION_LABEL = /^Session (\d+)$/;

function getNextSessionDisplayName(
  sessions: Record<string, ChatSession>,
  agentId: string,
): string {
  const highestNumber = Object.values(sessions)
    .filter((session) => session.agentId === agentId)
    .reduce((maxNumber, session) => {
      const match = NUMBERED_SESSION_LABEL.exec(session.displayName);
      if (!match) {
        return maxNumber;
      }

      const sessionNumber = Number.parseInt(match[1], 10);
      return Number.isNaN(sessionNumber) ? maxNumber : Math.max(maxNumber, sessionNumber);
    }, 0);

  return `Session ${highestNumber + 1}`;
}

interface SessionStore {
  sessions: Record<string, ChatSession>;
  activeSessionKey: Record<string, string>;
  transcriptStatus: Record<string, TranscriptStatus>;
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
  deleteMessage: (sessionKey: string, messageId: string) => Promise<void>;
  clearSessionMessages: (sessionKey: string) => Promise<void>;
  flushSession: (sessionKey: string) => Promise<void>;

  getSessionsForAgent: (agentId: string) => ChatSession[];

  pruneOrphanSessions: (validAgentIds: string[]) => Promise<void>;
  enforceSessionLimit: (agentId: string, maxSessions?: number) => Promise<void>;
  resetAllSessions: () => void;

  activeBranch: Record<string, string[]>;
  fetchBranchTree: (sessionKey: string) => Promise<BranchTree | null>;
  selectBranch: (sessionKey: string, branchPath: string[]) => void;
  fetchLineage: (sessionKey: string) => Promise<SessionLineage | null>;
}

export const useSessionStore = create<SessionStore>()((set, get) => ({
  sessions: {},
  activeSessionKey: {},
  transcriptStatus: {},
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
        transcriptStatus: Object.fromEntries(
          Object.keys(nextSessions).map((sessionKey) => [
            sessionKey,
            state.transcriptStatus[sessionKey] ?? 'idle',
          ]),
        ),
      };
    });

    const activeSessionKey = get().activeSessionKey[storageEngine.agentId];
    if (activeSessionKey && get().sessions[activeSessionKey]) {
      await get().flushSession(activeSessionKey).catch(console.error);
    }
  },

  createSession: async (agentId, provider, modelId, isDefault = false) => {
    const storageEngine = get().storageEngines[agentId] ?? get().storageEngine;
    if (!storageEngine) {
      throw new Error('Cannot create session without a bound storage backend');
    }

    const subKey = isDefault ? 'main' : `session-${Date.now()}`;
    const displayName = isDefault
      ? 'Main session'
      : getNextSessionDisplayName(get().sessions, agentId);
    const routed = await storageEngine.routeSession({
      subKey,
      chatType: 'direct',
      provider,
      displayName,
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
      transcriptStatus: {
        ...state.transcriptStatus,
        [meta.sessionKey]: 'ready',
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
      const { [sessionKey]: _deletedStatus, ...restStatus } = state.transcriptStatus;
      const nextActive = { ...state.activeSessionKey };
      for (const [nodeId, activeKey] of Object.entries(nextActive)) {
        if (activeKey === sessionKey) delete nextActive[nodeId];
      }
      return { sessions: rest, activeSessionKey: nextActive, transcriptStatus: restStatus };
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
      const nextTranscriptStatus: Record<string, TranscriptStatus> = {};
      const nextActive = { ...state.activeSessionKey };

      for (const [sessionKey, session] of Object.entries(state.sessions)) {
        if (session.agentId !== agentId) {
          nextSessions[sessionKey] = session;
          nextTranscriptStatus[sessionKey] = state.transcriptStatus[sessionKey] ?? 'idle';
        }
      }
      for (const [nodeId, activeKey] of Object.entries(nextActive)) {
        if (!(activeKey in nextSessions)) delete nextActive[nodeId];
      }
      return {
        sessions: nextSessions,
        activeSessionKey: nextActive,
        transcriptStatus: nextTranscriptStatus,
      };
    });
  },

  setActiveSession: (nodeId, sessionKey) => {
    set((state) => ({
      activeSessionKey: { ...state.activeSessionKey, [nodeId]: sessionKey },
    }));

    const session = get().sessions[sessionKey];
    if (session && session.messages.length === 0) {
      void get().flushSession(sessionKey).catch(console.error);
    }
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

      const idx = session.messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return state;

      const updated = updater(session.messages[idx]);
      const nextMessages = session.messages.slice();
      nextMessages[idx] = updated;

      return {
        sessions: {
          ...state.sessions,
          [sessionKey]: {
            ...session,
            messages: nextMessages,
            // Intentionally not updating lastMessageAt here — this fires on every
            // streaming delta and would cause all session-subscribed components to
            // re-render. lastMessageAt is updated by addMessage when a message lands.
          },
        },
      };
    });
  },

  deleteMessage: async (sessionKey, messageId) => {
    const session = get().sessions[sessionKey];
    if (!session) return;

    // Remove from in-memory store immediately
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

    // Persist deletion to disk
    const storageEngine = get().storageEngines[session.agentId] ?? get().storageEngine;
    if (storageEngine) {
      try {
        await storageEngine.deleteMessage(sessionKey, messageId);
      } catch {
        // In-memory state already updated; log but don't revert
      }
    }
  },

  clearSessionMessages: async (sessionKey) => {
    const session = get().sessions[sessionKey];
    const storageEngine = session
      ? get().storageEngines[session.agentId] ?? get().storageEngine
      : get().storageEngine;
    if (storageEngine) {
      try {
        await storageEngine.clearSessionMessages(sessionKey);
        const meta = await storageEngine.getSession(sessionKey);
        if (meta) {
          set((state) => ({
            sessions: {
              ...state.sessions,
              [sessionKey]: toChatSession(meta),
            },
            transcriptStatus: {
              ...state.transcriptStatus,
              [sessionKey]: 'ready',
            },
          }));
          return;
        }
      } catch {
        // Fall through to in-memory-only clear
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
        transcriptStatus: {
          ...state.transcriptStatus,
          [sessionKey]: 'ready',
        },
      };
    });
  },

  flushSession: async (sessionKey) => {
    const session = get().sessions[sessionKey];
    if (!session) return;
    const storageEngine = get().storageEngines[session.agentId] ?? get().storageEngine;
    if (!storageEngine) return;

    set((state) => ({
      transcriptStatus: {
        ...state.transcriptStatus,
        [sessionKey]: 'loading',
      },
    }));

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
      transcriptStatus: {
        ...state.transcriptStatus,
        [sessionKey]: 'ready',
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
      const nextTranscriptStatus: Record<string, TranscriptStatus> = {};
      const nextActive = { ...state.activeSessionKey };

      for (const [sessionKey, session] of Object.entries(state.sessions)) {
        if (validIds.has(session.agentId)) {
          nextSessions[sessionKey] = session;
          nextTranscriptStatus[sessionKey] = state.transcriptStatus[sessionKey] ?? 'idle';
        }
      }
      for (const [nodeId, activeKey] of Object.entries(nextActive)) {
        if (!(activeKey in nextSessions)) delete nextActive[nodeId];
      }
      return {
        sessions: nextSessions,
        activeSessionKey: nextActive,
        transcriptStatus: nextTranscriptStatus,
      };
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
      const nextTranscriptStatus = { ...state.transcriptStatus };
      const nextActive = { ...state.activeSessionKey };

      for (const session of overflow) {
        delete nextSessions[session.sessionKey];
        delete nextTranscriptStatus[session.sessionKey];
      }
      for (const [nodeId, activeKey] of Object.entries(nextActive)) {
        if (!(activeKey in nextSessions)) delete nextActive[nodeId];
      }

      return {
        sessions: nextSessions,
        activeSessionKey: nextActive,
        transcriptStatus: nextTranscriptStatus,
      };
    });
  },

  resetAllSessions: () => {
    const storages = Object.values(get().storageEngines);
    for (const storage of storages) {
      void storage.deleteAllSessions().catch(console.error);
    }
    set({ sessions: {}, activeSessionKey: {}, transcriptStatus: {} });
  },

  activeBranch: {},

  fetchBranchTree: async (sessionKey) => {
    const session = get().sessions[sessionKey];
    if (!session) return null;
    const storageEngine = get().storageEngines[session.agentId] ?? get().storageEngine;
    if (!storageEngine) return null;
    return storageEngine.fetchBranchTree(sessionKey);
  },

  selectBranch: (sessionKey, branchPath) => {
    set((state) => ({
      activeBranch: { ...state.activeBranch, [sessionKey]: branchPath },
    }));
  },

  fetchLineage: async (sessionKey) => {
    const session = get().sessions[sessionKey];
    if (!session) return null;
    const storageEngine = get().storageEngines[session.agentId] ?? get().storageEngine;
    if (!storageEngine) return null;
    return storageEngine.fetchLineage(sessionKey);
  },
}));
