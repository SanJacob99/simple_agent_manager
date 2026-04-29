/**
 * Mirror of `server/runtime-state.ts` paths for CLI-side use.
 *
 * `<repo>/.sam/server.pid` — written by the running server on listen,
 * read by `sam restart` to find what to stop.
 *
 * Kept in sync with the server file by hand.
 */

import path from 'path';
import { fileURLToPath } from 'url';

const here = fileURLToPath(import.meta.url);
// bin/lib/<file> -> repo root is two levels up.
const REPO_ROOT = path.resolve(path.dirname(here), '..', '..');

export const SAM_DIR = path.join(REPO_ROOT, '.sam');
export const SERVER_PID_FILE = path.join(SAM_DIR, 'server.pid');

export function repoRoot() {
  return REPO_ROOT;
}
