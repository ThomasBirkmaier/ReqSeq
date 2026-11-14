// The record of a buffer that is not drawn in advance by reading (SR-212 AK5): the answers its shown view got
// from core, so the fresh view mounted hidden after the reader leaves it draws from them without a read of the
// workspace. A record holds the answers of one generation of the workspace and one view-bound call; a change
// of either makes it void, and a read it cannot answer is a miss: the hidden view is then dropped
// (`BufferArea.tsx`). Pure display (ADR-0002 rule 3): it knows the reads only by name, and the paged ones by
// the parts of their output that hold one entry per row.
import type { Answer, Call } from "./call.js";
import { AS_FIELD, IN_SELECTION } from "./views.js";

/** The reads a record keeps: every command a view of a buffer reads with. A write is never kept. */
export const RECORDED: ReadonlySet<string> = new Set([
  ...IN_SELECTION,
  ...AS_FIELD,
  "element.get",
  "metamodel.get",
  "perspective.list",
  // The matrix asks what may be related per type of row (SR-199 AK3).
  "relation.options",
]);

/**
 * The parts of a paged read's output with one entry per row, in the order of the rows; `names` of the matrix
 * is a list of the elements named, each once.
 */
const PAGED: Readonly<Record<string, readonly string[]>> = {
  "element.list": ["elements", "partial", "tree", "rowVerification"],
  "element.search": ["hits", "rowVerification"],
  "trace.matrix": ["rows"],
};

/** The part of a paged output that counts its rows. */
const ROWS: Readonly<Record<string, string>> = {
  "element.search": "hits",
  "trace.matrix": "rows",
};

/** At most this many answers in a record; one more is not kept, and the record misses from then on. */
export const RECORD_MAX = 64;

type Input = Readonly<Record<string, unknown>>;
type Output = Readonly<Record<string, unknown>>;

interface Piece {
  readonly offset: number;
  readonly limit: number;
  readonly output: Output;
}

/** What a page of `name` holds of its rows. */
const rowsOf = (name: string, output: Output): readonly unknown[] => {
  const part = ROWS[name] ?? (output["partial"] === undefined ? "elements" : "partial");
  const rows: unknown = output[part];
  return Array.isArray(rows) ? (rows as readonly unknown[]) : [];
};

/** The input without its page: what two pages of one list share. */
const listKey = (name: string, input: Input): string => {
  const { offset: _offset, limit: _limit, ...rest } = input;
  return `${name}\n${JSON.stringify(rest)}`;
};

const exactKey = (name: string, input: Input): string => `${name}\n${JSON.stringify(input)}`;

const numberOr = (value: unknown, otherwise: number | undefined): number | undefined =>
  typeof value === "number" ? value : otherwise;

