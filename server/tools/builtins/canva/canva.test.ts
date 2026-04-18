import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import http from 'http';
import { createCanvaTool, __resetCanvasesForTests } from './canva';

let tmpDir: string;
const portBase = 5400 + Math.floor(Math.random() * 100);

function text(result: { content: { type: string; text?: string }[] }): string {
  return (result.content[0] as { text: string }).text;
}

function ctx() {
  return {
    cwd: tmpDir,
    portRangeStart: portBase,
    portRangeEnd: portBase + 20,
  };
}

async function fetchBody(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf-8'),
          }),
        );
      })
      .on('error', reject);
  });
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sam-canva-test-'));
});

afterEach(async () => {
  await __resetCanvasesForTests();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('canva.create', () => {
  it('writes files to .canva/<name>/ and serves them on a port', async () => {
    const tool = createCanvaTool(ctx());
    const result = text(
      await tool.execute('t1', {
        action: 'create',
        name: 'hello',
        html: '<h1 id="h">hi</h1>',
        css: 'h1 { color: red; }',
        js: 'console.log("ready");',
      }),
    );

    expect(result).toMatch(/live at http:\/\/localhost:\d+/);

    const folder = path.join(tmpDir, '.canva', 'hello');
    expect(await fs.readFile(path.join(folder, 'index.html'), 'utf-8')).toBe(
      '<h1 id="h">hi</h1>',
    );
    expect(await fs.readFile(path.join(folder, 'style.css'), 'utf-8')).toContain('red');

    const portMatch = result.match(/localhost:(\d+)/);
    const port = Number(portMatch![1]);

    const res = await fetchBody(`http://localhost:${port}/`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('<h1 id="h">hi</h1>');

    const cssRes = await fetchBody(`http://localhost:${port}/style.css`);
    expect(cssRes.status).toBe(200);
    expect(cssRes.body).toContain('red');
  });

  it('refuses to clobber an existing canvas without overwrite', async () => {
    const tool = createCanvaTool(ctx());
    await tool.execute('c1', { action: 'create', name: 'dup', html: '<p>a</p>' });
    await expect(
      tool.execute('c2', { action: 'create', name: 'dup', html: '<p>b</p>' }),
    ).rejects.toThrow(/already exists/);
  });

  it('rejects invalid names', async () => {
    const tool = createCanvaTool(ctx());
    await expect(
      tool.execute('t', { action: 'create', name: '../etc', html: 'x' }),
    ).rejects.toThrow(/Invalid canvas name/);
  });
});

describe('canva.update', () => {
  it('edits an existing canvas and keeps the server alive on the same port', async () => {
    const tool = createCanvaTool(ctx());
    const createOut = text(
      await tool.execute('c', {
        action: 'create',
        name: 'edit-me',
        html: '<p>before</p>',
      }),
    );
    const port = Number(createOut.match(/localhost:(\d+)/)![1]);

    const before = await fetchBody(`http://localhost:${port}/`);
    expect(before.body).toContain('before');

    await tool.execute('u', {
      action: 'update',
      name: 'edit-me',
      html: '<p>after</p>',
    });

    const after = await fetchBody(`http://localhost:${port}/`);
    expect(after.body).toContain('after');
  });

  it('can write arbitrary nested files via files map', async () => {
    const tool = createCanvaTool(ctx());
    await tool.execute('c', {
      action: 'create',
      name: 'nested',
      html: '<p/>',
      serve: false,
    });
    await tool.execute('u', {
      action: 'update',
      name: 'nested',
      files: { 'assets/data.json': '{"x":1}' },
    });
    const content = await fs.readFile(
      path.join(tmpDir, '.canva', 'nested', 'assets', 'data.json'),
      'utf-8',
    );
    expect(content).toBe('{"x":1}');
  });
});

describe('canva.status + stop', () => {
  it('reports the URL and can stop the server', async () => {
    const tool = createCanvaTool(ctx());
    await tool.execute('c', { action: 'create', name: 's1', html: '<p/>' });

    const status = text(await tool.execute('s', { action: 'status' }));
    expect(status).toContain('"s1"');
    expect(status).toMatch(/http:\/\/localhost:\d+/);

    const stopped = text(await tool.execute('x', { action: 'stop', name: 's1' }));
    expect(stopped).toContain('stopped');

    const after = text(await tool.execute('s2', { action: 'status' }));
    expect(after).toContain('no canvases running');
  });
});

describe('canva.list', () => {
  it('lists canvases on disk', async () => {
    const tool = createCanvaTool(ctx());
    await tool.execute('a', {
      action: 'create',
      name: 'one',
      html: '<p/>',
      serve: false,
    });
    await tool.execute('b', {
      action: 'create',
      name: 'two',
      html: '<p/>',
      serve: false,
    });
    const out = text(await tool.execute('l', { action: 'list' }));
    expect(out).toContain('- one');
    expect(out).toContain('- two');
  });
});
