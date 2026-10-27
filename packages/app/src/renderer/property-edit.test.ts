import type { DataExportElement, DataExportRelation } from "@logreq/core";
import { describe, expect, it } from "vitest";
import type { PropertyInfo, PropertyModel } from "./element-view.js";
import {
  addableProperties,
  allBoxes,
  boxValue,
  changedBoxes,
  choiceItems,
  chooseKey,
  chooseTarget,
  editableBoxes,
  editsOf,
  isValueKind,
  relationDoc,
  relationTargetOf,
  relationTargets,
  savedHint,
  shownBoxes,
  storedDocs,
  updateInput,
} from "./property-edit.js";
import type { BoxEdit, RelationTarget } from "./property-edit.js";

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
      [
        "area",
        {
          name: "Area",
          kind: "choice",
          many: false,
          markdown: false,
          choices: [
            { key: "quality", name: "Quality" },
            { key: "performance", name: "Performance" },
            { key: "interface", name: "Interface" },
          ],
        },
      ],
      ["tags", { kind: "choice", many: true, markdown: false, choices: [{ key: "a", name: "A" }] }],
      ["title", { kind: "text", many: false, markdown: false, meaning: "title" }],
      ["parent", { name: "Parent", kind: "relation", many: false, markdown: false, targetTypes: ["need"] }],
      ["packages", { name: "Package", kind: "relation", many: true, markdown: false }],
    ]),
  ],
]);

/** The definition of a property of the type `need` in the model above. */
const prop = (key: string): PropertyInfo => {
  const found = model.get("need")?.get(key);
  if (found === undefined) {
    throw new Error(`no property ${key}`);
  }
  return found;
};

const element = (
  properties: Record<string, unknown>,
  type = "need",
  relations: readonly DataExportRelation[] = [],
): DataExportElement => ({ type, properties, relations }) as unknown as DataExportElement;

/** A property target; `without` leaves fields out, as the output does for a relation with no repository or title. */
const target = (
  kind: string,
  id: string,
  extra: Partial<DataExportRelation> = {},
  without: readonly (keyof DataExportRelation)[] = [],
): DataExportRelation => {
  const relation: Record<string, unknown> = {
    kind,
    property: true,
    direction: "out",
    id,
    repository: "spec",
    shortId: "PKG-1",
    title: "Stufe 3",
    accessible: true,
    targetState: "available",
    ...extra,
  };
  return Object.fromEntries(
    Object.entries(relation).filter(([field]) => !without.includes(field as keyof DataExportRelation)),
  ) as unknown as DataExportRelation;
};

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
  it("[SR-104/AK1] has the filled properties of a text or choice kind that the type has, and no other", () => {
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
    expect([...boxes.keys()]).toEqual(["topic", "criteria", "effort", "area"]);
    expect(boxes.get("criteria")).toEqual({ key: "criteria", info: list, doc: "a\nb", lineBreak: false });
    expect(storedDocs(boxes)).toEqual(
      new Map([
        ["topic", "Wind"],
        ["criteria", "a\nb"],
        ["effort", "3"],
        ["area", "performance"],
      ]),
    );
  });

  it("has none for a type the model does not know", () => {
    expect(editableBoxes(element({ topic: "Wind" }, "other"), model).size).toBe(0);
    expect(editableBoxes(element({ topic: "Wind" }), new Map()).size).toBe(0);
  });
});

