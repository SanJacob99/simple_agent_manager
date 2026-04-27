import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { log } from '../../../logger';

const DEFAULT_PORT = 9222;
const PROBE_TIMEOUT_MS = 1_500;

/**
 * Known installation paths for a real Chrome binary, per platform. Each
 * entry is tried in order. Users on odd installs can override the whole
 * resolution by setting CHROME_PATH (standard Puppeteer env var) or
 * CHROME_BINARY (our project convention, wins).
 */
function candidatePaths(): string[] {
  const override = process.env.CHROME_BINARY || process.env.CHROME_PATH;
  if (override) return [override];

  const platform = process.platform;
  if (platform === 'win32') {
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env['LOCALAPPDATA'] || path.join(os.homedir(), 'AppData', 'Local');
    return [
      path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
  }
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
  }
  // Linux and BSD-likes
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ];
}

function firstExisting(paths: string[]): string | null {
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // ignore permission issues on individual probes
    }
  }
  return null;
}

/**
 * Probe the CDP endpoint to see if Chrome is already listening. Returns the
 * raw version payload when a debugger is live, or null otherwise.
 */
async function probeCdp(port: number): Promise<Record<string, unknown> | null> {
  const url = `http://127.0.0.1:${port}/json/version`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) return null;
    const body = await resp.json();
    return body as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface LaunchChromeResult {
  /** The endpoint the browser tool should attach to. */
  endpoint: string;
  /** Did we spawn a new Chrome, or was one already listening on this port? */
  launched: boolean;
  /** The path to the Chrome binary we launched (or found listening). */
  binary?: string;
  /** Chrome's /json/version payload after launch succeeded. */
  version?: Record<string, unknown>;
}

export interface LaunchChromeOptions {
  /** Remote-debugging port. Default 9222. */
  port?: number;
  /**
   * User-data directory. Empty = a per-run temp dir under the OS temp
   * folder so the agent's Chrome doesn't fight with the user's primary
   * profile. Pass the user's real profile path if they explicitly want to
   * share cookies/extensions/history.
   */
  userDataDir?: string;
}

/**
 * Spawn a Chrome instance with the remote-debugging port enabled. Returns
 * the endpoint to put into the browser tool's `cdpEndpoint` setting.
 *
 * Launch semantics:
 *   - If Chrome is already listening on the port, do not spawn anything —
 *     just return the endpoint as-is. Safe to call repeatedly.
 *   - Otherwise resolve a Chrome binary from platform defaults (or the
 *     CHROME_BINARY env var), spawn it detached so it outlives dev-server
 *     restarts, and poll /json/version until it comes up or we time out.
 *   - We do NOT touch the user's default Chrome profile unless they pass
 *     one explicitly — stealing their primary profile would break their
 *     active browsing. By default we spawn against a scratch dir.
 */
export async function launchChromeForCdp(opts: LaunchChromeOptions = {}): Promise<LaunchChromeResult> {
  const port = opts.port && Number.isFinite(opts.port) && opts.port > 0 ? Math.floor(opts.port) : DEFAULT_PORT;
  const endpoint = `http://127.0.0.1:${port}`;

  const existing = await probeCdp(port);
  if (existing) {
    log('chrome-launcher', `Chrome already listening on port ${port}; returning existing endpoint.`);
    return { endpoint, launched: false, version: existing };
  }

  const binary = firstExisting(candidatePaths());
  if (!binary) {
    throw new Error(
      'Could not find a Chrome binary. Install Chrome from https://www.google.com/chrome/ '
      + 'or set the CHROME_BINARY environment variable to the path of your Chrome/Chromium executable.',
    );
  }

  const userDataDir = opts.userDataDir?.trim()
    || path.join(os.tmpdir(), `sam-chrome-cdp-${port}`);
  // Ensure the dir exists so Chrome doesn't complain about the flag.
  fs.mkdirSync(userDataDir, { recursive: true });

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    // Match modern Chrome defaults; --no-first-run avoids the welcome tab.
    '--no-first-run',
    '--no-default-browser-check',
  ];

  log('chrome-launcher', `Spawning ${binary} --remote-debugging-port=${port} (user-data-dir=${userDataDir})`);

  const child = spawn(binary, args, {
    detached: true,
    stdio: 'ignore',
    // Don't inherit the dev server's env — keep it minimal so PATH/DISPLAY
    // issues don't sneak in. Chrome will pick up HOME/APPDATA from the OS.
  });

  // Detach so Chrome outlives the server if the user restarts tsx.
  child.unref();

  // Errors surface here (ENOENT if the binary vanished between existsSync
  // and spawn). We convert them to a rejected promise the endpoint handler
  // can turn into a useful 500.
  const spawnError = await new Promise<Error | null>((resolve) => {
    const onError = (err: Error) => resolve(err);
    child.once('error', onError);
    setTimeout(() => {
      child.removeListener('error', onError);
      resolve(null);
    }, 200);
  });
  if (spawnError) {
    throw new Error(`Failed to spawn Chrome: ${spawnError.message}`);
  }

  // Poll /json/version. Chrome typically comes up in 300-1500ms.
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const version = await probeCdp(port);
    if (version) {
      log('chrome-launcher', `Chrome is up on port ${port}.`);
      return { endpoint, launched: true, binary, version };
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  throw new Error(
    `Chrome was spawned but the CDP endpoint did not come up on port ${port} within 15s. `
    + `Check that Chrome is installed and that the port is not blocked.`,
  );
}
