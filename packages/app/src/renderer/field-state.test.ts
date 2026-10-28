import type { DataExportElement } from "@logreq/core";
import { describe, expect, it } from "vitest";
import type { Draft } from "./drafts.js";
import type { PropertyInfo, PropertyModel } from "./element-view.js";
import { TITLE_FIELD } from "./element-view.js";
import type { BufferFields } from "./field-state.js";
import {
  NO_FIELDS,
  boxDocs,
  draftOf,
  fileDocs,
  firstLoad,
  inputDocs,
  propertyAdded,
  reloaded,
  restored,
  settledFields,
  valueDoc,
  valueSet,
} from "./field-state.js";
import { TEXT_FIELD, outsideChange } from "./outside-change.js";

const text: PropertyInfo = { kind: "text", many: false, markdown: false };
const choice: PropertyInfo = { kind: "choice", many: false, markdown: false };
const relation: PropertyInfo = { kind: "relation", many: true, markdown: false };
const model: PropertyModel = new Map([
  [
    "need",
    new Map<string, PropertyInfo>([
      ["title", { ...text, meaning: "title" }],
      ["topic", text],
      ["area", choice],
      ["uses", relation],
    ]),
  ],
]);
const element = (body: string): DataExportElement =>
  ({ shortId: "SR-036", type: "need", title: "Wind", text: body }) as unknown as DataExportElement;
const fields = (changes: Partial<BufferFields>): BufferFields => ({ ...NO_FIELDS, ...changes });
const docsOf = (...entries: [string, string][]): Map<string, string> => new Map(entries);

describe("what the buffer holds against the file", () => {
  it("starts with nothing loaded", () => {
    expect(NO_FIELDS).toEqual({ baseline: "", stored: new Map(), added: [], values: new Map() });
  });

  it("holds the editors' documents, then the values set in the minibuffer", () => {
    const values = docsOf(["area", "high"]);
    expect([
      ...boxDocs(
        [
          ["topic", "wind"],
          [TITLE_FIELD, "Wind"],
        ],
        values,
      ),
    ]).toEqual([
      ["topic", "wind"],
      [TITLE_FIELD, "Wind"],
      ["area", "high"],
    ]);
  });

  it("has input in the text when typed in, and in every box not equal to its stored document", () => {
    const now = fields({ baseline: "file", stored: docsOf(["topic", "wind"], [TITLE_FIELD, "Wind"]) });
    expect(inputDocs(now, "typed", docsOf(["topic", "wind"], [TITLE_FIELD, "Gusts"]))).toEqual(
      docsOf([TEXT_FIELD, "typed"], [TITLE_FIELD, "Gusts"]),
    );
    expect(inputDocs(now, "file", docsOf(["topic", "rain"]))).toEqual(docsOf(["topic", "rain"]));
  });

  it("has no text input without a text editor, and no title input before the title's editor is there", () => {
    const now = fields({ baseline: "file", stored: docsOf([TITLE_FIELD, "Wind"]) });
    expect(inputDocs(now, undefined, new Map())).toEqual(new Map());
  });

  it("has what the file holds: the text, the title and the boxes", () => {
    const now = fields({ baseline: "file", stored: docsOf([TITLE_FIELD, "Wind"], ["topic", "wind"]) });
    expect([...fileDocs(now)]).toEqual([
      [TEXT_FIELD, "file"],
      [TITLE_FIELD, "Wind"],
      ["topic", "wind"],
    ]);
  });

  it("makes the draft of the text and of every box that differs, on the bytes the input was typed on", () => {
    const now = fields({ stored: docsOf(["topic", "wind"], [TITLE_FIELD, "Wind"]) });
    expect(draftOf(now, { doc: "file", base: "file" }, docsOf(["topic", "wind"]), "one")).toBeUndefined();
    expect(
      draftOf(now, { doc: "typed", base: "file" }, docsOf(["topic", "rain"], [TITLE_FIELD, "Wind"]), "one"),
    ).toEqual({
      text: "typed",
      base: "file",
      boxes: new Map([["topic", { doc: "rain", base: "wind" }]]),
      sha: "one",
    });
  });

  it("gives a choice or relation box its input, else its stored document, else nothing", () => {
    const now = fields({ stored: docsOf(["area", "low"]), values: docsOf(["uses", "[[SR-1]]"]) });
    expect(valueDoc(now, "uses")).toBe("[[SR-1]]");
    expect(valueDoc(now, "area")).toBe("low");
    expect(valueDoc(now, "topic")).toBe("");
  });

  it("sets the value of a choice or relation box in a new map", () => {
    const before = fields({ values: docsOf(["area", "low"]) });
    const after = valueSet(before, "area", "high");
    expect(after.values).toEqual(docsOf(["area", "high"]));
    expect(before.values).toEqual(docsOf(["area", "low"]));
  });

  it("adds a property: the key is added, its stored document is empty, in a new map", () => {
    const before = fields({ stored: docsOf(["topic", "wind"]), added: ["area"] });
    const after = propertyAdded(before, "uses");
    expect(after.added).toEqual(["area", "uses"]);
    expect(after.stored).toEqual(docsOf(["topic", "wind"], ["uses", ""]));
    expect(after.stored).not.toBe(before.stored);
    expect(before.stored).toEqual(docsOf(["topic", "wind"]));
  });

  it("stores the file's documents at the first answer, and the empty document for every added box", () => {
    const now = firstLoad(fields({ baseline: "file", added: ["area"] }), docsOf([TITLE_FIELD, "Wind"]));
    expect(now.stored).toEqual(docsOf([TITLE_FIELD, "Wind"], ["area", ""]));
    expect(now.baseline).toBe("file");
  });
});

