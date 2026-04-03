import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
  tokenCount?: number;       // estimated for user msgs, real (output) for assistant
  usage?: MessageUsage;      // full usage breakdown from API response (assistant only)
}

interface ChatStore {
  chats: Record<string, Message[]>;
  addMessage: (agentId: string, message: Message) => void;
  updateMessage: (agentId: string, messageId: string, updater: (msg: Message) => Message) => void;
  clearChat: (agentId: string) => void;
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set) => ({
      chats: {},
      
      addMessage: (agentId, message) => {
        set((state) => {
          const currentChats = state.chats[agentId] || [];
          return {
            chats: {
              ...state.chats,
              [agentId]: [...currentChats, message]
            }
          };
        });
      },

      updateMessage: (agentId, messageId, updater) => {
        set((state) => {
          const currentChats = state.chats[agentId] || [];
          return {
            chats: {
              ...state.chats,
              [agentId]: currentChats.map(m => m.id === messageId ? updater(m) : m)
            }
          };
        });
      },

      clearChat: (agentId) => {
        set((state) => {
          const newChats = { ...state.chats };
          delete newChats[agentId];
          return { chats: newChats };
        });
      }
    }),
    {
      name: 'agent-manager-chats'
    }
  )
);
