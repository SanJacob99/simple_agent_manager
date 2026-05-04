import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, normalize, relative } from 'node:path';
import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';

function textResult(text: string): AgentToolResult<null> {
  return { content: [{ type: 'text', text }], details: null };
}

function isAllowedPath(repoRoot: string, requestedPath: string): boolean {
  // Reject any traversal segments first.
  if (requestedPath.includes('..') || requestedPath.startsWith('/') || requestedPath.startsWith('\\')) return false;
  const normalised = normalize(requestedPath).replace(/\\/g, '/');
  if (normalised.startsWith('..') || normalised.includes('/../') || normalised.endsWith('/..')) return false;
  const allowed =
    normalised === 'README.md' ||
    normalised === 'AGENTS.md' ||
    (normalised.startsWith('docs/concepts/') && normalised.endsWith('.md'));
  if (!allowed) return false;
  const abs = join(repoRoot, normalised);
  const rel = relative(repoRoot, abs);
  return !rel.startsWith('..') && existsSync(abs);
}

export function buildDocTools(repoRoot: string): AgentTool[] {
  const listDocs: AgentTool = {
    name: 'list_docs',
    label: 'List Docs',
    description: 'List documentation files SAMAgent can read. Call once per session before reading specific docs.',
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: async (_id: string, _params: any, _signal?: AbortSignal) => {
      const lines: string[] = [];
      const manifestPath = join(repoRoot, 'docs/concepts/_manifest.json');
      if (existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
          const concepts = (manifest.concepts ?? {}) as Record<string, { doc: string }>;
          for (const [key, entry] of Object.entries(concepts)) {
            lines.push(`docs/concepts/${entry.doc} — ${key}`);
          }
        } catch {
          // fall through to directory scan
        }
      }
      const conceptsDir = join(repoRoot, 'docs/concepts');
      if (existsSync(conceptsDir)) {
        const files = readdirSync(conceptsDir).filter((f) => f.endsWith('.md') && !f.startsWith('_'));
        for (const f of files) {
          const line = `docs/concepts/${f} — concept`;
          if (!lines.some((l) => l.startsWith(`docs/concepts/${f}`))) lines.push(line);
        }
      }
      lines.push('README.md — project overview');
      lines.push('AGENTS.md — agent system overview');
      return textResult(lines.join('\n'));
    },
  };

  const readDoc: AgentTool = {
    name: 'read_doc',
    label: 'Read Doc',
    description: 'Read one allowlisted markdown file. Allowed: docs/concepts/*.md, README.md, AGENTS.md.',
    parameters: Type.Object(
      { path: Type.String({ description: 'Relative path to the doc file, e.g. docs/concepts/agent-node.md' }) },
      { additionalProperties: false },
    ),
    execute: async (_id: string, params: any, _signal?: AbortSignal) => {
      const path = String(params?.path ?? '');
      if (!isAllowedPath(repoRoot, path)) {
        return textResult(`Path '${path}' is not allowed. Allowed: docs/concepts/*.md, README.md, AGENTS.md.`);
      }
      const content = readFileSync(join(repoRoot, path), 'utf-8');
      return textResult(content);
    },
  };

  const searchDocs: AgentTool = {
    name: 'search_docs',
    label: 'Search Docs',
    description: 'Search for a literal substring (case-insensitive) across allowlisted docs. Returns up to 30 hits.',
    parameters: Type.Object(
      { query: Type.String({ description: 'Substring to search for (case-insensitive, min 2 chars)' }) },
      { additionalProperties: false },
    ),
    execute: async (_id: string, params: any, _signal?: AbortSignal) => {
      const query = String(params?.query ?? '').toLowerCase();
      if (query.length < 2) return textResult('query must be at least 2 characters');

      const candidates: string[] = ['README.md', 'AGENTS.md'];
      const conceptsDir = join(repoRoot, 'docs/concepts');
      if (existsSync(conceptsDir)) {
        for (const f of readdirSync(conceptsDir)) {
          if (f.endsWith('.md') && !f.startsWith('_')) candidates.push(`docs/concepts/${f}`);
        }
      }
      const hits: string[] = [];
      for (const rel of candidates) {
        const abs = join(repoRoot, rel);
        if (!existsSync(abs)) continue;
        const lines = readFileSync(abs, 'utf-8').split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(query)) {
            hits.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
            if (hits.length >= 30) break;
          }
        }
        if (hits.length >= 30) break;
      }
      return textResult(hits.length === 0 ? `no matches for '${query}'` : hits.join('\n'));
    },
  };

  return [listDocs, readDoc, searchDocs];
}
