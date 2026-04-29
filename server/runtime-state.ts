/**
 * Runtime PID coordination for `sam restart`.
 *
 * `<repo>/.sam/server.pid` holds the running server's PID. The server
 * writes it on listen and best-effort deletes it on graceful shutdown;
 * `sam restart` reads it to find what to SIGTERM before spawning a
 * fresh server.
 *
 * The CLI mirror of this module is `bin/lib/sam-paths.js`. Keep the
 * file paths in sync.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(here), '..');

export const SAM_DIR = path.join(REPO_ROOT, '.sam');
export const SERVER_PID_FILE = path.join(SAM_DIR, 'server.pid');

export function writeServerPid(pid: number): void {
  try {
    fs.mkdirSync(SAM_DIR, { recursive: true });
    fs.writeFileSync(SERVER_PID_FILE, String(pid), 'utf8');
  } catch (err) {
    console.error('[Server] Failed to write server.pid:', (err as Error).message);
  }
}

export function clearServerPid(): void {
  try {
    fs.rmSync(SERVER_PID_FILE, { force: true });
  } catch {
    // best-effort
  }
}
