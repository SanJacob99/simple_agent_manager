/**
 * Resolve where install / uninstall / list should look for user tools.
 *
 * Honors the same env precedence as the server (`SAM_DISABLE_USER_TOOLS`
 * kill switch and `SAM_USER_TOOLS_DIR` override) so what `sam install`
 * writes is what the server later reads. If the kill switch is on,
 * write commands refuse — there's no useful place to install.
 */

import { resolveUserToolsDir } from './resolve-user-tools-dir.js';

export function resolveTargetDir(env = process.env) {
  const info = resolveUserToolsDir(env);
  if (info.dirs.length === 0) {
    return { dir: null, info };
  }
  return { dir: info.dirs[0], info };
}
