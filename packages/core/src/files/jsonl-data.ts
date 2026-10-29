// Whether a file is a ReqSeq data file (`data.store`, SR-062 AK1; #319): JSON Lines whose first line
// starts with `{"reqseq-data":` and an integer of at least 2 (the signature), within the first MiB;
// and valid UTF-8 (a sequence cut at the very end is allowed, see below). Only the start of the first
// line is read, so a first element larger than one MiB does not block the next run. No later line is scanned:
// the first line is the signature, and a file of ReqSeq that a crash cut in the middle (the in-place
// write where the file system has no hard links) is still ReqSeq's and is replaced on the next run,
// instead of blocking the pipeline for that commit until someone removes it (review PS3). An empty
// file holds nothing to lose and counts too (a selection without elements gives one). One check
// serves the guard before a data file is replaced (`isJsonlDataFile`, `readJsonlFile`) and the
// `jsonl` refusal of `writeFileAtomic`, so the two never disagree. The file is read in pieces and
// hashed as it goes: it may be larger than one string (about 0.55 GB at N-036) and is never held
// whole.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";

/** The signature must lie within this many bytes (1 MiB). */
export const DATA_HEAD_BYTES = 1024 * 1024;

/** The pieces a file is read in. */
const PIECE_BYTES = 1024 * 1024;

const LF = 0x0a;

/** `"reqseq-data"` first, then the version and the end of that value: the start of every line ReqSeq writes (`jsonLines`). */
const SIGNATURE = /^\{[\t\r ]*"reqseq-data"[\t\r ]*:[\t\r ]*([1-9][0-9]*)[\t\r ]*[,}]/;

/** What a check over all pieces of a file gives. */
export interface JsonlDataResult {
  readonly size: number;
  readonly sha256: string;
  /** A ReqSeq data file (see the file comment). */
  readonly dataFile: boolean;
}

/** Whether `head` (the start of the first line, without its LF) holds the signature of a ReqSeq data file. */
const isFirstLine = (head: Buffer): boolean => {
  // The signature is ASCII; a byte outside it fails the pattern, and UTF-8 is checked on its own.
  const match = SIGNATURE.exec(head.toString("latin1"));
  return match !== null && Number(match[1]) >= 2;
};

/** The check of `isJsonlDataFile` over the pieces of a file, in order. */
export class JsonlDataCheck {
  readonly #hash = createHash("sha256");
  readonly #decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  #size = 0;
  #utf8 = true;
  /** The bytes before the first LF, until it comes or they reach DATA_HEAD_BYTES. */
  #head: Uint8Array[] = [];
  #headBytes = 0;
  /** Undefined until the first LF came or the head reached the bound. */
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
      if (lf !== -1 || this.#headBytes >= DATA_HEAD_BYTES) {
        this.#first = isFirstLine(Buffer.concat(this.#head).subarray(0, DATA_HEAD_BYTES));
      }
      if (this.#first !== undefined) {
        this.#head = [];
      }
    }
  }

  /** The result; a UTF-8 sequence cut at the end of the file is not checked (a cut file stays ReqSeq's). */
  finish(): JsonlDataResult {
    // A first line without LF: the whole file is that line (a file cut inside the signature is not recognised).
    const first = this.#first ?? (this.#size === 0 || isFirstLine(Buffer.concat(this.#head)));
    return {
      size: this.#size,
      sha256: this.#hash.digest("hex"),
      dataFile: this.#utf8 && first,
    };
  }
}

/** Whether `bytes` are a ReqSeq data file (see the file comment). */
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
