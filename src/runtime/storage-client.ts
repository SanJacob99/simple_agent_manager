import type { ResolvedStorageConfig } from '../../shared/agent-config';
import type { SessionStoreEntry, MemoryFileInfo, MaintenanceReport, BranchTree, SessionLineage } from '../../shared/storage-types';
import type {
  SessionCompactResponse,
  SessionRouteRequest,
  SessionRouteResponse,
  SessionTranscriptResponse,
} from '../../shared/session-routes';

/**
 * Browser-side client that mirrors the server session/storage APIs.
 */
export class StorageClient {
  constructor(
    private readonly config: ResolvedStorageConfig,
    public readonly agentName: string,
    public readonly agentId: string,
  ) {}

  private configParam(): string {
    return encodeURIComponent(JSON.stringify(this.config));
  }

  private queryStr(): string {
    return `config=${this.configParam()}&agentName=${encodeURIComponent(this.agentName)}`;
  }

  async init(): Promise<void> {
    const res = await fetch('/api/storage/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: this.config, agentName: this.agentName }),
    });
    if (!res.ok) throw new Error(await res.text());
  }

  async listSessions(): Promise<SessionStoreEntry[]> {
    const res = await fetch(`/api/sessions/${encodeURIComponent(this.agentId)}?${this.queryStr()}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async routeSession(request?: SessionRouteRequest): Promise<SessionRouteResponse> {
    const res = await fetch(`/api/sessions/${encodeURIComponent(this.agentId)}/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: this.config, agentName: this.agentName, request }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async resetSession(sessionKey: string): Promise<SessionRouteResponse> {
    const res = await fetch(
      `/api/sessions/${encodeURIComponent(this.agentId)}/${encodeURIComponent(sessionKey)}/reset`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: this.config, agentName: this.agentName }),
      },
    );
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async deleteMessage(sessionKey: string, messageId: string): Promise<{ deleted: boolean }> {
    const res = await fetch(
      `/api/sessions/${encodeURIComponent(this.agentId)}/${encodeURIComponent(sessionKey)}/messages/${encodeURIComponent(messageId)}`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: this.config, agentName: this.agentName }),
      },
    );
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async clearSessionMessages(sessionKey: string): Promise<SessionRouteResponse> {
    const res = await fetch(
      `/api/sessions/${encodeURIComponent(this.agentId)}/${encodeURIComponent(sessionKey)}/clear`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: this.config, agentName: this.agentName }),
      },
    );
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async compactSession(sessionKey: string): Promise<SessionCompactResponse> {
    const res = await fetch(
      `/api/sessions/${encodeURIComponent(this.agentId)}/${encodeURIComponent(sessionKey)}/compact`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: this.config, agentName: this.agentName }),
      },
    );
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async getSession(sessionKey: string): Promise<SessionStoreEntry | null> {
    const res = await fetch(
      `/api/sessions/${encodeURIComponent(this.agentId)}/${encodeURIComponent(sessionKey)}?${this.queryStr()}`,
    );
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async getTranscript(sessionKey: string): Promise<SessionTranscriptResponse> {
    const res = await fetch(
      `/api/sessions/${encodeURIComponent(this.agentId)}/${encodeURIComponent(sessionKey)}/transcript?${this.queryStr()}`,
    );
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async deleteSession(sessionKey: string): Promise<void> {
    const res = await fetch(
      `/api/sessions/${encodeURIComponent(this.agentId)}/${encodeURIComponent(sessionKey)}?${this.queryStr()}`,
      { method: 'DELETE' },
    );
    if (!res.ok) throw new Error(await res.text());
  }

  async deleteAllSessions(): Promise<void> {
    const res = await fetch(
      `/api/sessions/${encodeURIComponent(this.agentId)}?${this.queryStr()}`,
      { method: 'DELETE' },
    );
    if (!res.ok) throw new Error(await res.text());
  }

  async deleteAgentData(): Promise<void> {
    const res = await fetch('/api/storage/agent-data', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: this.config, agentName: this.agentName }),
    });
    if (!res.ok) throw new Error(await res.text());
  }

  async enforceRetention(maxSessions: number): Promise<void> {
    const res = await fetch('/api/storage/sessions/enforce-retention', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: this.config, agentName: this.agentName, maxSessions }),
    });
    if (!res.ok) throw new Error(await res.text());
  }

  async appendDailyMemory(content: string, date?: string): Promise<void> {
    const res = await fetch('/api/storage/memory/daily', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: this.config, agentName: this.agentName, content, date }),
    });
    if (!res.ok) throw new Error(await res.text());
  }

  async readDailyMemory(date: string): Promise<string | null> {
    const res = await fetch(`/api/storage/memory/daily/${date}?${this.queryStr()}`);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    return data.content;
  }

  async readLongTermMemory(): Promise<string | null> {
    const res = await fetch(`/api/storage/memory/long-term?${this.queryStr()}`);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    return data.content;
  }

  async writeLongTermMemory(content: string): Promise<void> {
    const res = await fetch('/api/storage/memory/long-term', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: this.config, agentName: this.agentName, content }),
    });
    if (!res.ok) throw new Error(await res.text());
  }

  async listMemoryFiles(): Promise<MemoryFileInfo[]> {
    const res = await fetch(`/api/storage/memory/files?${this.queryStr()}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async runMaintenance(): Promise<MaintenanceReport> {
    const res = await fetch('/api/storage/maintenance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: this.config, agentName: this.agentName }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async runMaintenanceDryRun(): Promise<MaintenanceReport> {
    const res = await fetch('/api/storage/maintenance/dry-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: this.config, agentName: this.agentName }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async fetchBranchTree(sessionKey: string): Promise<BranchTree> {
    const res = await fetch(
      `/api/sessions/${encodeURIComponent(this.agentId)}/${encodeURIComponent(sessionKey)}/branches?${this.queryStr()}`,
    );
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async fetchLineage(sessionKey: string): Promise<SessionLineage> {
    const res = await fetch(
      `/api/sessions/${encodeURIComponent(this.agentId)}/${encodeURIComponent(sessionKey)}/lineage?${this.queryStr()}`,
    );
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }
}