/** The elements that the pages name, each once, in the order first named (`trace.matrix` `names`). */
const namesOf = (pieces: readonly Output[]): unknown[] | undefined => {
  const named = pieces.flatMap((output): readonly unknown[] => {
    const names: unknown = output["names"];
    return Array.isArray(names) ? (names as readonly unknown[]) : [];
  });
  if (named.length === 0) {
    return undefined;
  }
  const seen = new Set<string>();
  return named.filter((entry) => {
    const id = JSON.stringify(entry);
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
};

/**
 * The page of `name` from `offset`, `limit` rows, put together from `pieces`
 * of the same list: the rows of each part of `PAGED` taken in order, the rest of the output from the first
 * piece used, `offset` the one asked. None when the pieces do not cover the rows asked: a gap, or a piece that
 * gave fewer rows than it asked for only at the end of the list.
 */
export const pageFrom = (
  name: string,
  pieces: readonly Piece[],
  offset: number,
  limit: number,
): Output | undefined => {
  const parts = PAGED[name] ?? [];
  const sorted = [...pieces].sort((one, other) => one.offset - other.offset);
  const end = offset + limit;
  const used: { readonly piece: Piece; readonly from: number; readonly to: number }[] = [];
  let at = offset;
  while (at < end) {
    const piece = sorted.find((one) => one.offset <= at && at < one.offset + rowsOf(name, one.output).length);
    if (piece !== undefined) {
      const length = rowsOf(name, piece.output).length;
      const to = Math.min(length, end - piece.offset);
      used.push({ piece, from: at - piece.offset, to });
      at = piece.offset + to;
      continue;
    }
    // No piece holds row `at`: covered only when a piece from before it ended the list there.
    const ended = sorted.some(
      (one) =>
        one.offset <= at &&
        rowsOf(name, one.output).length < one.limit &&
        one.offset + rowsOf(name, one.output).length <= at,
    );
    if (!ended) {
      return undefined;
    }
    break;
  }
  const first = used[0]?.piece ?? sorted.find((one) => one.offset <= offset);
  if (first === undefined) {
    return undefined;
  }
  const output: Record<string, unknown> = { ...first.output };
  for (const part of parts) {
    if (Array.isArray(first.output[part]) || used.some(({ piece }) => Array.isArray(piece.output[part]))) {
      output[part] = used.flatMap(({ piece, from, to }) => {
        const entries: unknown = piece.output[part];
        return Array.isArray(entries) ? (entries as readonly unknown[]).slice(from, to) : [];
      });
    }
  }
  if (name === "trace.matrix") {
    const names = namesOf(used.map(({ piece }) => piece.output));
    if (names === undefined) {
      delete output["names"];
    } else {
      output["names"] = names;
    }
  }
  if ("offset" in first.output) {
    output["offset"] = offset;
  }
  return output;
};

/** The generation of the workspace and the view-bound call that the answers of a record were read in. */
export interface RecordTag {
  readonly seen: number;
  readonly call: Call;
}

const sameTag = (one: RecordTag, other: RecordTag): boolean =>
  one.seen === other.seen && one.call === other.call;

/** The answers of one buffer's shown view in one generation and call. */
export class AnswerRecord {
  readonly tag: RecordTag;
  /** What else the view shows, besides its reads (`BufferArea.tsx`): a change of it voids the record. */
  inputs: string;
  private readonly exact = new Map<string, Answer<never>>();
  private readonly pages = new Map<string, Piece[]>();
  private count = 0;
  private full = false;

  constructor(tag: RecordTag, inputs: string) {
    this.tag = tag;
    this.inputs = inputs;
  }

  /** The record was read in `tag`. */
  holds(tag: RecordTag): boolean {
    return sameTag(this.tag, tag);
  }

  /** Keeps the answer to a read `name` with `input`: only an answer that succeeded, of a read, while there is room. */
  add(name: string, input: Input, answer: { readonly ok: boolean; readonly output?: unknown }): void {
    if (!answer.ok || !RECORDED.has(name) || this.full) {
      return;
    }
    if (this.count >= RECORD_MAX) {
      this.full = true;
      return;
    }
    this.count += 1;
    this.exact.set(exactKey(name, input), answer as Answer<never>);
    // A page without a limit is kept only as it was asked: what core gives then is no page of known size.
    const limit = numberOr(input["limit"], undefined);
    if (name in PAGED && limit !== undefined) {
      const key = listKey(name, input);
      const pieces = this.pages.get(key) ?? [];
      pieces.push({
        offset: numberOr(input["offset"], 0) ?? 0,
        limit,
        output: (answer as unknown as { readonly output: Output }).output,
      });
      this.pages.set(key, pieces);
    }
  }

  /** The answer to `name` with `input` from what was kept; none when the record cannot give it (a miss). */
  answer(name: string, input: Input): Answer<never> | undefined {
    if (this.full) {
      return undefined;
    }
    const exact = this.exact.get(exactKey(name, input));
    if (exact !== undefined || !(name in PAGED)) {
      return exact;
    }
    const pieces = this.pages.get(listKey(name, input));
    const limit = numberOr(input["limit"], undefined);
    if (pieces === undefined || limit === undefined) {
      return undefined;
    }
    const output = pageFrom(name, pieces, numberOr(input["offset"], 0) ?? 0, limit);
    return output === undefined ? undefined : ({ ok: true, output } as unknown as Answer<never>);
  }
}

/**
 * The records of an area, one per buffer key. The shown view of a buffer writes its record (`take`), a hidden
 * view mounted from it reads it (`get`); a record of another generation or call is replaced.
 */
export class AreaRecords {
  private readonly records = new Map<string, AnswerRecord>();

  /** The record of `key` for `tag` with the view's other `inputs`: the one kept if it holds `tag`, else a new one. */
  take(key: string, tag: RecordTag, inputs: string): AnswerRecord {
    const kept = this.records.get(key);
    if (kept?.holds(tag) === true) {
      kept.inputs = inputs;
      return kept;
    }
    const made = new AnswerRecord(tag, inputs);
    this.records.set(key, made);
    return made;
  }

  /** The record of `key` when it holds `tag` and `inputs`: what a hidden view may draw from. */
  get(key: string, tag: RecordTag, inputs: string): AnswerRecord | undefined {
    const kept = this.records.get(key);
    return kept?.holds(tag) === true && kept.inputs === inputs ? kept : undefined;
  }

  /** Forgets the record of `key`: its hidden view missed, or a change voided it. */
  forget(key: string): void {
    this.records.delete(key);
  }

  /** Keeps only the records of `keys` (the buffers shown or beside the shown one) and those that hold `tag`. */
  prune(keys: ReadonlySet<string>, tag: RecordTag): void {
    for (const [key, record] of this.records) {
      if (!keys.has(key) || !record.holds(tag)) {
        this.records.delete(key);
      }
    }
  }
}
