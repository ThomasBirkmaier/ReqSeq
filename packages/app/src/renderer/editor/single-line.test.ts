import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { oneLine, singleLine } from "./single-line.js";

/** A state with `doc` and the caret at `at`, as where the user types or pastes. */
const state = (doc: string, at = 0): EditorState =>
  EditorState.create({ doc, selection: { anchor: at }, extensions: [singleLine] });

/** The state after inserting `insert` at `at` with the user event `userEvent` (none: the file's text put in). */
const inserted = (doc: string, at: number, insert: string, userEvent?: string): EditorState =>
  state(doc, at).update({ changes: { from: at, insert }, ...(userEvent === undefined ? {} : { userEvent }) })
    .state;

describe("oneLine (#621)", () => {
  it("joins the lines with one space, without the line breaks at the ends or a run of blank lines", () => {
    expect(oneLine(["Title", ""])).toBe("Title");
    expect(oneLine(["", "Measure", "", "", "wind", ""])).toBe("Measure wind");
    expect(oneLine(["", ""])).toBe("");
  });
});

describe("singleLine (#621)", () => {
  it("makes typed, pasted and dropped line breaks one space, the caret after the insertion", () => {
    expect(inserted("Measure speed", 8, "wind\n", "input.type").doc.toString()).toBe("Measure windspeed");
    const pasted = inserted("Measure ", 8, "the\r\nwind\n\nspeed\n", "input.paste");
    expect(pasted.doc.toString()).toBe("Measure the wind speed");
    expect(pasted.selection.main.head).toBe(22);
    expect(pasted.doc.lines).toBe(1);
    expect(inserted("ab", 1, "\n", "input.drop").doc.toString()).toBe("ab");
    // The Emacs "split line" (Ctrl+O on macOS) is input too.
    expect(inserted("ab", 1, "\n", "input").doc.toString()).toBe("ab");
  });

  it("keeps the user event and every change of the transaction", () => {
    const tr = state("ab").update({
      changes: [
        { from: 0, insert: "x\ny" },
        { from: 2, insert: "!" },
      ],
      userEvent: "input.paste",
    });
    expect(tr.state.doc.toString()).toBe("x yab!");
    expect(tr.isUserEvent("input.paste")).toBe(true);
  });

  it("leaves the file's text, undo and redo, an edit put in by the app and other text as they are", () => {
    expect(inserted("ab", 1, "\n").doc.toString()).toBe("a\nb");
    expect(inserted("ab", 1, "\n", "undo").doc.toString()).toBe("a\nb");
    expect(inserted("ab", 1, "\n", "input.set").doc.toString()).toBe("a\nb");
    const plain = state("ab").update({ changes: { from: 1, insert: "c" }, userEvent: "input.type" });
    expect(plain.state.doc.toString()).toBe("acb");
    expect(
      state("ab")
        .update({ selection: { anchor: 1 } })
        .state.doc.toString(),
    ).toBe("ab");
  });
});
