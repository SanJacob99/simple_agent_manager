import fs from 'fs/promises';
import path from 'path';
import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';

const MAX_READ_BYTES = 64 * 1024; // 64 KB

function textResult(text: string): AgentToolResult<undefined> {
  return { content: [{ type: 'text', text }], details: undefined };
}

export interface FsToolContext {
  cwd: string;
  sandboxWorkdir?: boolean;
}

function resolvePath(filePath: string, ctx: FsToolContext): string {
  const resolved = path.resolve(ctx.cwd, filePath);
  // SECURITY: Prevent path traversal via partial prefix matching
  if (ctx.sandboxWorkdir && !(resolved.startsWith(ctx.cwd + path.sep) || resolved === ctx.cwd)) {
    throw new Error(`Path "${filePath}" is outside the workspace. Access denied.`);
  }
  return resolved;
}

export function createReadFileTool(ctx: FsToolContext): AgentTool<TSchema> {
  return {
    name: 'read_file',
    description:
      'Read the contents of a file. Returns the text content with line numbers. ' +
      'Use offset and limit for large files to read specific line ranges.',
    label: 'Read File',
    parameters: Type.Object({
      path: Type.String({ description: 'File path relative to workspace' }),
      offset: Type.Optional(
        Type.Number({ description: 'Start reading from this line number (1-based, default: 1)' }),
      ),
      limit: Type.Optional(
        Type.Number({ description: 'Max number of lines to return (default: all)' }),
      ),
    }),
    execute: async (_toolCallId, params: any) => {
      const filePath = params.path as string;
      if (!filePath?.trim()) throw new Error('No file path provided');

      const resolved = resolvePath(filePath, ctx);

      let stat;
      try {
        stat = await fs.stat(resolved);
      } catch {
        throw new Error(`File not found: ${filePath}`);
      }

      if (stat.isDirectory()) {
        throw new Error(`"${filePath}" is a directory, not a file. Use list_directory instead.`);
      }

      if (stat.size > MAX_READ_BYTES && !params.offset && !params.limit) {
        // File is large — read first chunk and suggest pagination
        const content = await fs.readFile(resolved, 'utf-8');
        const lines = content.split('\n');
        const pageLines = lines.slice(0, 500);
        const numbered = pageLines.map((line, i) => `${i + 1}\t${line}`).join('\n');
        return textResult(
          `${numbered}\n\n` +
          `[File has ${lines.length} lines, ${stat.size} bytes. ` +
          `Showing first 500 lines. Use offset/limit to read more.]`,
        );
      }

      const content = await fs.readFile(resolved, 'utf-8');
      const lines = content.split('\n');

      const offset = Math.max(1, params.offset ?? 1);
      const startIdx = offset - 1;
      const limit = params.limit ?? lines.length;
      const sliced = lines.slice(startIdx, startIdx + limit);
      const numbered = sliced.map((line, i) => `${startIdx + i + 1}\t${line}`).join('\n');

      const truncated = startIdx + limit < lines.length;
      const suffix = truncated
        ? `\n\n[Showing lines ${offset}–${startIdx + sliced.length} of ${lines.length}. ` +
          `Use offset=${startIdx + sliced.length + 1} to continue.]`
        : '';

      return textResult(numbered + suffix);
    },
  };
}
