import { AgentRuntime } from '../runtime/agent-runtime';
import { RunCoordinator } from './run-coordinator';
import { StreamProcessor } from './stream-processor';
import { EventBridge } from './event-bridge';
import { StorageEngine } from '../runtime/storage-engine';
import { HookRegistry } from '../hooks/hook-registry';
import { PluginLoader } from '../hooks/plugin-loader';
import { registerInternalHooks } from '../hooks/internal-hooks';
import { HOOK_NAMES, type BackendLifecycleContext } from '../hooks/hook-types';
import { ProviderPluginRegistry } from '../providers/plugin-registry';
import type { ApiKeyStore } from '../auth/api-keys';
import type { AgentConfig } from '../../shared/agent-config';
import type {
  DispatchParams,
  DispatchResult,
  WaitResult,
  RunEventListener,
} from '../../shared/run-types';
import type WebSocket from 'ws';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export interface ManagedAgent {
  runtime: AgentRuntime;
  coordinator: RunCoordinator;
  processor: StreamProcessor;
  config: AgentConfig;
  bridge: EventBridge;
  storage: StorageEngine | null;
  hooks: HookRegistry;
  lastActivity: number;
  unsubscribe: () => void;
}

/**
 * Global hook registry for backend lifecycle events.
 * Not per-agent — fires on server start/stop.
 */
let globalHookRegistry: HookRegistry | null = null;

export function getGlobalHookRegistry(): HookRegistry {
  if (!globalHookRegistry) {
    globalHookRegistry = new HookRegistry();
  }
  return globalHookRegistry;
}

export class AgentManager {
  private agents = new Map<string, ManagedAgent>();

  constructor(
    private readonly apiKeys: ApiKeyStore,
    private readonly pluginRegistry: ProviderPluginRegistry,
  ) {}

  async start(config: AgentConfig): Promise<void> {
    // Destroy existing if present
    if (this.agents.has(config.id)) {
      this.destroy(config.id);
    }

    // Create StorageEngine if storage config exists
    let storage: StorageEngine | null = null;
    if (config.storage) {
      storage = new StorageEngine(config.storage, config.name);
      await storage.init();
    }

    // Create HookRegistry for this agent
    const hooks = new HookRegistry();

    // Register internal (built-in) hooks
    registerInternalHooks(hooks, config);

    // Load plugin hooks from config
    if (config.tools?.plugins) {
      const basePath = config.storage
        ? this.resolveStoragePath(config.storage.storagePath)
        : process.cwd();

      await PluginLoader.loadPlugins(config.tools.plugins, hooks, basePath);
    }

    // Create runtime with hook registry
    const runtime = new AgentRuntime(
      config,
      (provider) => Promise.resolve(this.apiKeys.get(provider)),
      undefined,
      hooks,
      this.pluginRegistry,
    );

    // Create coordinator with hook registry
    const coordinator = new RunCoordinator(config.id, runtime, config, storage, hooks);

    const processor = new StreamProcessor(config.id, coordinator, config);

    const bridge = new EventBridge(config.id, processor);

    // Subscribe to coordinator lifecycle events for lastActivity tracking
    const unsubscribe = coordinator.subscribeAll(() => {
      const managed = this.agents.get(config.id);
      if (managed) managed.lastActivity = Date.now();
    });

    this.agents.set(config.id, {
      runtime,
      coordinator,
      processor,
      config,
      bridge,
      storage,
      hooks,
      lastActivity: Date.now(),
      unsubscribe,
    });

    // Persist config for restart resilience
    this.persistConfig(config).catch(console.error);
  }

  async dispatch(agentId: string, params: DispatchParams): Promise<DispatchResult> {
    const managed = this.agents.get(agentId);
    if (!managed) throw new Error(`Agent ${agentId} not found`);
    managed.lastActivity = Date.now();
    return managed.coordinator.dispatch(params);
  }

  async wait(agentId: string, runId: string, timeoutMs?: number): Promise<WaitResult> {
    const managed = this.agents.get(agentId);
    if (!managed) throw new Error(`Agent ${agentId} not found`);
    return managed.coordinator.wait(runId, timeoutMs);
  }

  subscribe(agentId: string, runId: string, listener: RunEventListener): () => void {
    const managed = this.agents.get(agentId);
    if (!managed) throw new Error(`Agent ${agentId} not found`);
    return managed.coordinator.subscribe(runId, listener);
  }

  abortRun(agentId: string, runId: string): void {
    const managed = this.agents.get(agentId);
    if (!managed) return;
    managed.coordinator.abort(runId);
  }

  /** Abort the most recent active run, or a specific run by ID. */
  abort(agentId: string, runId?: string): void {
    const managed = this.agents.get(agentId);
    if (!managed) return;
    const targetRunId = runId ?? managed.coordinator.getLatestActiveRunId();
    if (targetRunId) {
      managed.coordinator.abort(targetRunId);
    }
  }

  destroy(agentId: string): void {
    const managed = this.agents.get(agentId);
    if (!managed) return;
    managed.unsubscribe();
    managed.bridge.destroy();
    managed.processor.destroy();
    managed.coordinator.destroy();
    managed.runtime.destroy();
    managed.hooks.destroy();
    this.agents.delete(agentId);
  }

  has(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  /** Returns the agent's overall status based on active runs. */
  getStatus(agentId: string): 'idle' | 'running' | 'error' | 'not_found' {
    const managed = this.agents.get(agentId);
    if (!managed) return 'not_found';
    const activeRun = managed.coordinator.getLatestActiveRunId();
    return activeRun ? 'running' : 'idle';
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

  /** Resolve ~ prefix in storage paths. */
  private resolveStoragePath(storagePath: string): string {
    return storagePath.startsWith('~')
      ? storagePath.replace('~', os.homedir())
      : storagePath;
  }

  /** Persist agent config to disk for restart resilience. */
  private async persistConfig(config: AgentConfig): Promise<void> {
    if (!config.storage) return;
    const storagePath = this.resolveStoragePath(config.storage.storagePath);
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
          await this.start(config);
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
