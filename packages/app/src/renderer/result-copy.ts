// The lines a result buffer shows, and their text as "Copy result" puts it on the clipboard as one block
// (SR-161 AK3, SR-128): one line per shown line, indented by its depth, the key or ID first. Layout only:
// nothing here knows a command except the chain, which `chain-lines.ts` lays out (SR-033).
import type { ResultBuffer } from "./buffers.js";
import { chainLines } from "./chain-lines.js";
import type { ResultLine } from "./result.js";
import { resultLines } from "./result.js";

/** The lines of the buffer's output, as its view shows them. */
export const linesOf = (buffer: Pick<ResultBuffer, "command" | "output">): ResultLine[] =>
  (buffer.command === "trace.chain" ? chainLines : resultLines)(buffer.output);

const lineText = (line: ResultLine): string => {
  const head = line.kind === "text" && line.label !== "" ? `${line.label}:` : line.label;
  const status = line.status === undefined ? "" : `  ${line.status}`;
  return `${"  ".repeat(line.depth)}${[head, line.text].filter((part) => part !== "").join(" ")}${status}`;
};

/** The text of the lines, one per line. */
export const resultText = (lines: readonly ResultLine[]): string => lines.map(lineText).join("\n");
