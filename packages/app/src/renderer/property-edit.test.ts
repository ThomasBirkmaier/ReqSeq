import type { DataExportElement } from "@logreq/core";
import { describe, expect, it } from "vitest";
import type { PropertyInfo, PropertyModel } from "./element-view.js";
import {
  boxValue,
  changedBoxes,
  changedUnderEdit,
  editableBoxes,
  editsOf,
  savedHint,
  storedDocs,
  updateInput,
} from "./property-edit.js";
import type { BoxEdit } from "./property-edit.js";

const text: PropertyInfo = { kind: "text", many: false, markdown: false };
const list: PropertyInfo = { kind: "text", many: true, markdown: false };
const number: PropertyInfo = { kind: "number", many: false, markdown: false };

const model: PropertyModel = new Map([
  [
    "need",
    new Map<string, PropertyInfo>([
      ["topic", text],
      ["criteria", list],
      ["effort", number],
      ["sizes", { kind: "number", many: true, markdown: false }],
      ["day", { kind: "date", many: false, markdown: false }],
      ["area", { kind: "choice", many: false, markdown: false }],
    ]),
  ],
]);

const element = (properties: Record<string, unknown>, type = "need"): DataExportElement =>
  ({ type, properties, relations: [] }) as unknown as DataExportElement;

describe("boxValue", () => {
  it("[SR-104/AK1] is the stored value as it is: a string, a number as its text, a list with one item per line", () => {
    expect(boxValue("Wind", false)).toEqual({ doc: "Wind", lineBreak: false });
    expect(boxValue("  Wind \n", false)).toEqual({ doc: "  Wind \n", lineBreak: false });
    expect(boxValue(2.5, false)).toEqual({ doc: "2.5", lineBreak: false });
    expect(boxValue(["a", 3, "c"], true)).toEqual({ doc: "a\n3\nc", lineBreak: false });
    // Blank items are part of the document: the lines of a box would leave them out.
    expect(boxValue(["a", "", "c"], true)).toEqual({ doc: "a\n\nc", lineBreak: false });
    expect(boxValue(["only"], false)).toEqual({ doc: "only", lineBreak: false });
  });

  it("keeps the line break of a single value, and marks a list item that holds one", () => {
    expect(boxValue("one\ntwo", false)).toEqual({ doc: "one\ntwo", lineBreak: false });
    expect(boxValue(["one\ntwo", "three"], true)).toEqual({ doc: "one\ntwo\nthree", lineBreak: true });
    expect(boxValue("one\ntwo", true)).toEqual({ doc: "one\ntwo", lineBreak: true });
    expect(boxValue(["a\nb"], false)).toEqual({ doc: "a\nb", lineBreak: true });
  });

  it("has no document for what is not text", () => {
    for (const value of [{ id: "x" }, true, null, undefined, [["a"]], ["a", {}], [{ title: "t" }]]) {
      expect(boxValue(value, true)).toBeUndefined();
    }
  });
});

describe("editableBoxes", () => {
  it("[SR-104/AK1] has the filled properties of a text kind that the type has, and no other", () => {
    const boxes = editableBoxes(
      element({
        topic: "Wind",
        criteria: ["a", "b"],
        effort: 3,
        area: "performance",
        unknown: "x",
        empty: "",
        day: { nested: true },
      }),
      model,
    );
    expect([...boxes.keys()]).toEqual(["topic", "criteria", "effort"]);
    expect(boxes.get("criteria")).toEqual({ key: "criteria", info: list, doc: "a\nb", lineBreak: false });
    expect(storedDocs(boxes)).toEqual(
      new Map([
        ["topic", "Wind"],
        ["criteria", "a\nb"],
        ["effort", "3"],
      ]),
    );
  });

  it("has none for a type the model does not know", () => {
    expect(editableBoxes(element({ topic: "Wind" }, "other"), model).size).toBe(0);
    expect(editableBoxes(element({ topic: "Wind" }), new Map()).size).toBe(0);
  });
});