describe("a reload (SR-106, SR-116)", () => {
  it("[SR-106/AK1] a reload puts the file's value into every field without input", () => {
    const before = fields({
      baseline: "old text",
      stored: docsOf([TITLE_FIELD, "Wind"], ["topic", "wind"], ["area", "low"]),
      values: docsOf(["area", "low"]),
    });
    const next = reloaded(
      before,
      "new text",
      docsOf([TITLE_FIELD, "Gusts"], ["topic", "rain"], ["area", "high"]),
      new Map(),
      docsOf([TITLE_FIELD, "Wind"], ["topic", "wind"], ["area", "low"]),
    );
    expect(next.followed).toEqual(docsOf([TITLE_FIELD, "Gusts"], ["topic", "rain"], ["area", "high"]));
    expect(next.fields.values).toEqual(new Map());
    expect(next.fields.baseline).toBe("new text");
    expect(next.fields.stored).toEqual(docsOf([TITLE_FIELD, "Gusts"], ["topic", "rain"], ["area", "high"]));
    expect(next.draftText).toBe("new text");
  });

  it("[SR-116/AK3] a reload keeps every input: a choice or relation value with input, and a box with input whose property left the file stays as an added box", () => {
    const before = fields({
      baseline: "old",
      stored: docsOf([TITLE_FIELD, "Wind"], ["topic", "wind"], ["area", "low"]),
      values: docsOf(["area", "high"]),
    });
    const input = docsOf([TEXT_FIELD, "typed"], [TITLE_FIELD, "Gusts"], ["topic", "rain"], ["area", "high"]);
    const next = reloaded(
      before,
      "new",
      docsOf([TITLE_FIELD, "Breeze"], ["area", "medium"]),
      input,
      docsOf([TITLE_FIELD, "Gusts"], ["topic", "rain"], ["area", "high"]),
    );
    expect(next.followed).toEqual(docsOf([TITLE_FIELD, "Gusts"], ["topic", "rain"], ["area", "high"]));
    expect(next.fields.values).toEqual(docsOf(["area", "high"]));
    expect(next.fields.added).toEqual(["topic"]);
    expect(next.fields.stored).toEqual(docsOf([TITLE_FIELD, "Breeze"], ["area", "medium"], ["topic", ""]));
    expect(next.addedChanged).toBe(true);
    expect(next.draftText).toBeUndefined();
  });

  it("[SR-106/AK2] input on other bytes than it was typed on is a conflict after a reload, the title as any field", () => {
    const before = fields({ baseline: "old", stored: docsOf([TITLE_FIELD, "Wind"]) });
    const input = docsOf([TITLE_FIELD, "Gusts"]);
    const next = reloaded(before, "old", docsOf([TITLE_FIELD, "Breeze"]), input, input);
    expect(outsideChange(input, "one", { sha: "two", docs: fileDocs(next.fields) })).toEqual({
      kind: "conflict",
      dropped: [],
      fields: [{ label: TITLE_FIELD, input: "Gusts", disk: "Breeze" }],
    });
  });

  it("leaves a box without input whose property left the file as it is in the draft (its box goes)", () => {
    const before = fields({ stored: docsOf(["topic", "wind"]) });
    const next = reloaded(before, "", new Map(), new Map(), docsOf(["topic", "wind"]));
    expect(next.followed).toEqual(docsOf(["topic", "wind"]));
    expect(next.fields.stored).toEqual(new Map());
  });

  it("drops a value whose input the file now holds", () => {
    const before = fields({ stored: docsOf(["area", "low"]), values: docsOf(["area", "high"]) });
    const next = reloaded(
      before,
      "",
      docsOf(["area", "high"]),
      docsOf(["area", "high"]),
      docsOf(["area", "high"]),
    );
    expect(next.fields.values).toEqual(new Map());
  });

  it("keeps an added box while the file has no value for it, and drops it when the file has one", () => {
    const before = fields({ stored: docsOf(["area", ""]), added: ["area"] });
    const kept = reloaded(before, "", new Map(), new Map(), new Map());
    expect(kept.fields.added).toBe(before.added);
    expect(kept.fields.stored).toEqual(docsOf(["area", ""]));
    expect(kept.addedChanged).toBe(false);
    const filled = reloaded(before, "", docsOf(["area", "low"]), new Map(), new Map());
    expect(filled.fields.added).toEqual([]);
    expect(filled.addedChanged).toBe(true);
  });

  it("puts title input into the added keys when the file no longer has a title field, as any input key", () => {
    const before = fields({ stored: docsOf([TITLE_FIELD, "Wind"]) });
    const input = docsOf([TITLE_FIELD, "Gusts"]);
    const next = reloaded(before, "", new Map(), input, input);
    expect(next.fields.added).toEqual([TITLE_FIELD]);
    expect(next.fields.stored.get(TITLE_FIELD)).toBe("");
    expect(next.addedChanged).toBe(true);
  });

  it("returns a new values map always, and keeps the added keys while their number stays", () => {
    const before = fields({ added: ["area"], stored: docsOf(["area", ""]), values: new Map() });
    const next = reloaded(before, "", new Map(), new Map(), new Map());
    expect(next.fields.values).not.toBe(before.values);
    expect(next.fields.added).toBe(before.added);
    // The number is what counts (R4): another key in place of the one before keeps the old array.
    const swapped = reloaded(
      fields({ added: ["area"], stored: docsOf(["area", ""]) }),
      "",
      docsOf(["area", "low"]),
      docsOf(["topic", "x"]),
      new Map(),
    );
    expect(swapped.addedChanged).toBe(false);
    expect(swapped.fields.added).toEqual(["area"]);
    expect(swapped.fields.stored).toEqual(docsOf(["area", "low"], ["topic", ""]));
  });
});

