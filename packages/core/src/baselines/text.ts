// The text and the file name of a new baseline file (ADR-0018): the layout the line scanner reads
// (scan.ts), and the name made portable as attachment names. Pure: `baselines/create.ts` writes it.
//
// - Header in block style, keys in the order given; `package`, `view` and `ids` items `{ id, … }` as
//   flow mappings, lists of plain values in `where` on one line (as filter.save writes them).
// - `repositories` and `elements` one flow mapping per line, `elements: []` when empty (SR-050 AK5); a
//   repository name YAML would read as no string (`123`, `true`) is quoted, so the file is still
//   valid (the scanner then leaves it to the YAML fallback).
// - File name: `portableName` with `baseline` when nothing is left, `-baseline` after a Windows
//   device name.
import { Document, isMap, isScalar, visit } from "yaml";
import type { BaselineFile } from "../generated/types.js";
import { portableName, windowsChanges } from "../model/index.js";
import { BASELINE_FILE_EXTENSION } from "./read.js";
import { NOT_A_STRING } from "./scan.js";

const YAML_OPTIONS = { version: "1.2", schema: "core" } as const;

/** A repository name as a plain scalar, quoted where YAML would read it as no string. */
const plain = (name: string): string => (NOT_A_STRING.test(name) ? JSON.stringify(name) : name);

/** The header lines: `package`, `view` and `ids` items as flow mappings, lists of plain values in `where` on one line. */
const headerText = (header: Omit<BaselineFile, "repositories" | "elements">): string => {
  const document = new Document(header, YAML_OPTIONS);
  for (const node of [
    document.getIn(["selection", "package"], true),
    document.getIn(["selection", "view"], true),
    ...((document.getIn(["selection", "ids"], true) as { items?: unknown[] } | undefined)?.items ?? []),
  ]) {
    if (isMap(node)) {
      node.flow = true;
    }
  }
  const where = document.getIn(["selection", "where"], true);
  if (isMap(where)) {
    visit(where, {
      Seq: (_, node) => {
        node.flow = node.items.every((item) => isScalar(item));
      },
    });
  }
  return document.toString({ lineWidth: 0, minContentWidth: 0, blockQuote: false });
};

/** The text of `data` in the layout of ADR-0018 (see the file comment); `elements` sorted by the caller. */
export const baselineText = (data: BaselineFile): string => {
  const { repositories, elements, ...header } = data;
  return [
    `${headerText(header)}repositories:`,
    ...repositories.map((r) => `  - { name: ${plain(r.name)}, commit: ${r.commit} }`),
    elements.length === 0 ? "elements: []" : "elements:",
    ...elements.map(
      (e) =>
        `  - { id: ${e.id}, version: ${e.version}${e.repository === undefined ? "" : `, repository: ${plain(e.repository)}`} }`,
    ),
    "",
  ].join("\n");
};

/** The file name of a baseline without `-<n>` and extension: the name made portable, `baseline` when nothing is left. */
export const baselineStem = (name: string): string => {
  const stem = portableName(name, "baseline");
  return windowsChanges(`${stem}${BASELINE_FILE_EXTENSION}`) ? `${stem}-baseline` : stem;
};