describe("updateInput", () => {
  const edit = (key: string, info: PropertyInfo, base: string, doc: string): BoxEdit => ({
    key,
    info,
    base,
    doc,
  });

  it("[SR-104/AK4] removes a property whose box was emptied: unset, for every text kind", () => {
    expect(
      updateInput("u", undefined, [
        edit("topic", text, "Wind", ""),
        edit("criteria", list, "a\nb", ""),
        edit("effort", number, "3", ""),
        edit("day", { kind: "date", many: false, markdown: false }, "2026-10-27", ""),
      ]),
    ).toEqual({ ref: "u", unset: ["topic", "criteria", "effort", "day"] });
  });

  it("[SR-104/AK4] treats a box with nothing but blank lines as emptied", () => {
    expect(
      updateInput("u", undefined, [edit("criteria", list, "a", " \n\n\t"), edit("topic", text, "x", "  ")]),
    ).toEqual({ ref: "u", unset: ["criteria", "topic"] });
  });

  it("sends only the boxes that differ from the stored document, and the text when given", () => {
    expect(updateInput("u", "New text", [edit("topic", text, "Wind", "Wind")])).toEqual({
      ref: "u",
      text: "New text",
    });
    expect(updateInput("u", undefined, [])).toEqual({ ref: "u" });
    expect(changedBoxes([edit("topic", text, "a", "a"), edit("criteria", list, "a", "b")])).toEqual([
      edit("criteria", list, "a", "b"),
    ]);
  });

  it("sends a list as the whole array, drops blank lines and keeps every other line byte for byte", () => {
    expect(updateInput("u", undefined, [edit("criteria", list, "a\nb", "a\n\n  b \n\t\n*c*")])).toEqual({
      ref: "u",
      set: { criteria: ["a", "  b ", "*c*"] },
    });
  });

  it("sends a single value as the text typed, without trimming", () => {
    expect(updateInput("u", undefined, [edit("topic", text, "Wind", "  Gust\n")])).toEqual({
      ref: "u",
      set: { topic: "  Gust\n" },
    });
    // A single value may hold a line break.
    expect(updateInput("u", undefined, [edit("topic", text, "a", "a\nb")])).toEqual({
      ref: "u",
      set: { topic: "a\nb" },
    });
  });

  it("makes a number of a decimal literal, and leaves anything else as the text typed", () => {
    const sent = (doc: string) => updateInput("u", undefined, [edit("effort", number, "1", doc)]).set;
    expect(sent("2")).toEqual({ effort: 2 });
    expect(sent("-3")).toEqual({ effort: -3 });
    expect(sent("2.50")).toEqual({ effort: 2.5 });
    for (const doc of ["0x10", "1e3", "1,5", " 5", "5 ", ".5", "5.", "+5", "abc", "Infinity"]) {
      expect(sent(doc)).toEqual({ effort: doc });
    }
    expect(
      updateInput("u", undefined, [
        edit("sizes", { kind: "number", many: true, markdown: false }, "1", "1\n2.5\nx\n"),
      ]).set,
    ).toEqual({ sizes: [1, 2.5, "x"] });
    // Only a number property reads digits as a number.
    expect(updateInput("u", undefined, [edit("topic", text, "a", "7")]).set).toEqual({ topic: "7" });
  });

  it("[SR-104/AK1] gives the document of every stored value back as the same value, without a blank item or a line break", () => {
    for (const [stored, many] of [
      ["Wind", false],
      [["a", "b"], true],
      [["x y", "  z"], true],
      ["a b", true],
    ] as const) {
      const value = boxValue(stored, many);
      const sent = updateInput("u", undefined, [edit("criteria", many ? list : text, "", value?.doc ?? "")])
        .set?.["criteria"];
      expect(sent).toEqual(many && !Array.isArray(stored) ? [stored] : stored);
    }
  });
});

describe("savedHint", () => {
  it("is the first hint that names a saved key", () => {
    const problems = [{ message: "topic is odd" }, { message: "effort expects a number" }];
    expect(savedHint(problems, ["effort"])).toBe("effort expects a number");
    expect(savedHint(problems, ["topic", "effort"])).toBe("topic is odd");
    expect(savedHint(problems, ["criteria"])).toBeUndefined();
    expect(savedHint(undefined, ["effort"])).toBeUndefined();
  });
});

describe("editsOf", () => {
  it("is each box with what its editor holds, against the document it was typed on; a box that is gone is left out", () => {
    const boxes = editableBoxes(element({ topic: "Wind", criteria: ["a"] }), model);
    expect(
      editsOf(
        boxes,
        new Map([
          ["topic", "Gust"],
          ["criteria", "a"],
          ["gone", "x"],
        ]),
      ),
    ).toEqual([
      { key: "topic", info: text, base: "Wind", doc: "Gust" },
      { key: "criteria", info: list, base: "a", doc: "a" },
    ]);
  });
});

describe("changedUnderEdit", () => {
  const docs = (entries: [string, string][]) => new Map(entries);

  it("is true when the file changed a box the user has typed in", () => {
    expect(changedUnderEdit(docs([["topic", "a"]]), docs([["topic", "b"]]), docs([["topic", "mine"]]))).toBe(
      true,
    );
  });

  it("is false for a box without input and an unchanged box", () => {
    expect(changedUnderEdit(docs([["topic", "a"]]), docs([["topic", "b"]]), docs([["topic", "a"]]))).toBe(
      false,
    );
    expect(changedUnderEdit(docs([["topic", "a"]]), docs([["topic", "a"]]), docs([["topic", "mine"]]))).toBe(
      false,
    );
  });

  it("is true for a box with input whose property left the file, false for one without input", () => {
    expect(changedUnderEdit(docs([["topic", "a"]]), docs([]), docs([["topic", "mine"]]))).toBe(true);
    expect(changedUnderEdit(docs([["topic", "a"]]), docs([]), docs([["topic", "a"]]))).toBe(false);
  });
});
