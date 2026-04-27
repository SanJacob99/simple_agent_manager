import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchGraphFromServer,
  loadGraphRaw,
  saveGraph,
  saveGraphToServer,
} from './storage';
import type { GraphState } from '../types/graph';

const sampleGraph: GraphState = {
  nodes: [
    { id: 'a', type: 'agent', position: { x: 0, y: 0 }, data: { type: 'agent' } as any },
  ],
  edges: [{ id: 'e1', source: 'a', target: 'b' }],
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchGraphFromServer', () => {
  it('returns null when the server has no graph yet (body is null)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('null', { status: 200, headers: { 'Content-Type': 'application/json' } })),
    );
    const result = await fetchGraphFromServer();
    expect(result).toBeNull();
  });

  it('returns null and does not throw when the network call fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const result = await fetchGraphFromServer();
    expect(result).toBeNull();
  });

  it('returns null when the response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 500 })),
    );
    const result = await fetchGraphFromServer();
    expect(result).toBeNull();
  });

  it('returns the migrated graph when the server has a blob', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: 'default',
              version: 2,
              graph: sampleGraph,
              updatedAt: 1700000000000,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    );
    const result = await fetchGraphFromServer();
    expect(result).not.toBeNull();
    expect(result?.graph.edges).toEqual(sampleGraph.edges);
    expect(result?.graph.nodes).toHaveLength(1);
    expect(result?.updatedAt).toBe(1700000000000);
  });
});

describe('saveGraphToServer', () => {
  it('PUTs the canvas blob to /api/graph', async () => {
    const fetchSpy = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    await saveGraphToServer(sampleGraph);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = call;
    expect(url).toBe('/api/graph');
    expect(init.method).toBe('PUT');
    const body = JSON.parse(init.body as string);
    expect(body.graph).toEqual(sampleGraph);
    expect(body.id).toBe('default');
    expect(typeof body.updatedAt).toBe('number');
  });

  it('swallows network errors so a missed call does not crash the app', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    await expect(saveGraphToServer(sampleGraph)).resolves.toBeUndefined();
  });
});

describe('loadGraphRaw / saveGraph (localStorage)', () => {
  it('round-trips a graph through localStorage with an updatedAt timestamp', () => {
    saveGraph(sampleGraph);
    const loaded = loadGraphRaw();
    expect(loaded?.graph.edges).toEqual(sampleGraph.edges);
    expect(loaded?.graph.nodes).toHaveLength(1);
    expect(typeof loaded?.updatedAt).toBe('number');
    expect(loaded?.updatedAt).toBeGreaterThan(0);
  });

  it('returns null when no graph has been saved yet', () => {
    expect(loadGraphRaw()).toBeNull();
  });
});
