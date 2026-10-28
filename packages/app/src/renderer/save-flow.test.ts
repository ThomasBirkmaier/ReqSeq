import type { DataExportElement } from "@logreq/core";
import { describe, expect, it } from "vitest";
import type { Draft } from "./drafts.js";
import type { PropertyInfo, PropertyModel } from "./element-view.js";
import { TITLE_FIELD } from "./element-view.js";
import { RESOLVE_FIRST } from "./outside-change.js";
import type { BoxEdit } from "./property-edit.js";
import {
  afterRefusal,
  checkStep,
  failedSpeech,
  leftDraft,
  saveStep,
  savedSpeech,
  staleRead,
} from "./save-flow.js";

const text: PropertyInfo = { kind: "text", many: false, markdown: false };
const model: PropertyModel = new Map([
  [
    "need",
    new Map<string, PropertyInfo>([
      ["title", { ...text, meaning: "title" }],
      ["topic", text],
    ]),
  ],
]);
const element = (body: string, title: string, topic?: string): DataExportElement =>
  ({
    id: "uuid-1",
    shortId: "SR-036",
    type: "need",
    title,
    text: body,
    properties: topic === undefined ? {} : { topic },
    relations: [],
  }) as unknown as DataExportElement;
const edit = (key: string, base: string, doc: string): BoxEdit => ({ key, info: text, base, doc });
const EDITOR = { name: "the editor" };

describe("a save (SR-105, SR-106)", () => {
  it("[SR-105/AK1] a save writes when there is input and nothing stops it, and writes nothing without input", () => {
    expect(saveStep({ editor: EDITOR, input: true, note: undefined, mode: "quiet" })).toEqual({
      kind: "write",
      editor: EDITOR,
    });
    expect(saveStep({ editor: EDITOR, input: false, note: undefined, mode: "quiet" })).toEqual({
      kind: "done",
      result: true,
    });
  });

  it("[SR-106/AK2] nothing is written during a conflict; Save element says how to resolve it, autosave says nothing", () => {
    expect(saveStep({ editor: EDITOR, input: true, note: RESOLVE_FIRST, mode: "asked" })).toEqual({
      kind: "done",
      result: false,
      echo: RESOLVE_FIRST,
    });
    expect(saveStep({ editor: EDITOR, input: true, note: RESOLVE_FIRST, mode: "quiet" })).toEqual({
      kind: "done",
      result: false,
    });
  });

  it("[SR-106/AK2] a write refused because the file changed reads it once, and other bytes follow the outside-change rule", () => {
    expect(afterRefusal("file.changed-on-disk")).toBe("check");
    expect(checkStep("two", "one", undefined)).toEqual({ kind: "apply" });
    expect(checkStep("two", "one", "refused before")).toEqual({ kind: "apply" });
  });

  it("says that nothing is to save only when asked, and is done without input under a note", () => {
    expect(saveStep({ editor: EDITOR, input: false, note: undefined, mode: "asked" })).toEqual({
      kind: "done",
      result: true,
      echo: "No changes to save",
    });
    // A note stops the save: true when there is no input to lose (R4: not simply false).
    expect(saveStep({ editor: EDITOR, input: false, note: "SR-036 is read-only", mode: "quiet" })).toEqual({
      kind: "done",
      result: true,
    });
  });

  it("is done at once without a text editor, whatever the input and the note", () => {
    expect(saveStep({ editor: undefined, input: true, note: RESOLVE_FIRST, mode: "asked" })).toEqual({
      kind: "done",
      result: true,
    });
  });

  it("reads once after a refusal of a gone file, and says any other refusal", () => {
    expect(afterRefusal("ref.unknown")).toBe("check");
    expect(afterRefusal("element.invalid")).toBe("fail");
  });

  it("writes the bytes sent again once when only the store lagged, and says a second refusal", () => {
    expect(checkStep("one", "one", undefined)).toEqual({ kind: "retry" });
    expect(checkStep("one", "one", "the file changed")).toEqual({
      kind: "refused",
      message: "the file changed",
    });
    expect(checkStep("one", undefined, undefined)).toEqual({ kind: "apply" });
  });

  it("takes an answer asked before a save of the buffer answered as stale", () => {
    expect(staleRead(2, 2)).toBe(false);
    expect(staleRead(1, 2)).toBe(true);
  });
});

