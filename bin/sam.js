#!/usr/bin/env node
/**
 * SAM CLI — entry point.
 *
 * Dispatcher only. Each command lives in `bin/commands/<name>.js`
 * and is loaded lazily so the help/version path stays cheap and
 * a broken command file can't break unrelated commands.
 *
 * Plain ESM JavaScript on purpose — keeps the npm `bin` entry
 * runnable without a TypeScript loader.
 */

import fs from 'fs';
import { fileURLToPath } from 'url';

const PKG_PATH = fileURLToPath(new URL('../package.json', import.meta.url));

function readVersion() {
  const raw = fs.readFileSync(PKG_PATH, 'utf8');
  return JSON.parse(raw).version;
}

function printHelp() {
  console.log(`SAM CLI

Usage: sam <command> [args...]

Commands:
  help                  Show this message.
  version               Print the SAM version.
  diagnose              Probe the local backend and report status.
  install tool <url>    Fetch a user tool from a GitHub repo.
  uninstall tool <name> Remove an installed user tool (asks to confirm).
  list tools            List installed user tools and their state.
  enable tool <name>    Enable an installed user tool (flip sam.json flag).
  disable tool <name>   Disable an installed user tool (flip sam.json flag).
  restart               Restart the local backend (detached supervisor).

Run \`sam help\` at any time for this list.`);
}

function printVersion() {
  console.log(readVersion());
}

function unknown(args) {
  const joined = args.join(' ');
  console.error(`sam: unknown command "${joined}". Run "sam help" for usage.`);
  process.exit(2);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printHelp();
    return;
  }

  const head = args[0];

  if (head === 'help' || head === '--help' || head === '-h') {
    printHelp();
    return;
  }

  if (head === 'version' || head === '--version' || head === '-v') {
    printVersion();
    return;
  }

  if (head === 'diagnose') {
    const { runDiagnose } = await import('./commands/diagnose.js');
    await runDiagnose();
    return;
  }

  if (head === 'install') {
    const { runInstall } = await import('./commands/install.js');
    await runInstall(args.slice(1));
    return;
  }

  if (head === 'uninstall') {
    const { runUninstall } = await import('./commands/uninstall.js');
    await runUninstall(args.slice(1));
    return;
  }

  if (head === 'list') {
    const { runList } = await import('./commands/list.js');
    await runList(args.slice(1));
    return;
  }

  if (head === 'restart') {
    const { runRestart } = await import('./commands/restart.js');
    await runRestart(args.slice(1));
    return;
  }

  if (head === 'enable' || head === 'disable') {
    const { runToggle } = await import('./commands/toggle.js');
    await runToggle(head, args.slice(1));
    return;
  }

  unknown(args);
}

main().catch((err) => {
  console.error(`sam: ${err?.stack ?? err}`);
  process.exit(1);
});
