import fs from 'fs/promises';
import path from 'path';
import http from 'http';
import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';

const DEFAULT_ROOT_DIR = '.canva';
const DEFAULT_PORT_START = 5173;
const DEFAULT_PORT_END = 5273;
const NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

interface CanvasInstance {
  name: string;
  folder: string;
  port: number;
  server: http.Server;
  startedAt: number;
}

// Module-level registry — persists across tool invocations within the agent
// process. Keyed by absolute folder path so two agents with different CWDs
// can each own a distinct canvas with the same logical name.
const CANVASES = new Map<string, CanvasInstance>();

function textResult(text: string): AgentToolResult<undefined> {
  return { content: [{ type: 'text', text }], details: undefined };
}

export interface CanvaToolContext {
  cwd: string;
  sandboxWorkdir?: boolean;
  /** Override default root folder (relative to cwd). Defaults to ".canva". */
  rootDir?: string;
  /** Override the default start of the auto-assigned port range. */
  portRangeStart?: number;
  /** Override the default end of the auto-assigned port range. */
  portRangeEnd?: number;
}

function resolveCanvasFolder(name: string, ctx: CanvaToolContext): string {
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid canvas name "${name}". Use 1-64 chars of [A-Za-z0-9_-].`,
    );
  }
  const root = path.resolve(ctx.cwd, ctx.rootDir ?? DEFAULT_ROOT_DIR);
  const folder = path.resolve(root, name);
  if (folder !== root && !folder.startsWith(root + path.sep)) {
    throw new Error(`Path escape detected for canvas "${name}".`);
  }
  return folder;
}

function resolveFileInCanvas(folder: string, file: string): string {
  if (!file?.trim()) throw new Error('file is required');
  if (file.startsWith('/') || file.includes('\0')) {
    throw new Error(`Invalid file path "${file}".`);
  }
  const resolved = path.resolve(folder, file);
  if (resolved !== folder && !resolved.startsWith(folder + path.sep)) {
    throw new Error(
      `File "${file}" is outside the canvas folder.`,
    );
  }
  return resolved;
}

async function folderExists(folder: string): Promise<boolean> {
  try {
    const stat = await fs.stat(folder);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

function findCanvasByPort(port: number): CanvasInstance | undefined {
  for (const instance of CANVASES.values()) {
    if (instance.port === port) return instance;
  }
  return undefined;
}

function findCanvasByName(
  name: string,
  ctx: CanvaToolContext,
): CanvasInstance | undefined {
  const folder = resolveCanvasFolder(name, ctx);
  return CANVASES.get(folder);
}

async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = http.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => {
      probe.close(() => resolve(true));
    });
    probe.listen(port, '127.0.0.1');
  });
}

async function pickPort(
  requested: number | undefined,
  ctx: CanvaToolContext,
): Promise<number> {
  if (requested) {
    if (requested < 1024 || requested > 65535) {
      throw new Error(`Port ${requested} must be between 1024 and 65535.`);
    }
    if (findCanvasByPort(requested)) {
      throw new Error(`Port ${requested} is already serving another canvas.`);
    }
    if (!(await isPortFree(requested))) {
      throw new Error(`Port ${requested} is already in use by another process.`);
    }
    return requested;
  }
  const start = ctx.portRangeStart ?? DEFAULT_PORT_START;
  const end = ctx.portRangeEnd ?? DEFAULT_PORT_END;
  for (let port = start; port <= end; port++) {
    if (findCanvasByPort(port)) continue;
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free port available between ${start} and ${end}.`);
}