describe("what a save says (D-062)", () => {
  it("says Saved <name> when asked, with the hint of core, and clears the error", () => {
    expect(savedSpeech({ error: "boom", hint: "old" }, "asked", "SR-036", undefined)).toEqual({
      echo: "Saved SR-036",
      said: { error: undefined, hint: undefined },
    });
    expect(savedSpeech({}, "asked", "SR-036", "topic is required")).toEqual({
      echo: "Saved SR-036. topic is required",
      said: { error: undefined, hint: "topic is required" },
    });
    expect(savedSpeech({ hint: "topic is required" }, "asked", "SR-036", "topic is required").echo).toBe(
      "Saved SR-036. topic is required",
    );
  });

  it("says a hint once when quiet, and nothing without a new one", () => {
    expect(savedSpeech({ error: "boom" }, "quiet", "SR-036", "topic is required")).toEqual({
      echo: "Saved SR-036. topic is required",
      said: { error: undefined, hint: "topic is required" },
    });
    expect(savedSpeech({ hint: "topic is required" }, "quiet", "SR-036", "topic is required")).toEqual({
      said: { error: undefined, hint: "topic is required" },
    });
    expect(savedSpeech({ hint: "topic is required" }, "quiet", "SR-036", undefined)).toEqual({
      said: { error: undefined, hint: undefined },
    });
  });

  it("says a failed save when asked or when its error is new, and keeps the hint", () => {
    expect(failedSpeech({ hint: "h" }, "quiet", "boom")).toEqual({
      echo: "boom",
      said: { hint: "h", error: "boom" },
    });
    expect(failedSpeech({ hint: "h", error: "boom" }, "quiet", "boom")).toEqual({
      said: { hint: "h", error: "boom" },
    });
    expect(failedSpeech({ error: "boom" }, "asked", "boom")).toEqual({
      echo: "boom",
      said: { error: "boom" },
    });
  });
});

describe("the answer of a save that came after the buffer was left (SR-105)", () => {
  it("keeps input typed while the save ran, on the bytes the save wrote", () => {
    const draft: Draft = {
      text: "typed more",
      base: "old",
      boxes: new Map([
        ["topic", { doc: "rain", base: "wind" }],
        [TITLE_FIELD, { doc: "Gusts!", base: "Wind" }],
      ]),
      sha: "one",
    };
    const saved = element("typed", "Gusts", "rain");
    const rest = leftDraft(
      draft,
      {
        textDirty: true,
        doc: "typed",
        edits: [edit("topic", "wind", "rain"), edit(TITLE_FIELD, "Wind", "Gusts")],
      },
      { element: saved, sha: "two" },
      model,
    );
    expect(rest).toEqual({
      text: "typed more",
      base: "typed",
      boxes: new Map([[TITLE_FIELD, { doc: "Gusts!", base: "Gusts" }]]),
      sha: "two",
      shown: { element: saved, sha: "two" },
    });
  });

  it("leaves no draft when everything typed went with the save", () => {
    const draft: Draft = {
      text: "typed",
      base: "old",
      boxes: new Map([["topic", { doc: "rain", base: "wind" }]]),
    };
    expect(
      leftDraft(
        draft,
        { textDirty: true, doc: "typed", edits: [edit("topic", "wind", "rain")] },
        { element: element("typed", "Wind", "rain"), sha: "two" },
        model,
      ),
    ).toBeUndefined();
  });

  it("takes an element without text as the empty text", () => {
    const saved = { ...element("", "Wind"), text: undefined } as unknown as DataExportElement;
    expect(
      leftDraft(
        { text: "typed", base: "x" },
        { textDirty: false, doc: "x", edits: [] },
        { element: saved, sha: "two" },
        model,
      ),
    ).toEqual({ text: "typed", base: "", sha: "two", shown: { element: saved, sha: "two" } });
  });

  it("compares the boxes with the stored documents of the model it is given, the title among them", () => {
    const draft: Draft = {
      text: "file",
      base: "file",
      boxes: new Map([[TITLE_FIELD, { doc: "Gusts", base: "Wind" }]]),
    };
    const sent = { textDirty: false, doc: "file", edits: [] };
    const saved = { element: element("file", "Gusts"), sha: "two" };
    // With the title property in the model the file holds the input: nothing is left.
    expect(leftDraft(draft, sent, saved, model)).toBeUndefined();
    // Without it the title has no stored document, so its input stays on the empty one.
    expect(leftDraft(draft, sent, saved, new Map())?.boxes).toEqual(
      new Map([[TITLE_FIELD, { doc: "Gusts", base: "" }]]),
    );
  });
});
