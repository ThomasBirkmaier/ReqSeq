// The default output of the CLI for people (ADR-0009, ThomasBirkmaier/ReqSeq-archive#310): compact lines instead of the whole output
// object. Pure layout (ADR-0002 rule 3: no logic, no command named here): the form follows only the
// shape of the output, and whether the command reads or writes (its catalog `effect`), so every
// command of the catalog is covered. `--json` prints the output unchanged, `--yaml` all of it.
//
// - An element (an object with `shortId` and `title`) is one line, `SHORT-ID  status  title`, with its
//   identifier next to the short ID when it has one (`SR-3c90b0 (SR-036)`, ThomasBirkmaier/ReqSeq-archive#305), `[emergent]` when it
//   is marked emergent (SR-035), and its verification status per view at the end, apart from its own
//   status (`[verification: core verified]`, SR-031, D-030; the children missing for SR-034 as
//   `core open (missing SR-0000b2)`, the criteria of SR-031 AK5 as `core open 2 of 3 criteria (AK3 (k7f3)
//   not verified)`, with the key where the criterion has one, SR-205 AK2), then its validation status (`[validation: validated]`, SR-038;
//   an inconclusive one with its reason on one line, `[validation: inconclusive — <reason>]`, SR-172);
//   a list of them one such line per element, a search hit with its snippet (SR-174) on the line
//   below it, `  text: …line…` or the property's name instead of `text`, on a terminal cut to its width
//   and the marked words strong, as the marked words of the title; a list whose elements carry their text (element.list
//   `withText`) shows below each line its properties without relation targets, its relations one line
//   each and its text, with a blank line between elements (#397). A read command (element.get) shows
//   the element's details below its line, a write command only the line; there, a property whose
//   value is a list of texts numbers its items from 1 (`1: ...`), as tests name acceptance criteria
//   (#401).
// - A chain (`nodes` with `depth`, and `edges`) is an indented tree per direction with the depth in
//   front, its gaps, cycles and the edges to an element listed elsewhere marked. Its `evidence` is
//   indented below the element it belongs to (`evidenceLines`); the root's `validationRecords` below
//   the root, `validation  DATE  RESULT  ITEM  BELEG  [version V]` (#646). An element reached by a relation
//   whose meaning is not `derivation` names its kind (`[has-stakeholder]`), and a direction with such
//   an element is headed `upward:` or `downward:` instead of `parents:` or `children:` (#643).
// - A graph (`nodes` of elements with a `level`) with `evidence` summaries (trace.graph `withEvidence`,
//   SR-111 AK3) lists its nodes, each with its summary on the line below it:
//   `evidence: 2 test cases, 1 record · 2 passed, 1 failed`; the edges stay YAML.
// - A list of evidence records (`kind`, `date`, `result`, the reason of an inconclusive one) is one line per record, a list of test cases
//   (`name`, `executions`) one line per test case with its last result and the number of executions
//   (evidence.list, #275); `--json` and `--yaml` keep every execution.
// - A matrix (`columns` with `name` and `direction`, `rows` of elements with one cell per column) lists
//   its columns numbered with the head of each (the count, or with minima `met of expected · share`, as
//   the app, SR-153), then per row the element line and one line of cells, `n: SHORT-ID, ...`, `–` for an
//   empty cell, `[gap]` after a cell the row's `gaps` names (trace.matrix, #629).
// - A grouped list (element.list `group`, SR-149): each group of the page under its heading, its name
//   and value (a package by short ID and title, `(no value)` for the last group) and its count,
//   `continued` when it began on an earlier page; its elements below it as in a plain or a tree
//   list. The note on a short page counts the rows, an element once per group.
// - A list of elements with a `tree` of their places (`depth`, `parent`; one per element, element.list
//   by hierarchy, SR-075 AK2) is indented two spaces per level; an element whose parent is not shown
//   before it (on an earlier page) names it, `[under X]`.
// - The elements of a list narrowed by element.list `fields` (#982) are in `partial`, which a grouped
//   and a tree list read as `elements`; a row without `title` is no element, so such a list stays YAML.
// - A list of findings other than `problems` (the hints of hint.list) is one line per finding: the
//   element's short ID and title (and its target's), the kind, the message, the view of outdated
//   evidence and the hint ID when it has one. Their counts per kind (`kinds`) print as YAML before them.
// - A verification degree (`share` next to `counts`, SR-037), at any depth of a value printed as YAML,
//   shows its share as a percentage rounded down to one decimal (`degreePercent` of core, the rule of
//   every access, spec question ThomasBirkmaier/ReqSeq-archive#592 Q3): `share: 60 %`.
// - `names` (the elements an output gives elsewhere by UUID only, `common.schema.json#/$defs/elementName`,
//   ThomasBirkmaier/ReqSeq-archive#588) is not printed: those UUIDs print as the element instead, `SHORT-ID (IDENTIFIER)  title` in a
//   value printed as YAML (the lists of evidence.coverage, a variant `view`, the details of an element) and in a list of UUIDs one per
//   line (the lists of variant.diff), `SHORT-ID (IDENTIFIER)` in
//   the verification status of an element line, and `SHORT-ID  title` as the variant of a record of a
//   chain (#676). A UUID that `names` leaves out stays as it is.
// - The answer (`answer`, SR-224) is the first line, as core gives it; an output whose text is a
//   format (`textOutput`, such as Mermaid, SR-151 AK4) is printed alone, without it (render.ts).
// - Every other value stays YAML. Problems come last, each once: those of the output and the hints
//   at an element it shows; then `No problems.`, or how many findings the output left out (`hidden`).
//
// On a terminal (`renderHuman`'s `terminal`, from bin.ts; stdout a TTY, `TERM` not `dumb`, #988) the
// shapes most commands share take a terminal layout, styled by `style.ts` when the terminal has colours
// (not with `NO_COLOR`); everything above is the plain text that pipes, files and tests get, unchanged:
// - an element line (one element, a plain, tree or grouped list): the short ID strong, the
//   identifier faint in brackets behind it (`SR-3c90b0 (SR-036)`, SR-084 AK4), the status in a column as wide as the list needs,
//   the title cut with `…` to the terminal width, the marks after it faint. The title stays whole when
//   details follow (element.get, `withText`), which do not repeat it, and when less than `MIN_TITLE`
//   characters would be left (the line wraps anyway);
// - a tree list draws its tree with `├ └ │` from the parent of each element; an element whose parent
//   is not shown before it (`[under X]`) starts a tree of its own; the line goes on beside details;
// - a grouped list heads each group at the left, with a blank line before it: its title (else name,
//   else value) strong, then faint what names it besides and the count, `Wind  PKG-0000d1 (R1) · 2`;
//   the columns are as wide as the whole page needs;
// - hints and problems show their severity first, coloured by it; the line after them is faint.
// No style is keyed to a status: statuses come from the metamodel. A matrix, a chain, a graph and the
// comparisons keep the plain layout on a terminal.
import { hiddenOf, problemsEnd, renderProblem } from "./render.js";
import type { Style, Terminal } from "./style.js";
import { PLAIN, styleOf } from "./style.js";
import { chainLines, isChain } from "./present/chain.js";
import type { Rec } from "./present/common.js";
import { isElement, isProblem, isRecord, listOf, namesIn, yamlOf } from "./present/common.js";
import { criterionReferencesIn } from "./present/element.js";
import { graphNodeLines, isGraphWithEvidence } from "./present/evidence.js";
import { elementsKey, groupedListLines, treeListLines, treeListOf, valueLines } from "./present/list.js";
import { isMatrix, matrixColumnLines, matrixRowLines } from "./present/matrix.js";

