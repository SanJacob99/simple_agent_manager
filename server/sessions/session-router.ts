import path from 'path';
import type { ResolvedStorageConfig } from '../../shared/agent-config';
import type { SessionStoreEntry } from '../../shared/storage-types';
import { StorageEngine } from '../storage/storage-engine';
import { SessionTranscriptStore } from './session-transcript-store';

export interface RouteRequest {
  agentId: string;
  subKey?: string;
  chatType?: SessionStoreEntry['chatType'];
  provider?: string;
  subject?: string;
  room?: string;
  space?: string;
  displayName?: string;
  cronJobId?: string;
  webhookId?: string;
}

export interface RouteResult {
  sessionKey: string;
  sessionId: string;
  transcriptPath: string;
  created: boolean;
  reset: boolean;
}

export class SessionRouter {
  constructor(
    private readonly storageEngine: StorageEngine,
    private readonly transcriptStore: SessionTranscriptStore,
    private readonly storageConfig: ResolvedStorageConfig,
    private readonly agentId: string,
  ) {}

  async route(req: RouteRequest): Promise<RouteResult> {
    const sessionKey = this.buildSessionKey(req.agentId, req.subKey, req.cronJobId, req.webhookId);
    const existing = await this.storageEngine.getSession(sessionKey);

    if (!existing) {
      const created = await this.createEntry(sessionKey, req);
      await this.storageEngine.enforceRetention(this.storageConfig.sessionRetention);
      return this.toRouteResult(created, true, false);
    }

    if (this.shouldReset(existing)) {
      return this.resetSession(sessionKey);
    }

    return this.toRouteResult(existing, false, false);
  }

  async resetSession(sessionKey: string, newModel?: string): Promise<RouteResult> {
    const existing = await this.storageEngine.getSession(sessionKey);
    if (!existing) {
      const created = await this.createEntry(sessionKey, {
        agentId: this.agentId,
      });
      return this.toRouteResult(created, true, true);
    }

    const parentSession = this.shouldForkFromParent(existing)
      ? this.storageEngine.resolveTranscriptPath(existing)
      : undefined;

    const created = await this.transcriptStore.createSession(parentSession);
    const timestamp = new Date().toISOString();
    const replacement: Partial<SessionStoreEntry> = {
      sessionId: created.sessionId,
      sessionFile: this.toStoredSessionFile(created.sessionFile),
      createdAt: timestamp,
      updatedAt: timestamp,
      parentSessionId: existing.sessionId,
      providerOverride: newModel ? existing.providerOverride : existing.providerOverride,
      modelOverride: newModel ?? existing.modelOverride,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      contextTokens: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalEstimatedCostUsd: 0,
      compactionCount: 0,
      memoryFlushAt: undefined,
      memoryFlushCompactionCount: undefined,
    };

    await this.storageEngine.updateSession(sessionKey, replacement);

    const updated = await this.storageEngine.getSession(sessionKey);
    if (!updated) {
      throw new Error(`Failed to update session metadata for ${sessionKey}`);
    }

    return this.toRouteResult(updated, false, true);
  }

  async getStatus(sessionKey: string): Promise<SessionStoreEntry | null> {
    const session = await this.storageEngine.getSession(sessionKey);
    if (!session || session.agentId !== this.agentId) {
      return null;
    }
    return session;
  }

  async listSessions(): Promise<SessionStoreEntry[]> {
    const sessions = await this.storageEngine.listSessions();
    return sessions.filter((session) => session.agentId === this.agentId);
  }

  async updateAfterTurn(
    sessionKey: string,
    updates: Partial<SessionStoreEntry>,
  ): Promise<void> {
    const existing = await this.storageEngine.getSession(sessionKey);
    if (!existing || existing.agentId !== this.agentId) {
      return;
    }

    await this.storageEngine.updateSession(sessionKey, {
      ...updates,
      updatedAt: new Date().toISOString(),
    });
  }

  private async createEntry(
    sessionKey: string,
    req: RouteRequest,
  ): Promise<SessionStoreEntry> {
    const created = await this.transcriptStore.createSession();
    const timestamp = new Date().toISOString();

    const entry: SessionStoreEntry = {
      sessionKey,
      sessionId: created.sessionId,
      agentId: req.agentId,
      sessionFile: this.toStoredSessionFile(created.sessionFile),
      createdAt: timestamp,
      updatedAt: timestamp,
      chatType: req.chatType ?? 'direct',
      provider: req.provider,
      subject: req.subject,
      room: req.room,
      space: req.space,
      displayName: req.displayName,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      contextTokens: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalEstimatedCostUsd: 0,
      compactionCount: 0,
    };

    await this.storageEngine.createSession(entry);
    return entry;
  }

  private buildSessionKey(agentId: string, subKey?: string, cronJobId?: string, webhookId?: string): string {
    if (cronJobId) return `cron:${cronJobId}`;
    if (webhookId) return `hook:${webhookId}`;
    return `agent:${agentId}:${subKey ?? 'main'}`;
  }

  private toRouteResult(
    session: SessionStoreEntry,
    created: boolean,
    reset: boolean,
  ): RouteResult {
    return {
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
      transcriptPath: this.storageEngine.resolveTranscriptPath(session),
      created,
      reset,
    };
  }

  private shouldReset(session: SessionStoreEntry): boolean {
    if (this.storageConfig.dailyResetEnabled && this.crossedDailyBoundary(session.updatedAt)) {
      return true;
    }

    if (this.storageConfig.idleResetEnabled && this.exceededIdleWindow(session.updatedAt)) {
      return true;
    }

    return false;
  }

  private crossedDailyBoundary(updatedAt: string): boolean {
    const lastUpdated = new Date(updatedAt);
    if (Number.isNaN(lastUpdated.getTime())) {
      return false;
    }

    const boundary = new Date();
    boundary.setHours(this.storageConfig.dailyResetHour, 0, 0, 0);
    if (Date.now() < boundary.getTime()) {
      boundary.setDate(boundary.getDate() - 1);
    }

    return lastUpdated.getTime() < boundary.getTime();
  }

  private exceededIdleWindow(updatedAt: string): boolean {
    const lastUpdated = new Date(updatedAt);
    if (Number.isNaN(lastUpdated.getTime())) {
      return false;
    }

    const idleMs = this.storageConfig.idleResetMinutes * 60 * 1000;
    return Date.now() - lastUpdated.getTime() > idleMs;
  }

  private shouldForkFromParent(session: SessionStoreEntry): boolean {
    return this.storageConfig.parentForkMaxTokens > 0
      && session.totalTokens <= this.storageConfig.parentForkMaxTokens;
  }

  private toStoredSessionFile(sessionFile: string): string {
    return path.relative(this.storageEngine.getAgentDir(), sessionFile).replace(/\\/g, '/');
  }
}
