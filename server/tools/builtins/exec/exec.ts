import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';

const DEFAULT_TIMEOUT_SEC = 30;
const MAX_TIMEOUT_SEC = 300;
const MAX_OUTPUT_CHARS = 20_000;

// Best-effort, defense-in-depth blocklist of obviously destructive commands.
//
// IMPORTANT: This is NOT an authoritative security boundary and is not
// exhaustive. It only catches a handful of well-known footguns and is trivially
// bypassable (encodings, aliases, indirection, env-var assembly, etc.). Real
// safety must come from workspace sandboxing / an allowlist of permitted
// commands, not from this pattern matching. Treat a miss here as expected.

// POSIX/bash-flavored dangerous commands.
const BLOCKED_PATTERNS_POSIX = [
  // rm with a force flag targeting root or a top-level/system path:
  //   rm -rf /, rm -fr /home/*, rm -r --force /usr, rm -rf /sbin, etc.
  /\brm\s+(?:-\S+\s+|--\S+\s+)*(?:-\S*f\S*|--force)(?:\s+(?:-\S+|--\S+))*\s+\/(?:bin|boot|dev|etc|home|lib|lib64|opt|proc|root|run|sbin|srv|sys|usr|var)?\b/i,
  // shutdown / reboot / halt / poweroff, with or without an absolute path.
  /(?:^|[\s;|&/])(?:shutdown|reboot|halt|poweroff|init\s+0|init\s+6)\b/i,
  /\bmkfs(?:\.\w+)?\b/i,
  // dd writing to a block/raw device.
  /\bdd\b.*\bof=\/dev\//i,
  // overwrite a block device directly: > /dev/sda
  />\s*\/dev\/(?:sd|hd|nvme|vd|mmcblk)\w*/i,
  // fork bomb variants: :(){ :|:& };:
  /:\s*\(\s*\)\s*\{[^}]*:\s*[|&][^}]*\}/,
];

// PowerShell-flavored dangerous commands (Windows spawns powershell.exe).
const BLOCKED_PATTERNS_WIN = [
  // Remove-Item / rm / del / rd recursive+force against a drive root or
  // system-ish path: Remove-Item -Recurse -Force C:\, rm -r -fo C:\Windows ...
  // Order of -Recurse/-Force is interchangeable, so require both to appear.
  /\b(?:Remove-Item|ri|rm|rmdir|rd|del|erase)\b(?=[^\n;|]*?(?:-Recurse|-r\b))(?=[^\n;|]*?(?:-Force|-fo\b))[^\n;|]*?(?:[A-Za-z]:\\?(?:\s|$)|\\\\|\$env:SystemRoot|\\Windows\b)/i,
  // Power-state cmdlets and the classic shutdown.exe / reboot tooling
  // (with or without an absolute path, e.g. C:\Windows\System32\shutdown.exe).
  /\b(?:Stop-Computer|Restart-Computer)\b/i,
  /(?:^|[\s;|&/\\])(?:shutdown|reboot)(?:\.exe)?\b/i,
  // Disk/volume destruction.
  /\b(?:Format-Volume|Clear-Disk|Remove-Partition|Initialize-Disk)\b/i,
  // Recursively delete a tree from the .NET API.
  /\[System\.IO\.Directory\]::Delete\(/i,
];

const BLOCKED_PATTERNS = process.platform === 'win32'
  ? BLOCKED_PATTERNS_WIN
  : BLOCKED_PATTERNS_POSIX;

function textResult(text: string): AgentToolResult<undefined> {
  return { content: [{ type: 'text', text }], details: undefined };
}

function isBlockedCommand(command: string): string | null {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return `Command blocked by security policy: matches ${pattern.source}`;
    }
  }
  return null;
}

function resolveWorkdir(
  workdir: string | undefined,
  defaultCwd: string,
  sandboxed: boolean,
): string {
  if (!workdir) return defaultCwd;
  const resolvedBase = path.resolve(defaultCwd);
  const resolvedTarget = path.resolve(resolvedBase, workdir);
  if (sandboxed && !(resolvedTarget.startsWith(resolvedBase + path.sep) || resolvedTarget === resolvedBase)) {
    return defaultCwd;
  }
  return resolvedTarget;
}

