import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createImageAnalyzeTool } from './image-analyze';

describe('image-analyze', () => {
  let tmpDir: string;
  let pngPath: string;
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'image-analyze-'));
    pngPath = path.join(tmpDir, 'sample.png');
    await fs.writeFile(pngPath, pngBytes);
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reads a local image and returns it as a content block', async () => {
    const tool = createImageAnalyzeTool({ cwd: tmpDir });
    const result = await tool.execute('call_1', { image: 'sample.png' }, undefined as any);

    expect(result.content).toHaveLength(2);
    const imageBlock = result.content[0] as any;
    expect(imageBlock.type).toBe('image');
    expect(imageBlock.mimeType).toBe('image/png');
    expect(Buffer.from(imageBlock.data, 'base64').equals(pngBytes)).toBe(true);
  });

  it('rejects unsupported extensions', async () => {
    const tool = createImageAnalyzeTool({ cwd: tmpDir });
    await expect(
      tool.execute('call_1', { image: 'foo.bmp' }, undefined as any),
    ).rejects.toThrow(/Unsupported image format/);
  });

  it('rejects path traversal attempts', async () => {
    const tool = createImageAnalyzeTool({ cwd: tmpDir });
    await expect(
      tool.execute('call_1', { image: '../sample.png' }, undefined as any),
    ).rejects.toThrow(/Path escape detected/);
  });
});