/**
 * The note on a page shorter than `total`. The page is the list of elements or findings: the nodes of a
 * chain, the elements of a list (never `names`), the hints of a list of hints (never `problems`).
 */
const pageNote = (output: Rec): string[] => {
  // A grouped list (SR-149) pages over its rows, an element once per group.
  const total = typeof output["rows"] === "number" ? output["rows"] : output["total"];
  const page = Object.entries(output).find(
    (entry): entry is [string, unknown[]] =>
      entry[0] !== "names" &&
      Array.isArray(entry[1]) &&
      entry[1].length > 0 &&
      // The rows of `partial` (element.list `fields`, #982) also without a title.
      (entry[1].every(isElement) ||
        entry[1].every(isProblem) ||
        (entry[0] === "partial" && entry[1].every(isRecord))),
  )?.[1];
  return typeof total === "number" && page !== undefined && page.length < total
    ? [`Showing ${String(page.length)} of ${String(total)}; ask for more with --offset and --limit.`]
    : [];
};

/**
 * The lines of a graph with evidence (its nodes with their summaries), of a grouped list or of a list
 * of elements with a `tree`, adding the keys they show to `shown`; none for any other output.
 */
const nodeListLines = (rest: Rec, shown: Set<string>, style: Style | undefined): string[] => {
  if (isGraphWithEvidence(rest)) {
    shown.add("nodes");
    shown.add("evidence");
    return graphNodeLines(rest);
  }
  const grouped = groupedListLines(rest, namesIn(rest), style);
  if (grouped !== undefined) {
    for (const key of [elementsKey(rest), "tree", "groups", "offset", "rows"]) {
      shown.add(key);
    }
    return grouped;
  }
  const tree = rest["tree"];
  const treeList = Array.isArray(tree) ? treeListOf(listOf(rest[elementsKey(rest)]), tree) : undefined;
  if (treeList === undefined) {
    return [];
  }
  shown.add(elementsKey(rest));
  shown.add("tree");
  return treeListLines(treeList, style, elementsKey(rest));
};