function serveStatic(folder: string): http.RequestListener {
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const rel = pathname.replace(/^\/+/, '');
      const resolved = path.resolve(folder, rel);
      if (resolved !== folder && !resolved.startsWith(folder + path.sep)) {
        res.statusCode = 403;
        res.end('Forbidden');
        return;
      }
      let target = resolved;
      let stat;
      try {
        stat = await fs.stat(target);
      } catch {
        res.statusCode = 404;
        res.end('Not Found');
        return;
      }
      if (stat.isDirectory()) {
        target = path.join(target, 'index.html');
        try {
          stat = await fs.stat(target);
        } catch {
          res.statusCode = 404;
          res.end('Not Found');
          return;
        }
      }
      const body = await fs.readFile(target);
      res.statusCode = 200;
      res.setHeader('Content-Type', contentTypeFor(target));
      res.setHeader('Content-Length', String(body.length));
      res.setHeader('Cache-Control', 'no-store');
      res.end(body);
    } catch (err) {
      res.statusCode = 500;
      res.end(`Server error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}

async function startServer(folder: string, port: number): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(serveStatic(folder));
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server);
    });
  });
}

async function stopInstance(instance: CanvasInstance): Promise<void> {
  return new Promise((resolve) => {
    instance.server.close(() => resolve());
  });
}

function canvasUrl(port: number): string {
  return `http://localhost:${port}/`;
}

function defaultHtml(name: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${name}</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <main id="app"></main>
    <script src="script.js"></script>
  </body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function doCreate(
  params: any,
  ctx: CanvaToolContext,
): Promise<string> {
  const name = String(params.name ?? '').trim();
  const folder = resolveCanvasFolder(name, ctx);
  const html = typeof params.html === 'string' ? params.html : undefined;
  const css = typeof params.css === 'string' ? params.css : undefined;
  const js = typeof params.js === 'string' ? params.js : undefined;
  const files = (params.files && typeof params.files === 'object')
    ? (params.files as Record<string, string>)
    : undefined;
  const overwrite = Boolean(params.overwrite);
  const autoStart = params.serve !== false; // default true

  const existed = await folderExists(folder);
  if (existed && !overwrite) {
    throw new Error(
      `Canvas "${name}" already exists at ${folder}. Pass overwrite=true or use action="update".`,
    );
  }

  await fs.mkdir(folder, { recursive: true });

  const written: string[] = [];
  if (files) {
    for (const [rel, content] of Object.entries(files)) {
      if (typeof content !== 'string') continue;
      const target = resolveFileInCanvas(folder, rel);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, 'utf-8');
      written.push(rel);
    }
  }
  if (html !== undefined || (!files && !existed)) {
    const target = path.join(folder, 'index.html');
    await fs.writeFile(target, html ?? defaultHtml(name), 'utf-8');
    if (!written.includes('index.html')) written.push('index.html');
  }
  if (css !== undefined) {
    await fs.writeFile(path.join(folder, 'style.css'), css, 'utf-8');
    written.push('style.css');
  }
  if (js !== undefined) {
    await fs.writeFile(path.join(folder, 'script.js'), js, 'utf-8');
    written.push('script.js');
  }

  let instance = CANVASES.get(folder);
  if (instance && autoStart) {
    // Already serving — content was refreshed on disk; client needs to reload.
    return formatStatus(
      `Updated canvas "${name}". Already serving at ${canvasUrl(instance.port)} — reload the page to see changes.`,
      [instance],
      written,
    );
  }

  if (!autoStart) {
    return [
      `Canvas "${name}" written to ${folder}.`,
      written.length > 0 ? `Files: ${written.join(', ')}.` : null,
      `Not started (serve=false). Call action="start" to serve it.`,
    ]
      .filter(Boolean)
      .join(' ');
  }

  const requestedPort =
    typeof params.port === 'number' ? params.port : undefined;
  const port = await pickPort(requestedPort, ctx);
  const server = await startServer(folder, port);
  instance = {
    name,
    folder,
    port,
    server,
    startedAt: Date.now(),
  };
  CANVASES.set(folder, instance);

  return formatStatus(
    `Canvas "${name}" is live at ${canvasUrl(port)}.`,
    [instance],
    written,
  );
}

async function doUpdate(
  params: any,
  ctx: CanvaToolContext,
): Promise<string> {
  const name = String(params.name ?? '').trim();
  const folder = resolveCanvasFolder(name, ctx);
  if (!(await folderExists(folder))) {
    throw new Error(
      `Canvas "${name}" does not exist. Use action="create" first.`,
    );
  }

  const changed: string[] = [];

  const singleFile = typeof params.file === 'string' ? params.file : undefined;
  const singleContent = typeof params.content === 'string' ? params.content : undefined;
  if (singleFile) {
    if (singleContent === undefined) {
      throw new Error('content is required when file is provided');
    }
    const target = resolveFileInCanvas(folder, singleFile);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, singleContent, 'utf-8');
    changed.push(singleFile);
  }

  if (params.files && typeof params.files === 'object') {
    for (const [rel, content] of Object.entries(
      params.files as Record<string, string>,
    )) {
      if (typeof content !== 'string') continue;
      const target = resolveFileInCanvas(folder, rel);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, 'utf-8');
      changed.push(rel);
    }
  }

  if (typeof params.html === 'string') {
    await fs.writeFile(path.join(folder, 'index.html'), params.html, 'utf-8');
    if (!changed.includes('index.html')) changed.push('index.html');
  }
  if (typeof params.css === 'string') {
    await fs.writeFile(path.join(folder, 'style.css'), params.css, 'utf-8');
    if (!changed.includes('style.css')) changed.push('style.css');
  }
  if (typeof params.js === 'string') {
    await fs.writeFile(path.join(folder, 'script.js'), params.js, 'utf-8');
    if (!changed.includes('script.js')) changed.push('script.js');
  }

  if (changed.length === 0) {
    throw new Error(
      'No changes supplied. Provide file+content, files, html, css, or js.',
    );
  }

  const instance = CANVASES.get(folder);
  const lines: string[] = [
    `Updated canvas "${name}": ${changed.join(', ')}.`,
  ];
  if (instance) {
    lines.push(
      `Serving at ${canvasUrl(instance.port)} — reload the page to see changes.`,
    );
  } else {
    lines.push(
      `Not currently served. Call action="start" to serve on a port.`,
    );
  }
  return lines.join(' ');
}