describe("a buffer shown again with a draft (SR-106)", () => {
  const typedOn = (boxes: [string, string, string][], sha = "one", textDoc = "file"): Draft => ({
    text: textDoc,
    base: "file",
    boxes: new Map(boxes.map(([key, doc, base]) => [key, { doc, base }])),
    sha,
  });

  it("[SR-106/AK2] a draft shown again on other bytes is a conflict with its kept input; on the same bytes it follows the file", () => {
    const kept = typedOn([["topic", "rain", "wind"]], "one", "typed");
    const other = restored(kept, element("changed"), docsOf(["topic", "storm"]), "two", model);
    expect(other.change.kind).toBe("conflict");
    expect(other.basis).toBe("one");
    expect(other.keptText).toBe("typed");
    expect(other.keptBoxes).toEqual(new Map([["topic", { doc: "rain", base: "storm" }]]));
    expect(other.draft).toEqual({
      text: "typed",
      base: "changed",
      boxes: new Map([["topic", { doc: "rain", base: "storm" }]]),
      sha: "one",
    });
    expect(other.changed).toBe(true);
    const same = restored(kept, element("file"), docsOf(["topic", "wind"]), "one", model);
    expect(same.change.kind).toBe("follow");
    expect(same.basis).toBe("one");
    expect(same.draft).toEqual(kept);
    expect(same.changed).toBe(false);
  });

  it("[SR-106/AK2] a draft with title input shown again on other bytes, the file's title changed, is a conflict and opens the title", () => {
    const kept = typedOn([[TITLE_FIELD, "Gusts", "Wind"]]);
    const back = restored(kept, element("file"), docsOf([TITLE_FIELD, "Breeze"]), "two", model);
    expect(back.change).toEqual({
      kind: "conflict",
      dropped: [],
      fields: [{ label: TITLE_FIELD, input: "Gusts", disk: "Breeze" }],
    });
    expect(back.basis).toBe("one");
    expect(back.titleOpens).toBe(true);
    expect(back.draft?.boxes?.get(TITLE_FIELD)).toEqual({ doc: "Gusts", base: "Breeze" });
  });

  it("brings title input back into the title, never as an added box or a value", () => {
    const kept = typedOn([[TITLE_FIELD, "Gusts", "Wind"]]);
    const back = restored(kept, element("file"), docsOf([TITLE_FIELD, "Wind"]), "one", model);
    expect(back.titleOpens).toBe(true);
    expect(back.keptBoxes.get(TITLE_FIELD)).toEqual({ doc: "Gusts", base: "Wind" });
    expect(back.added).toEqual([]);
    expect(back.values).toEqual(new Map());
  });

  it("keeps title input as a box on the empty document when the file has no title field", () => {
    const kept = typedOn([[TITLE_FIELD, "Gusts", "Wind"]]);
    const back = restored(kept, element("file"), new Map(), "two", model);
    expect(back.keptBoxes.get(TITLE_FIELD)).toEqual({ doc: "Gusts", base: "" });
    expect(back.titleOpens).toBe(true);
    expect(back.added).toEqual([]);
    expect(back.values).toEqual(new Map());
  });

  it("opens no title when the file now holds the title input", () => {
    const kept = typedOn([[TITLE_FIELD, "Gusts", "Wind"]]);
    const back = restored(kept, element("file"), docsOf([TITLE_FIELD, "Gusts"]), "two", model);
    expect(back.keptBoxes.has(TITLE_FIELD)).toBe(false);
    expect(back.titleOpens).toBe(false);
    expect(back.draft).toBeUndefined();
    expect(back.changed).toBe(true);
  });

  it("gives the draft its own boxes: the editors taking their kept input change nothing in it", () => {
    const kept = typedOn([[TITLE_FIELD, "Gusts", "Wind"]]);
    const back = restored(kept, element("file"), docsOf([TITLE_FIELD, "Wind"]), "one", model);
    back.keptBoxes.delete(TITLE_FIELD);
    expect(back.draft?.boxes?.get(TITLE_FIELD)).toEqual({ doc: "Gusts", base: "Wind" });
  });

  it("keeps only known properties as added boxes, and values only for a choice or relation", () => {
    const kept = typedOn([
      ["area", "high", ""],
      ["uses", "[[SR-1]]", "[[SR-2]]"],
      ["topic", "rain", ""],
      ["gone", "x", ""],
    ]);
    const back = restored(kept, element("file"), docsOf(["uses", "[[SR-2]]"]), "one", model);
    expect(back.added).toEqual(["area", "topic"]);
    expect(back.values).toEqual(docsOf(["area", "high"], ["uses", "[[SR-1]]"]));
    expect(back.keptText).toBeUndefined();
    expect(back.titleOpens).toBe(false);
  });

  it("drops text input the file now holds, and reads a missing text as empty", () => {
    const kept: Draft = { text: "same", base: "file", sha: "one" };
    const back = restored(kept, element("same"), new Map(), "two", model);
    expect(back.keptText).toBeUndefined();
    expect(back.basis).toBe("two");
    const none = restored(
      { text: "typed", base: "" },
      { shortId: "SR-036", type: "other", title: "" } as unknown as DataExportElement,
      new Map(),
      "two",
      model,
    );
    expect(none.keptText).toBe("typed");
    expect(none.draft).toEqual({ text: "typed", base: "" });
  });

  it("returns a new added array and new kept boxes every time", () => {
    const kept = typedOn([]);
    const one = restored(kept, element("file"), new Map(), "one", model);
    const two = restored(kept, element("file"), new Map(), "one", model);
    expect(one.added).not.toBe(two.added);
    expect(one.keptBoxes).not.toBe(two.keptBoxes);
  });
});