/**
 * The criteria of element.get and element.resolve, which show in the element's properties (SR-205
 * AK1), adding `criterionReferences` to `shown`; undefined without them.
 */
const shownReferences = (rest: Rec, shown: Set<string>): ReturnType<typeof criterionReferencesIn> => {
  const references = criterionReferencesIn(rest["criterionReferences"]);
  if (references !== undefined && isElement(rest["element"])) {
    shown.add("criterionReferences");
  }
  return references;
};

/** The answer of core as the first line (SR-224 AK2); none for an output without one. */
const answerLines = (answer: unknown): string[] => (typeof answer === "string" ? [answer] : []);

/**
 * The output for people (see the file comment). `details`: show an element's details below its line
 * (commands that read). `terminal`: the terminal stdout is, when the output is styled for one (#988);
 * plain text without it.
 */
export function renderHuman(output: unknown, details = true, terminal?: Terminal): string {
  const style = terminal === undefined ? undefined : styleOf(terminal);
  if (!isRecord(output)) {
    return output === undefined ? "" : yamlOf(output);
  }
  const { problems, answer, ...rest } = output;
  const lines = answerLines(answer);
  const lifted: unknown[] = [];
  const chain = isChain(rest);
  if (chain) {
    lines.push(...chainLines(rest, namesIn(rest)));
  }
  const shown = chain
    ? new Set(["root", "nodes", "edges", "gaps", "evidence", "validationRecords", "unresolved"])
    : new Set<string>();
  if (isMatrix(rest)) {
    // The evidence header (the degree, SR-126 AK4) stands above the rows that hold the status.
    lines.push(...matrixColumnLines(rest));
    if (rest["evidence"] !== undefined) {
      lines.push(...valueLines("evidence", rest["evidence"], details, lifted, namesIn(rest)));
    }
    lines.push(...matrixRowLines(rest, namesIn(rest)));
    shown.add("columns");
    shown.add("evidence");
    shown.add("rows");
  }
  lines.push(...nodeListLines(rest, shown, style));
  // The findings left out are said after the problems (`problemsEnd`).
  if (hiddenOf(rest) !== undefined) {
    shown.add("hidden");
  }
  // The elements named by UUID elsewhere name those UUIDs instead of being printed (ThomasBirkmaier/ReqSeq-archive#588).
  const names = namesIn(rest);
  if (names.size > 0) {
    shown.add("names");
  }
  const references = shownReferences(rest, shown);
  for (const [key, value] of Object.entries(rest)) {
    if (!shown.has(key)) {
      lines.push(
        ...valueLines(key, value, details, lifted, names, style, key === "element" ? references : undefined),
      );
    }
  }
  lines.push(...pageNote(rest));
  return `${lines.map((line) => `${line}\n`).join("")}${problemsText(problems, lifted, rest, style ?? PLAIN)}`;
}

/**
 * The problems of the output and those lifted from the elements it shows, each once, then the line
 * after them (`problemsEnd`), faint on a terminal (#988).
 */
const problemsText = (problems: unknown, lifted: readonly unknown[], rest: Rec, style: Style): string => {
  const seen = new Set<string>();
  const all = [...listOf(problems), ...lifted].filter((problem) => {
    const key = JSON.stringify(problem);
    const first = !seen.has(key);
    seen.add(key);
    return first;
  });
  const end = Array.isArray(problems) ? problemsEnd(rest, all.length) : "";
  const shownEnd = end === "" ? end : `${style.faint(end.replace(/\n$/, ""))}\n`;
  return `${all.map((problem) => renderProblem(problem, style)).join("")}${shownEnd}`;
};
