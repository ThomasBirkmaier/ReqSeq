// Whether a JSON file is a LogReq data file (`data.store`, SR-062; #277). One check serves the guard
// before a data file is replaced (`isDataFile` of the data block) and the `json` refusal of
// `writeFileAtomic`, so the two never disagree. Up to `fullParseUpTo` bytes the file is parsed whole,
// as UTF-8 JSON. A larger file may not fit into one string (V8 holds at most about 512 MB), so above
// the bound only the frame of a data file is checked: an optional byte order mark, then `{`,
// `"logreq-data"`, `:`, `1` and `,` at the start and `}` at the end, with any JSON whitespace around
// and between them (CRLF, the indentation of `data export --json`), so a file above the bound is
// judged like the same file below it; and valid UTF-8 in the first and the last MiB, each cut at a
// code-point boundary. Assumption (#277, how only): a larger file with that frame is treated as a
// LogReq data file.

/** Up to this size (64 MiB) a JSON file is parsed whole. */
export const JSON_FULL_PARSE_BYTES = 64 * 1024 * 1024;

/** The part at each end of a larger file whose UTF-8 is checked. */
const EDGE_BYTES = 1024 * 1024;

/** The tokens of the start of the frame, in order; JSON whitespace may stand around each. */
const FRAME_START = ["{", '"logreq-data"', ":", "1", ","].map((token) => Buffer.from(token, "utf8"));
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const CLOSE = 0x7d;

/** Space, tab, line feed, carriage return (RFC 8259). */
const isJsonSpace = (byte: number | undefined): boolean =>
  byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;

/**
 * What a JSON file is: `data` a LogReq data file (parsed: an object with `"logreq-data": 1`; above
 * the bound: the frame), `json` readable JSON of another kind, `faulty` no readable UTF-8 JSON,
 * `unchecked` above the bound without the frame (not read whole, so not known to be JSON).
 */
export type JsonDataKind = "data" | "json" | "faulty" | "unchecked";

const isContinuation = (byte: number | undefined): boolean => byte !== undefined && (byte & 0xc0) === 0x80;

const validUtf8 = (bytes: Uint8Array): boolean => {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
};

/** Whether the first MiB starts with the tokens of the frame (see the file comment). */
const startsFramed = (bytes: Buffer): boolean => {
  const limit = Math.min(EDGE_BYTES, bytes.length);
  let at = bytes.subarray(0, BOM.length).equals(BOM) ? BOM.length : 0;
  for (const token of FRAME_START) {
    while (at < limit && isJsonSpace(bytes[at])) {
      at += 1;
    }
    if (!bytes.subarray(at, at + token.length).equals(token)) {
      return false;
    }
    at += token.length;
  }
  return true;
};

/** Whether the last MiB ends with `}` and JSON whitespace only. */
const endsFramed = (bytes: Buffer): boolean => {
  const limit = Math.max(0, bytes.length - EDGE_BYTES);
  let at = bytes.length - 1;
  while (at > limit && isJsonSpace(bytes[at])) {
    at -= 1;
  }
  return bytes[at] === CLOSE;
};

/** The frame check of a file above the bound (see the file comment). */
const framed = (bytes: Buffer): boolean => {
  if (!startsFramed(bytes) || !endsFramed(bytes)) {
    return false;
  }
  // A UTF-8 sequence has at most three continuation bytes: move each cut off them, so that a
  // character across the edge is neither split nor counted as faulty.
  let end = Math.min(EDGE_BYTES, bytes.length);
  for (let step = 0; step < 3 && isContinuation(bytes[end]); step += 1) {
    end -= 1;
  }
  let start = Math.max(0, bytes.length - EDGE_BYTES);
  for (let step = 0; step < 3 && isContinuation(bytes[start]); step += 1) {
    start += 1;
  }
  return validUtf8(bytes.subarray(0, end)) && validUtf8(bytes.subarray(start));
};

/** What the JSON file `bytes` is (see `JsonDataKind`); files over `fullParseUpTo` bytes get the frame check. */
export const jsonDataKind = (
  bytes: Uint8Array,
  fullParseUpTo: number = JSON_FULL_PARSE_BYTES,
): JsonDataKind => {
  if (bytes.byteLength > fullParseUpTo) {
    return framed(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)) ? "data" : "unchecked";
  }
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return "faulty";
  }
  return typeof data === "object" && data !== null && (data as Record<string, unknown>)["logreq-data"] === 1
    ? "data"
    : "json";
};
