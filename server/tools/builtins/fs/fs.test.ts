import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createReadFileTool } from './read-file';
import { createWriteFileTool } from './write-file';
import { createEditFileTool } from './edit-file';
import { createListDirectoryTool } from './list-directory';

let tmpDir: string;

function text(result: { content: { type: string; text?: string }[] }): string {
  return (result.content[0] as { text: string }).text;
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sam-fs-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('read_file', () => {
  it('reads file content with line numbers', async () => {
    await fs.writeFile(path.join(tmpDir, 'hello.txt'), 'line1\nline2\nline3');
    const tool = createReadFileTool({ cwd: tmpDir });
    const out = text(await tool.execute('t1', { path: 'hello.txt' }));
    expect(out).toContain('1\tline1');
    expect(out).toContain('2\tline2');
    expect(out).toContain('3\tline3');
  });

  it('supports offset and limit', async () => {
    await fs.writeFile(path.join(tmpDir, 'lines.txt'), 'a\nb\nc\nd\ne');
    const tool = createReadFileTool({ cwd: tmpDir });
    const out = text(await tool.execute('t2', { path: 'lines.txt', offset: 2, limit: 2 }));
    expect(out).toContain('2\tb');
    expect(out).toContain('3\tc');
    expect(out).not.toContain('1\ta');
    expect(out).not.toContain('4\td');
  });

  it('throws for missing files', async () => {
    const tool = createReadFileTool({ cwd: tmpDir });
    await expect(tool.execute('t3', { path: 'nope.txt' })).rejects.toThrow('not found');
  });

  it('blocks path traversal when sandboxed', async () => {
    const tool = createReadFileTool({ cwd: tmpDir, sandboxWorkdir: true });
    await expect(tool.execute('t4', { path: '../../../etc/passwd' })).rejects.toThrow('outside');
  });

  it('blocks prefix-matching path traversal bypass', async () => {
    const baseName = path.basename(tmpDir);
    // e.g. if tmpDir is /tmp/sam-fs-test-abc, bypass is /tmp/sam-fs-test-abc-secrets/passwd
    const bypassPath = `../${baseName}-secrets/passwd`;
    const tool = createReadFileTool({ cwd: tmpDir, sandboxWorkdir: true });
    await expect(tool.execute('t5', { path: bypassPath })).rejects.toThrow('outside');
  });
});

describe('write_file', () => {
  it('creates a new file', async () => {
    const tool = createWriteFileTool({ cwd: tmpDir });
    const out = text(await tool.execute('t1', { path: 'new.txt', content: 'hello' }));
    expect(out).toContain('Wrote');
    const content = await fs.readFile(path.join(tmpDir, 'new.txt'), 'utf-8');
    expect(content).toBe('hello');
  });

  it('creates parent directories', async () => {
    const tool = createWriteFileTool({ cwd: tmpDir });
    await tool.execute('t2', { path: 'deep/nested/file.txt', content: 'ok' });
    const content = await fs.readFile(path.join(tmpDir, 'deep/nested/file.txt'), 'utf-8');
    expect(content).toBe('ok');
  });

  it('overwrites existing files', async () => {
    await fs.writeFile(path.join(tmpDir, 'exist.txt'), 'old');
    const tool = createWriteFileTool({ cwd: tmpDir });
    await tool.execute('t3', { path: 'exist.txt', content: 'new' });
    const content = await fs.readFile(path.join(tmpDir, 'exist.txt'), 'utf-8');
    expect(content).toBe('new');
  });
});

describe('edit_file', () => {
  it('replaces exact string match', async () => {
    await fs.writeFile(path.join(tmpDir, 'edit.txt'), 'foo bar baz');
    const tool = createEditFileTool({ cwd: tmpDir });
    const out = text(await tool.execute('t1', { path: 'edit.txt', old_string: 'bar', new_string: 'qux' }));
    expect(out).toContain('Edited');
    const content = await fs.readFile(path.join(tmpDir, 'edit.txt'), 'utf-8');
    expect(content).toBe('foo qux baz');
  });

  it('throws when old_string not found', async () => {
    await fs.writeFile(path.join(tmpDir, 'miss.txt'), 'hello world');
    const tool = createEditFileTool({ cwd: tmpDir });
    await expect(
      tool.execute('t2', { path: 'miss.txt', old_string: 'xyz', new_string: 'abc' }),
    ).rejects.toThrow('not found');
  });

  it('throws when old_string is not unique', async () => {
    await fs.writeFile(path.join(tmpDir, 'dup.txt'), 'aaa\naaa');
    const tool = createEditFileTool({ cwd: tmpDir });
    await expect(
      tool.execute('t3', { path: 'dup.txt', old_string: 'aaa', new_string: 'bbb' }),
    ).rejects.toThrow('multiple times');
  });
});

describe('list_directory', () => {
  it('lists files and directories', async () => {
    await fs.mkdir(path.join(tmpDir, 'subdir'));
    await fs.writeFile(path.join(tmpDir, 'file.txt'), 'content');
    const tool = createListDirectoryTool({ cwd: tmpDir });
    const out = text(await tool.execute('t1', {}));
    expect(out).toContain('subdir/');
    expect(out).toContain('file.txt');
  });

  it('defaults to workspace root', async () => {
    await fs.writeFile(path.join(tmpDir, 'root.txt'), 'x');
    const tool = createListDirectoryTool({ cwd: tmpDir });
    const out = text(await tool.execute('t2', {}));
    expect(out).toContain('root.txt');
  });

  it('throws for non-existent paths', async () => {
    const tool = createListDirectoryTool({ cwd: tmpDir });
    await expect(tool.execute('t3', { path: 'nope' })).rejects.toThrow('not found');
  });
});
