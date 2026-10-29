// Whether a file is a LogReq data file (`data.store`, SR-062 AK1; #319): JSON Lines whose first line
// starts with `"logreq-data"` as the first key, with an integer of at least 2, within the first MiB;
// and valid UTF-8 (a sequence cut at the very end is allowed, see below). No later line is scanned:
// the first line is the signature, and a file of LogReq that a crash cut in the middle (the in-place
// write where the file system has no hard links) is still LogReq's and is replaced on the next run,
// instead of blocking the pipeline for that commit until someone removes it (review PS3). An empty
// file holds nothing to lose and counts too (a selection without elements gives one). One check
// serves the guard before a data file is replaced (`isJsonlDataFile`, `readJsonlFile`) and the
// `jsonl` refusal of `writeFileAtomic`, so the two never disagree. The file is read in pieces and
// hashed as it goes: it may be larger than one string (about 0.55 GB at N-036) and is never held
// whole.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";

/** The first line must end within this many bytes (1 MiB). */
export const DATA_HEAD_BYTES = 1024 * 1024;

/** The pieces a file is read in. */
const PIECE_BYTES = 1024 * 1024;

const LF = 0x0a;
const CR = 0x0d;

/** `"logreq-data"` first, then the version: the start of every line LogReq writes (`jsonLines`). */
const FIRST_KEY = /^\{[\t\n\r ]*"logreq-data"[\t\n\r ]*:/;

/** What a check over all pieces of a file gives. */
export interface JsonlDataResult {
  readonly size: number;
  readonly sha256: string;
  /** A LogReq data file (see the file comment). */
  readonly dataFile: boolean;
}

/** Whether `line` (without its LF) is the first line of a LogReq data file. */
const isFirstLine = (line: Uint8Array): boolean => {
  const end = line.byteLength > 0 && line[line.byteLength - 1] === CR ? line.byteLength - 1 : line.byteLength;
  let text: string;
  let value: unknown;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(line.subarray(0, end));
    value = JSON.parse(text);
  } catch {
    return false;
  }
  if (!FIRST_KEY.test(text) || typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const version = (value as Record<string, unknown>)["logreq-data"];
  return typeof version === "number" && Number.isInteger(version) && version >= 2;
};

/** The check of `isJsonlDataFile` over the pieces of a file, in order. */
export class JsonlDataCheck {
  readonly #hash = createHash("sha256");
  readonly #decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  #size = 0;
  #utf8 = true;
  /** The bytes before the first LF, while it has not come and they are within DATA_HEAD_BYTES. */
  #head: Uint8Array[] = [];
  #headBytes = 0;
  /** Undefined until the first LF came or the head is over the bound. */
  #first: boolean | undefined;

  update(piece: Uint8Array): void {
    this.#hash.update(piece);
    this.#size += piece.byteLength;
    if (this.#utf8) {
      try {
        this.#decoder.decode(piece, { stream: true });
      } catch {
        this.#utf8 = false;
      }
    }
    if (this.#first === undefined) {
      const lf = piece.indexOf(LF);
      const part = lf === -1 ? piece : piece.subarray(0, lf);
      // A copy: the caller may reuse the piece's memory for the next one.
      this.#head.push(Buffer.from(part));
      this.#headBytes += part.byteLength;
      if (this.#headBytes > DATA_HEAD_BYTES) {
        this.#first = false;
      } else if (lf !== -1) {
        this.#first = isFirstLine(Buffer.concat(this.#head));
      }
      if (this.#first !== undefined) {
        this.#head = [];
      }
    }
  }

  /** The result; a UTF-8 sequence cut at the end of the file is not checked (a cut file stays LogReq's). */
  finish(): JsonlDataResult {
    // A first line without LF: the whole file is that line (a file cut inside it is not recognised).
    const first = this.#first ?? (this.#size === 0 || isFirstLine(Buffer.concat(this.#head)));
    return {
      size: this.#size,
      sha256: this.#hash.digest("hex"),
      dataFile: this.#utf8 && first,
    };
  }
}

/** Whether `bytes` are a LogReq data file (see the file comment). */
export const isJsonlDataFile = (bytes: Uint8Array): boolean => {
  const check = new JsonlDataCheck();
  check.update(bytes);
  return check.finish().dataFile;
};

/** The check of the file at `absolute`, read in pieces of 1 MiB; rejects with the Node error (ENOENT, ...). */
export const readJsonlFile = async (absolute: string): Promise<JsonlDataResult> => {
  const handle = await fs.open(absolute, "r");
  try {
    const check = new JsonlDataCheck();
    const buffer = Buffer.alloc(PIECE_BYTES);
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, PIECE_BYTES, null);
      if (bytesRead === 0) {
        return check.finish();
      }
      check.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
};
