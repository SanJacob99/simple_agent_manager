/**
 * `sam list tools` — table of installed user tools.
 *
 * Walks the resolved user-tools directory, reads each subdirectory's
 * sam.json, and prints NAME | VERSION | SOURCE | STATE. Subdirectories
 * starting with "." (e.g. `.sam-staging-*` left behind by a crashed
 * install) are skipped.
 *
 * Read-only. Never mutates the filesystem.
 */

import fs from 'fs';
import path from 'path';
import { resolveTargetDir } from '../lib/install-target.js';
import { manifestPath } from '../lib/manifest.js';

export async function runList(args) {
  if (args[0] !== 'tools') {
    console.error('sam: usage: sam list tools');
    process.exit(2);
  }

  const { dir, info } = resolveTargetDir();
  if (!dir) {
    console.log(`(user tools ${info.describe})`);
    return;
  }
  if (!fs.existsSync(dir)) {
    console.log(`(no user tools — ${dir} does not exist yet)`);
    return;
  }

  const subdirs = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'));

  if (subdirs.length === 0) {
    console.log(`(no user tools installed in ${dir})`);
    return;
  }

  const rows = [];
  for (const entry of subdirs) {
    const toolDir = path.join(dir, entry.name);
    const mPath = manifestPath(toolDir);
    if (!fs.existsSync(mPath)) {
      rows.push({ cells: [entry.name, '?', '?', 'no manifest'], dim: false });
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(mPath, 'utf8'));
    } catch (err) {
      rows.push({
        cells: [entry.name, '?', '?', `invalid (${err.message})`],
        dim: false,
      });
      continue;
    }
    const disabled = parsed.disabled === true;
    rows.push({
      cells: [
        typeof parsed.name === 'string' ? parsed.name : entry.name,
        typeof parsed.version === 'string' ? parsed.version : '?',
        typeof parsed.source === 'string' ? parsed.source : '?',
        disabled ? 'disabled' : 'enabled',
      ],
      dim: disabled,
    });
  }

  printTable(['NAME', 'VERSION', 'SOURCE', 'STATE'], rows);
}

function printTable(headers, rows) {
  // Dim ANSI is widely supported (Windows Terminal, modern conhost, Git
  // Bash, VS Code). NO_COLOR / non-TTY suppress it.
  const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
  const dim = (s) => (useColor ? `\x1b[2m${s}\x1b[0m` : s);

  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r.cells[i]).length)),
  );
  const pad = (s, w) => String(s).padEnd(w, ' ');
  const line = (cols) => cols.map((c, i) => pad(c, widths[i])).join('  ');

  console.log(line(headers));
  console.log(line(headers.map((_, i) => '-'.repeat(widths[i]))));
  for (const r of rows) {
    const text = line(r.cells);
    console.log(r.dim ? dim(text) : text);
  }
}
