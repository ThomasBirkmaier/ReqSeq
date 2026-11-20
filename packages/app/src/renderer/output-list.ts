// A list of the elements of a command's output (SR-223 AK6): the output of a read command whose elements the catalog
// marks as its answer (`x-elements: "answer"`) shows as a list of those elements, whose first filter step is the
// output (`selection.output`, `answerOf` of `buffers.ts`) under the answer. Besides its rows the list shows what
// else the output gives: its other fields above the rows, as the output page lays them out (`result.ts`), such as
// the records of older versions of `trace.affected` (SR-024 AK4); and, with "Show details", at each row the values
// the output gives for its element besides the row (its ID, title, type and status). Layout only: the field of the
// answer and the titles come from the catalog, so nothing here knows a command (ADR-0002).
import type { ListBuffer } from "./buffers.js";
import { answerOf } from "./buffers.js";
import type { OutputField, ResultLine } from "./result.js";
import { resultLines } from "./result.js";
import { NEXT_FIELD } from "./next-steps.js";

type Rec = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The fields of an element that its row shows, or that name it: not repeated at the row with "Show details". */
const ROW_FIELDS: ReadonlySet<string> = new Set([
  "id",
  "repository",
  "shortId",
  "identifier",
  "title",
  "type",
  "status",
]);

/** The top-level field of the output the catalog marks as the elements of its answer; undefined without one. */
export const answerField = (fields: readonly OutputField[]): string | undefined =>
  fields.find((field) => field.elements === "answer" && !/[.[]/u.test(field.path))?.path;

/**
 * The key a row and an element of the output share: repository and UUID, and the file where it is given, so two
 * copies of a UUID in one repository are told apart (SR-088).
 */
export const elementKey = (element: {
  readonly id: string;
  readonly repository: string;
  readonly file?: string | undefined;
}): string => `${element.repository}\u0000${element.id}\u0000${element.file ?? ""}`;

/** What a list of an output shows besides its rows: the lines above them and the details of each row. */
export interface OutputParts {
  /** The other fields of the output (not its answer and its elements), as the output page lays them out. */
  readonly lines: readonly ResultLine[];
  /** By `elementKey`, the values the output gives for the element besides its row, each as a line. */
  readonly details: ReadonlyMap<string, readonly ResultLine[]>;
}

/** The fields under `prefix` (`affected[].`) with that part taken off their path. */
const rebased = (fields: readonly OutputField[], prefix: string): OutputField[] =>
  fields.flatMap((field) =>
    field.path.startsWith(prefix) ? [{ ...field, path: field.path.slice(prefix.length) }] : [],
  );

/**
 * The parts of `output`, the output `list` lists the answer of, under the titles of `fields` (`outputFields` of its
 * command); `details`: "Show details" is on. Nothing for another list or an output of another shape.
 */
export const outputParts = (
  list: ListBuffer,
  output: unknown,
  fields: readonly OutputField[],
  details: boolean,
): OutputParts => {
  const origin = answerOf(list);
  const field = answerField(fields);
  if (origin === undefined || field === undefined || !isRecord(output)) {
    return { lines: [], details: new Map() };
  }
  // The answer heads the list as its first step; its elements are the rows. Next steps (SR-226 AK5) are lines of
  // an output page only.
  const { [field]: elements, answer: _answer, [NEXT_FIELD]: _next, ...rest } = output;
  const lines = resultLines(rest, fields, details, [], {
    command: origin.command,
    input: origin.input,
    name: list.label,
  });
  const of = rebased(fields, `${field}[].`);
  const byElement = new Map<string, readonly ResultLine[]>();
  if (details && Array.isArray(elements)) {
    for (const element of elements as readonly unknown[]) {
      if (
        !isRecord(element) ||
        typeof element["id"] !== "string" ||
        typeof element["repository"] !== "string"
      ) {
        continue;
      }
      const extra = Object.fromEntries(Object.entries(element).filter(([name]) => !ROW_FIELDS.has(name)));
      const lines = resultLines(extra, of, true);
      const id = element["id"];
      const repository = element["repository"];
      const file = typeof element["file"] === "string" ? element["file"] : undefined;
      // By its file, and, for a row that names none, by repository and UUID: the first copy's values.
      for (const key of [elementKey({ id, repository, file }), elementKey({ id, repository })]) {
        if (!byElement.has(key) && Object.keys(extra).length > 0) {
          byElement.set(key, lines);
        }
      }
    }
  }
  return { lines, details: byElement };
};

/**
 * The list with the answer of its output as the label of its first step (SR-223 AK6), when the output read last
 * gives another answer than the one it was opened with (after a change of the workspace or a restart); undefined
 * when it already has it, or for another list or output.
 */
export const relabelled = (list: ListBuffer, output: unknown): ListBuffer | undefined => {
  const [first, ...rest] = list.steps;
  const answer = isRecord(output) ? output["answer"] : undefined;
  if (
    answerOf(list) === undefined ||
    first === undefined ||
    typeof answer !== "string" ||
    first.label === answer
  ) {
    return undefined;
  }
  const steps = [{ ...first, label: answer }, ...rest];
  return { ...list, steps, label: steps.map((step) => step.label).join(" · ") };
};
