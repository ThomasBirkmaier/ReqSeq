// The reference of each acceptance criterion at the end of its line in the criteria box (SR-205 AK1): muted,
// no part of the text, as `element.get` gives it in `criterionReferences` (core works it out, ADR-0002). A
// line finds its criterion by its criterion key (`criterion-keys.ts`), so a moved or reworded line shows
// its reference at once. A criterion whose key another one carries too has no reference (SR-205 AK1,
// SR-204 AK10): its line shows the bare key. A line with a key the file does not hold yet (typed, not saved)
// shows nothing until the save; nor does a line without key.
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import type { EditorState, Extension, Range } from "@codemirror/state";
import type { DataExportCriterionEntry } from "@reqseq/core";
import { isBlankLine } from "@reqseq/core/criterion-lines";
import { criterionKeysField } from "./criterion-keys.js";

/** The muted mark after a criterion. */
class ReferenceMark extends WidgetType {
  readonly label: string;

  constructor(label: string) {
    super();
    this.label = label;
  }

  override eq(other: ReferenceMark): boolean {
    return other.label === this.label;
  }

  toDOM(): HTMLElement {
    const mark = document.createElement("span");
    mark.className = "cm-lr-muted cm-lr-criterion-ref";
    mark.textContent = this.label;
    return mark;
  }

  // A press on the mark is one on its line: the editor puts the caret at the end of the line, as after the
  // text, so "Copy criterion reference" then acts on that criterion (SR-205 AK4). By default a widget keeps
  // its events from the editor, and the caret stayed where it was.
  override ignoreEvent(): boolean {
    return false;
  }
}

/** What a line of the box shows after its text: the reference of its criterion, the bare key, or nothing. */
export const markOf = (
  entries: readonly DataExportCriterionEntry[],
  byKey: ReadonlyMap<string, string>,
  key: string | undefined,
  at: number,
  text: string,
): string | undefined => {
  if (key !== undefined) {
    return byKey.get(key);
  }
  // The second holder of a key starts without one in the box (`lineKeysOf`): while it is the stored line, it
  // shows the key the file gives it.
  const stored = entries[at];
  return stored?.key !== undefined && stored.reference === undefined && stored.text === text
    ? stored.key
    : undefined;
};

const marks = (entries: readonly DataExportCriterionEntry[], state: EditorState): DecorationSet => {
  const byKey = new Map(
    entries.flatMap((entry) => (entry.key === undefined ? [] : [[entry.key, entry.reference ?? entry.key]])),
  );
  // A box without criterion keys (criteria of several lines) shows no marks: its lines are no criteria.
  const keys = state.field(criterionKeysField, false)?.keys;
  if (keys === undefined) {
    return Decoration.none;
  }
  const found: Range<Decoration>[] = [];
  for (let n = 1; n <= state.doc.lines; n += 1) {
    const line = state.doc.line(n);
    const label = isBlankLine(line.text) ? undefined : markOf(entries, byKey, keys[n - 1], n - 1, line.text);
    if (label !== undefined) {
      found.push(Decoration.widget({ widget: new ReferenceMark(label), side: 1 }).range(line.to));
    }
  }
  return Decoration.set(found);
};

/** The marks of the criteria `entries` (`criterionReferences.criteria` of `element.get`) in the criteria box. */
export const criterionMarks = (entries: readonly DataExportCriterionEntry[]): Extension => [
  EditorView.decorations.compute(["doc", criterionKeysField], (state) => marks(entries, state)),
  EditorView.baseTheme({ ".cm-lr-criterion-ref": { marginLeft: "0.75em", whiteSpace: "nowrap" } }),
];
