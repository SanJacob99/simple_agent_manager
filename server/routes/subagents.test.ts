import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'http';
import { mountSubAgentRoutes } from './subagents';
import { SubAgentRegistry } from '../agents/sub-agent-registry';

async function startServer(registry: SubAgentRegistry, abort: (id: string) => void = () => {}) {
  const app = express();
  app.use(express.json());
  mountSubAgentRoutes(app, { registry, abortRun: abort });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('Server failed to bind');
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  return { server, baseUrl };
}

function spawnRecord(registry: SubAgentRegistry) {
  return registry.spawn(
    { sessionKey: 'agent:a:main', runId: 'pr1' },
    {
      agentId: 'a',
      sessionKey: 'sub:agent:a:main:helper:abc',
      runId: 'cr1',
      subAgentName: 'helper',
      appliedOverrides: {},
    },
  );
}

describe('POST /api/subagents/:id/kill', () => {
  it('aborts run and marks killed', async () => {
    const registry = new SubAgentRegistry();
    const record = spawnRecord(registry);
    let abortedRunId: string | null = null;
    const { server, baseUrl } = await startServer(registry, (rid) => { abortedRunId = rid; });
    try {
      const res = await fetch(`${baseUrl}/api/subagents/${record.subAgentId}/kill`, { method: 'POST' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ killed: true });
      expect(abortedRunId).toBe('cr1');
      expect(registry.get(record.subAgentId)?.status).toBe('killed');
    } finally {
      server.close();
    }
  });

  it('returns 404 for unknown id', async () => {
    const { server, baseUrl } = await startServer(new SubAgentRegistry());
    try {
      const res = await fetch(`${baseUrl}/api/subagents/nope/kill`, { method: 'POST' });
      expect(res.status).toBe(404);
    } finally {
      server.close();
    }
  });

  it('returns 409 for already-terminal sub', async () => {
    const registry = new SubAgentRegistry();
    const record = spawnRecord(registry);
    registry.kill(record.subAgentId);
    const { server, baseUrl } = await startServer(registry);
    try {
      const res = await fetch(`${baseUrl}/api/subagents/${record.subAgentId}/kill`, { method: 'POST' });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.reason).toBe('not-running');
    } finally {
      server.close();
    }
  });
});

describe('GET /api/subagents/:id', () => {
  it('returns the registry record', async () => {
    const registry = new SubAgentRegistry();
    const record = spawnRecord(registry);
    const { server, baseUrl } = await startServer(registry);
    try {
      const res = await fetch(`${baseUrl}/api/subagents/${record.subAgentId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.subAgentId).toBe(record.subAgentId);
      expect(body.subAgentName).toBe('helper');
    } finally {
      server.close();
    }
  });

  it('404 on unknown', async () => {
    const { server, baseUrl } = await startServer(new SubAgentRegistry());
    try {
      const res = await fetch(`${baseUrl}/api/subagents/nope`);
      expect(res.status).toBe(404);
    } finally {
      server.close();
    }
  });
});

describe('GET /api/subagents?parentSessionKey=...', () => {
  it('lists records for a parent session', async () => {
    const registry = new SubAgentRegistry();
    spawnRecord(registry);
    const { server, baseUrl } = await startServer(registry);
    try {
      const res = await fetch(`${baseUrl}/api/subagents?parentSessionKey=${encodeURIComponent('agent:a:main')}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(1);
    } finally {
      server.close();
    }
  });

  it('400 when missing parentSessionKey query', async () => {
    const { server, baseUrl } = await startServer(new SubAgentRegistry());
    try {
      const res = await fetch(`${baseUrl}/api/subagents`);
      expect(res.status).toBe(400);
    } finally {
      server.close();
    }
  });
});
