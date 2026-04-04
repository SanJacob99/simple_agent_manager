import type { ResolvedStorageConfig } from './agent-config';
import type { SessionMeta, SessionEntry, MemoryFileInfo } from './storage-engine';

/**
 * Browser-side client that mirrors StorageEngine's interface
 * but delegates to the local Express server via fetch.
 */
export class StorageClient {
  constructor(
    private readonly config: ResolvedStorageConfig,
    private readonly agentName: string,
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

  async listSessions(): Promise<SessionMeta[]> {
    const res = await fetch(`/api/storage/sessions?${this.queryStr()}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async createSession(meta: SessionMeta): Promise<void> {
    const res = await fetch('/api/storage/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: this.config, agentName: this.agentName, meta }),
    });
    if (!res.ok) throw new Error(await res.text());
  }

  async deleteSession(sessionId: string): Promise<void> {
    const res = await fetch(
      `/api/storage/sessions/${encodeURIComponent(sessionId)}?${this.queryStr()}`,
      { method: 'DELETE' },
    );
    if (!res.ok) throw new Error(await res.text());
  }

  async getSessionMeta(sessionId: string): Promise<SessionMeta | null> {
    const res = await fetch(
      `/api/storage/sessions/${encodeURIComponent(sessionId)}?${this.queryStr()}`,
    );
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async updateSessionMeta(sessionId: string, partial: Partial<SessionMeta>): Promise<void> {
    const res = await fetch(`/api/storage/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: this.config, agentName: this.agentName, partial }),
    });
    if (!res.ok) throw new Error(await res.text());
  }

  async appendEntry(sessionId: string, entry: SessionEntry): Promise<void> {
    const res = await fetch(`/api/storage/sessions/${encodeURIComponent(sessionId)}/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: this.config, agentName: this.agentName, entry }),
    });
    if (!res.ok) throw new Error(await res.text());
  }

  async readEntries(sessionId: string): Promise<SessionEntry[]> {
    const res = await fetch(
      `/api/storage/sessions/${encodeURIComponent(sessionId)}/entries?${this.queryStr()}`,
    );
    if (!res.ok) throw new Error(await res.text());
    return res.json();
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
}