async function doStart(
  params: any,
  ctx: CanvaToolContext,
): Promise<string> {
  const name = String(params.name ?? '').trim();
  const folder = resolveCanvasFolder(name, ctx);
  if (!(await folderExists(folder))) {
    throw new Error(
      `Canvas "${name}" does not exist. Use action="create" first.`,
    );
  }
  const existing = CANVASES.get(folder);
  if (existing) {
    return `Canvas "${name}" is already being served at ${canvasUrl(existing.port)}.`;
  }
  const requestedPort = typeof params.port === 'number' ? params.port : undefined;
  const port = await pickPort(requestedPort, ctx);
  const server = await startServer(folder, port);
  const instance: CanvasInstance = {
    name,
    folder,
    port,
    server,
    startedAt: Date.now(),
  };
  CANVASES.set(folder, instance);
  return `Canvas "${name}" started at ${canvasUrl(port)}.`;
}

async function doStop(
  params: any,
  ctx: CanvaToolContext,
): Promise<string> {
  const name = String(params.name ?? '').trim();
  const folder = resolveCanvasFolder(name, ctx);
  const instance = CANVASES.get(folder);
  if (!instance) {
    return `Canvas "${name}" is not currently being served.`;
  }
  await stopInstance(instance);
  CANVASES.delete(folder);
  return `Canvas "${name}" stopped. Port ${instance.port} released.`;
}

async function doStatus(
  params: any,
  ctx: CanvaToolContext,
): Promise<string> {
  const requestedName = typeof params.name === 'string' && params.name.trim()
    ? params.name.trim()
    : undefined;

  if (requestedName) {
    const folder = resolveCanvasFolder(requestedName, ctx);
    const onDisk = await folderExists(folder);
    const instance = CANVASES.get(folder);
    const lines: string[] = [];
    lines.push(`Canvas "${requestedName}":`);
    lines.push(`  folder: ${folder} ${onDisk ? '(exists)' : '(missing)'}`);
    if (instance) {
      lines.push(`  url: ${canvasUrl(instance.port)}`);
      lines.push(`  port: ${instance.port}`);
      lines.push(
        `  uptime: ${Math.round((Date.now() - instance.startedAt) / 1000)}s`,
      );
    } else {
      lines.push('  status: not running');
    }
    if (onDisk) {
      const files = await listCanvasFiles(folder);
      if (files.length > 0) {
        lines.push(`  files: ${files.join(', ')}`);
      }
    }
    return lines.join('\n');
  }

  return formatStatus('Canvas status', [...CANVASES.values()]);
}

async function doList(
  _params: any,
  ctx: CanvaToolContext,
): Promise<string> {
  const root = path.resolve(ctx.cwd, ctx.rootDir ?? DEFAULT_ROOT_DIR);
  let entries: string[] = [];
  try {
    const dir = await fs.readdir(root, { withFileTypes: true });
    entries = dir.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return `No canvases yet — ${root} does not exist.`;
  }
  if (entries.length === 0) {
    return `No canvases in ${root}.`;
  }
  const lines = [`Canvases in ${root}:`];
  for (const name of entries) {
    const folder = path.join(root, name);
    const instance = CANVASES.get(folder);
    lines.push(
      instance
        ? `  - ${name}  →  ${canvasUrl(instance.port)}`
        : `  - ${name}  (stopped)`,
    );
  }
  return lines.join('\n');
}

