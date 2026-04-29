/**
 * `sam install tool <github-url>` — fetch a tool from a GitHub repo.
 *
 * Flow:
 *   1. Parse the URL (only github.com is accepted).
 *   2. Resolve the install target dir (honors SAM_USER_TOOLS_DIR /
 *      SAM_DISABLE_USER_TOOLS — same precedence the server uses).
 *   3. Refuse if the per-tool subdir already exists.
 *   4. Download the tarball from codeload.github.com to OS temp.
 *   5. Extract into a `.sam-staging-*` directory next to the final
 *      target — same filesystem, so the final move is a rename.
 *   6. Validate the archive root contains either a sam.json or at
 *      least one *.module.ts. Otherwise refuse.
 *   7. Synthesize a sam.json if the archive didn't ship one.
 *   8. Rename staging-root -> target dir, clean up tmp/staging on
 *      both success and failure.
 *
 * Tar extraction uses the system `tar` binary (Windows 10+ ships it
 * at C:\Windows\System32\tar.exe; macOS/Linux have it built in). We
 * lean on that instead of pulling in a Node tar dependency.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { resolveTargetDir } from '../lib/install-target.js';
import { parseGithubUrl } from '../lib/github-url.js';
import {
  manifestPath,
  readManifest,
  writeManifest,
  synthesizeManifest,
  MANIFEST_FILENAME,
} from '../lib/manifest.js';

export async function runInstall(args) {
  if (args[0] !== 'tool' || !args[1]) {
    console.error('sam: usage: sam install tool <github-url>');
    process.exit(2);
  }

  let parsed;
  try {
    parsed = parseGithubUrl(args[1]);
  } catch (err) {
    console.error(`sam: ${err.message}`);
    process.exit(2);
  }

  const { dir: userDir, info } = resolveTargetDir();
  if (!userDir) {
    console.error(`sam: cannot install — user tools ${info.describe}.`);
    process.exit(2);
  }

  fs.mkdirSync(userDir, { recursive: true });
  const targetDir = path.join(userDir, parsed.repo);
  if (fs.existsSync(targetDir)) {
    console.error(
      `sam: ${targetDir} already exists. Use \`sam uninstall tool ${parsed.repo}\` first.`,
    );
    process.exit(2);
  }

  const tarPath = path.join(
    os.tmpdir(),
    `sam-install-${process.pid}-${Date.now()}.tar.gz`,
  );
  // Stage inside `userDir` so the final move is a same-filesystem rename
  // (no EXDEV on Windows when /tmp is on a different drive).
  const stagingDir = path.join(
    userDir,
    `.sam-staging-${process.pid}-${Date.now()}`,
  );
  fs.mkdirSync(stagingDir, { recursive: true });

  let succeeded = false;
  try {
    console.log(`sam: fetching ${parsed.codeloadUrl}`);
    await downloadFile(parsed.codeloadUrl, tarPath);

    console.log('sam: extracting');
    runTar(tarPath, stagingDir);

    // GitHub tars contain a single top-level directory like `<repo>-<ref>`.
    const stagedEntries = fs
      .readdirSync(stagingDir, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.'));
    if (stagedEntries.length !== 1 || !stagedEntries[0].isDirectory()) {
      throw new Error(
        `Expected one top-level directory in archive, got ${stagedEntries
          .map((e) => e.name)
          .join(', ') || '(none)'}.`,
      );
    }
    const archiveRoot = path.join(stagingDir, stagedEntries[0].name);

    const archiveFiles = fs.readdirSync(archiveRoot);
    const hasManifest = archiveFiles.includes(MANIFEST_FILENAME);
    const hasModule = archiveFiles.some((f) => f.endsWith('.module.ts'));
    if (!hasManifest && !hasModule) {
      throw new Error(
        `Archive root has no ${MANIFEST_FILENAME} and no *.module.ts. Refusing to install ` +
          `(this does not look like a SAM user tool).`,
      );
    }

    if (hasManifest) {
      try {
        readManifest(archiveRoot);
      } catch (err) {
        throw new Error(`Existing ${MANIFEST_FILENAME} is invalid: ${err.message}`);
      }
    } else {
      const synth = synthesizeManifest({ name: parsed.repo, source: parsed.sourceUrl });
      writeManifest(archiveRoot, synth);
      console.log(`sam: synthesized ${MANIFEST_FILENAME} (please fill in the TODO fields)`);
    }

    fs.renameSync(archiveRoot, targetDir);
    succeeded = true;

    const final = readManifest(targetDir);
    console.log('');
    console.log('Installed:');
    console.log(`  name     ${final.name}`);
    console.log(`  version  ${final.version}`);
    console.log(`  source   ${final.source}`);
    console.log(`  path     ${targetDir}`);
    console.log('');
    console.log(
      'Restart the backend (`sam restart`, or stop+restart `npm run dev:server`) for the new tool to load.',
    );
  } catch (err) {
    console.error(`sam: install failed — ${err.message}`);
    if (!succeeded) {
      // If we failed mid-rename, the partial target shouldn't exist; only clean staging/tar.
    }
    process.exitCode = 1;
  } finally {
    safeRm(stagingDir);
    safeRm(tarPath);
  }
}

function runTar(tarPath, destDir) {
  // On Windows, prefer the OS-native bsdtar at C:\Windows\System32\tar.exe.
  // Git Bash on Windows ships GNU tar on PATH, which parses `C:\...` as a
  // `host:path` remote-tape spec and fails with "Cannot connect to C".
  // GNU tar accepts `--force-local` to suppress that; bsdtar does not.
  if (process.platform === 'win32') {
    const sysTar = 'C:\\Windows\\System32\\tar.exe';
    if (fs.existsSync(sysTar)) {
      execFileSync(sysTar, ['-xzf', tarPath, '-C', destDir], { stdio: 'inherit' });
      return;
    }
    execFileSync('tar', ['--force-local', '-xzf', tarPath, '-C', destDir], {
      stdio: 'inherit',
    });
    return;
  }
  execFileSync('tar', ['-xzf', tarPath, '-C', destDir], { stdio: 'inherit' });
}

async function downloadFile(url, destPath) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
}

function safeRm(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}
