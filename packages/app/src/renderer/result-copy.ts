// The lines a result buffer shows, and the output as "Copy as JSON" puts it on the clipboard (SR-223 AK9): the
// text the command line gives with `--json`, `JSON.stringify` with two spaces and a line break (`jsonOutput` of
// the CLI). Layout only: nothing here knows a command except the chain, which `chain-lines.ts` lays out (SR-033).
import type { ResultBuffer } from "./buffers.js";
import { NO_ROW } from "./buffers.js";
import { chainLines } from "./chain-lines.js";
import type { OutputField, ResultLine } from "./result.js";
import { resultLines } from "./result.js";

/**
 * The lines of the buffer's output, as its view shows them, under the titles of `fields` (`outputFields`), with
 * the details while "Show details" is on for it (SR-223 AK2) and its open groups of problems (SR-223 AK3).
 */
export const linesOf = (
  buffer: Pick<ResultBuffer, "command" | "output" | "details" | "unfolded">,
  fields: readonly OutputField[] = [],
): ResultLine[] =>
  (buffer.command === "trace.chain" ? chainLines : resultLines)(
    buffer.output,
    fields,
    buffer.details === true,
    buffer.unfolded,
  );

/** The whole output as the command line gives it with `--json` (`null` for none), with its line break. */
export const outputJson = (output: unknown): string => `${JSON.stringify(output ?? null, null, 2)}\n`;

/** What makes a line the same line with details on and off: all but its kind of a problem and its detail mark. */
const identity = (line: ResultLine): string =>
  JSON.stringify([
    line.kind,
    line.depth,
    line.label,
    line.text,
    line.field,
    line.open?.key,
    line.beside?.key,
  ]);

/**
 * The cursor in `after` on the line it is on in `before`, the same line by what it shows and as the same
 * occurrence of it, so "Show details" leaves the selection where it was (SR-223 AK2); `NO_ROW` when the line
 * is not in `after` (a detail that is hidden again) or none was selected.
 */
export const keptCursor = (
  before: readonly ResultLine[],
  after: readonly ResultLine[],
  cursor: number,
): number => {
  const line = before[cursor];
  if (line === undefined) {
    return NO_ROW;
  }
  const key = identity(line);
  const nth = before.slice(0, cursor).filter((each) => identity(each) === key).length;
  const found = after.map((each, at) => [identity(each), at] as const).filter(([each]) => each === key)[nth];
  return found === undefined ? NO_ROW : found[1];
};
