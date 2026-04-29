/**
 * `sam diagnose` — read-only probe of the local backend.
 *
 * Hits /api/health and /api/tools on the storage port, prints the
 * resolved user-tools directory, and surfaces SAM_USER_TOOLS_DIR /
 * SAM_DISABLE_USER_TOOLS if they are set. No server-side mutation.
 */

import { resolveUserToolsDir } from '../lib/resolve-user-tools-dir.js';

const HEALTH_TIMEOUT_MS = 1500;
const CATALOG_TIMEOUT_MS = 3000;

function resolveBaseUrl(env = process.env) {
  const port = parseInt(env.STORAGE_PORT ?? '3210', 10);
  return `http://localhost:${port}`;
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return { ok: res.ok, status: res.status, body: await res.text() };
  } catch (err) {
    return { ok: false, error: err };
  } finally {
    clearTimeout(timer);
  }
}

function classifyError(err) {
  if (err?.name === 'AbortError') return 'timeout';
  const code = err?.cause?.code ?? err?.code;
  if (code === 'ECONNREFUSED') return 'not running';
  if (code === 'ENOTFOUND') return 'host not found';
  return err?.message ?? 'unreachable';
}

function pad(label, width = 16) {
  return label.padEnd(width, ' ');
}

export async function runDiagnose() {
  const env = process.env;
  const baseUrl = resolveBaseUrl(env);

  console.log('SAM diagnose');
  console.log('');
  console.log(`Server (${baseUrl})`);

  const health = await fetchWithTimeout(`${baseUrl}/api/health`, HEALTH_TIMEOUT_MS);
  if (health.ok) {
    console.log(`  ${pad('/api/health')}reachable`);
  } else if (health.error) {
    console.log(`  ${pad('/api/health')}unreachable (${classifyError(health.error)})`);
  } else {
    console.log(`  ${pad('/api/health')}HTTP ${health.status}`);
  }

  // Only probe the catalog if health succeeded — avoids a second timeout
  // when the server is plainly down.
  if (health.ok) {
    const catalog = await fetchWithTimeout(`${baseUrl}/api/tools`, CATALOG_TIMEOUT_MS);
    if (catalog.ok) {
      let count = '?';
      try {
        const parsed = JSON.parse(catalog.body);
        if (Array.isArray(parsed)) count = String(parsed.length);
      } catch {
        // leave count as '?'
      }
      console.log(`  ${pad('/api/tools')}${count} tool(s)`);
    } else {
      const reason = catalog.error ? classifyError(catalog.error) : `HTTP ${catalog.status}`;
      console.log(`  ${pad('/api/tools')}unreachable (${reason})`);
    }
  } else {
    console.log(`  ${pad('/api/tools')}skipped (health failed)`);
  }

  console.log('');
  console.log('User tools');

  const info = resolveUserToolsDir(env);
  const resolvedDir = info.dirs[0] ?? '(none — kill switch active)';
  console.log(`  ${pad('Resolved dir')}${resolvedDir}`);
  console.log(`  ${pad('Source')}${info.describe}`);

  if (env.SAM_USER_TOOLS_DIR !== undefined) {
    console.log(`  ${pad('Override')}SAM_USER_TOOLS_DIR=${env.SAM_USER_TOOLS_DIR}`);
  }
  if (env.SAM_DISABLE_USER_TOOLS !== undefined) {
    console.log(`  ${pad('Kill switch')}SAM_DISABLE_USER_TOOLS=${env.SAM_DISABLE_USER_TOOLS}`);
  }
}
