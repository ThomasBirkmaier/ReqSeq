// JSON text larger than one string (#697). V8 holds at most about 512 MB in one string, so an output
// such as `data.export` at N-036 cannot go through one `JSON.stringify`. `jsonChunks` gives exactly
// the text of `JSON.stringify(value, null, indent || undefined)` in pieces of about one chunk.
//
// It descends by size, not by depth: it walks into every plain object and array and hands a subtree
// to the native `JSON.stringify` only when `jsonByteLength` (with its early stop) says the subtree is
// at most one chunk, so any shape streams (a top-level array, `data.export`, an MCP message that holds
// the output some levels down). The extra work is the measuring: about one chunk for every walked
// node, plus one measuring pass over each subtree handed to the native call. The rules are those of
// `JSON.stringify`: `toJSON(key)` at every walked level (the native call does it below; inside a
// subtree handed to it, `toJSON` runs twice, once for the measuring), keys by
// `Object.keys`, `undefined`, functions and symbols left out of objects and `null` in arrays, number,
// string and boolean objects unwrapped, a BigInt and a circular structure a `TypeError`. A top-level
// value that gives no text (`undefined`) gives no chunk; what to print then is the caller's. Pieces
// are cut only between values, so a surrogate pair is never split. Native pieces are re-indented
// (`\n` becomes `\n` plus the padding of their level), which is exact because JSON strings never
// hold a raw line break.

/** About 1 MB: a chunk is cut once its pieces reach this length (UTF-16 code units). */
export const JSON_CHUNK_LENGTH = 1 << 20;

export interface JsonChunkOptions {
  /** 0 for compact JSON, 2 for `JSON.stringify(value, null, 2)`. */
  readonly indent: 0 | 2;
  /** The chunk length; default `JSON_CHUNK_LENGTH` (tests take small ones). */
  readonly chunkLength?: number;
}

/** A value `JSON.stringify` leaves out of an object (and writes as `null` in an array). */
const SKIPPED = -1;

/** Printable ASCII without `"` and `\`: such a string is its own JSON text between quotes. */
const PLAIN = /^[\x20\x21\x23-\x5b\x5d-\x7e]*$/;

const circular = (): TypeError => new TypeError("Converting circular structure to JSON");

/** The value `JSON.stringify` serialises for `value` under `key`: after `toJSON`, wrappers unwrapped. */
const resolved = (value: unknown, key: string | number): unknown => {
  let v = value;
  if ((typeof v === "object" && v !== null) || typeof v === "bigint") {
    const toJSON = (v as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === "function") {
      v = (toJSON as (key: string) => unknown).call(v, String(key));
    }
  }
  if (v instanceof Number) {
    return Number(v);
  }
  if (v instanceof String) {
    return String(v);
  }
  if (v instanceof Boolean) {
    return v.valueOf();
  }
  return v;
};

/** Whether `JSON.stringify` leaves a resolved value out (`undefined`, a function, a symbol). */
const isSkipped = (v: unknown): boolean =>
  v === undefined || typeof v === "function" || typeof v === "symbol";

/** Whether a resolved value is an object or array that the walk descends into. */
const isWalkable = (v: unknown): v is object => typeof v === "object" && v !== null;

const stringBytes = (s: string): number =>
  PLAIN.test(s) ? s.length + 2 : Buffer.byteLength(JSON.stringify(s));

/** UTF-8 bytes of the JSON of a resolved primitive, `SKIPPED` for one left out, undefined for an object or array. */
const primitiveBytes = (v: unknown): number | undefined => {
  switch (typeof v) {
    case "string":
      return stringBytes(v);
    case "number":
      return Number.isFinite(v) ? String(v).length : 4;
    case "boolean":
      return v ? 4 : 5;
    case "bigint":
      // Throws the TypeError of JSON.stringify ("Do not know how to serialize a BigInt").
      return JSON.stringify(v).length;
    case "object":
      return v === null ? 4 : undefined;
    case "undefined":
    case "function":
    case "symbol":
      return SKIPPED;
  }
};

/**
 * UTF-8 bytes of the compact JSON of a resolved value, `SKIPPED` for one left out; stops once the
 * count is over `budget` and returns the count so far. `stack` holds the objects being walked.
 */
const bytesOf = (v: unknown, budget: number, stack: Set<object>): number => {
  const primitive = primitiveBytes(v);
  if (primitive !== undefined) {
    return primitive;
  }
  const container = v as object;
  if (stack.has(container)) {
    throw circular();
  }
  stack.add(container);
  try {
    return Array.isArray(container)
      ? arrayBytes(container as readonly unknown[], budget, stack)
      : objectBytes(container as Readonly<Record<string, unknown>>, budget, stack);
  } finally {
    stack.delete(container);
  }
};