describe("editableBoxes of choices and relations (SR-104)", () => {
  it("[SR-104/AK3] has the stored keys of a choice, one per line", () => {
    const boxes = editableBoxes(element({ area: "quality", tags: ["a", "b"], topic: "x" }), model);
    expect(boxes.get("area")?.doc).toBe("quality");
    expect(boxes.get("tags")?.doc).toBe("a\nb");
    expect(boxes.get("area")?.lineBreak).toBe(false);
    // A choice stored as a boolean or a mapping is shown as it is, not edited.
    expect(editableBoxes(element({ area: true }), model).size).toBe(0);
  });

  it("has the targets of a relation property, from the relations of the element", () => {
    const stage = target("packages", "p1", { title: "Stufe 3" });
    const second = target("packages", "p2", {}, ["repository", "shortId", "title"]);
    const boxes = editableBoxes(
      element({ packages: [{ id: "p1" }, { id: "p2" }], parent: [] }, "need", [stage, second]),
      model,
    );
    expect([...boxes.keys()]).toEqual(["packages"]);
    expect(boxes.get("packages")?.doc).toBe("p1\tspec\tPKG-1 Stufe 3\np2\t\tp2");
    expect(relationTargets(boxes.get("packages")?.doc ?? "")).toEqual([
      { id: "p1", repository: "spec", label: "PKG-1 Stufe 3" },
      { id: "p2", repository: "", label: "p2" },
    ]);
  });

  it("marks a relation box unmatched when the file stores more items than the output gives targets for", () => {
    const stage = target("packages", "p1");
    const twoStored = editableBoxes(element({ packages: [{ id: "p1" }, "broken"] }, "need", [stage]), model);
    expect(twoStored.get("packages")?.unmatched).toBe(true);
    expect(twoStored.get("packages")?.doc).toBe("p1\tspec\tPKG-1 Stufe 3");
    expect(
      editableBoxes(element({ packages: [{ id: "p1" }] }, "need", [stage]), model).get("packages")?.unmatched,
    ).toBe(false);
    // A single relation stored as one item, and one stored as an empty text or as nothing.
    const parent = target("parent", "n1");
    expect(
      editableBoxes(element({ parent: { id: "n1" } }, "need", [parent]), model).get("parent")?.unmatched,
    ).toBe(false);
    expect(editableBoxes(element({ parent: "" }, "need", [parent]), model).get("parent")?.unmatched).toBe(
      true,
    );
    expect(editableBoxes(element({ parent: null }, "need", [parent]), model).get("parent")?.unmatched).toBe(
      true,
    );
  });

  it("leaves the box of a relation property whose targets the output does not give as it is shown", () => {
    expect(editableBoxes(element({ packages: [{ id: "x", title: "T" }] }), model).size).toBe(0);
  });

  it("leaves the box of a property the type does not know read-only, and a relation that is no property out", () => {
    const unknown = target("legacy", "x");
    expect(editableBoxes(element({ legacy: [{ id: "x" }] }, "need", [unknown]), model).size).toBe(0);
    expect(isValueKind("choice")).toBe(true);
    expect(isValueKind("relation")).toBe(true);
    expect(isValueKind("text")).toBe(false);
  });
});

describe("relation documents", () => {
  const targets: RelationTarget[] = [
    { id: "a", repository: "spec", label: "PKG-1 One" },
    { id: "b", repository: "", label: "b" },
  ];

  it("round trips the targets, one per line, and keeps a label on one line", () => {
    expect(relationTargets(relationDoc(targets))).toEqual(targets);
    expect(relationDoc([])).toBe("");
    expect(relationTargets("")).toEqual([]);
    expect(relationDoc([{ id: "c", repository: "r", label: "two\nlines\tand a tab" }])).toBe(
      "c\tr\ttwo lines and a tab",
    );
    // A line without a label or a repository.
    expect(relationTargets("only-id")).toEqual([{ id: "only-id", repository: "", label: "" }]);
  });

  it("takes the target of a relation row", () => {
    expect(relationTargetOf(target("packages", "p1"))).toEqual({
      id: "p1",
      repository: "spec",
      label: "PKG-1 Stufe 3",
    });
    expect(relationTargetOf(target("packages", "p1", {}, ["repository"]))).toMatchObject({
      repository: "",
    });
  });
});

