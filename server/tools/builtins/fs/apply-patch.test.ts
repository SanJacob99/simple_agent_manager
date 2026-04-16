import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createApplyPatchTool } from './apply-patch';

let tmpDir: string;

function text(result: { content: { type: string; text?: string }[] }): string {
  return (result.content[0] as { text: string }).text;
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sam-patch-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('apply_patch', () => {
  it('adds a new file', async () => {
    const tool = createApplyPatchTool({ cwd: tmpDir });
    const patch = [
      '*** Begin Patch',
      '*** Add File: hello.txt',
      '+Hello',
      '+World',
      '*** End Patch',
    ].join('\n');

    const out = text(await tool.execute('t1', { input: patch }));
    expect(out).toContain('A hello.txt');
    const content = await fs.readFile(path.join(tmpDir, 'hello.txt'), 'utf-8');
    expect(content).toBe('Hello\nWorld\n');
  });

  it('deletes a file', async () => {
    await fs.writeFile(path.join(tmpDir, 'gone.txt'), 'bye');
    const tool = createApplyPatchTool({ cwd: tmpDir });
    const patch = [
      '*** Begin Patch',
      '*** Delete File: gone.txt',
      '*** End Patch',
    ].join('\n');

    const out = text(await tool.execute('t2', { input: patch }));
    expect(out).toContain('D gone.txt');
    await expect(fs.stat(path.join(tmpDir, 'gone.txt'))).rejects.toThrow();
  });

  it('updates a file with a single hunk', async () => {
    await fs.writeFile(path.join(tmpDir, 'app.ts'), 'line1\nold line\nline3\n');
    const tool = createApplyPatchTool({ cwd: tmpDir });
    const patch = [
      '*** Begin Patch',
      '*** Update File: app.ts',
      '@@',
      '-old line',
      '+new line',
      '*** End Patch',
    ].join('\n');

    const out = text(await tool.execute('t3', { input: patch }));
    expect(out).toContain('M app.ts');
    const content = await fs.readFile(path.join(tmpDir, 'app.ts'), 'utf-8');
    expect(content).toContain('new line');
    expect(content).not.toContain('old line');
  });

  it('handles multi-file patches', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'aaa\n');
    const tool = createApplyPatchTool({ cwd: tmpDir });
    const patch = [
      '*** Begin Patch',
      '*** Add File: b.txt',
      '+bbb',
      '*** Update File: a.txt',
      '@@',
      '-aaa',
      '+AAA',
      '*** End Patch',
    ].join('\n');

    const out = text(await tool.execute('t4', { input: patch }));
    expect(out).toContain('A b.txt');
    expect(out).toContain('M a.txt');
    expect(await fs.readFile(path.join(tmpDir, 'a.txt'), 'utf-8')).toContain('AAA');
    expect(await fs.readFile(path.join(tmpDir, 'b.txt'), 'utf-8')).toContain('bbb');
  });

  it('uses context markers to find the right hunk', async () => {
    await fs.writeFile(path.join(tmpDir, 'ctx.ts'), 'function foo() {\n  return 1;\n}\n\nfunction bar() {\n  return 2;\n}\n');
    const tool = createApplyPatchTool({ cwd: tmpDir });
    const patch = [
      '*** Begin Patch',
      '*** Update File: ctx.ts',
      '@@ function bar() {',
      '-  return 2;',
      '+  return 42;',
      '*** End Patch',
    ].join('\n');

    await tool.execute('t5', { input: patch });
    const content = await fs.readFile(path.join(tmpDir, 'ctx.ts'), 'utf-8');
    expect(content).toContain('return 42');
    expect(content).toContain('return 1'); // foo untouched
  });

  it('throws for missing Begin/End markers', async () => {
    const tool = createApplyPatchTool({ cwd: tmpDir });
    await expect(tool.execute('t6', { input: 'no markers here' })).rejects.toThrow('Begin Patch');
  });

  it('throws when old lines not found in update', async () => {
    await fs.writeFile(path.join(tmpDir, 'miss.txt'), 'hello\n');
    const tool = createApplyPatchTool({ cwd: tmpDir });
    const patch = [
      '*** Begin Patch',
      '*** Update File: miss.txt',
      '@@',
      '-not here',
      '+replacement',
      '*** End Patch',
    ].join('\n');

    await expect(tool.execute('t7', { input: patch })).rejects.toThrow('Failed to find');
  });

  it('creates parent directories for new files', async () => {
    const tool = createApplyPatchTool({ cwd: tmpDir });
    const patch = [
      '*** Begin Patch',
      '*** Add File: deep/nested/file.txt',
      '+content',
      '*** End Patch',
    ].join('\n');

    await tool.execute('t8', { input: patch });
    const content = await fs.readFile(path.join(tmpDir, 'deep/nested/file.txt'), 'utf-8');
    expect(content).toBe('content\n');
  });
});
