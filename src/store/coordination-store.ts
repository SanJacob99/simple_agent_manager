import { create } from 'zustand';
import type { AgentConfig } from '../../shared/agent-config';
import type {
  CoordinationAgentRecord,
  CoordinationEvent,
  WorkflowReport,
  WorkflowSummary,
} from '../../shared/coordination-types';
import { coordinationClient } from '../client/coordination-client';

interface CoordinationStore {
  agents: CoordinationAgentRecord[];
  workflows: WorkflowSummary[];
  traces: Record<string, CoordinationEvent[]>;
  loading: boolean;
  error: string | null;
  syncAgents: (configs: AgentConfig[]) => Promise<void>;
  loadDashboard: () => Promise<void>;
  pauseWorkflow: (callerAgentId: string, workflowId: string) => Promise<void>;
  resumeWorkflow: (callerAgentId: string, workflowId: string) => Promise<void>;
  stopWorkflow: (callerAgentId: string, workflowId: string) => Promise<WorkflowReport | null>;
  requestReport: (callerAgentId: string, workflowId: string) => Promise<WorkflowReport | null>;
  loadTrace: (workflowId: string) => Promise<void>;
  clearError: () => void;
}

function setError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useCoordinationStore = create<CoordinationStore>((set, get) => ({
  agents: [],
  workflows: [],
  traces: {},
  loading: false,
  error: null,

  syncAgents: async (configs) => {
    try {
      const response = await coordinationClient.syncAgents(
        configs.map((config) => ({ config })),
      );
      set({ agents: response.agents, error: null });
    } catch (err) {
      set({ error: setError(err) });
    }
  },

  loadDashboard: async () => {
    set({ loading: true });
    try {
      const [agents, workflows] = await Promise.all([
        coordinationClient.listAgents(),
        coordinationClient.listWorkflows(),
      ]);
      set({
        agents: agents.agents,
        workflows: workflows.workflows,
        loading: false,
        error: null,
      });
    } catch (err) {
      set({ loading: false, error: setError(err) });
    }
  },

  pauseWorkflow: async (callerAgentId, workflowId) => {
    try {
      await coordinationClient.pauseWorkflow(callerAgentId, workflowId, 'Paused from manager console');
      await get().loadDashboard();
    } catch (err) {
      set({ error: setError(err) });
    }
  },

  resumeWorkflow: async (callerAgentId, workflowId) => {
    try {
      await coordinationClient.resumeWorkflow(callerAgentId, workflowId);
      await get().loadDashboard();
    } catch (err) {
      set({ error: setError(err) });
    }
  },

  stopWorkflow: async (callerAgentId, workflowId) => {
    try {
      const report = await coordinationClient.stopWorkflow(
        callerAgentId,
        workflowId,
        'Stopped from manager console',
      );
      await get().loadDashboard();
      return report;
    } catch (err) {
      set({ error: setError(err) });
      return null;
    }
  },

  requestReport: async (callerAgentId, workflowId) => {
    try {
      const report = await coordinationClient.requestReport(callerAgentId, workflowId);
      await get().loadDashboard();
      return report;
    } catch (err) {
      set({ error: setError(err) });
      return null;
    }
  },

  loadTrace: async (workflowId) => {
    try {
      const response = await coordinationClient.getTrace(workflowId);
      set((state) => ({
        traces: { ...state.traces, [workflowId]: response.events },
        error: null,
      }));
    } catch (err) {
      set({ error: setError(err) });
    }
  },

  clearError: () => set({ error: null }),
}));