describe("choiceItems and chooseKey", () => {
  const area = prop("area");
  const tags = prop("tags");

  it("[SR-104/AK3] offers exactly the choices of the metamodel, in its order, with the key as hint", () => {
    expect(choiceItems(area, [])).toEqual([
      { key: "quality", name: "Quality", hint: "quality", set: false },
      { key: "performance", name: "Performance", hint: "performance", set: false },
      { key: "interface", name: "Interface", hint: "interface", set: false },
    ]);
  });

  it("lists a value that is set first with the hint set, also one the metamodel does not offer", () => {
    expect(choiceItems(area, ["interface"]).map((item) => [item.name, item.hint, item.set])).toEqual([
      ["Interface", "set", true],
      ["Quality", "quality", false],
      ["Performance", "performance", false],
    ]);
    expect(choiceItems(area, ["legacy"]).map((item) => [item.name, item.hint, item.set])).toEqual([
      ["legacy", "set", true],
      ["Quality", "quality", false],
      ["Performance", "performance", false],
      ["Interface", "interface", false],
    ]);
    expect(choiceItems({ kind: "choice", many: false, markdown: false }, [])).toEqual([]);
  });

  it("[SR-104/AK3] replaces the value of a single choice and toggles the values of a list", () => {
    expect(chooseKey(area, ["quality"], "interface")).toEqual(["interface"]);
    expect(chooseKey(area, ["quality"], "quality")).toEqual(["quality"]);
    expect(chooseKey(area, [], "quality")).toEqual(["quality"]);
    expect(chooseKey(tags, ["a"], "b")).toEqual(["a", "b"]);
    expect(chooseKey(tags, ["a", "b"], "a")).toEqual(["b"]);
    expect(chooseKey(tags, ["a"], "a")).toEqual([]);
  });
});

describe("chooseTarget", () => {
  const one: RelationTarget = { id: "a", repository: "spec", label: "A" };
  const two: RelationTarget = { id: "b", repository: "spec", label: "B" };
  const parent = prop("parent");
  const packages = prop("packages");

  it("replaces the target of a single relation and appends to a list", () => {
    expect(chooseTarget(parent, [one], two)).toEqual([two]);
    expect(chooseTarget(parent, [], two)).toEqual([two]);
    expect(chooseTarget(packages, [one], two)).toEqual([one, two]);
  });

  it("removes a target that is set already, by id and repository", () => {
    expect(chooseTarget(packages, [one, two], { ...one, label: "other label" })).toEqual([two]);
    expect(chooseTarget(parent, [one], one)).toEqual([]);
    // The same UUID in another repository is another target.
    expect(chooseTarget(packages, [one], { ...one, repository: "vault" })).toEqual([
      one,
      { ...one, repository: "vault" },
    ]);
  });
});

describe("addableProperties", () => {
  it("[SR-104/AK2] offers the keys of the type that have no box, by name, without the title", () => {
    const found = addableProperties(element({ topic: "Wind", criteria: ["a"], title: "T" }), model);
    expect(found.map(({ key, name }) => [key, name])).toEqual([
      ["effort", "effort"],
      ["sizes", "sizes"],
      ["day", "day"],
      ["area", "Area"],
      ["tags", "tags"],
      ["parent", "Parent"],
      ["packages", "Package"],
    ]);
    // With the definition of the property, which the box is made from.
    expect(found.find((property) => property.key === "area")?.info).toBe(model.get("need")?.get("area"));
  });

  it("[SR-104/AK2] offers a key that is stored with an empty value, because no box shows it", () => {
    const found = addableProperties(element({ topic: "", criteria: [], area: "  ", effort: null }), model);
    expect(found.map((property) => property.key)).toEqual([
      "topic",
      "criteria",
      "effort",
      "sizes",
      "day",
      "area",
      "tags",
      "parent",
      "packages",
    ]);
  });

  it("leaves out the keys that were added already, the keys the type does not know and a relation property that has targets", () => {
    const stage = target("packages", "p1");
    const found = addableProperties(
      element({ unknown: "x", packages: [{ id: "p1" }] }, "need", [stage]),
      model,
      ["topic"],
    );
    expect(found.map((property) => property.key)).not.toContain("topic");
    expect(found.map((property) => property.key)).not.toContain("unknown");
    expect(found.map((property) => property.key)).not.toContain("packages");
    expect(addableProperties(element({}, "other"), model)).toEqual([]);
  });
});

