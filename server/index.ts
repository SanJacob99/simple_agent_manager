import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { StorageEngine } from './runtime/storage-engine';
import { AgentManager } from './agents/agent-manager';
import { ApiKeyStore } from './auth/api-keys';
import { handleConnection } from './connections/ws-handler';
import { getGlobalHookRegistry } from './agents/agent-manager';
import { HOOK_NAMES, type BackendLifecycleContext } from './hooks/hook-types';
import { createStartupErrorHandler } from './startup';
import type { ResolvedStorageConfig } from '../shared/agent-config';
import type { SessionMeta, SessionEntry } from '../shared/storage-types';

const app = express();
app.use(express.json({ limit: '10mb' }));

// --- Shared state ---

const apiKeys = new ApiKeyStore();
const agentManager = new AgentManager(apiKeys);

// --- Storage engine instances ---

const engines = new Map<string, StorageEngine>();

function getOrCreateEngine(config: ResolvedStorageConfig, agentName: string): StorageEngine {
  const key = `${config.storagePath}:${agentName}`;
  let engine = engines.get(key);
  if (!engine) {
    engine = new StorageEngine(config, agentName);
    engines.set(key, engine);
  }
  return engine;
}

// --- Storage REST routes (unchanged) ---

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

app.get('/api/storage/sessions', async (req, res) => {
  const { config, agentName } = req.query as { config: string; agentName: string };
  try {
    const parsedConfig = JSON.parse(config) as ResolvedStorageConfig;
    const engine = getOrCreateEngine(parsedConfig, agentName);
    const sessions = await engine.listSessions();
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/storage/sessions', async (req, res) => {
  const { config, agentName, meta } = req.body as {
    config: ResolvedStorageConfig;
    agentName: string;
    meta: SessionMeta;
  };
  try {
    const engine = getOrCreateEngine(config, agentName);
    await engine.createSession(meta);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.delete('/api/storage/sessions/:id', async (req, res) => {
  const { config, agentName } = req.query as { config: string; agentName: string };
  try {
    const parsedConfig = JSON.parse(config) as ResolvedStorageConfig;
    const engine = getOrCreateEngine(parsedConfig, agentName);
    await engine.deleteSession(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/storage/sessions/:id', async (req, res) => {
  const { config, agentName } = req.query as { config: string; agentName: string };
  try {
    const parsedConfig = JSON.parse(config) as ResolvedStorageConfig;
    const engine = getOrCreateEngine(parsedConfig, agentName);
    const meta = await engine.getSessionMeta(req.params.id);
    res.json(meta);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.patch('/api/storage/sessions/:id', async (req, res) => {
  const { config, agentName, partial } = req.body as {
    config: ResolvedStorageConfig;
    agentName: string;
    partial: Partial<SessionMeta>;
  };
  try {
    const engine = getOrCreateEngine(config, agentName);
    await engine.updateSessionMeta(req.params.id, partial);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/storage/sessions/:id/entries', async (req, res) => {
  const { config, agentName, entry } = req.body as {
    config: ResolvedStorageConfig;
    agentName: string;
    entry: SessionEntry;
  };
  try {
    const engine = getOrCreateEngine(config, agentName);
    await engine.appendEntry(req.params.id, entry);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/storage/sessions/:id/entries', async (req, res) => {
  const { config, agentName } = req.query as { config: string; agentName: string };
  try {
    const parsedConfig = JSON.parse(config) as ResolvedStorageConfig;
    const engine = getOrCreateEngine(parsedConfig, agentName);
    const entries = await engine.readEntries(req.params.id);
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.put('/api/storage/sessions/:id/entries', async (req, res) => {
  const { config, agentName, entries } = req.body as {
    config: ResolvedStorageConfig;
    agentName: string;
    entries: SessionEntry[];
  };
  try {
    const engine = getOrCreateEngine(config, agentName);
    await engine.replaceEntries(req.params.id, entries);
    res.json({ ok: true });
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