const UTF16_LE_BOM = [0xff, 0xfe];
const UTF16_BE_BOM = [0xfe, 0xff];

function decodeChunk(chunk: Buffer): string {
  if (chunk.length >= 2 && chunk[0] === UTF16_LE_BOM[0] && chunk[1] === UTF16_LE_BOM[1]) {
    return chunk.subarray(2).toString('utf16le');
  }
  if (chunk.length >= 2 && chunk[0] === UTF16_BE_BOM[0] && chunk[1] === UTF16_BE_BOM[1]) {
    return chunk.subarray(2).swap16().toString('utf16le');
  }
  return chunk.toString('utf-8');
}

// Strip C0 control chars except 0x09/0x0A/0x0D, and DEL (0x7F). Null bytes in
// particular are rejected by OpenAI/OpenRouter JSON payloads and can appear
// when a subprocess (notably WSL) emits UTF-16 text decoded as UTF-8.
const UNSAFE_CONTROL_CHARS = new RegExp(
  '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]',
  'g',
);
function stripUnsafeControlChars(text: string): string {
  return text.replace(UNSAFE_CONTROL_CHARS, '');
}

function truncateOutput(output: string): { text: string; truncated: boolean } {
  if (output.length <= MAX_OUTPUT_CHARS) {
    return { text: output, truncated: false };
  }
  // Keep the last MAX_OUTPUT_CHARS chars — tail is usually more useful
  const kept = output.slice(-MAX_OUTPUT_CHARS);
  return {
    text: `...(${output.length - MAX_OUTPUT_CHARS} chars truncated)\n${kept}`,
    truncated: true,
  };
}

function formatExecResult(params: {
  exitCode: number | null;
  output: string;
  durationMs: number;
  timedOut: boolean;
  killed: boolean;
}): string {
  const { text, truncated } = truncateOutput(stripUnsafeControlChars(params.output));
  const parts: string[] = [];

  if (params.timedOut) {
    parts.push(`[timed out after ${Math.round(params.durationMs / 1000)}s]`);
  } else if (params.killed) {
    parts.push('[killed]');
  }

  parts.push(`Exit code: ${params.exitCode ?? 'null'}`);

  if (text.trim()) {
    parts.push('');
    parts.push(text);
  } else {
    parts.push('(no output)');
  }

  if (truncated) {
    parts.push('\n(output truncated)');
  }

  return parts.join('\n');
}

export interface ExecToolContext {
  /** Default working directory for commands (agent's workspace path) */
  cwd: string;
  /** When true, workdir is constrained to stay within cwd. Defaults to false. */
  sandboxWorkdir?: boolean;
}

function buildExecDescription(cwd: string): string {
  const platform = os.platform();
  const arch = os.arch();
  const release = os.release();
  const isWin = platform === 'win32';
  const shell = isWin
    ? 'powershell.exe'
    : (process.env.SHELL || '/bin/bash');
  const isWSL = release.toLowerCase().includes('microsoft') || release.toLowerCase().includes('wsl');

  const lines = [
    `Execute a shell command via ${path.basename(shell)} on ${platform}${isWSL ? ' (WSL)' : ''} ${arch}.`,
    `OS: ${platform} ${release}.`,
    `Working directory: ${cwd}.`,
    'Returns stdout + stderr (interleaved) and exit code.',
    'Use for file operations, git, package managers, build tools, and general system tasks.',
  ];

  if (isWin) {
    lines.push(
      'Shell is Windows PowerShell 5.1 — use PowerShell syntax (Get-ChildItem, Test-Path, $env:NAME). `&&`/`||` chain operators are not available; use `;` or `if ($?) { ... }` instead. Avoid `2>&1` on native exes (it wraps stderr lines in ErrorRecord and flips $? to false).',
    );
  }

  return lines.join(' ');
}