describe("allBoxes", () => {
  it("[SR-104/AK2] has the editable boxes and an empty box, with the empty document, for each property that was added", () => {
    const boxes = allBoxes(element({ topic: "Wind", effort: { nested: true } }), model, [
      "area",
      "criteria",
      "nothing",
    ]);
    expect([...boxes.keys()]).toEqual(["topic", "area", "criteria"]);
    expect(boxes.get("area")).toEqual({
      key: "area",
      info: model.get("need")?.get("area"),
      doc: "",
      lineBreak: false,
    });
    expect(storedDocs(boxes).get("criteria")).toBe("");
  });

  it("leaves a filled box that is not edited as it is, and takes no empty box for it", () => {
    expect(allBoxes(element({ effort: { nested: true } }), model, ["effort"]).size).toBe(0);
  });
});

describe("shownBoxes", () => {
  it("[SR-104/AK2] puts an added box at its place in the order of the type, before the first box that comes after it", () => {
    const filled = element({ topic: "Wind", effort: 3, legacy: "x" });
    expect(shownBoxes(filled, model, ["criteria"]).map((box) => box.key)).toEqual([
      "topic",
      "criteria",
      "effort",
      "legacy",
    ]);
    expect(shownBoxes(filled, model, ["day"]).map((box) => box.key)).toEqual([
      "topic",
      "effort",
      "day",
      "legacy",
    ]);
    // Behind every other box, a key that the type has comes before one it does not know.
    expect(shownBoxes(filled, model, ["packages"]).map((box) => box.key)).toEqual([
      "topic",
      "effort",
      "packages",
      "legacy",
    ]);
  });

  it("gives an added box no lines, and several added boxes keep the order of the type", () => {
    const shown = shownBoxes(element({ topic: "Wind" }), model, ["area", "criteria"]);
    expect(shown).toEqual([
      { key: "topic", lines: ["Wind"] },
      { key: "criteria", lines: [] },
      { key: "area", lines: [] },
    ]);
  });

  it("ignores an added key that has a box already or that the type does not have", () => {
    expect(shownBoxes(element({ topic: "Wind" }), model, ["topic", "nothing"]).map((box) => box.key)).toEqual(
      ["topic"],
    );
    expect(shownBoxes(element({ topic: "Wind" }, "other"), model, ["topic"]).map((box) => box.key)).toEqual([
      "topic",
    ]);
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

describe("updateInput for choices and relations (SR-104)", () => {
  const area = prop("area");
  const tags = prop("tags");
  const parent = prop("parent");
  const packages = prop("packages");
  const edit = (key: string, info: PropertyInfo, base: string, doc: string): BoxEdit => ({
    key,
    info,
    base,
    doc,
  });

  it("[SR-104/AK3] sends the keys of a choice: one key for a single choice, the whole array for a list", () => {
    expect(
      updateInput("u", undefined, [edit("area", area, "", "quality"), edit("tags", tags, "a", "a\nb")]),
    ).toEqual({ ref: "u", set: { area: "quality", tags: ["a", "b"] } });
  });

  it("[SR-104/AK4] removes a choice and a relation that were emptied with unset", () => {
    expect(
      updateInput("u", undefined, [
        edit("area", area, "quality", ""),
        edit("tags", tags, "a", ""),
        edit("parent", parent, "a\tspec\tA", ""),
        edit("packages", packages, "a\tspec\tA\nb\t\tB", ""),
      ]),
    ).toEqual({ ref: "u", unset: ["area", "tags", "parent", "packages"] });
  });

  it("[SR-104/AK4] sends the targets of a relation as id and repository, for every target that remains", () => {
    expect(
      updateInput("u", undefined, [
        edit("packages", packages, "a\tspec\tA\nb\t\tB", "b\t\tB\nc\tvault\tC"),
        edit("parent", parent, "", "d\tspec\tD"),
      ]),
    ).toEqual({
      ref: "u",
      set: {
        packages: [{ id: "b" }, { id: "c", repository: "vault" }],
        parent: { id: "d", repository: "spec" },
      },
    });
  });

  it("does not send a choice or relation whose document is the stored one", () => {
    expect(
      updateInput("u", undefined, [
        edit("area", area, "quality", "quality"),
        edit("packages", packages, "a\tspec\tA", "a\tspec\tA"),
      ]),
    ).toEqual({ ref: "u" });
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
