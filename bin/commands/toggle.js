/**
 * `sam enable tool <name>` and `sam disable tool <name>` — flip the
 * `disabled` flag in the tool's sam.json. The server reads this on
 * startup; the user must restart for the change to take effect.
 *
 * Same module handles both verbs since the only difference is the flag
 * value and the message text.
 */

import path from 'path';
import { resolveTargetDir } from '../lib/install-target.js';
import { readManifest, writeManifest, manifestPath } from '../lib/manifest.js';

export async function runToggle(verb, args) {
  if (verb !== 'enable' && verb !== 'disable') {
    throw new Error(`runToggle: unknown verb "${verb}"`);
  }
  if (args[0] !== 'tool' || !args[1]) {
    console.error(`sam: usage: sam ${verb} tool <name>`);
    process.exit(2);
  }
  const name = args[1];
  const targetDisabled = verb === 'disable';

  const { dir, info } = resolveTargetDir();
  if (!dir) {
    console.error(`sam: cannot ${verb} — user tools ${info.describe}.`);
    process.exit(2);
  }
  const toolDir = path.join(dir, name);

  let manifest;
  try {
    manifest = readManifest(toolDir);
  } catch (err) {
    console.error(`sam: ${err.message}`);
    process.exit(2);
  }
  if (manifest === null) {
    console.error(`sam: no ${manifestPath(toolDir)} — is "${name}" installed?`);
    process.exit(2);
  }

  if (manifest.disabled === targetDisabled) {
    console.log(`sam: ${name} is already ${targetDisabled ? 'disabled' : 'enabled'}.`);
    return;
  }

  manifest.disabled = targetDisabled;
  writeManifest(toolDir, manifest);
  console.log(`sam: ${name} ${targetDisabled ? 'disabled' : 'enabled'}.`);
  console.log('Run `sam restart` (or restart the backend) for the change to take effect.');
}
