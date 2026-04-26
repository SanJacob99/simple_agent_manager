import fs from 'fs/promises';
import path from 'path';
import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { FsToolContext } from './read-file';

function textResult(text: string): AgentToolResult<undefined> {
  return { content: [{ type: 'text', text }], details: undefined };
}

function resolvePath(dirPath: string, ctx: FsToolContext): string {
  const resolvedBase = path.resolve(ctx.cwd);
  const resolved = path.resolve(resolvedBase, dirPath);
  if (ctx.sandboxWorkdir && !resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
    throw new Error(`Path "${dirPath}" is outside the workspace. Access denied.`);
  }
  return resolved;
}

export function createListDirectoryTool(ctx: FsToolContext): AgentTool<TSchema> {
  return {
    name: 'list_directory',
    description:
      'List files and directories at a given path. Shows type (file/dir), size, ' +
      'and name for each entry. Defaults to the workspace root.',
    label: 'List Directory',
    parameters: Type.Object({
      path: Type.Optional(
        Type.String({ description: 'Directory path relative to workspace (default: workspace root)' }),
      ),
    }),
    execute: async (_toolCallId, params: any) => {
      const dirPath = (params.path as string) || '.';
      const resolved = resolvePath(dirPath, ctx);

      let stat;
      try {
        stat = await fs.stat(resolved);
      } catch {
        throw new Error(`Path not found: ${dirPath}`);
      }

      if (!stat.isDirectory()) {
        throw new Error(`"${dirPath}" is a file, not a directory. Use read_file instead.`);
      }

      const entries = await fs.readdir(resolved, { withFileTypes: true });
      if (entries.length === 0) {
        return textResult(`${dirPath}: (empty directory)`);
      }

      // Sort: directories first, then files, alphabetical within each
      const sorted = entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

      const lines: string[] = [];
      for (const entry of sorted) {
        const entryPath = path.join(resolved, entry.name);
        if (entry.isDirectory()) {
          lines.push(`📁 ${entry.name}/`);
        } else {
          try {
            const s = await fs.stat(entryPath);
            const size = s.size < 1024
              ? `${s.size} B`
              : s.size < 1024 * 1024
                ? `${(s.size / 1024).toFixed(1)} KB`
                : `${(s.size / (1024 * 1024)).toFixed(1)} MB`;
            lines.push(`   ${entry.name} (${size})`);
          } catch {
            lines.push(`   ${entry.name}`);
          }
        }
      }

      return textResult(lines.join('\n'));
    },
  };
}
