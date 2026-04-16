import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';

const DEFAULT_TIMEOUT_SEC = 30;
const MAX_TIMEOUT_SEC = 300;
const MAX_OUTPUT_CHARS = 20_000;

// Commands that should never be executed regardless of context
const BLOCKED_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/\s*$/,  // rm -rf /
  /\bshutdown\b/,
  /\breboot\b/,
  /\bmkfs\b/,
  /\bdd\s.*of=\/dev\//,
  /:\(\)\s*\{.*:\|:.*\}/,  // fork bomb variants
];

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
  const resolved = path.resolve(defaultCwd, workdir);
  if (sandboxed && !resolved.startsWith(defaultCwd)) {
    return defaultCwd;
  }
  return resolved;
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
  const { text, truncated } = truncateOutput(params.output);
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
  const shell = process.env.SHELL || '/bin/bash';
  const isWSL = release.toLowerCase().includes('microsoft') || release.toLowerCase().includes('wsl');

  const lines = [
    `Execute a shell command via ${path.basename(shell)} on ${platform}${isWSL ? ' (WSL)' : ''} ${arch}.`,
    `OS: ${platform} ${release}.`,
    `Working directory: ${cwd}.`,
    'Returns stdout + stderr (interleaved) and exit code.',
    'Use for file operations, git, package managers, build tools, and general system tasks.',
  ];

  if (platform === 'win32') {
    lines.push('Run executables directly — do NOT wrap in cmd /c or powershell -Command.');
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
        const child = spawn('bash', ['-c', command], {
          cwd,
          env: { ...process.env, LANG: 'en_US.UTF-8' },
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: timeoutSec * 1000,
        });

        let output = '';
        let timedOut = false;
        let killed = false;

        child.stdout.on('data', (chunk: Buffer) => {
          output += chunk.toString('utf-8');
        });

        child.stderr.on('data', (chunk: Buffer) => {
          output += chunk.toString('utf-8');
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
            child.kill('SIGTERM');
            resolve(textResult('[aborted before execution]'));
            return;
          }
          signal.addEventListener('abort', onAbort, { once: true });
        }

        child.on('close', (exitCode, sig) => {
          signal?.removeEventListener('abort', onAbort);

          if (sig === 'SIGTERM' && !killed) {
            timedOut = true;
          }

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
