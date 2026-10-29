// @vitest-environment happy-dom
import type { DataExportElement } from "@reqseq/core";
import { describe, expect, it, vi } from "vitest";
import {
  NOTHING,
  NOTICE_MS,
  copyField,
  copyNotice,
  copyable,
  cursorField,
  docOf,
  fieldText,
  heading,
  idField,
} from "./copy.js";

const element = (extra: Record<string, unknown> = {}): DataExportElement =>
  ({
    id: "uuid-1",
    shortId: "SR-000001",
    identifier: "SR-036",
    type: "system-requirement",
    title: "Measure wind",
    repository: "spec",
    file: "a.md",
    properties: { topic: "Wind", empty: "", criteria: ["first", "second"], count: 3 },
    relations: [
      {
        kind: "derives-from",
        direction: "out",
        id: "n1",
        shortId: "N-000001",
        identifier: "N-1",
        title: "Need",
      },
      { kind: "derives-from", direction: "out", id: "n2", shortId: "N-000002" },
      { kind: "derives-from", direction: "in", id: "r1", shortId: "SR-000009", title: "Child" },
    ],
    ...extra,
  }) as unknown as DataExportElement;

const labels = (from: ReturnType<typeof copyable>): string[] => from.fields.map((field) => field.label);

describe("copy", () => {
  it("[SR-128/AK2] puts the values of a field one per line", () => {
    expect(fieldText(["first", "second"])).toBe("first\nsecond");
    expect(fieldText(["only"])).toBe("only");
    expect(fieldText([])).toBe("");
  });

  it("[SR-128/AK1] has a field for the title, the text, each property box and each group of relations", () => {
    const from = copyable(element(), () => "doc");
    expect(labels(from)).toEqual([
      "Title",
      "Text",
      "topic",
      "criteria",
      "count",
      "derives-from",
      "← derives-from",
    ]);
    expect(from.fields.map((field) => field.text())).toEqual([
      "Measure wind",
      "doc",
      "Wind",
      "first\nsecond",
      "3",
      "N-1 Need\nN-000002",
      "SR-000009 Child",
    ]);
  });

  it("[SR-128/AK2] copies what the editor of a box holds, the unsaved input included, else the lines as shown", () => {
    const docs = new Map([["criteria", "first\nsecond\nthird"]]);
    const from = copyable(
      element(),
      () => "doc",
      (key) => docs.get(key),
    );
    expect(from.fields.map((field) => field.text())).toEqual([
      "Measure wind",
      "doc",
      "Wind",
      "first\nsecond\nthird",
      "3",
      "N-1 Need\nN-000002",
      "SR-000009 Child",
    ]);
    docs.set("criteria", "");
    expect(from.fields.find((field) => field.label === "criteria")?.text()).toBe("");
  });

  it("[SR-128/AK1] has a field for a relation property, and for a box that was added, in the order of the boxes", () => {
    const stage = {
      kind: "packages",
      property: true,
      direction: "out",
      id: "p1",
      shortId: "PKG-1",
      title: "Stufe 3",
    };
    const withPackage = element({
      properties: { topic: "Wind", packages: [{ id: "p1" }] },
      relations: [stage, { kind: "derives-from", direction: "out", id: "n1", shortId: "N-000001" }],
    });
    const from = copyable(withPackage, () => "doc");
    expect(labels(from)).toEqual(["Title", "Text", "topic", "packages", "derives-from"]);
    expect(from.fields.map((field) => field.text()).slice(3)).toEqual(["PKG-1 Stufe 3", "N-000001"]);
    // The boxes as the buffer shows them: a box that was added has a field, empty.
    const shown = copyable(
      withPackage,
      () => "doc",
      (key) => (key === "packages" ? "PKG-1 Stufe 3\nPKG-2 Zwei" : undefined),
      [
        { key: "area", lines: [] },
        { key: "packages", lines: ["PKG-1 Stufe 3"] },
      ],
    );
    expect(labels(shown).slice(0, 4)).toEqual(["Title", "Text", "area", "packages"]);
    expect(shown.fields.map((field) => field.text()).slice(2, 4)).toEqual(["", "PKG-1 Stufe 3\nPKG-2 Zwei"]);
  });

  it("[SR-128/AK2] copies the text as the editor holds it, and the heading as the buffer shows it", () => {
    let doc = "saved";
    const from = copyable(element({ title: "" }), () => doc);
    doc = "saved and typed";
    expect(from.fields.map((field) => field.text()).slice(0, 2)).toEqual(["SR-036", "saved and typed"]);
    expect(heading(element({ title: "", identifier: undefined }))).toBe("SR-000001");
    expect(heading(element({ title: "  ", identifier: undefined }))).toBe("SR-000001");
    expect(heading(element())).toBe("Measure wind");
  });

  it("copies what the editor of the title holds, the heading when it holds nothing (#621)", () => {
    let title: string | undefined;
    const from = copyable(
      element(),
      () => "doc",
      (key) => (key === "Title" ? title : undefined),
    );
    expect(from.fields[0]?.text()).toBe("Measure wind");
    title = "Measure gusts";
    expect(from.fields[0]?.text()).toBe("Measure gusts");
    title = "";
    expect(from.fields[0]?.text()).toBe("Measure wind");
    title = "  ";
    expect(from.fields[0]?.text()).toBe("Measure wind");
  });

  it("[SR-128/AK3] names the element by its identifier, else its short ID", () => {
    expect(idField(element()).label).toBe("ID");
    expect(idField(element()).text()).toBe("SR-036");
    expect(idField(element({ identifier: undefined })).text()).toBe("SR-000001");
    expect(copyable(element(), () => "").id?.text()).toBe("SR-036");
  });

  it("[SR-128/AK3] hands the field with this label to the copy, else the ID, else nothing", () => {
    const copy = vi.fn();
    const from = copyable(element(), () => "doc");
    copyField(from, "criteria", copy);
    copyField(from, undefined, copy);
    copyField(from, "no such field", copy);
    expect(copy.mock.calls).toEqual([
      ["criteria", "first\nsecond"],
      ["ID", "SR-036"],
      ["ID", "SR-036"],
    ]);
    copyField(NOTHING, "criteria", copy);
    expect(copy).toHaveBeenCalledTimes(3);
  });

  it("[SR-128/AK2] says what was copied, or that the copy failed, for a short time", () => {
    expect(copyNotice("criteria", true)).toBe("Copied criteria");
    expect(copyNotice("criteria", false)).toBe("Copy failed");
    expect(NOTICE_MS).toBeGreaterThan(0);
    expect(NOTICE_MS).toBeLessThanOrEqual(5000);
  });

  it("[SR-128/AK3] takes the field the focus is in, the one before while the command prompt has the focus, else none", () => {
    document.body.innerHTML =
      '<article data-buffer><div data-field="topic"><span id="in-field"></span></div><p id="in-buffer"></p></article><input id="prompt-input"><input id="elsewhere">';
    const at = (id: string): Element | null => document.getElementById(id);
    expect(cursorField(at("in-field"), "Title")).toBe("topic");
    expect(cursorField(at("in-buffer"), "Title")).toBeUndefined();
    expect(cursorField(at("prompt-input"), "Title")).toBe("Title");
    expect(cursorField(at("prompt-input"), undefined)).toBeUndefined();
    // A stale field: the focus went somewhere else than the prompt.
    expect(cursorField(at("elsewhere"), "Title")).toBeUndefined();
    expect(cursorField(null, "Title")).toBeUndefined();
    document.body.innerHTML = "";
  });

  it("asks the editor for its text, and has none without one", () => {
    expect(docOf({ doc: () => "typed" })).toBe("typed");
    expect(docOf(undefined)).toBe("");
  });
});
