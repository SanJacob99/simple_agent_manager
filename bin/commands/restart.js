/**
 * `sam restart` — spawn the supervisor detached and return immediately.
 *
 * The supervisor (`bin/sam-supervisor.js`) handles stopping the
 * existing server, starting a fresh dev:server, and waiting for
 * /api/health to respond. We just write its pid to
 * `.sam/supervisor.pid` so the new server can SIGTERM it as
 * belt-and-suspenders, then exit.
 *
 * Caveat: only meaningful when the dev:server is being run via tsx /
 * node directly (or by a previous `sam restart`). If the operator is
 * running `npm run dev` (concurrently + vite), restart will tear vite
 * down too — concurrently exits when one child dies. We don't try to
 * detect that here; the README documents the limitation.
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { repoRoot, SAM_DIR, SUPERVISOR_PID_FILE } from '../lib/sam-paths.js';

export async function runRestart(_args) {
  const REPO_ROOT = repoRoot();
  const supervisorPath = path.join(REPO_ROOT, 'bin', 'sam-supervisor.js');
  if (!fs.existsSync(supervisorPath)) {
    console.error(`sam: supervisor not found at ${supervisorPath}`);
    process.exit(1);
  }

  fs.mkdirSync(SAM_DIR, { recursive: true });

  const child = spawn(process.execPath, [supervisorPath], {
    detached: true,
    stdio: 'ignore',
    cwd: REPO_ROOT,
    windowsHide: true,
  });

  if (typeof child.pid !== 'number') {
    console.error('sam: failed to spawn supervisor.');
    process.exit(1);
  }

  fs.writeFileSync(SUPERVISOR_PID_FILE, String(child.pid), 'utf8');
  child.unref();

  console.log(`sam: supervisor started (pid=${child.pid}). Run \`sam diagnose\` in a few seconds to confirm.`);
}
