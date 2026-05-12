import type {
  CoordinationAgentRecord,
  CoordinationAgentSyncItem,
  CoordinationEvent,
  WorkflowDetail,
  WorkflowReport,
  WorkflowSummary,
} from '../../shared/coordination-types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.error ?? message;
    } catch {
      // keep status text
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export const coordinationClient = {
  syncAgents(agents: CoordinationAgentSyncItem[]): Promise<{ agents: CoordinationAgentRecord[] }> {
    return request('/api/coordination/agents/sync', {
      method: 'POST',
      body: JSON.stringify({ agents }),
    });
  },

  listAgents(): Promise<{ agents: CoordinationAgentRecord[] }> {
    return request('/api/coordination/agents');
  },

  listWorkflows(): Promise<{ workflows: WorkflowSummary[] }> {
    return request('/api/coordination/workflows');
  },

  getWorkflow(workflowId: string): Promise<WorkflowDetail> {
    return request(`/api/coordination/workflows/${encodeURIComponent(workflowId)}`);
  },

  startWorkflow(callerAgentId: string, workflowId: string): Promise<WorkflowDetail['workflow']> {
    return request(`/api/coordination/workflows/${encodeURIComponent(workflowId)}/start`, {
      method: 'POST',
      body: JSON.stringify({ callerAgentId }),
    });
  },

  pauseWorkflow(callerAgentId: string, workflowId: string, reason: string): Promise<WorkflowDetail['workflow']> {
    return request(`/api/coordination/workflows/${encodeURIComponent(workflowId)}/pause`, {
      method: 'POST',
      body: JSON.stringify({ callerAgentId, reason }),
    });
  },

  resumeWorkflow(callerAgentId: string, workflowId: string): Promise<WorkflowDetail['workflow']> {
    return request(`/api/coordination/workflows/${encodeURIComponent(workflowId)}/resume`, {
      method: 'POST',
      body: JSON.stringify({ callerAgentId }),
    });
  },

  stopWorkflow(callerAgentId: string, workflowId: string, reason: string): Promise<WorkflowReport> {
    return request(`/api/coordination/workflows/${encodeURIComponent(workflowId)}/stop`, {
      method: 'POST',
      body: JSON.stringify({ callerAgentId, reason }),
    });
  },

  requestReport(callerAgentId: string, workflowId: string): Promise<WorkflowReport> {
    return request(`/api/coordination/workflows/${encodeURIComponent(workflowId)}/report`, {
      method: 'POST',
      body: JSON.stringify({ callerAgentId }),
    });
  },

  getTrace(workflowId: string, limit = 200): Promise<{ events: CoordinationEvent[] }> {
    return request(`/api/coordination/workflows/${encodeURIComponent(workflowId)}/trace?limit=${limit}`);
  },
};

