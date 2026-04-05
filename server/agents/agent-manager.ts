import { AgentRuntime, type RuntimeEvent } from '../runtime/agent-runtime';
import { EventBridge } from './event-bridge';
import type { ApiKeyStore } from '../auth/api-keys';
import type { AgentConfig } from '../../shared/agent-config';
import type { ImageAttachment } from '../../shared/protocol';
import type WebSocket from 'ws';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export interface ManagedAgent {
  runtime: AgentRuntime;
  config: AgentConfig;
  status: 'idle' | 'running' | 'error';
  bridge: EventBridge;
  activeSessionId: string | null;
  lastActivity: number;
  unsubscribe: () => void;
}

export class AgentManager {
  private agents = new Map<string, ManagedAgent>();

  constructor(private readonly apiKeys: ApiKeyStore) {}

  start(config: AgentConfig): void {
    // Destroy existing if present
    if (this.agents.has(config.id)) {
      this.destroy(config.id);
    }

    const bridge = new EventBridge(config.id);

    const runtime = new AgentRuntime(
      config,
      (provider) => Promise.resolve(this.apiKeys.get(provider)),
    );

    const unsubscribe = runtime.subscribe((event: RuntimeEvent) => {
      bridge.handleRuntimeEvent(event);

      if (event.type === 'agent_end') {
        const managed = this.agents.get(config.id);
        if (managed) managed.status = 'idle';
      }
    });

    this.agents.set(config.id, {
      runtime,
      config,
      status: 'idle',
      bridge,
      activeSessionId: null,
      lastActivity: Date.now(),
      unsubscribe,
    });

    // Persist config for restart resilience
    this.persistConfig(config).catch(console.error);
  }

  async prompt(agentId: string, sessionId: string, text: string, attachments?: ImageAttachment[]): Promise<void> {
    const managed = this.agents.get(agentId);
    if (!managed) throw new Error(`Agent ${agentId} not found`);

    managed.status = 'running';
    managed.activeSessionId = sessionId;
    managed.lastActivity = Date.now();

    try {
      await managed.runtime.prompt(text, attachments);
    } catch (error) {
      managed.status = 'error';
      throw error;
    }
  }

  abort(agentId: string): void {
    const managed = this.agents.get(agentId);
    if (!managed) return;
    managed.runtime.abort();
    managed.status = 'idle';
  }

  destroy(agentId: string): void {
    const managed = this.agents.get(agentId);
    if (!managed) return;
    managed.unsubscribe();
    managed.runtime.destroy();
    this.agents.delete(agentId);
  }

  has(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  getStatus(agentId: string): 'idle' | 'running' | 'error' | 'not_found' {
    const managed = this.agents.get(agentId);
    return managed?.status ?? 'not_found';
  }

  getBridge(agentId: string): EventBridge | undefined {
    return this.agents.get(agentId)?.bridge;
  }

  addSocket(agentId: string, socket: WebSocket): void {
    this.agents.get(agentId)?.bridge.addSocket(socket);
  }

  removeSocketFromAll(socket: WebSocket): void {
    for (const managed of this.agents.values()) {
      managed.bridge.removeSocket(socket);
    }
  }

  /** Persist agent config to disk for restart resilience. */
  private async persistConfig(config: AgentConfig): Promise<void> {
    if (!config.storage) return;
    const storagePath = config.storage.storagePath.startsWith('~')
      ? config.storage.storagePath.replace('~', os.homedir())
      : config.storage.storagePath;
    const agentDir = path.join(storagePath, config.name);
    await fs.mkdir(agentDir, { recursive: true });
    await fs.writeFile(
      path.join(agentDir, 'agent-config.json'),
      JSON.stringify(config, null, 2),
      'utf-8',
    );
  }

  /** Restore agents from persisted configs on server boot. */
  async restoreFromDisk(storagePath: string): Promise<number> {
    const resolvedPath = storagePath.startsWith('~')
      ? storagePath.replace('~', os.homedir())
      : storagePath;

    let restored = 0;
    try {
      const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const configPath = path.join(resolvedPath, entry.name, 'agent-config.json');
        try {
          const raw = await fs.readFile(configPath, 'utf-8');
          const config = JSON.parse(raw) as AgentConfig;
          this.start(config);
          restored++;
        } catch {
          // No config file in this directory — skip
        }
      }
    } catch {
      // Storage path doesn't exist yet — nothing to restore
    }
    return restored;
  }

  /** Graceful shutdown: destroy all agents. */
  async shutdown(): Promise<void> {
    for (const [agentId] of this.agents) {
      this.destroy(agentId);
    }
  }
}
