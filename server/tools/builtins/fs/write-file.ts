import fs from 'fs/promises';
import path from 'path';
import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { FsToolContext } from './read-file';

function textResult(text: string): AgentToolResult<undefined> {
  return { content: [{ type: 'text', text }], details: undefined };
}

function resolvePath(filePath: string, ctx: FsToolContext): string {
  const resolved = path.resolve(ctx.cwd, filePath);
  if (ctx.sandboxWorkdir && !resolved.startsWith(ctx.cwd)) {
    throw new Error(`Path "${filePath}" is outside the workspace. Access denied.`);
  }
  return resolved;
}

export function createWriteFileTool(ctx: FsToolContext): AgentTool<TSchema> {
  return {
    name: 'write_file',
    description:
      'Write content to a file. Creates the file and any parent directories if they don\'t exist. ' +
      'Overwrites the file if it already exists. Use edit_file for targeted changes to existing files.',
    label: 'Write File',
    parameters: Type.Object({
      path: Type.String({ description: 'File path relative to workspace' }),
      content: Type.String({ description: 'Full file content to write' }),
    }),
    execute: async (_toolCallId, params: any) => {
      const filePath = params.path as string;
      const content = params.content as string;
      if (!filePath?.trim()) throw new Error('No file path provided');
      if (content === undefined || content === null) throw new Error('No content provided');

      const resolved = resolvePath(filePath, ctx);

      // Create parent directories
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, content, 'utf-8');

      const lines = content.split('\n').length;
      const bytes = Buffer.byteLength(content, 'utf-8');
      return textResult(`Wrote ${lines} lines (${bytes} bytes) to ${filePath}`);
    },
  };
}
