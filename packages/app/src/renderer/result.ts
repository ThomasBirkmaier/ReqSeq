// The lines of the result buffer (SR-073 AK2): the output of a catalog command that no other buffer
// shows, laid out by its shape alone, like the CLI's text output. Elements are rows that open, problems and
// hints are one line each with their element, everything else is a quiet indented outline. The share of a
// verification degree (`share` next to `counts`, SR-037) is a percentage by core's rule of every access
// (`degreePercent`, one decimal rounded down, #592 Q3). Layout only: nothing here knows a command (ADR-0002).
import { degreePercent, degreeShareOf } from "@reqseq/core/verification-degree";
import type { ElementBuffer } from "./buffers.js";
import { elementBuffer, elementBufferOf } from "./buffers.js";

/** One line of the result buffer; `open` is the element Enter or a click opens. */
export interface ResultLine {
  readonly kind: "element" | "problem" | "text";
  /** Indentation level, from 0. */
  readonly depth: number;
  /** The ID of an element row; for any other line the key it stands under, or "". */
  readonly label: string;
  readonly text: string;
  readonly open?: ElementBuffer;
}

/** The most lines shown; an output beyond it ends with a line that says how many more there are. */
export const MAX_RESULT_LINES = 2000;

type Rec = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/** An element as outputs give it: an ID, its repository, a short ID and a title. */
const asElement = (value: Rec): Parameters<typeof elementBufferOf>[0] | undefined => {
  const [id, repository, shortId, title] = [
    value["id"],
    value["repository"],
    value["shortId"],
    value["title"],
  ];
  return typeof id === "string" &&
    typeof repository === "string" &&
    typeof shortId === "string" &&
    typeof title === "string"
    ? { id, repository, shortId, title, identifier: str(value["identifier"]) }
    : undefined;
};

/** A problem or hint: a code, a severity and a message. */
const isProblem = (value: Rec): boolean =>
  typeof value["code"] === "string" &&
  typeof value["severity"] === "string" &&
  typeof value["message"] === "string";

const problemLine = (problem: Rec, depth: number, label: string): ResultLine => {
  const id = str(problem["elementId"]);
  // Safe fallback: a problem gives `elementRepository` only when its `repository` and `file` name another
  // file than the element's (schemas/common.schema.json, `problem`); otherwise a problem that names an element
  // is about the element's own file, so `repository` is the element's repository.
  const repository = str(problem["elementRepository"]) ?? str(problem["repository"]);
  const name = str(problem["elementIdentifier"]) ?? str(problem["elementShortId"]);
  return {
    kind: "problem",
    depth,
    label,
    text: [String(problem["severity"]), String(problem["code"]), name, String(problem["message"])]
      .filter((part) => part !== undefined)
      .join("  "),
    ...(id === undefined || repository === undefined
      ? {}
      : { open: elementBuffer(id, repository, name ?? id) }),
  };
};

const scalar = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value));

/**
 * Collects the first `MAX_RESULT_LINES` lines and only counts the rest: a line past the limit is never built,
 * so a huge output costs a walk, not a line object per value.
 */
interface Sink {
  readonly lines: ResultLine[];
  rest: number;
}

const emit = (sink: Sink, line: () => ResultLine): void => {
  if (sink.lines.length < MAX_RESULT_LINES) {
    sink.lines.push(line());
  } else {
    sink.rest += 1;
  }
};

const linesOf = (value: unknown, depth: number, label: string, sink: Sink): void => {
  if (Array.isArray(value)) {
    if (label !== "") {
      emit(sink, () => ({ kind: "text", depth, label, text: String(value.length) }));
    }
    for (const item of value as readonly unknown[]) {
      linesOf(item, label === "" ? depth : depth + 1, "", sink);
    }
    return;
  }
  if (!isRecord(value)) {
    emit(sink, () => ({ kind: "text", depth, label, text: scalar(value) }));
    return;
  }
  const element = asElement(value);
  if (element !== undefined) {
    emit(sink, () => ({
      kind: "element",
      depth,
      label: element.identifier ?? element.shortId,
      text: element.title,
      open: elementBufferOf(element),
    }));
    return;
  }
  if (isProblem(value)) {
    emit(sink, () => problemLine(value, depth, label));
    return;
  }
  const inner = label === "" ? depth : depth + 1;
  if (label !== "") {
    emit(sink, () => ({ kind: "text", depth, label, text: "" }));
  }
  const share = degreeShareOf(value);
  for (const [key, item] of Object.entries(value)) {
    linesOf(key === "share" && share !== undefined ? degreePercent(share) : item, inner, key, sink);
  }
};

/** The lines of an output (none while there is none), at most `MAX_RESULT_LINES` and a last one that counts the rest. */
export const resultLines = (output: unknown): ResultLine[] => {
  const sink: Sink = { lines: [], rest: 0 };
  if (output !== undefined) {
    linesOf(output, 0, "", sink);
  }
  const { lines, rest } = sink;
  if (rest > 0) {
    lines.push({
      kind: "text",
      depth: 0,
      label: "",
      text: `${String(rest)} more line${rest === 1 ? "" : "s"}`,
    });
  }
  return lines;
};

/** The count an output gives for its whole answer (`total`), for the modeline; undefined without one. */
export const resultTotal = (output: unknown): number | undefined =>
  isRecord(output) && typeof output["total"] === "number" ? output["total"] : undefined;
