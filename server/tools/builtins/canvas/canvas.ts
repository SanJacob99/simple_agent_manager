import fs from 'fs/promises';
import path from 'path';
import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';

export interface CanvasContext {
  /** Workspace directory where the `canvas/` subfolder is created. */
  cwd: string;
  /** When true, any asset path must stay within cwd. Defaults to true. */
  sandboxWorkdir?: boolean;
  /** Public base URL used to build the link returned to the chat. */
  publicBaseUrl?: string;
  /** Agent id — used to scope canvas URLs to a specific agent workspace. */
  agentId?: string;
}

const CANVAS_DIRNAME = 'canvas';
const MAX_ASSETS = 20;
const MAX_ASSET_BYTES = 2 * 1024 * 1024;

const ASSET_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const INDEX_FILENAME = 'index.html';
const META_FILENAME = 'canvas.json';

function slugifyId(raw: string | undefined): string {
  const candidate = (raw ?? '').trim().toLowerCase();
  const cleaned = candidate.replace(/[^a-z0-9-_]/g, '-').replace(/^-+|-+$/g, '');
  if (cleaned.length >= 3) return cleaned.slice(0, 64);
  const random = Math.random().toString(36).slice(2, 8);
  return `canvas-${Date.now().toString(36)}-${random}`;
}

function assetExtension(name: string): string {
  return path.extname(name).toLowerCase();
}

function isSafeAssetPath(assetPath: string): boolean {
  if (!assetPath || assetPath.startsWith('/') || assetPath.startsWith('\\')) return false;
  if (assetPath.includes('\0')) return false;
  const normalized = path.posix.normalize(assetPath.replace(/\\/g, '/'));
  if (normalized.startsWith('..') || normalized.includes('/../')) return false;
  return true;
}

