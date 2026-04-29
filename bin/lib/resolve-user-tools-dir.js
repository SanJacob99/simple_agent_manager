/**
 * JS mirror of `server/tools/resolve-user-tools-dir.ts` for the SAM CLI.
 *
 * The CLI is plain ESM Node and intentionally avoids a TypeScript loader,
 * so we reimplement the (very small) resolution logic here. If the
 * server-side rules change, update both files.
 *
 * Precedence (first match wins):
 *   1. `SAM_DISABLE_USER_TOOLS=1` — kill switch.
 *   2. `SAM_USER_TOOLS_DIR=<path>` — override (with `~` expansion).
 *   3. Default: `<repo>/server/tools/user`.
 */

import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

function expandHome(input) {
  if (input === '~') return os.homedir();
  if (input.startsWith('~/')) return path.join(os.homedir(), input.slice(2));
  return input;
}

export function resolveUserToolsDir(env = process.env) {
  if (env.SAM_DISABLE_USER_TOOLS === '1') {
    return { dirs: [], describe: 'disabled via SAM_DISABLE_USER_TOOLS=1' };
  }

  const override = env.SAM_USER_TOOLS_DIR?.trim();
  if (override) {
    const resolved = expandHome(override);
    return { dirs: [resolved], describe: `SAM_USER_TOOLS_DIR=${resolved}` };
  }

  // From bin/lib/<this-file> → ../../server/tools/user
  const here = fileURLToPath(import.meta.url);
  const defaultDir = path.resolve(path.dirname(here), '..', '..', 'server', 'tools', 'user');
  return { dirs: [defaultDir], describe: `default ${defaultDir}` };
}
