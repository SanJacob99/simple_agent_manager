import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { StorageEngine } from './runtime/storage-engine';
import { SessionTranscriptStore } from './runtime/session-transcript-store';
import { SessionRouter } from './runtime/session-router';
import { AgentManager } from './agents/agent-manager';
import { ApiKeyStore } from './auth/api-keys';
import { handleConnection } from './connections/ws-handler';
import { getGlobalHookRegistry } from './agents/agent-manager';
import { HOOK_NAMES, type BackendLifecycleContext } from './hooks/hook-types';
import { createStartupErrorHandler } from './startup';
import { ProviderPluginRegistry } from './providers/plugin-registry';
import { ProviderCatalogCache, type ProviderCatalogRequest } from './providers/catalog-cache';
import { loadProviderPlugins } from './providers/provider-loader';
import { resolveProviderRuntimeAuth } from './providers/provider-auth';
import { SettingsFileStore } from './runtime/settings-file-store';
import path from 'path';
import type { ResolvedStorageConfig } from '../shared/agent-config';
import type { SessionRouteRequest, SessionTranscriptResponse } from '../shared/session-routes';

const app = express();
app.use(express.json({ limit: '10mb' }));

// --- Shared state ---

const apiKeys = new ApiKeyStore();
const pluginRegistry = new ProviderPluginRegistry();
const catalogCache = new ProviderCatalogCache();
const agentManager = new AgentManager(apiKeys, pluginRegistry);
const settingsFile = new SettingsFileStore();

// --- Storage engine instances ---

const engines = new Map<string, StorageEngine>();
const transcriptStores = new Map<string, SessionTranscriptStore>();
const sessionRouters = new Map<string, SessionRouter>();

function engineKey(config: ResolvedStorageConfig, agentName: string): string {
  return `${config.storagePath}:${agentName}`;
}

function sessionRouterKey(config: ResolvedStorageConfig, agentName: string, agentId: string): string {
  return `${config.storagePath}:${agentName}:${agentId}`;
}

function getOrCreateEngine(config: ResolvedStorageConfig, agentName: string): StorageEngine {
  const key = engineKey(config, agentName);
  let engine = engines.get(key);
  if (!engine) {
    engine = new StorageEngine(config, agentName);
    engines.set(key, engine);
  }
  return engine;
}

function getOrCreateTranscriptStore(
  config: ResolvedStorageConfig,
  agentName: string,
): SessionTranscriptStore {
  const key = engineKey(config, agentName);
  let store = transcriptStores.get(key);
  if (!store) {
    store = new SessionTranscriptStore(
      getOrCreateEngine(config, agentName).getSessionsDir(),
      process.cwd(),
    );
    transcriptStores.set(key, store);
  }
  return store;
}

function getOrCreateSessionRouter(
  config: ResolvedStorageConfig,
  agentName: string,
  agentId: string,
): SessionRouter {
  const key = sessionRouterKey(config, agentName, agentId);
  let router = sessionRouters.get(key);
  if (!router) {
    router = new SessionRouter(
      getOrCreateEngine(config, agentName),
      getOrCreateTranscriptStore(config, agentName),
      config,
      agentId,
    );
    sessionRouters.set(key, router);
  }
  return router;
}

function forgetAgentStorage(config: ResolvedStorageConfig, agentName: string): void {
  const key = engineKey(config, agentName);
  engines.delete(key);
  transcriptStores.delete(key);

  for (const routerKey of sessionRouters.keys()) {
    if (routerKey.startsWith(`${key}:`)) {
      sessionRouters.delete(routerKey);
    }
  }
}

// --- Storage initialization ---