describe("after a save (SR-105)", () => {
  const sentOf = (
    doc: string,
    edits: [string, string][],
    added: string[] = [],
  ): { doc: string; edits: { key: string; doc: string }[]; added: string[] } => ({
    doc,
    edits: edits.map(([key, edited]) => ({ key, doc: edited })),
    added,
  });

  it("[SR-105/AK1] after a save, input typed while it ran stays for the next save: in the text, in a box, in a choice", () => {
    const before = fields({
      baseline: "old",
      stored: docsOf(["topic", "wind"], ["area", "low"]),
      values: docsOf(["area", "high"]),
    });
    const sent = sentOf("sent", [
      ["topic", "rain"],
      ["area", "medium"],
    ]);
    const editors = docsOf(["topic", "rain and more"]);
    const result = settledFields(
      before,
      { text: "sent", docs: docsOf(["topic", "rain"], ["area", "medium"]) },
      sent,
      { textDoc: "sent and more", boxDoc: (key) => editors.get(key) },
    );
    expect(result.textReplace).toBeUndefined();
    expect(result.values).toEqual(docsOf(["area", "high"]));
    const after = { ...result.fields, values: result.values };
    expect(inputDocs(after, "sent and more", docsOf(["topic", "rain and more"], ["area", "high"]))).toEqual(
      docsOf([TEXT_FIELD, "sent and more"], ["topic", "rain and more"], ["area", "high"]),
    );
  });

  it("puts the file's form into a box that still holds what was sent, rebases every saved box, the title first as sent", () => {
    const before = fields({ stored: docsOf([TITLE_FIELD, "Wind"], ["topic", "wind"]) });
    const sent = sentOf("t", [
      [TITLE_FIELD, " Gusts"],
      ["topic", "rain"],
      ["gone", "x"],
    ]);
    const editors = docsOf([TITLE_FIELD, " Gusts"], ["topic", "rain typed"]);
    const result = settledFields(
      before,
      { text: "t", docs: docsOf([TITLE_FIELD, "Gusts"], ["topic", "rain"]) },
      sent,
      { textDoc: "t", boxDoc: (key) => editors.get(key) },
    );
    expect(result.boxes).toEqual([
      { key: TITLE_FIELD, replace: "Gusts", rebase: "Gusts" },
      { key: "topic", rebase: "rain" },
      { key: "gone" },
    ]);
  });

  it("does not replace a title whose editor holds other input, nor one the file holds as sent", () => {
    const before = fields({ stored: docsOf([TITLE_FIELD, "Wind"]) });
    const typed = settledFields(
      before,
      { text: "", docs: docsOf([TITLE_FIELD, "Gusts"]) },
      sentOf("", [[TITLE_FIELD, " Gusts"]]),
      { textDoc: "", boxDoc: () => " Gusts!" },
    );
    expect(typed.boxes).toEqual([{ key: TITLE_FIELD, rebase: "Gusts" }]);
    const same = settledFields(
      before,
      { text: "", docs: docsOf([TITLE_FIELD, "Gusts"]) },
      sentOf("", [[TITLE_FIELD, "Gusts"]]),
      { textDoc: "", boxDoc: () => "Gusts" },
    );
    expect(same.boxes).toEqual([{ key: TITLE_FIELD, rebase: "Gusts" }]);
  });

  it("puts the text core saved into the editor when it still holds what was sent (afterSave)", () => {
    const result = settledFields(
      fields({ baseline: "a" }),
      { text: "b\n", docs: new Map() },
      sentOf("b", []),
      {
        textDoc: "b",
        boxDoc: () => undefined,
      },
    );
    expect(result.textReplace).toBe("b\n");
    expect(result.fields.baseline).toBe("b\n");
    const typed = settledFields(
      fields({ baseline: "a" }),
      { text: "b\n", docs: new Map() },
      sentOf("b", []),
      {
        textDoc: "bc",
        boxDoc: () => undefined,
      },
    );
    expect(typed.textReplace).toBeUndefined();
  });

  it("drops an added box left empty, keeps one typed in meanwhile, and keeps a box the save emptied that was typed in", () => {
    const before = fields({
      added: ["area", "topic", "uses"],
      stored: docsOf(["area", ""], ["topic", ""], ["uses", ""]),
      values: docsOf(["area", "high"]),
    });
    const editors = docsOf(["topic", ""], ["note", "typed"], ["other", "sent"], ["empty", ""]);
    const result = settledFields(
      before,
      { text: "", docs: docsOf(["uses", "[[SR-1]]"]) },
      sentOf(
        "",
        [
          ["note", "x"],
          ["other", "sent"],
          ["empty", "y"],
          ["area", "z"],
        ],
        ["area", "topic"],
      ),
      { textDoc: "", boxDoc: (key) => editors.get(key) },
    );
    // "area" was added and sent and still holds a value (the old values, before the save's are dropped);
    // "topic" was added and sent and is empty; "uses" is in the file now; "note" was typed in while the save
    // emptied it; "other" holds what was sent and "empty" nothing.
    expect(result.fields.added).toEqual(["area", "note"]);
    expect(result.fields.stored).toEqual(docsOf(["uses", "[[SR-1]]"], ["area", ""], ["note", ""]));
  });

  it("keeps an added box not in the sent ones, and reads a box without editor or value as empty", () => {
    const before = fields({ added: ["area", "topic"], stored: docsOf(["area", ""], ["topic", ""]) });
    const result = settledFields(
      before,
      { text: "", docs: new Map() },
      sentOf("", [["gone", "x"]], ["topic"]),
      {
        textDoc: "",
        boxDoc: () => undefined,
      },
    );
    expect(result.fields.added).toEqual(["area"]);
  });

  it("drops the values that still hold what was sent, keeps the others, in new arrays and maps", () => {
    const before = fields({ values: docsOf(["area", "high"], ["uses", "[[SR-1]]"]), added: [] });
    const result = settledFields(
      before,
      { text: "", docs: docsOf(["area", "high"], ["uses", "[[SR-2]]"]) },
      sentOf("", [
        ["area", "high"],
        ["uses", "[[SR-2]]"],
      ]),
      { textDoc: "", boxDoc: () => undefined },
    );
    expect(result.values).toEqual(docsOf(["uses", "[[SR-1]]"]));
    expect(result.values).not.toBe(before.values);
    expect(result.fields.added).not.toBe(before.added);
    expect(result.fields).not.toHaveProperty("values");
    const nothing = settledFields(before, { text: "", docs: new Map() }, sentOf("", []), {
      textDoc: "",
      boxDoc: () => undefined,
    });
    expect(nothing.values).toEqual(before.values);
    expect(nothing.values).not.toBe(before.values);
  });
});