export function createExecTool(ctx: ExecToolContext): AgentTool<TSchema> {
  return {
    name: 'exec',
    description: buildExecDescription(ctx.cwd),
    label: 'Shell',
    parameters: Type.Object({
      command: Type.String({ description: 'Shell command to execute' }),
      workdir: Type.Optional(
        Type.String({ description: 'Working directory relative to workspace (defaults to workspace root)' }),
      ),
      timeout: Type.Optional(
        Type.Number({ description: `Timeout in seconds (default: ${DEFAULT_TIMEOUT_SEC}, max: ${MAX_TIMEOUT_SEC})` }),
      ),
    }),
    execute: async (_toolCallId, params: any, signal) => {
      const command = params.command as string;
      if (!command || !command.trim()) {
        throw new Error('No command provided');
      }

      // Security: check blocked patterns
      const blocked = isBlockedCommand(command);
      if (blocked) {
        throw new Error(blocked);
      }

      const cwd = resolveWorkdir(params.workdir, ctx.cwd, ctx.sandboxWorkdir ?? false);
      const timeoutSec = Math.min(
        Math.max(1, params.timeout ?? DEFAULT_TIMEOUT_SEC),
        MAX_TIMEOUT_SEC,
      );

      const startTime = Date.now();

      return new Promise<AgentToolResult<undefined>>((resolve) => {
        const isWin = process.platform === 'win32';
        const child = isWin
          ? spawn(
              'powershell.exe',
              ['-NoProfile', '-NonInteractive', '-Command', command],
              {
                cwd,
                env: { ...process.env },
                stdio: ['ignore', 'pipe', 'pipe'],
              },
            )
          : spawn('bash', ['-c', command], {
              cwd,
              env: { ...process.env, LANG: 'en_US.UTF-8' },
              stdio: ['ignore', 'pipe', 'pipe'],
            });

        let output = '';
        let timedOut = false;
        let killed = false;

        // Track timeout deterministically rather than inferring it from the
        // exit signal: an externally-sent SIGTERM must NOT be mislabeled as a
        // timeout, and the abort path is reported separately via `killed`.
        const timeoutTimer = setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
          setTimeout(() => {
            if (!child.killed) child.kill('SIGKILL');
          }, 2000);
        }, timeoutSec * 1000);

        child.stdout.on('data', (chunk: Buffer) => {
          output += decodeChunk(chunk);
        });

        child.stderr.on('data', (chunk: Buffer) => {
          output += decodeChunk(chunk);
        });

        // Respect abort signal from the agent runtime
        const onAbort = () => {
          killed = true;
          child.kill('SIGTERM');
          setTimeout(() => {
            if (!child.killed) child.kill('SIGKILL');
          }, 2000);
        };

        if (signal) {
          if (signal.aborted) {
            clearTimeout(timeoutTimer);
            child.kill('SIGTERM');
            resolve(textResult('[aborted before execution]'));
            return;
          }
          signal.addEventListener('abort', onAbort, { once: true });
        }

        child.on('close', (exitCode, _sig) => {
          // Clear the timer first so a SIGKILL fallback scheduled by an
          // abort/timeout can't fire late and flip flags after we've resolved.
          clearTimeout(timeoutTimer);
          signal?.removeEventListener('abort', onAbort);

          // `timedOut` is set only by the timeout timer above; an externally
          // sent SIGTERM (abort) surfaces as `killed`, not as a timeout.
          const durationMs = Date.now() - startTime;
          resolve(
            textResult(
              formatExecResult({
                exitCode,
                output,
                durationMs,
                timedOut,
                killed,
              }),
            ),
          );
        });

        child.on('error', (err) => {
          clearTimeout(timeoutTimer);
          signal?.removeEventListener('abort', onAbort);
          const durationMs = Date.now() - startTime;
          resolve(
            textResult(
              formatExecResult({
                exitCode: 1,
                output: `spawn error: ${err.message}\n${output}`,
                durationMs,
                timedOut: false,
                killed: false,
              }),
            ),
          );
        });
      });
    },
  };
}
