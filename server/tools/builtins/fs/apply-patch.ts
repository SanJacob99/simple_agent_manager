import fs from 'fs/promises';
import path from 'path';
import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { FsToolContext } from './read-file';

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

const BEGIN_PATCH = '*** Begin Patch';
const END_PATCH = '*** End Patch';
const ADD_FILE = '*** Add File: ';
const DELETE_FILE = '*** Delete File: ';
const UPDATE_FILE = '*** Update File: ';
const EOF_MARKER = '*** End of File';
const CONTEXT_MARKER = '@@ ';
const EMPTY_CONTEXT = '@@';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AddHunk = { kind: 'add'; path: string; contents: string };
type DeleteHunk = { kind: 'delete'; path: string };
type UpdateChunk = {
  context?: string;
  oldLines: string[];
  newLines: string[];
  isEof: boolean;
};
type UpdateHunk = { kind: 'update'; path: string; chunks: UpdateChunk[] };
type Hunk = AddHunk | DeleteHunk | UpdateHunk;

interface PatchSummary {
  added: string[];
  modified: string[];
  deleted: string[];
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function parsePatch(input: string): Hunk[] {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Patch input is empty.');

  const lines = trimmed.split(/\r?\n/);
  if (lines[0]?.trim() !== BEGIN_PATCH) {
    throw new Error(`First line must be "${BEGIN_PATCH}".`);
  }
  if (lines[lines.length - 1]?.trim() !== END_PATCH) {
    throw new Error(`Last line must be "${END_PATCH}".`);
  }

  const body = lines.slice(1, lines.length - 1);
  const hunks: Hunk[] = [];
  let i = 0;

  while (i < body.length) {
    const line = body[i].trim();

    if (line.startsWith(ADD_FILE)) {
      const filePath = line.slice(ADD_FILE.length);
      let contents = '';
      i++;
      while (i < body.length && body[i].startsWith('+')) {
        contents += body[i].slice(1) + '\n';
        i++;
      }
      hunks.push({ kind: 'add', path: filePath, contents });
      continue;
    }

    if (line.startsWith(DELETE_FILE)) {
      hunks.push({ kind: 'delete', path: line.slice(DELETE_FILE.length) });
      i++;
      continue;
    }

    if (line.startsWith(UPDATE_FILE)) {
      const filePath = line.slice(UPDATE_FILE.length);
      i++;
      const chunks: UpdateChunk[] = [];

      while (i < body.length) {
        // Skip blank lines between chunks
        if (body[i].trim() === '') { i++; continue; }
        // Stop at next file marker
        if (body[i].startsWith('***')) break;

        // Parse one chunk
        let context: string | undefined;
        if (body[i] === EMPTY_CONTEXT) {
          i++;
        } else if (body[i].startsWith(CONTEXT_MARKER)) {
          context = body[i].slice(CONTEXT_MARKER.length);
          i++;
        }

        const oldLines: string[] = [];
        const newLines: string[] = [];
        let isEof = false;

        while (i < body.length) {
          const cl = body[i];
          if (cl === EOF_MARKER) { isEof = true; i++; break; }
          if (cl.startsWith('***') || cl === EMPTY_CONTEXT || cl.startsWith(CONTEXT_MARKER)) break;

          const marker = cl[0];
          if (marker === '-') {
            oldLines.push(cl.slice(1));
          } else if (marker === '+') {
            newLines.push(cl.slice(1));
          } else if (marker === ' ') {
            oldLines.push(cl.slice(1));
            newLines.push(cl.slice(1));
          } else {
            // Treat unmarked lines as context
            oldLines.push(cl);
            newLines.push(cl);
          }
          i++;
        }

        if (oldLines.length > 0 || newLines.length > 0) {
          chunks.push({ context, oldLines, newLines, isEof });
        }
      }

      if (chunks.length === 0) {
        throw new Error(`Update hunk for "${filePath}" contains no changes.`);
      }
      hunks.push({ kind: 'update', path: filePath, chunks });
      continue;
    }

    // Skip unrecognized lines
    i++;
  }

  return hunks;
}

// ---------------------------------------------------------------------------
// Hunk application (line-level search and replace)
// ---------------------------------------------------------------------------

function seekLines(
  lines: string[],
  pattern: string[],
  start: number,
  eof: boolean,
): number | null {
  if (pattern.length === 0) return start;
  if (pattern.length > lines.length) return null;

  const max = lines.length - pattern.length;
  const searchStart = eof ? max : start;
  if (searchStart > max) return null;

  // Exact match
  for (let i = searchStart; i <= max; i++) {
    if (pattern.every((p, j) => lines[i + j] === p)) return i;
  }
  // Trimmed fallback
  for (let i = searchStart; i <= max; i++) {
    if (pattern.every((p, j) => lines[i + j].trimEnd() === p.trimEnd())) return i;
  }
  return null;
}

function applyUpdateChunks(filePath: string, content: string, chunks: UpdateChunk[]): string {
  const lines = content.split('\n');
  // Remove trailing empty line from split
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const replacements: Array<[number, number, string[]]> = [];
  let cursor = 0;

  for (const chunk of chunks) {
    if (chunk.context) {
      const ctxIdx = seekLines(lines, [chunk.context], cursor, false);
      if (ctxIdx === null) {
        throw new Error(`Context "${chunk.context}" not found in ${filePath}`);
      }
      cursor = ctxIdx + 1;
    }

    if (chunk.oldLines.length === 0) {
      // Insert-only at end
      const insertAt = lines.length > 0 && lines[lines.length - 1] === ''
        ? lines.length - 1
        : lines.length;
      replacements.push([insertAt, 0, chunk.newLines]);
      continue;
    }

    const found = seekLines(lines, chunk.oldLines, cursor, chunk.isEof);
    if (found === null) {
      throw new Error(
        `Failed to find expected lines in ${filePath}:\n${chunk.oldLines.join('\n')}`,
      );
    }

    replacements.push([found, chunk.oldLines.length, chunk.newLines]);
    cursor = found + chunk.oldLines.length;
  }

  // Apply in reverse order to preserve indices
  replacements.sort((a, b) => a[0] - b[0]);
  const result = [...lines];
  for (const [start, oldLen, newLines] of [...replacements].reverse()) {
    result.splice(start, oldLen, ...newLines);
  }

  // Ensure trailing newline
  if (result.length === 0 || result[result.length - 1] !== '') {
    result.push('');
  }
  return result.join('\n');
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

function resolvePath(filePath: string, ctx: FsToolContext): string {
  const resolved = path.resolve(ctx.cwd, filePath);
  if (ctx.sandboxWorkdir && !resolved.startsWith(ctx.cwd)) {
    throw new Error(`Path "${filePath}" is outside the workspace. Access denied.`);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

function textResult(text: string): AgentToolResult<undefined> {
  return { content: [{ type: 'text', text }], details: undefined };
}

export function createApplyPatchTool(ctx: FsToolContext): AgentTool<TSchema> {
  return {
    name: 'apply_patch',
    description:
      'Apply file changes using a structured patch format. Supports adding, updating, and deleting files in one operation. ' +
      'Ideal for multi-file or multi-hunk edits where edit_file would be brittle. ' +
      'Input must include *** Begin Patch and *** End Patch markers.',
    label: 'Apply Patch',
    parameters: Type.Object({
      input: Type.String({
        description: 'Full patch contents including *** Begin Patch and *** End Patch.',
      }),
    }),
    execute: async (_toolCallId, params: any) => {
      const input = params.input as string;
      if (!input?.trim()) throw new Error('No patch input provided');

      const hunks = parsePatch(input);
      if (hunks.length === 0) throw new Error('Patch contains no file operations.');

      const summary: PatchSummary = { added: [], modified: [], deleted: [] };

      for (const hunk of hunks) {
        if (hunk.kind === 'add') {
          const resolved = resolvePath(hunk.path, ctx);
          await fs.mkdir(path.dirname(resolved), { recursive: true });
          await fs.writeFile(resolved, hunk.contents, 'utf-8');
          summary.added.push(hunk.path);
          continue;
        }

        if (hunk.kind === 'delete') {
          const resolved = resolvePath(hunk.path, ctx);
          await fs.rm(resolved);
          summary.deleted.push(hunk.path);
          continue;
        }

        // Update
        const resolved = resolvePath(hunk.path, ctx);
        const content = await fs.readFile(resolved, 'utf-8');
        const updated = applyUpdateChunks(hunk.path, content, hunk.chunks);
        await fs.writeFile(resolved, updated, 'utf-8');
        summary.modified.push(hunk.path);
      }

      const lines = ['Patch applied successfully:'];
      for (const f of summary.added) lines.push(`  A ${f}`);
      for (const f of summary.modified) lines.push(`  M ${f}`);
      for (const f of summary.deleted) lines.push(`  D ${f}`);
      return textResult(lines.join('\n'));
    },
  };
}
