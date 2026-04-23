/**
 * Resolve where the tool registry should look for user-installed tools
 * at startup. See `docs/concepts/user-tools-guide.md` § "Where tools live".
 *
 * Precedence (first match wins):
 *   1. `SAM_DISABLE_USER_TOOLS=1` — kill switch. Returns zero dirs so
 *      the registry loads nothing beyond the built-ins. For CI and
 *      production containers that should never honour a local dir.
 *   2. `SAM_USER_TOOLS_DIR=<path>` — override. Expands a leading `~`
 *      and returns that single directory.
 *   3. Default: `<this-file>/../user` (i.e. `server/tools/user/`),
 *      resolved from `import.meta.url` so it works identically under
 *      tsx (source) and a compiled layout.
 *
 * Missing directories are NOT filtered here. `initializeToolRegistry`
 * walks extras with `failSoft: true`, so a non-existent default dir is
 * the expected state until the user drops a `.module.ts` file in.
 */

import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

export interface UserToolsDirInfo {
  /** Directories to pass to `initializeToolRegistry({ extraDirs })`. */
  dirs: string[];
  /**
   * Short human-readable suffix for the startup log, so the operator
   * can see at a glance why the loader is (or isn't) scanning, and
   * where. Never includes secrets.
   */
  describe: string;
}

export function resolveUserToolsDir(
  env: NodeJS.ProcessEnv = process.env,
): UserToolsDirInfo {
  if (env.SAM_DISABLE_USER_TOOLS === '1') {
    return { dirs: [], describe: 'disabled via SAM_DISABLE_USER_TOOLS=1' };
  }

  const override = env.SAM_USER_TOOLS_DIR?.trim();
  if (override) {
    const resolved = expandHome(override);
    return { dirs: [resolved], describe: `SAM_USER_TOOLS_DIR=${resolved}` };
  }

  const here = fileURLToPath(import.meta.url);
  const defaultDir = path.resolve(path.dirname(here), 'user');
  return { dirs: [defaultDir], describe: `default ${defaultDir}` };
}

function expandHome(input: string): string {
  if (input === '~') return os.homedir();
  if (input.startsWith('~/')) return path.join(os.homedir(), input.slice(2));
  return input;
}