app.post('/api/storage/init', async (req, res) => {
  const { config, agentName } = req.body as { config: ResolvedStorageConfig; agentName: string };
  try {
    const engine = getOrCreateEngine(config, agentName);
    await engine.init();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.delete('/api/storage/agent-data', async (req, res) => {
  const { config, agentName } = req.body as {
    config: ResolvedStorageConfig;
    agentName: string;
  };
  try {
    const engine = getOrCreateEngine(config, agentName);
    await engine.deleteAgentData();
    forgetAgentStorage(config, agentName);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// --- Session REST routes ---

app.get('/api/sessions/:agentId', async (req, res) => {
  const { config, agentName } = req.query as { config: string; agentName: string };
  try {
    const parsedConfig = JSON.parse(config) as ResolvedStorageConfig;
    const router = getOrCreateSessionRouter(parsedConfig, agentName, req.params.agentId);
    res.json(await router.listSessions());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/sessions/:agentId/route', async (req, res) => {
  const { config, agentName, request } = req.body as {
    config: ResolvedStorageConfig;
    agentName: string;
    request?: SessionRouteRequest;
  };
  try {
    const router = getOrCreateSessionRouter(config, agentName, req.params.agentId);
    res.json(await router.route({
      agentId: req.params.agentId,
      ...(request ?? {}),
    }));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/sessions/:agentId/:sessionKey/reset', async (req, res) => {
  const { config, agentName } = req.body as {
    config: ResolvedStorageConfig;
    agentName: string;
  };
  try {
    const router = getOrCreateSessionRouter(config, agentName, req.params.agentId);
    res.json(await router.resetSession(req.params.sessionKey));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/sessions/:agentId/:sessionKey/transcript', async (req, res) => {
  const { config, agentName } = req.query as { config: string; agentName: string };
  try {
    const parsedConfig = JSON.parse(config) as ResolvedStorageConfig;
    const router = getOrCreateSessionRouter(parsedConfig, agentName, req.params.agentId);
    const status = await router.getStatus(req.params.sessionKey);

    if (!status) {
      res.status(404).json({ error: `Session ${req.params.sessionKey} not found` });
      return;
    }

    const engine = getOrCreateEngine(parsedConfig, agentName);
    const transcriptStore = getOrCreateTranscriptStore(parsedConfig, agentName);
    const transcriptPath = engine.resolveTranscriptPath(status);
    const payload: SessionTranscriptResponse = {
      sessionKey: status.sessionKey,
      sessionId: status.sessionId,
      transcriptPath,
      entries: transcriptStore.readTranscript(transcriptPath),
    };
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/sessions/:agentId/:sessionKey', async (req, res) => {
  const { config, agentName } = req.query as { config: string; agentName: string };
  try {
    const parsedConfig = JSON.parse(config) as ResolvedStorageConfig;
    const router = getOrCreateSessionRouter(parsedConfig, agentName, req.params.agentId);
    res.json(await router.getStatus(req.params.sessionKey));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.delete('/api/sessions/:agentId/:sessionKey', async (req, res) => {
  const { config, agentName } = req.query as { config: string; agentName: string };
  try {
    const parsedConfig = JSON.parse(config) as ResolvedStorageConfig;
    const engine = getOrCreateEngine(parsedConfig, agentName);
    await engine.deleteSession(req.params.sessionKey);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.delete('/api/sessions/:agentId', async (req, res) => {
  const { config, agentName } = req.query as { config: string; agentName: string };
  try {
    const parsedConfig = JSON.parse(config) as ResolvedStorageConfig;
    const router = getOrCreateSessionRouter(parsedConfig, agentName, req.params.agentId);
    const engine = getOrCreateEngine(parsedConfig, agentName);
    const sessions = await router.listSessions();
    await Promise.all(sessions.map((session) => engine.deleteSession(session.sessionKey)));
    res.json({ ok: true, deleted: sessions.length });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/storage/sessions/enforce-retention', async (req, res) => {
  const { config, agentName, maxSessions } = req.body as {
    config: ResolvedStorageConfig;
    agentName: string;
    maxSessions: number;
  };
  try {
    const engine = getOrCreateEngine(config, agentName);
    await engine.enforceRetention(maxSessions);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/storage/memory/daily', async (req, res) => {
  const { config, agentName, content, date } = req.body as {
    config: ResolvedStorageConfig;
    agentName: string;
    content: string;
    date?: string;
  };
  try {
    const engine = getOrCreateEngine(config, agentName);
    await engine.appendDailyMemory(content, date);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/storage/memory/daily/:date', async (req, res) => {
  const { config, agentName } = req.query as { config: string; agentName: string };
  try {
    const parsedConfig = JSON.parse(config) as ResolvedStorageConfig;
    const engine = getOrCreateEngine(parsedConfig, agentName);
    const content = await engine.readDailyMemory(req.params.date);
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/storage/memory/long-term', async (req, res) => {
  const { config, agentName } = req.query as { config: string; agentName: string };
  try {
    const parsedConfig = JSON.parse(config) as ResolvedStorageConfig;
    const engine = getOrCreateEngine(parsedConfig, agentName);
    const content = await engine.readLongTermMemory();
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.put('/api/storage/memory/long-term', async (req, res) => {
  const { config, agentName, content } = req.body as {
    config: ResolvedStorageConfig;
    agentName: string;
    content: string;
  };
  try {
    const engine = getOrCreateEngine(config, agentName);
    await engine.writeLongTermMemory(content);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/storage/memory/files', async (req, res) => {
  const { config, agentName } = req.query as { config: string; agentName: string };
  try {
    const parsedConfig = JSON.parse(config) as ResolvedStorageConfig;
    const engine = getOrCreateEngine(parsedConfig, agentName);
    const files = await engine.listMemoryFiles();
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/storage/maintenance', async (req, res) => {
  const { config, agentName } = req.body as {
    config: ResolvedStorageConfig;
    agentName: string;
  };
  try {
    const engine = getOrCreateEngine(config, agentName);
    const report = await engine.runMaintenance();
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/storage/maintenance/dry-run', async (req, res) => {
  const { config, agentName } = req.body as {
    config: ResolvedStorageConfig;
    agentName: string;
  };
  try {
    const engine = getOrCreateEngine(config, agentName);
    const report = await engine.runMaintenance('warn');
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/sessions/:agentId/:sessionKey/branches', async (req, res) => {
  const { config, agentName } = req.query as { config: string; agentName: string };
  try {
    const parsedConfig = JSON.parse(config) as ResolvedStorageConfig;
    const router = getOrCreateSessionRouter(parsedConfig, agentName, req.params.agentId);
    const status = await router.getStatus(req.params.sessionKey);

    if (!status) {
      res.status(404).json({ error: `Session ${req.params.sessionKey} not found` });
      return;
    }

    const engine = getOrCreateEngine(parsedConfig, agentName);
    const transcriptStore = getOrCreateTranscriptStore(parsedConfig, agentName);
    const transcriptPath = engine.resolveTranscriptPath(status);
    const branchTree = transcriptStore.buildBranchTree(transcriptPath);
    res.json(branchTree);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/sessions/:agentId/:sessionKey/lineage', async (req, res) => {
  const { config, agentName } = req.query as { config: string; agentName: string };
  try {
    const parsedConfig = JSON.parse(config) as ResolvedStorageConfig;
    const router = getOrCreateSessionRouter(parsedConfig, agentName, req.params.agentId);
    const engine = getOrCreateEngine(parsedConfig, agentName);
    const status = await router.getStatus(req.params.sessionKey);

    if (!status) {
      res.status(404).json({ error: `Session ${req.params.sessionKey} not found` });
      return;
    }

    const current = {
      sessionId: status.sessionId,
      sessionKey: status.sessionKey,
      createdAt: status.createdAt,
    };

    const ancestors: Array<{ sessionId: string; sessionKey: string; createdAt: string }> = [];
    let parentId = status.parentSessionId;
    while (parentId) {
      const parent = await engine.getSessionById(parentId);
      if (!parent) break;
      ancestors.push({
        sessionId: parent.sessionId,
        sessionKey: parent.sessionKey,
        createdAt: parent.createdAt,
      });
      parentId = parent.parentSessionId;
    }

    res.json({ current, ancestors });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// --- Settings persistence ---

app.get('/api/settings', async (_req, res) => {
  try {
    const settings = await settingsFile.load();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.put('/api/settings', async (req, res) => {
  try {
    const settings = req.body as {
      apiKeys: Record<string, string>;
      agentDefaults: Record<string, unknown>;
      storageDefaults: Record<string, unknown>;
    };
    await settingsFile.save(settings);
    // Keep in-memory API key store in sync
    apiKeys.setAll(settings.apiKeys ?? {});
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// --- Provider registry ---

app.get('/api/providers', (_req, res) => {
  res.json(pluginRegistry.listSummaries());
});

// --- Provider catalog ---

app.post('/api/providers/catalog/load', async (req, res) => {
  const { request, apiKeyFingerprint } = req.body as {
    request: ProviderCatalogRequest;
    apiKeyFingerprint?: string;
  };
  try {
    const cached = await catalogCache.load(request, apiKeyFingerprint);
    if (cached) {
      res.json(cached);
    } else {
      const plugin = pluginRegistry.get(request.pluginId);
      if (!plugin?.catalog) {
        res.json({ models: {}, userModels: {}, syncedAt: null, userModelsRequireRefresh: false });
        return;
      }
      const apiKey = apiKeys.get(plugin.id);
      if (!apiKey) {
        res.json({ models: {}, userModels: {}, syncedAt: null, userModelsRequireRefresh: false });
        return;
      }
      const auth = resolveProviderRuntimeAuth(
        { pluginId: request.pluginId, authMethodId: request.authMethodId, envVar: request.envVar, baseUrl: request.baseUrl },
        plugin,
        apiKeys,
      );
      res.json(await catalogCache.refresh(request, plugin, {
        apiKey: auth.apiKey!,
        baseUrl: auth.baseUrl,
      }));
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/providers/catalog/refresh', async (req, res) => {
  const { request } = req.body as { request: ProviderCatalogRequest };
  try {
    const plugin = pluginRegistry.get(request.pluginId);
    if (!plugin?.catalog) {
      res.status(400).json({ error: `Plugin "${request.pluginId}" has no catalog.` });
      return;
    }
    const auth = resolveProviderRuntimeAuth(
      { pluginId: request.pluginId, authMethodId: request.authMethodId, envVar: request.envVar, baseUrl: request.baseUrl },
      plugin,
      apiKeys,
    );
    if (!auth.apiKey) {
      res.status(400).json({ error: `No API key available for "${request.pluginId}".` });
      return;
    }
    res.json(await catalogCache.refresh(request, plugin, {
      apiKey: auth.apiKey,
      baseUrl: auth.baseUrl,
    }));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/providers/catalog/clear', async (req, res) => {
  const { request } = req.body as { request?: ProviderCatalogRequest };
  try {
    if (request) {
      await catalogCache.clear(request);
    } else {
      await catalogCache.clearAll();
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// --- Health check ---

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// --- Start server with WebSocket support ---

const PORT = parseInt(process.env.STORAGE_PORT ?? '3210', 10);
const httpServer = createServer(app);

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
const handleStartupError = createStartupErrorHandler({ port: PORT });

httpServer.once('error', handleStartupError);
wss.once('error', handleStartupError);

wss.on('connection', (socket) => {
  handleConnection(socket, agentManager, apiKeys);
});

// Seed in-memory API key store from persisted settings
settingsFile.load().then((s) => {
  if (Object.keys(s.apiKeys).length > 0) {
    apiKeys.setAll(s.apiKeys);
    console.log(`[Settings] Loaded API keys for ${Object.keys(s.apiKeys).length} provider(s) from ${settingsFile.getFilePath()}`);
  }
}).catch((err) => {
  console.error('[Settings] Failed to load settings file:', err);
});

// Load provider plugins
loadProviderPlugins(
  path.join(process.cwd(), 'providers.json'),
  pluginRegistry,
).then(() => {
  console.log(`[Providers] ${pluginRegistry.list().length} provider(s) available.`);
}).catch((err) => {
  console.error('[Providers] Failed to load plugins:', err);
});

httpServer.listen(PORT, () => {
  httpServer.off('error', handleStartupError);
  wss.off('error', handleStartupError);
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`WebSocket available at ws://localhost:${PORT}/ws`);

  // --- backend_start hook (global) ---
  const globalRegistry = getGlobalHookRegistry();
  const startCtx: BackendLifecycleContext = { phase: 'start', timestamp: Date.now() };
  globalRegistry.invoke(HOOK_NAMES.BACKEND_START, startCtx).catch((err) => {
    console.error('[Server] backend_start hook error:', err);
  });
});

// --- Graceful shutdown ---

async function shutdown() {
  console.log('\nShutting down...');

  // --- backend_stop hook (global) ---
  try {
    const globalRegistry = getGlobalHookRegistry();
    const stopCtx: BackendLifecycleContext = { phase: 'stop', timestamp: Date.now() };
    await globalRegistry.invoke(HOOK_NAMES.BACKEND_STOP, stopCtx);
  } catch (err) {
    console.error('[Server] backend_stop hook error:', err);
  }

  // Close WebSocket connections
  for (const client of wss.clients) {
    client.close(1001, 'Server shutting down');
  }

  agentManager.shutdown()
    .then(() => {
      httpServer.close(() => {
        console.log('Server closed.');
        process.exit(0);
      });
    })
    .catch((err) => {
      console.error('Error during shutdown:', err);
      process.exit(1);
    });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
