// Private files of LogReq outside the working tree, e.g. the token file of the local API in the cache
// folder (ADR-0008, ADR-0009). They belong to LogReq alone: a write replaces the file without the
// changed-on-disk check of element and YAML files. Only the owner may read them (folder 0700, file 0600 on
// POSIX; on Windows the cache folder in the user profile is private to the user already).
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { retry, TRANSIENT_CODES } from "./retry.js";

const removeQuietly = async (file: string): Promise<void> => {
  try {
    await fs.rm(file, { force: true });
  } catch {
    // A leftover temp file matches TEMP_FILE_PATTERN and is ignored by watchers and listings.
  }
};

/**
 * Write `text` as UTF-8 to the absolute path `file` atomically: a temp file next to it, created with mode
 * 0600 and fsynced, then renamed over the target. Missing folders are created with mode 0700. Rejects with
 * the Node error when the folder cannot be created or written.
 */
export async function writePrivateFile(file: string, text: string): Promise<void> {
  const folder = path.dirname(file);
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  const temp = path.join(folder, `.${path.basename(file)}.${randomBytes(4).toString("hex")}.logreq-tmp`);
  try {
    const handle = await fs.open(temp, "wx", 0o600);
    try {
      await handle.writeFile(text, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await retry(() => fs.rename(temp, file), TRANSIENT_CODES);
  } catch (error) {
    await removeQuietly(temp);
    throw error;
  }
}

/**
 * Remove the private file `file` (absolute path) if it is there; a missing file is fine. Rejects with the Node
 * error when it cannot be removed. Only for LogReq's own files outside the working tree, never for elements
 * (D-045).
 */
export async function removePrivateFile(file: string): Promise<void> {
  await retry(() => fs.rm(file, { force: true }), TRANSIENT_CODES);
}
