import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDocTools } from './sam-agent-doc-tools';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'samagent-doc-'));
  mkdirSync(join(root, 'docs/concepts'), { recursive: true });
  writeFileSync(
    join(root, 'docs/concepts/_manifest.json'),
    JSON.stringify({ concepts: { agent: { doc: 'agent-node.md' } } }),
  );
  writeFileSync(join(root, 'docs/concepts/agent-node.md'), '# Agent Node\nThis is the agent.\nAnother line.');
  writeFileSync(join(root, 'README.md'), '# Project\nThe agent runtime is here.');
  writeFileSync(join(root, 'AGENTS.md'), '# Agents\nList of agents.');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('buildDocTools', () => {
  it('list_docs returns manifest entries plus README and AGENTS', async () => {
    const tools = buildDocTools(root);
    const list = tools.find((t) => t.name === 'list_docs')!;
    const result = await list.execute('id1', {}, new AbortController().signal);
    const text = (result as any).content[0].text;
    expect(text).toContain('agent-node.md');
    expect(text).toContain('README.md');
    expect(text).toContain('AGENTS.md');
  });

  it('read_doc reads an allowlisted concept file', async () => {
    const tools = buildDocTools(root);
    const read = tools.find((t) => t.name === 'read_doc')!;
    const result = await read.execute('id2', { path: 'docs/concepts/agent-node.md' }, new AbortController().signal);
    const text = (result as any).content[0].text;
    expect(text).toContain('# Agent Node');
  });

  it('read_doc rejects unknown paths', async () => {
    const tools = buildDocTools(root);
    const read = tools.find((t) => t.name === 'read_doc')!;
    const result = await read.execute('id3', { path: 'docs/superpowers/specs/foo.md' }, new AbortController().signal);
    const text = (result as any).content[0].text;
    expect(text).toMatch(/not allow/i);
  });

  it('read_doc rejects path traversal', async () => {
    const tools = buildDocTools(root);
    const read = tools.find((t) => t.name === 'read_doc')!;
    const result = await read.execute('id4', { path: '../../../etc/passwd' }, new AbortController().signal);
    const text = (result as any).content[0].text;
    expect(text).toMatch(/not allow/i);
  });

  it('search_docs greps across allowed files', async () => {
    const tools = buildDocTools(root);
    const search = tools.find((t) => t.name === 'search_docs')!;
    const result = await search.execute('id5', { query: 'agent' }, new AbortController().signal);
    const text = (result as any).content[0].text;
    expect(text).toContain('docs/concepts/agent-node.md');
    expect(text).toContain('README.md');
  });
});