async function listCanvasFiles(folder: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(folder, { withFileTypes: true });
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const nested = await listCanvasFiles(path.join(folder, entry.name), rel);
      out.push(...nested);
    } else {
      out.push(rel);
    }
  }
  return out.sort();
}

function formatStatus(
  header: string,
  instances: CanvasInstance[],
  written?: string[],
): string {
  const lines = [header];
  if (written && written.length > 0) {
    lines.push(`  wrote: ${written.join(', ')}`);
  }
  if (instances.length === 0) {
    lines.push('  (no canvases running)');
  } else {
    for (const inst of instances) {
      lines.push(
        `  - "${inst.name}" → ${canvasUrl(inst.port)}  [folder: ${inst.folder}]`,
      );
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

const DESCRIPTION = [
  'Build, serve, and edit lightweight HTML/CSS/JS visualizations for the user.',
  'Use this when the user asks to visualize something or when a quick interactive',
  'page makes an explanation clearer.',
  '',
  'Actions:',
  '  create  — write files for a new canvas and (by default) start serving it.',
  '            Params: name, html?, css?, js?, files?, port?, overwrite?, serve?',
  '  update  — edit an existing canvas. Params: name, file+content | files | html/css/js.',
  '            The dev server keeps running — the user only needs to reload the page.',
  '  start   — start serving an existing canvas. Params: name, port?',
  '  stop    — stop the dev server for a canvas. Params: name',
  '  status  — report running canvases and their URLs. Params: name? (details one canvas)',
  '  list    — list canvases on disk.',
  '',
  'Files are written under <cwd>/.canva/<name>/. Default entrypoint: index.html',
  '(with style.css + script.js if you provide css/js).',
  'Always tell the user the URL after create/start so they can open it.',
].join('\n');

export function createCanvaTool(ctx: CanvaToolContext): AgentTool<TSchema> {
  return {
    name: 'canva',
    description: DESCRIPTION,
    label: 'Canva',
    parameters: Type.Object({
      action: Type.Union(
        [
          Type.Literal('create'),
          Type.Literal('update'),
          Type.Literal('start'),
          Type.Literal('stop'),
          Type.Literal('status'),
          Type.Literal('list'),
        ],
        { description: 'Which canva operation to perform' },
      ),
      name: Type.Optional(
        Type.String({
          description:
            'Canvas name (folder under .canva/). Required for create/update/start/stop and to scope status.',
        }),
      ),
      html: Type.Optional(
        Type.String({ description: 'Full index.html content' }),
      ),
      css: Type.Optional(
        Type.String({ description: 'Full style.css content (linked from default index.html)' }),
      ),
      js: Type.Optional(
        Type.String({ description: 'Full script.js content (linked from default index.html)' }),
      ),
      file: Type.Optional(
        Type.String({ description: 'Relative file path inside the canvas to write' }),
      ),
      content: Type.Optional(
        Type.String({ description: 'File content — used with "file"' }),
      ),
      files: Type.Optional(
        Type.Record(Type.String(), Type.String(), {
          description: 'Multi-file map: { "relative/path": "contents" }',
        }),
      ),
      port: Type.Optional(
        Type.Number({
          description:
            'Preferred port (1024-65535). Omit to auto-pick a free port in the configured range.',
        }),
      ),
      overwrite: Type.Optional(
        Type.Boolean({
          description: 'create only: allow overwriting an existing canvas folder',
        }),
      ),
      serve: Type.Optional(
        Type.Boolean({
          description: 'create only: start the dev server after writing files (default: true)',
        }),
      ),
    }),
    execute: async (_toolCallId, params: any) => {
      const action = String(params?.action ?? '').trim();
      if (!action) throw new Error('action is required');
      switch (action) {
        case 'create':
          return textResult(await doCreate(params, ctx));
        case 'update':
          return textResult(await doUpdate(params, ctx));
        case 'start':
          return textResult(await doStart(params, ctx));
        case 'stop':
          return textResult(await doStop(params, ctx));
        case 'status':
          return textResult(await doStatus(params, ctx));
        case 'list':
          return textResult(await doList(params, ctx));
        default:
          throw new Error(`Unknown action "${action}".`);
      }
    },
  };
}

// Exported for tests — shuts down any running instances so test isolation works.
export async function __resetCanvasesForTests(): Promise<void> {
  const instances = [...CANVASES.values()];
  CANVASES.clear();
  await Promise.all(instances.map((i) => stopInstance(i)));
}
