// The ReqIF file of an import or analysis (ADR-0013 "Import"): read as a regular file of at most
// `REQIF_LIMITS.bytes`, then parsed; `file.faulty` or `reqif.invalid` before anything else.
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { CommandError } from "../catalog.js";
import type { ReqifFile } from "./model.js";
import { REQIF_LIMITS, parseReqif } from "./parse.js";

/** Opening never waits: a FIFO in place of the file opens at once and is then no file (no O_NONBLOCK on Windows). */
const READ_NOW = constants.O_RDONLY | constants.O_NONBLOCK;

/** Bytes read at a time. */
const CHUNK = 1024 * 1024;

/**
 * The bytes of the ReqIF file at the local path `given`. The limit holds for the bytes read, not for
 * a size looked at before, so a file growing meanwhile is refused too; a FIFO or device is no file.
 */
const readBytes = async (root: string, given: string): Promise<Uint8Array> => {
  const absolute = path.resolve(root, given);
  const name = path.basename(absolute);
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(absolute, READ_NOW);
  } catch (error) {
    throw new CommandError(
      "file.faulty",
      `file: cannot read ${name}: ${String((error as NodeJS.ErrnoException).code)}`,
      { fields: ["file"] },
    );
  }
  try {
    if (!(await handle.stat()).isFile()) {
      throw new CommandError("file.faulty", `file: ${name} is not a file`, { fields: ["file"] });
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const chunk = Buffer.alloc(CHUNK);
      const { bytesRead } = await handle.read(chunk, 0, CHUNK, null);
      if (bytesRead === 0) {
        return Buffer.concat(chunks, total);
      }
      total += bytesRead;
      if (total > REQIF_LIMITS.bytes) {
        throw new CommandError(
          "reqif.invalid",
          `file: ${name} is larger than ${String(REQIF_LIMITS.bytes)} bytes, the most ReqSeq reads`,
          { fields: ["file"] },
        );
      }
      chunks.push(chunk.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
};

/** The parsed ReqIF file at the local path `given` (relative to `root`); `reqif.invalid` when it is none. */
export const readDelivery = async (root: string, given: string): Promise<ReqifFile> => {
  const parsed = parseReqif(await readBytes(root, given));
  if (parsed.kind === "refused") {
    throw new CommandError("reqif.invalid", `file: line ${String(parsed.line)}: ${parsed.message}`, {
      fields: ["file"],
      line: parsed.line,
    });
  }
  return parsed.file;
};
