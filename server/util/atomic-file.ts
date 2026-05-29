import fs from 'fs/promises';
import path from 'path';

let tmpCounter = 0;

/**
 * Write a file atomically: stream the bytes into a sibling temp file, fsync,
 * then `rename()` over the target. `rename` is atomic on a single filesystem
 * (and overwrites the destination on both POSIX and Windows via libuv's
 * MOVEFILE_REPLACE_EXISTING), so a crash or ENOSPC mid-write can never leave
 * a half-written file in place of the real one — readers always see either
 * the old contents or the fully new contents.
 *
 * The temp file lives in the same directory as the target so the rename stays
 * on the same volume (a cross-device rename would fall back to a non-atomic
 * copy). The parent directory is created if missing.
 */
export async function writeFileAtomic(
  filePath: string,
  data: string | Uint8Array,
): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${tmpCounter++}.tmp`,
  );

  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(tmp, 'w');
    await handle.writeFile(data, 'utf-8');
    try {
      await handle.sync();
    } catch {
      // fsync can be unsupported on some filesystems; the rename below still
      // gives us atomicity of visibility even without the durability flush.
    }
  } finally {
    await handle?.close();
  }

  try {
    await fs.rename(tmp, filePath);
  } catch (err) {
    // Best-effort cleanup of the temp file if the rename failed.
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}
