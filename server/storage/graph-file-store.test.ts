import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { GraphFileStore } from './graph-file-store';

let tmpDir: string;
let store: GraphFileStore;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sam-graph-'));
  store = new GraphFileStore(tmpDir);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('GraphFileStore', () => {
  it('returns null when no graph file exists yet', async () => {
    const graph = await store.load();
    expect(graph).toBeNull();
  });

  it('saves and reloads a graph blob verbatim', async () => {
    const data = {
      id: 'default',
      version: 2,
      graph: {
        nodes: [{ id: 'a', type: 'agent', position: { x: 0, y: 0 }, data: {} }],
        edges: [{ id: 'e1', source: 'a', target: 'b' }],
      },
      updatedAt: 1700000000000,
    };
    await store.save(data);
    const loaded = await store.load();
    expect(loaded).toEqual(data);
  });

  it('overwrites an existing graph file on save', async () => {
    await store.save({
      id: 'default',
      version: 2,
      graph: { nodes: [{ id: 'old' }], edges: [] },
      updatedAt: 1,
    });
    await store.save({
      id: 'default',
      version: 2,
      graph: { nodes: [{ id: 'new' }], edges: [] },
      updatedAt: 2,
    });
    const loaded = await store.load();
    expect(loaded?.updatedAt).toBe(2);
    expect((loaded?.graph.nodes[0] as { id: string }).id).toBe('new');
  });

  it('exposes the resolved file path', () => {
    expect(store.getFilePath()).toBe(path.join(tmpDir, 'graph.json'));
  });
});