const arrayBytes = (items: readonly unknown[], budget: number, stack: Set<object>): number => {
  let total = 2;
  for (let i = 0; i < items.length && total <= budget; i += 1) {
    const size = bytesOf(resolved(items[i], i), budget - total, stack);
    total += (size === SKIPPED ? 4 : size) + (i > 0 ? 1 : 0);
  }
  return total;
};

const objectBytes = (
  record: Readonly<Record<string, unknown>>,
  budget: number,
  stack: Set<object>,
): number => {
  let total = 2;
  let count = 0;
  for (const key of Object.keys(record)) {
    if (total > budget) {
      break;
    }
    const size = bytesOf(resolved(record[key], key), budget - total, stack);
    if (size !== SKIPPED) {
      total += stringBytes(key) + 1 + size + (count > 0 ? 1 : 0);
      count += 1;
    }
  }
  return total;
};

/**
 * The UTF-8 length of `JSON.stringify(value)` (0 when it gives no text), counted without building the
 * text. Stops early once the count is over `atMost` and then returns some number above `atMost`.
 */
export const jsonByteLength = (value: unknown, atMost = Number.POSITIVE_INFINITY): number => {
  const size = bytesOf(resolved(value, ""), atMost, new Set());
  return size === SKIPPED ? 0 : size;
};

/** The text of `JSON.stringify(value, null, indent || undefined)` in pieces of about one chunk (see the file comment). */
export function* jsonChunks(value: unknown, options: JsonChunkOptions): Generator<string, void, undefined> {
  const chunkLength = options.chunkLength ?? JSON_CHUNK_LENGTH;
  const indented = options.indent === 2;
  const stack = new Set<object>();
  let pieces: string[] = [];
  let length = 0;

  const push = (piece: string): void => {
    pieces.push(piece);
    length += piece.length;
  };
  const take = (): string => {
    const chunk = pieces.join("");
    pieces = [];
    length = 0;
    return chunk;
  };
  const native = (v: object, pad: string): string => {
    if (!indented) {
      return JSON.stringify(v);
    }
    const text = JSON.stringify(v, null, 2);
    return pad === "" ? text : text.replaceAll("\n", `\n${pad}`);
  };

  /** Writes the items of a large array at the padding `pad`. */
  function* emitArray(items: readonly unknown[], pad: string): Generator<string, void, undefined> {
    const inner = indented ? `${pad}  ` : "";
    const newline = indented ? `\n${inner}` : "";
    push("[");
    for (let i = 0; i < items.length; i += 1) {
      push(i > 0 ? `,${newline}` : newline);
      const item = resolved(items[i], i);
      if (isSkipped(item)) {
        push("null");
      } else {
        yield* emit(item, inner);
      }
    }
    push(items.length > 0 && indented ? `\n${pad}]` : "]");
  }

  /** Writes the properties of a large object at the padding `pad`. */
  function* emitObject(
    record: Readonly<Record<string, unknown>>,
    pad: string,
  ): Generator<string, void, undefined> {
    const inner = indented ? `${pad}  ` : "";
    const newline = indented ? `\n${inner}` : "";
    const colon = indented ? ": " : ":";
    let count = 0;
    push("{");
    for (const key of Object.keys(record)) {
      const item = resolved(record[key], key);
      if (!isSkipped(item)) {
        push(`${count > 0 ? "," : ""}${newline}${JSON.stringify(key)}${colon}`);
        count += 1;
        yield* emit(item, inner);
      }
    }
    push(count > 0 && indented ? `\n${pad}}` : "}");
  }

  /** Writes a resolved value that is not left out, at the padding `pad`. */
  function* emit(v: unknown, pad: string): Generator<string, void, undefined> {
    if (!isWalkable(v)) {
      push(JSON.stringify(v));
    } else if (
      typeof (v as { toJSON?: unknown }).toJSON !== "function" &&
      bytesOf(v, chunkLength, stack) <= chunkLength
    ) {
      // Small enough for one native call. A value whose own toJSON is still callable (a toJSON that
      // returned such an object) is walked instead, since the native call would call it once more.
      push(native(v, pad));
    } else {
      stack.add(v);
      if (Array.isArray(v)) {
        yield* emitArray(v as readonly unknown[], pad);
      } else {
        yield* emitObject(v as Readonly<Record<string, unknown>>, pad);
      }
      stack.delete(v);
    }
    if (length >= chunkLength) {
      yield take();
    }
  }

  const top = resolved(value, "");
  if (isSkipped(top)) {
    return;
  }
  yield* emit(top, "");
  if (length > 0) {
    yield take();
  }
}
