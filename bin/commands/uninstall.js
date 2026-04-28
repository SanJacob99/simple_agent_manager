/**
 * `sam uninstall tool <name>` — destructive removal of a user-installed
 * tool directory. Type-the-name confirmation prompt.
 */

import fs from 'fs';
import path from 'path';
import { resolveTargetDir } from '../lib/install-target.js';
import { prompt } from '../lib/prompt.js';

export async function runUninstall(args) {
  if (args[0] !== 'tool' || !args[1]) {
    console.error('sam: usage: sam uninstall tool <name>');
    process.exit(2);
  }
  const name = args[1];

  const { dir, info } = resolveTargetDir();
  if (!dir) {
    console.error(`sam: cannot uninstall — user tools ${info.describe}.`);
    process.exit(2);
  }
  const targetDir = path.join(dir, name);
  if (!fs.existsSync(targetDir)) {
    console.error(`sam: no installed tool named "${name}" at ${targetDir}.`);
    process.exit(2);
  }

  console.log(`This will delete ${targetDir} and everything inside it.`);
  const answer = (await prompt('Type the tool name to confirm: ')).trim();
  if (answer !== name) {
    console.error('sam: aborted (input did not match tool name).');
    process.exit(2);
  }

  fs.rmSync(targetDir, { recursive: true, force: true });
  console.log(`sam: removed ${name}.`);
  console.log('Restart the backend for the change to take effect.');
}
