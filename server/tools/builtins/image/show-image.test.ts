import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createShowImageTool } from './show-image';
import { createAgentTools } from '../../tool-factory';
import { initializeToolRegistry } from '../../tool-registry';

beforeAll(async () => {
  await initializeToolRegistry();
});

describe('show_image', () => {
  let tmpDir: string;
  let pngPath: string;
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'show-image-'));
    pngPath = path.join(tmpDir, 'sample.png');
    await fs.writeFile(pngPath, pngBytes);
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reads a local image and returns image + text content blocks', async () => {
    const tool = createShowImageTool({ cwd: tmpDir });
    const result = await tool.execute('call_1', { path: 'sample.png' }, undefined as any);

    expect(result.content).toHaveLength(2);
    const imageBlock = result.content[0] as any;
    const textBlock = result.content[1] as any;

    expect(imageBlock.type).toBe('image');
    expect(imageBlock.mimeType).toBe('image/png');
    expect(Buffer.from(imageBlock.data, 'base64').equals(pngBytes)).toBe(true);
    expect(textBlock.type).toBe('text');
    expect(textBlock.text).toContain('sample.png');
  });

  it('uses a custom caption when provided', async () => {
    const tool = createShowImageTool({ cwd: tmpDir });
    const result = await tool.execute(
      'call_1',
      { path: 'sample.png', caption: 'Hello there' },
      undefined as any,
    );
    const textBlock = result.content[1] as any;
    expect(textBlock.text).toBe('Hello there');
  });

  it('rejects unsupported extensions', async () => {
    const tool = createShowImageTool({ cwd: tmpDir });
    await expect(
      tool.execute('call_1', { path: 'foo.bmp' }, undefined as any),
    ).rejects.toThrow(/Unsupported image format/);
  });

  it('reports a clear error when the file is missing', async () => {
    const tool = createShowImageTool({ cwd: tmpDir });
    await expect(
      tool.execute('call_1', { path: 'nope.png' }, undefined as any),
    ).rejects.toThrow(/Image not found/);
  });

  it('is registered by createAgentTools when show_image is in names and cwd is set', () => {
    const tools = createAgentTools(['show_image'], [], undefined, { cwd: tmpDir });
    expect(tools.map((t) => t.name)).toContain('show_image');
  });
});
