import { describe, it, expect } from 'vitest';
import { cloneTemplateContents } from './clone-nodes';
import type { TemplateEdge, TemplateNode } from '../types/templates';
import type { AppNode } from '../types/nodes';
import { getDefaultNodeData } from './default-nodes';

function buildTemplateNode(
  id: string,
  type: TemplateNode['type'],
  overrides: Partial<TemplateNode['data']> = {},
  position = { x: 0, y: 0 },
): TemplateNode {
  const base = getDefaultNodeData(type) as TemplateNode['data'];
  return {
    id,
    type,
    position,
    data: { ...base, ...overrides } as TemplateNode['data'],
  };
}

describe('cloneTemplateContents', () => {
  it('mints fresh node IDs and remaps edges to the new IDs', () => {
    const nodes: TemplateNode[] = [
      buildTemplateNode('orig-a', 'agent', {
        name: 'Researcher',
        nameConfirmed: true,
      }),
      buildTemplateNode('orig-b', 'storage', {}, { x: 100, y: 0 }),
    ];
    const edges: TemplateEdge[] = [
      { id: 'orig-edge', source: 'orig-b', target: 'orig-a' },
    ];

    const result = cloneTemplateContents(nodes, edges, [], { x: 0, y: 0 });

    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
    for (const n of result.nodes) {
      expect(n.id.startsWith('node_')).toBe(true);
      expect(n.id).not.toBe('orig-a');
      expect(n.id).not.toBe('orig-b');
    }
    const [newA, newB] = result.nodes;
    expect(result.edges[0]).toMatchObject({
      source: newB.id,
      target: newA.id,
    });
  });

  it('drops edges that reference nodes outside the template', () => {
    const nodes: TemplateNode[] = [buildTemplateNode('orig-a', 'agent')];
    const edges: TemplateEdge[] = [
      { id: 'dangling', source: 'orig-a', target: 'outside' },
    ];

    const result = cloneTemplateContents(nodes, edges, [], { x: 0, y: 0 });

    expect(result.edges).toHaveLength(0);
  });

  it('rewrites storage path so two clones never share a directory', () => {
    const tplNode = buildTemplateNode('orig-storage', 'storage', {
      storagePath: '~/.simple-agent-manager/storage',
    });

    const first = cloneTemplateContents([tplNode], [], [], { x: 0, y: 0 });
    const existing = first.nodes as AppNode[];
    const second = cloneTemplateContents([tplNode], [], existing, {
      x: 0,
      y: 0,
    });

    const firstPath = (first.nodes[0].data as { storagePath: string })
      .storagePath;
    const secondPath = (second.nodes[0].data as { storagePath: string })
      .storagePath;

    expect(firstPath).not.toBe('~/.simple-agent-manager/storage');
    expect(secondPath).not.toBe('~/.simple-agent-manager/storage');
    expect(firstPath).not.toBe(secondPath);
    expect(firstPath.startsWith('~/.simple-agent-manager/storage/')).toBe(
      true,
    );
  });

  it('rewrites tools.exec.cwd when set, leaves it empty when blank', () => {
    const withCwd = buildTemplateNode('orig-tools-1', 'tools', {
      toolSettings: {
        ...(getDefaultNodeData('tools') as any).toolSettings,
        exec: { cwd: '/home/user/proj', sandboxWorkdir: false, skill: '' },
      },
    });
    const empty = buildTemplateNode('orig-tools-2', 'tools');

    const r = cloneTemplateContents([withCwd, empty], [], [], { x: 0, y: 0 });
    const cwd1 = (r.nodes[0].data as any).toolSettings.exec.cwd;
    const cwd2 = (r.nodes[1].data as any).toolSettings.exec.cwd;

    expect(cwd1.startsWith('/home/user/proj/')).toBe(true);
    expect(cwd1).not.toBe('/home/user/proj');
    expect(cwd2).toBe('');
  });

  it('rewrites mcp cwd when set', () => {
    const tplNode = buildTemplateNode('orig-mcp', 'mcp', {
      cwd: '/srv/mcp-server',
    });

    const r = cloneTemplateContents([tplNode], [], [], { x: 0, y: 0 });
    const newCwd = (r.nodes[0].data as { cwd: string }).cwd;
    expect(newCwd.startsWith('/srv/mcp-server/')).toBe(true);
    expect(newCwd).not.toBe('/srv/mcp-server');
  });

  it('produces unique agent names against existing graph and within batch', () => {
    const existing: AppNode[] = [
      {
        id: 'node_existing',
        type: 'agent',
        position: { x: 0, y: 0 },
        data: {
          ...(getDefaultNodeData('agent') as any),
          name: 'Researcher',
          nameConfirmed: true,
        },
      },
    ];

    const nodes: TemplateNode[] = [
      buildTemplateNode('orig-1', 'agent', {
        name: 'Researcher',
        nameConfirmed: true,
      }),
      buildTemplateNode(
        'orig-2',
        'agent',
        { name: 'Researcher', nameConfirmed: true },
        { x: 200, y: 0 },
      ),
    ];

    const r = cloneTemplateContents(nodes, [], existing, { x: 0, y: 0 });
    const name1 = (r.nodes[0].data as { name: string }).name;
    const name2 = (r.nodes[1].data as { name: string }).name;

    expect(name1).not.toBe('Researcher');
    expect(name2).not.toBe('Researcher');
    expect(name1).not.toBe(name2);
    expect(name1.toLowerCase()).toContain('researcher');
    expect(name2.toLowerCase()).toContain('researcher');
  });

  it('preserves relative offsets between cloned nodes', () => {
    const nodes: TemplateNode[] = [
      buildTemplateNode('a', 'agent', {}, { x: 50, y: 50 }),
      buildTemplateNode('b', 'storage', {}, { x: 250, y: 50 }),
    ];

    const r = cloneTemplateContents(nodes, [], [], { x: 1000, y: 1000 });

    expect(r.nodes[0].position).toEqual({ x: 1000, y: 1000 });
    expect(r.nodes[1].position).toEqual({ x: 1200, y: 1000 });
  });
});
