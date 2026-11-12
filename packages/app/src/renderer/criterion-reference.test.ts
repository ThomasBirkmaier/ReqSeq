// @vitest-environment happy-dom
// The reference of the criterion with the cursor (SR-205 AK4) and the marks after the criteria (AK1).
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { DataExportCriterionEntry } from "@reqseq/core";
import { describe, expect, it } from "vitest";
import { KEY_MARK } from "./criterion-doc.js";
import { criterionAtPos, referenceToCopy } from "./criterion-reference.js";
import { criterionKeys } from "./editor/criterion-keys.js";
import { criterionMarks, markOf } from "./editor/criterion-marks.js";

const ENTRIES: readonly DataExportCriterionEntry[] = [
  { criterion: 1, key: "kaaa", text: "Alpha", reference: "[SR-036/AK-kaaa]" },
  { criterion: 2, key: "kbbb", text: "Beta" },
  { criterion: 3, key: "kbbb", text: "Gamma" },
];

/** A criteria box with `doc` (keys as `criterion-doc.ts` writes them). */
const box = (doc: string, extensions = criterionKeys().extension): EditorState => {
  const codec = criterionKeys();
  const { text, init } = codec.decode(doc);
  return EditorState.create({ doc: text, extensions: [init, extensions] });
};

describe("Copy criterion reference (SR-205 AK4)", () => {
  it("[SR-205/AK-zvtb] takes the reference core gives for the key of the line, or says why there is none", () => {
    const state = box(`kaaa${KEY_MARK}Alpha\n\nkbbb${KEY_MARK}Beta\n${KEY_MARK}New`);
    expect(criterionAtPos(state, 0)).toEqual({ key: "kaaa", line: 1 });
    expect(criterionAtPos(state, 6)).toBeUndefined();
    const at = criterionAtPos(state, 0);
    expect(at === undefined ? undefined : referenceToCopy(ENTRIES, at)).toEqual({
      reference: "[SR-036/AK-kaaa]",
    });
    expect(referenceToCopy(ENTRIES, { key: "kbbb", line: 3 })).toEqual({
      message: "AK2 (kbbb) has no reference: another acceptance criterion carries the same criterion key",
    });
    expect(referenceToCopy(ENTRIES, { key: undefined, line: 4 })).toEqual({
      message: "Line 4 is no saved acceptance criterion yet: it has no reference",
    });
    expect(referenceToCopy(undefined, { key: "kccc", line: 1 })).toHaveProperty("message");
    // A box without criterion keys (criteria of several lines): no line is a criterion.
    expect(criterionAtPos(EditorState.create({ doc: "Alpha\nmore" }), 0)).toBeUndefined();
  });
});

describe("the marks after the criteria (SR-205 AK1)", () => {
  it("[SR-205/AK-npsp] shows the reference by key, the bare key of a key two criteria carry, and nothing for a line not saved", () => {
    const byKey = new Map([
      ["kaaa", "[SR-036/AK-kaaa]"],
      ["kbbb", "kbbb"],
    ]);
    expect(markOf(ENTRIES, byKey, "kaaa", 5, "moved")).toBe("[SR-036/AK-kaaa]");
    expect(markOf(ENTRIES, byKey, "kbbb", 1, "Beta")).toBe("kbbb");
    expect(markOf(ENTRIES, byKey, "knew", 3, "typed")).toBeUndefined();
    // The second holder of a key has none in the box: while it is the stored line, it shows the stored key.
    expect(markOf(ENTRIES, byKey, undefined, 2, "Gamma")).toBe("kbbb");
    expect(markOf(ENTRIES, byKey, undefined, 2, "Gamma changed")).toBeUndefined();
    expect(markOf(ENTRIES, byKey, undefined, 0, "Alpha")).toBeUndefined();
  });

  it("[SR-205/AK-npsp] decorates the end of each criterion line in the box", () => {
    const keys = criterionKeys();
    const state = box(`kaaa${KEY_MARK}Alpha\n\nkbbb${KEY_MARK}Beta\n${KEY_MARK}Gamma`, [
      keys.extension,
      criterionMarks(ENTRIES),
    ]);
    const labels: string[] = [];
    for (const source of state.facet(EditorView.decorations)) {
      const set = typeof source === "function" ? source(undefined as unknown as EditorView) : source;
      set.between(0, state.doc.length, (_from, _to, decoration) => {
        const { widget } = decoration.spec as { readonly widget?: { toDOM: () => HTMLElement } };
        if (widget !== undefined) {
          labels.push(widget.toDOM().textContent);
        }
      });
    }
    expect(labels).toEqual(["[SR-036/AK-kaaa]", "kbbb"]);
  });

  it("shows no marks in a box without criterion keys (criteria of several lines)", () => {
    const state = EditorState.create({ doc: "Alpha\nmore", extensions: [criterionMarks(ENTRIES)] });
    let count = 0;
    for (const source of state.facet(EditorView.decorations)) {
      const set = typeof source === "function" ? source(undefined as unknown as EditorView) : source;
      count += set.size;
    }
    expect(count).toBe(0);
  });
});
