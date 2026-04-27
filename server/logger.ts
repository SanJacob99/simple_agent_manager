import fs from 'fs';
import path from 'path';

const logsDir = path.join(process.cwd(), 'logs');
const apiDir = path.join(logsDir, 'api');
fs.mkdirSync(logsDir, { recursive: true });
fs.mkdirSync(apiDir, { recursive: true });

// Append so logs from a session are not wiped when the dev server
// hot-restarts between a user report and the debugging session.
const stream = fs.createWriteStream(path.join(logsDir, 'debug.log'), { flags: 'a' });
stream.on('error', () => { /* suppress: debug log failure must not crash the process */ });

const API_LOG_MAX_FILES = 200;

function formatLine(category: string, message: string): string {
  return `[${new Date().toISOString()}] [${category}] ${message}\n`;
}

export function log(category: string, message: string): void {
  stream.write(formatLine(category, message));
}

export function logError(category: string, message: string): void {
  stream.write(formatLine(category, message));
  console.error(`[${category}]`, message);
}

export function logConsoleAndFile(category: string, message: string): void {
  stream.write(formatLine(category, message));
  console.log(`[${category}]`, message);
}

let apiSeq = 0;
function nextApiId(): string {
  apiSeq += 1;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `${ts}-${String(apiSeq).padStart(4, '0')}`;
}

function pruneApiLogs(): void {
  try {
    const files = fs.readdirSync(apiDir)
      .filter((f) => f.endsWith('.txt') || f.endsWith('.json'))
      .map((f) => ({ f, t: fs.statSync(path.join(apiDir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const entry of files.slice(API_LOG_MAX_FILES)) {
      fs.unlinkSync(path.join(apiDir, entry.f));
    }
  } catch {
    // don't crash the process on log-rotation failures
  }
}

/**
 * Write a complete request/response exchange to logs/api/<id>.txt. Bodies
 * are never truncated so the raw provider response can be inspected. Files
 * are pruned to the most recent API_LOG_MAX_FILES.
 */
export function logApiExchange(input: {
  url: string;
  requestHeaders?: Record<string, string>;
  requestBody?: string | null;
  status?: number;
  statusText?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string | null;
  error?: string | null;
}): string {
  const id = nextApiId();
  const file = path.join(apiDir, `${id}.txt`);
  const parts: string[] = [];
  parts.push(`=== ${new Date().toISOString()} ===`);
  parts.push(`URL: ${input.url}`);
  if (input.status !== undefined) parts.push(`STATUS: ${input.status} ${input.statusText ?? ''}`);
  if (input.error) parts.push(`ERROR: ${input.error}`);
  if (input.requestHeaders) {
    parts.push('\n--- REQUEST HEADERS ---');
    parts.push(JSON.stringify(input.requestHeaders, null, 2));
  }
  if (input.requestBody) {
    parts.push('\n--- REQUEST BODY ---');
    parts.push(input.requestBody);
  }
  if (input.responseHeaders) {
    parts.push('\n--- RESPONSE HEADERS ---');
    parts.push(JSON.stringify(input.responseHeaders, null, 2));
  }
  if (input.responseBody !== undefined && input.responseBody !== null) {
    parts.push('\n--- RESPONSE BODY ---');
    parts.push(input.responseBody);
  }
  try {
    fs.writeFileSync(file, parts.join('\n'));
    pruneApiLogs();
  } catch {
    // debug-only: never let a log-write break the agent
  }
  return file;
}