function buildIndexHtml(params: {
  title: string;
  html: string;
  css?: string;
  js?: string;
}): string {
  const { title, html, css, js } = params;
  const styleBlock = css && css.trim().length > 0
    ? `    <style>\n${css}\n    </style>\n`
    : '';
  const scriptBlock = js && js.trim().length > 0
    ? `  <script>\n${js}\n  </script>\n`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
${styleBlock}  </head>
  <body>
${html}
${scriptBlock}  </body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolveCanvasDir(ctx: CanvasContext): string {
  return path.resolve(ctx.cwd, CANVAS_DIRNAME);
}

function resolveCanvasPath(ctx: CanvasContext, canvasId: string, relative?: string): string {
  const base = path.join(resolveCanvasDir(ctx), canvasId);
  const target = relative ? path.resolve(base, relative) : base;
  if (ctx.sandboxWorkdir !== false && !target.startsWith(base)) {
    throw new Error(`Path "${relative}" is outside the canvas folder. Access denied.`);
  }
  return target;
}

function canvasUrl(ctx: CanvasContext, canvasId: string, file = INDEX_FILENAME): string {
  const base = (ctx.publicBaseUrl ?? '').replace(/\/$/, '');
  const agentSegment = ctx.agentId ? `/${encodeURIComponent(ctx.agentId)}` : '';
  return `${base}/${CANVAS_DIRNAME}${agentSegment}/${encodeURIComponent(canvasId)}/${file}`;
}

async function writeAssets(
  dir: string,
  assets: Array<{ path: string; content: string; encoding?: 'utf-8' | 'base64' }>,
): Promise<string[]> {
  const written: string[] = [];
  for (const asset of assets) {
    if (!isSafeAssetPath(asset.path)) {
      throw new Error(`Invalid asset path: ${asset.path}`);
    }
    const ext = assetExtension(asset.path);
    if (!(ext in ASSET_MIME)) {
      throw new Error(`Unsupported asset extension: ${ext || '(none)'}`);
    }
    const target = path.resolve(dir, asset.path);
    if (!target.startsWith(dir)) {
      throw new Error(`Asset "${asset.path}" escapes the canvas folder.`);
    }
    const buffer = asset.encoding === 'base64'
      ? Buffer.from(asset.content, 'base64')
      : Buffer.from(asset.content, 'utf-8');
    if (buffer.byteLength > MAX_ASSET_BYTES) {
      throw new Error(
        `Asset "${asset.path}" exceeds ${MAX_ASSET_BYTES} bytes (got ${buffer.byteLength}).`,
      );
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, buffer);
    written.push(asset.path);
  }
  return written;
}

interface CanvasDetails {
  canvasId: string;
  url: string;
  files: string[];
}

export function createCanvasTool(ctx: CanvasContext): AgentTool<TSchema> {
  return {
    name: 'canvas',
    description:
      'Create an interactive HTML/CSS/JS mini-app and serve it over HTTP so the user can open it ' +
      'in a browser. Use this when the user wants something visual and interactive that is not a ' +
      'static image — for example a small game, a chart, a form, a simulation, or a UI prototype. ' +
      'Prefer plain HTML/CSS/JS with no external build step; CDN scripts are allowed but keep the ' +
      "output self-contained. Returns a URL to open the canvas.",
    label: 'Canvas',
    parameters: Type.Object({
      id: Type.Optional(
        Type.String({
          description:
            'Optional slug for the canvas folder. Reusing the same id overwrites the previous version.',
        }),
      ),
      title: Type.Optional(
        Type.String({ description: 'Page title shown in the browser tab. Defaults to the id.' }),
      ),
      html: Type.String({
        description:
          'Body HTML. Do not include <html>, <head>, or <body> tags — they are wrapped for you. ' +
          'Reference additional assets by relative path (e.g. "app.js", "styles/main.css").',
      }),
      css: Type.Optional(
        Type.String({ description: 'Inline CSS injected into <head>.' }),
      ),
      js: Type.Optional(
        Type.String({ description: 'Inline JavaScript injected at the end of <body>.' }),
      ),
      assets: Type.Optional(
        Type.Array(
          Type.Object({
            path: Type.String({
              description:
                'Relative path inside the canvas folder (e.g. "app.js", "img/logo.svg"). Must not escape the folder.',
            }),
            content: Type.String({ description: 'File contents. UTF-8 text by default.' }),
            encoding: Type.Optional(
              Type.Union([Type.Literal('utf-8'), Type.Literal('base64')], {
                description: 'Use "base64" for binary assets like images.',
              }),
            ),
          }),
          {
            description:
              'Extra files to write alongside index.html. Limited to common web extensions (.js, .css, .svg, .png, etc.).',
          },
        ),
      ),
    }),
    execute: async (_toolCallId, params: any): Promise<AgentToolResult<CanvasDetails>> => {
      const canvasId = slugifyId(params.id);
      const title = ((params.title as string) ?? '').trim() || canvasId;
      const htmlBody = (params.html as string) ?? '';
      if (!htmlBody.trim()) throw new Error('html body is required');

      const assets = (params.assets as Array<{
        path: string;
        content: string;
        encoding?: 'utf-8' | 'base64';
      }> | undefined) ?? [];
      if (assets.length > MAX_ASSETS) {
        throw new Error(`Too many assets (max ${MAX_ASSETS}, got ${assets.length}).`);
      }

      const canvasDir = resolveCanvasPath(ctx, canvasId);
      await fs.mkdir(canvasDir, { recursive: true });

      const indexHtml = buildIndexHtml({
        title,
        html: htmlBody,
        css: params.css as string | undefined,
        js: params.js as string | undefined,
      });

      if (Buffer.byteLength(indexHtml, 'utf-8') > MAX_ASSET_BYTES) {
        throw new Error(`index.html exceeds ${MAX_ASSET_BYTES} bytes.`);
      }

      const writtenAssets = await writeAssets(canvasDir, assets);
      await fs.writeFile(path.join(canvasDir, INDEX_FILENAME), indexHtml, 'utf-8');
      await fs.writeFile(
        path.join(canvasDir, META_FILENAME),
        JSON.stringify(
          { id: canvasId, title, updatedAt: new Date().toISOString(), files: [INDEX_FILENAME, ...writtenAssets] },
          null,
          2,
        ),
        'utf-8',
      );

      const url = canvasUrl(ctx, canvasId);
      const filesList = [INDEX_FILENAME, ...writtenAssets];
      const summary = `Canvas "${canvasId}" is live at ${url}\n` +
        `Files: ${filesList.join(', ')}\n` +
        'Open the URL in a browser to interact with it.';

      return {
        content: [{ type: 'text', text: summary }],
        details: { canvasId, url, files: filesList },
      };
    },
  };
}

export const CANVAS_ASSET_MIME = ASSET_MIME;
export const CANVAS_DIR_NAME = CANVAS_DIRNAME;
