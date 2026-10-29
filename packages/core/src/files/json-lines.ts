// JSON Lines of a command output (#319, SR-061 AK4; ADR-0009): what `data export --jsonl` prints, what
// the API sends for `Accept: application/x-ndjson` and, with SR-062, what `data.store` writes. The
// catalog entry's `jsonLines` names the top-level array whose items become the lines (`items`) and the
// top-level fields every line carries first (`fields`, in that order; one the output leaves out is
// left out). Each line is one native `JSON.stringify` of those fields and the item's keys, then LF:
// compact, UTF-8 when written, no BOM. The other top-level fields are not in the lines. Lines are
// joined into chunks of about `JSON_CHUNK_LENGTH`, cut only after a line, so no string holds the
// whole text (which V8 cannot hold at N-036, #277). `catalog-checks.mjs` makes sure no field is also
// a key of an item.
import { JSON_CHUNK_LENGTH } from "./json-text.js";

/** The `jsonLines` field of a catalog entry. */
export interface JsonLinesSpec {
  readonly items: string;
  readonly fields: readonly string[];
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The JSON Lines of `output` by `spec` in chunks (see the file comment); nothing for no items. */
export function* jsonLines(
  output: unknown,
  spec: JsonLinesSpec,
  chunkLength: number = JSON_CHUNK_LENGTH,
): Generator<string, void, undefined> {
  const items = isRecord(output) ? output[spec.items] : undefined;
  if (!isRecord(output) || !Array.isArray(items)) {
    throw new TypeError(`The output has no array ${spec.items} to give as JSON Lines`);
  }
  const state: Record<string, unknown> = {};
  for (const field of spec.fields) {
    if (output[field] !== undefined) {
      state[field] = output[field];
    }
  }
  let pieces: string[] = [];
  let length = 0;
  for (const item of items as readonly unknown[]) {
    if (!isRecord(item)) {
      throw new TypeError(`An item of ${spec.items} is not an object`);
    }
    const line = `${JSON.stringify({ ...state, ...item })}\n`;
    pieces.push(line);
    length += line.length;
    if (length >= chunkLength) {
      yield pieces.join("");
      pieces = [];
      length = 0;
    }
  }
  if (length > 0) {
    yield pieces.join("");
  }
}
