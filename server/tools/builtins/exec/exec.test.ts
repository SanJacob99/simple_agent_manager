import { describe, expect, it } from 'vitest';
import { createExecTool } from './exec';
import os from 'os';
import path from 'path';

const cwd = os.tmpdir();
const tool = createExecTool({ cwd });
const isWin = process.platform === 'win32';

function text(result: { content: { type: string; text?: string }[] }): string {
  return (result.content[0] as { text: string }).text;
}

describe('exec tool', () => {
  it('runs a simple command and returns output', async () => {
    const result = await tool.execute('t1', { command: 'echo hello' });
    expect(text(result)).toContain('hello');
    expect(text(result)).toContain('Exit code: 0');
  }, 15000);

  it.skipIf(isWin)('captures stderr (bash redirect)', async () => {
    const result = await tool.execute('t2', { command: 'echo err >&2' });
    expect(text(result)).toContain('err');
  });

  it.runIf(isWin)('captures stderr (PowerShell Write-Error)', async () => {
    const result = await tool.execute('t2-ps', {
      command: "[Console]::Error.WriteLine('err')",
    });
    expect(text(result)).toContain('err');
  });

  it('reports non-zero exit code', async () => {
    const result = await tool.execute('t3', { command: 'exit 42' });
    expect(text(result)).toContain('Exit code: 42');
  });

  it('blocks dangerous commands', async () => {
    await expect(tool.execute('t4', { command: 'shutdown' })).rejects.toThrow('blocked');
  });

  it('blocks fork bombs', async () => {
    await expect(tool.execute('t5', { command: ':(){ :|:& };:' })).rejects.toThrow('blocked');
  });

  it('respects timeout', async () => {
    // `sleep` works in bash and as a PowerShell alias for Start-Sleep.
    const result = await tool.execute('t6', { command: 'sleep 60', timeout: 1 });
    expect(text(result)).toMatch(/timed out|Exit code/);
  }, 10_000);

  it('uses workdir relative to cwd', async () => {
    // `pwd` works in bash and as a PowerShell alias for Get-Location.
    const result = await tool.execute('t7', { command: 'pwd', workdir: '.' });
    const output = text(result);
    expect(output).toContain(path.resolve(cwd));
  });

  it('allows workdir outside cwd when sandbox is off (default)', async () => {
    const outside = isWin ? process.env.TEMP || 'C:\\' : '/tmp';
    const result = await tool.execute('t8', { command: 'pwd', workdir: outside });
    expect(text(result)).toContain(outside);
  });

  it('prevents workdir escape when sandbox is enabled', async () => {
    const sandboxed = createExecTool({ cwd, sandboxWorkdir: true });
    const result = await sandboxed.execute('t8b', { command: 'pwd', workdir: '../../../../../../' });
    const output = text(result);
    // Should fall back to cwd, not escape
    expect(output).toContain(path.resolve(cwd));
  });

  it('rejects empty commands', async () => {
    await expect(tool.execute('t9', { command: '' })).rejects.toThrow('No command');
  });

  it.skipIf(isWin)('strips null bytes from output (WSL UTF-16 stderr safety)', async () => {
    // Emit "wsl\0:\0 \0" style garbage via printf \x00 — if the harness passes
    // this through to a provider, OpenAI/OpenRouter rejects the payload.
    const result = await tool.execute('t10', {
      command: "printf 'a\\0b\\0c' && echo done",
    });
    const output = text(result);
    expect(output).not.toMatch(/\x00/);
    expect(output).toContain('done');
  });
});
