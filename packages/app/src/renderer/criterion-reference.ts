// "Copy criterion reference" (SR-205 AK4): the reference for a test name of the acceptance criterion with
// the cursor, as `element.get` gives it in `criterionReferences` (core works it out, SR-205 AK1); the app
// finds the criterion by the criterion key of the line (`editor/criterion-keys.ts`). Pure: the element
// buffer reads the line and the answer, and copies.
import type { DataExportCriterionEntry } from "@reqseq/core";
import { criterionLabel } from "@reqseq/core/criterion-items";
import { isBlankLine } from "@reqseq/core/criterion-lines";
import type { EditorState } from "@codemirror/state";
import { criterionKeysField } from "./editor/criterion-keys.js";

/**
 * The criterion on a line of the criteria box: the key of the line (none while the file gives its criterion
 * none, or gives its key to another criterion too), the line and its text.
 */
export interface CriterionAt {
  readonly key: string | undefined;
  readonly line: number;
  readonly text: string;
}

/**
 * The criterion of the line at `pos` of the criteria box `state`; none on a blank line, nor in a box without
 * criterion keys (criteria of several lines: a line is no criterion there).
 */
export const criterionAtPos = (state: EditorState, pos: number): CriterionAt | undefined => {
  const keys = state.field(criterionKeysField, false)?.keys;
  const line = state.doc.lineAt(pos);
  return keys === undefined || isBlankLine(line.text)
    ? undefined
    : { key: keys[line.number - 1], line: line.number, text: line.text };
};

/** What the action says when the cursor is on no criterion. */
export const NO_CRITERION = "Put the cursor on an acceptance criterion to copy its reference";

const SHARED_KEY = "has no reference: another acceptance criterion carries the same criterion key";

/**
 * The reference to copy for the criterion `at`, from the criteria of `element.get`; or why there is none: the
 * line is not saved yet (its key is not in the file), another criterion carries the same key (SR-204 AK10), or
 * the saved criterion has no key. A line without key is found by its text: the box gives none to a criterion
 * the file gives none, nor to the second one of a key two carry.
 */
export const referenceToCopy = (
  entries: readonly DataExportCriterionEntry[] | undefined,
  at: CriterionAt,
): { readonly reference: string } | { readonly message: string } => {
  if (at.key === undefined) {
    const stored = entries?.find((candidate) => candidate.text === at.text);
    if (stored?.key !== undefined) {
      return { message: `${criterionLabel(stored)} ${SHARED_KEY}` };
    }
    const label = stored === undefined ? `Line ${String(at.line)}` : criterionLabel(stored);
    return { message: `${label} has no criterion key: run Assign criterion keys to give it one` };
  }
  const entry = entries?.find((candidate) => candidate.key === at.key);
  if (entry === undefined) {
    return { message: `Line ${String(at.line)} is no saved acceptance criterion yet: it has no reference` };
  }
  return entry.reference === undefined
    ? { message: `${criterionLabel(entry)} ${SHARED_KEY}` }
    : { reference: entry.reference };
};
