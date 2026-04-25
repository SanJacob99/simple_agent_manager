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
  // SECURITY: Prevent path traversal via partial prefix matching
  if (ctx.sandboxWorkdir && !(resolved.startsWith(ctx.cwd + path.sep) || resolved === ctx.cwd)) {
    throw new Error(`Path "${filePath}" is outside the workspace. Access denied.`);
  }
  return resolved;
}

export function createEditFileTool(ctx: FsToolContext): AgentTool<TSchema> {
  return {
    name: 'edit_file',
    description:
      'Edit a file by replacing an exact string match. The old_string must match exactly ' +
      '(including whitespace and indentation). Use read_file first to see the current content. ' +
      'For creating new files, use write_file instead.',
    label: 'Edit File',
    parameters: Type.Object({
      path: Type.String({ description: 'File path relative to workspace' }),
      old_string: Type.String({ description: 'Exact text to find and replace (must be unique in the file)' }),
      new_string: Type.String({ description: 'Replacement text' }),
    }),
    execute: async (_toolCallId, params: any) => {
      const filePath = params.path as string;
      const oldStr = params.old_string as string;
      const newStr = params.new_string as string;

      if (!filePath?.trim()) throw new Error('No file path provided');
      if (oldStr === undefined || oldStr === null) throw new Error('No old_string provided');
      if (newStr === undefined || newStr === null) throw new Error('No new_string provided');
      if (oldStr === newStr) throw new Error('old_string and new_string are identical — no change needed');

      const resolved = resolvePath(filePath, ctx);

      let content: string;
      try {
        content = await fs.readFile(resolved, 'utf-8');
      } catch {
        throw new Error(`File not found: ${filePath}`);
      }

      // Check for exact match
      const idx = content.indexOf(oldStr);
      if (idx === -1) {
        // Help the model debug: show nearby lines
        const lines = content.split('\n');
        const firstWord = oldStr.trim().split(/\s+/)[0];
        const candidates = lines
          .map((line, i) => ({ line: i + 1, text: line }))
          .filter((l) => l.text.includes(firstWord))
          .slice(0, 3);

        const hint = candidates.length > 0
          ? `\nPossible near-matches (by first word "${firstWord}"):\n` +
            candidates.map((c) => `  line ${c.line}: ${c.text.slice(0, 120)}`).join('\n')
          : '';

        throw new Error(
          `old_string not found in ${filePath}. ` +
          `Make sure it matches exactly, including whitespace and indentation.${hint}`,
        );
      }

      // Check uniqueness
      const secondIdx = content.indexOf(oldStr, idx + 1);
      if (secondIdx !== -1) {
        const line1 = content.slice(0, idx).split('\n').length;
        const line2 = content.slice(0, secondIdx).split('\n').length;
        throw new Error(
          `old_string appears multiple times in ${filePath} (at lines ${line1} and ${line2}). ` +
          `Include more surrounding context to make the match unique.`,
        );
      }

      // Apply the edit
      const updated = content.slice(0, idx) + newStr + content.slice(idx + oldStr.length);
      await fs.writeFile(resolved, updated, 'utf-8');

      // Report what changed
      const lineStart = content.slice(0, idx).split('\n').length;
      const oldLines = oldStr.split('\n').length;
      const newLines = newStr.split('\n').length;
      return textResult(
        `Edited ${filePath}: replaced ${oldLines} line${oldLines !== 1 ? 's' : ''} ` +
        `with ${newLines} line${newLines !== 1 ? 's' : ''} at line ${lineStart}.`,
      );
    },
  };
}
