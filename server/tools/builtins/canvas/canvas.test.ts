import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCanvasTool } from './canvas';

describe('canvas tool', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-tool-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes an index.html and returns a URL scoped to the agent', async () => {
    const tool = createCanvasTool({
      cwd: tmpDir,
      publicBaseUrl: 'http://localhost:3210',
      agentId: 'agent-42',
    });

    const result = await tool.execute(
      'call_1',
      {
        id: 'demo',
        title: 'Demo',
        html: '<h1>hi</h1>',
        css: 'h1 { color: red; }',
        js: 'console.log("ready")',
      },
      undefined as any,
    );

    const details = (result as any).details as { canvasId: string; url: string; files: string[] };
    expect(details.canvasId).toBe('demo');
    expect(details.url).toBe('http://localhost:3210/canvas/agent-42/demo/index.html');
    expect(details.files).toContain('index.html');

    const html = await fs.readFile(path.join(tmpDir, 'canvas', 'demo', 'index.html'), 'utf-8');
    expect(html).toContain('<title>Demo</title>');
    expect(html).toContain('h1 { color: red; }');
    expect(html).toContain('<h1>hi</h1>');
    expect(html).toContain('console.log("ready")');

    const meta = JSON.parse(
      await fs.readFile(path.join(tmpDir, 'canvas', 'demo', 'canvas.json'), 'utf-8'),
    );
    expect(meta.id).toBe('demo');
    expect(meta.files).toContain('index.html');
  });

  it('writes extra assets and refuses to escape the canvas folder', async () => {
    const tool = createCanvasTool({ cwd: tmpDir, publicBaseUrl: '' });

    const result = await tool.execute(
      'call_1',
      {
        id: 'withAssets',
        html: '<div id="app"></div>',
        assets: [
          { path: 'app.js', content: 'document.title="ok"' },
          { path: 'styles/main.css', content: 'body{margin:0}' },
        ],
      },
      undefined as any,
    );
    const details = (result as any).details as { files: string[] };
    expect(details.files).toEqual(['index.html', 'app.js', 'styles/main.css']);

    const js = await fs.readFile(
      path.join(tmpDir, 'canvas', 'withassets', 'app.js'),
      'utf-8',
    );
    expect(js).toBe('document.title="ok"');

    await expect(
      tool.execute(
        'call_2',
        {
          id: 'escape',
          html: '<p>x</p>',
          assets: [{ path: '../../../etc/passwd.js', content: 'nope' }],
        },
        undefined as any,
      ),
    ).rejects.toThrow(/Invalid asset path/);
  });

  it('rejects disallowed asset extensions', async () => {
    const tool = createCanvasTool({ cwd: tmpDir });
    await expect(
      tool.execute(
        'call_1',
        {
          id: 'bad-ext',
          html: '<p>x</p>',
          assets: [{ path: 'payload.exe', content: 'data' }],
        },
        undefined as any,
      ),
    ).rejects.toThrow(/Unsupported asset extension/);
  });

  it('requires non-empty html body', async () => {
    const tool = createCanvasTool({ cwd: tmpDir });
    await expect(
      tool.execute('call_1', { id: 'empty', html: '   ' }, undefined as any),
    ).rejects.toThrow(/html body is required/);
  });
});
